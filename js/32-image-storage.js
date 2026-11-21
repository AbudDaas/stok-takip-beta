/**
 * Görsel depolama: Cloudflare R2 (Worker üzerinden) ya da — ayar boşsa — eski
 * Firebase Storage. Firebase Storage ücretli plan (Blaze + faturalama hesabı)
 * gerektirdiği için, faturalama durunca resimler 402 hatasıyla açılmaz.
 * Kurulum: r2-worker/KURULUM.md ve js/image-config.js.
 */

import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { showToast } from './02-utils.js';

/** Worker adresi (sonunda "/" yok) ya da "" (ayarlanmamış). */
export function getImageWorkerUrl() {
  const url = typeof imageConfig !== "undefined" && imageConfig && imageConfig.workerUrl ? String(imageConfig.workerUrl).trim() : "";
  if (!url || url.indexOf("BURAYA") === 0) return "";
  // "https://" yazılmamışsa ekle; yoksa adres GitHub Pages'e göre göreli sayılır ve istek 405 alır.
  return normalizeWorkerUrl(url);
}

/** Saf: boşlukları atar, https:// ekler (yoksa), sondaki "/" işaretlerini siler. */
export function normalizeWorkerUrl(raw) {
  let url = String(raw || "").trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url.replace(/^\/+/, "");
  return url;
}

export function isR2Configured() {
  return Boolean(getImageWorkerUrl());
}

/** Saf: yüklenmiş görselin herkese açık adresi. `v`, önbelleği tazelemek için. */
export function buildImageUrl(base, path, v) {
  return `${base}/img/${path}?v=${v}`;
}

/** Saf: adres eski Firebase Storage'a mı ait? */
export function isLegacyStorageUrl(url) {
  return typeof url === "string" && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com|[^/]*\.firebasestorage\.app)\//.test(url);
}

/** Aktif işletmenin kimliği (personel girişinde de sahibin belge kimliği). */
export function getBusinessId() {
  return (state.originalDocRef || state.docRef).id;
}

/**
 * Görseli yükler ve herkese açık adresini döner.
 * path örn.: `product-images/<işletmeId>/<ürünId>.jpg`
 */
export async function uploadImage(path, blob) {
  const base = getImageWorkerUrl();
  if (!base) {
    if (!state.storage) throw new Error("Storage etkin değil");
    const ref = state.storage.ref(path);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }
  if (!state.currentUser) throw new Error("Giriş yapılmamış");
  const idToken = await state.currentUser.getIdToken();
  const res = await fetch(`${base}/img/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": blob.type || "image/jpeg" },
    body: blob
  });
  if (!res.ok) {
    let reason = "";
    try {
      const body = await res.json();
      reason = body && body.reason ? ` — ${body.reason}` : "";
    } catch (e) {
      // gövde okunamadı
    }
    throw new Error(`Görsel yüklenemedi (${res.status})${reason}`);
  }
  return buildImageUrl(base, path, Date.now());
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Eski Firebase Storage adreslerindeki görselleri R2'ye taşır (ürün fotoğrafları + logo).
 * Eski depoya erişilemiyorsa (faturalama kapalı, 402) art arda hata alınca durur.
 * Dönüş: { migrated, failed, skipped, aborted }
 */
export async function migrateImagesToR2(onProgress) {
  const result = { migrated: 0, failed: 0, skipped: 0, aborted: false };
  if (!isR2Configured()) throw new Error("R2 ayarlı değil");
  const businessId = getBusinessId();
  const targets = state.products.filter((p) => isLegacyStorageUrl(p.image));
  result.skipped = state.products.filter((p) => p.image && !isLegacyStorageUrl(p.image)).length;
  let consecutiveFails = 0;

  const moveOne = async (url, path) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`eski depo ${res.status}`);
    const blob = await res.blob();
    return uploadImage(path, blob);
  };

  await mapLimit(targets, 3, async (p) => {
    if (result.aborted) return;
    try {
      p.image = await moveOne(p.image, `product-images/${businessId}/${p.id}.jpg`);
      result.migrated++;
      consecutiveFails = 0;
    } catch (e) {
      result.failed++;
      consecutiveFails++;
      if (consecutiveFails >= 5 && result.migrated === 0) result.aborted = true;
    }
    if (onProgress) onProgress(result, targets.length);
  });

  if (!result.aborted && isLegacyStorageUrl(state.businessLogo)) {
    try {
      state.businessLogo = await moveOne(state.businessLogo, `business-logos/${businessId}/logo.jpg`);
      const ref = state.originalDocRef || state.docRef;
      if (ref) await ref.set({ businessLogo: state.businessLogo }, { merge: true });
      result.migrated++;
    } catch (e) {
      result.failed++;
    }
  }
  if (result.migrated > 0) save();
  return result;
}

/** Ayarlar ekranındaki düğme. */
export async function runImageMigration() {
  if (!isR2Configured()) {
    showToast(state.t("imageMigrateNotConfigured"), "error");
    return;
  }
  if (!confirm(state.t("imageMigrateConfirm"))) return;
  showToast(state.t("imageMigrateRunning"), "success");
  try {
    const r = await migrateImagesToR2((res, total) => {
      const el = document.getElementById("imageMigrateStatus");
      if (el) el.textContent = `${res.migrated + res.failed} / ${total}`;
    });
    if (r.aborted) {
      showToast(state.t("imageMigrateOldInaccessible"), "error");
    } else {
      showToast(state.t("imageMigrateDone").replace("{ok}", r.migrated).replace("{fail}", r.failed), r.failed ? "error" : "success");
    }
  } catch (e) {
    console.error("Görsel taşıma hatası", e);
    showToast(state.t("imageMigrateFailed"), "error");
  }
}