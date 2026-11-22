/**
 * Stok hareketleri (stock movements).
 *
 * Stok miktarı her değiştiğinde "ne oldu, neden, kim yaptı, önce/sonra kaç
 * vardı" bilgisi ayrı bir kayıt olarak saklanır. Böylece:
 *  - bir ürünün stoğunun neden azaldığı/arttığı geriye dönük görülebilir,
 *  - stokta fazla satış (stoktan fazla satılan miktar) fark edilebilir,
 *  - ileride satış hızı / sipariş önerisi gibi özellikler bu kayıtlardan beslenebilir.
 *
 * Kayıtlar işletme belgesinin İÇİNE yazılmaz (1 MiB belge sınırını doldurmasın
 * diye); `isletmeler/{id}/stokHareketleri/{hareketId}` alt koleksiyonuna her
 * hareket ayrı bir belge olarak yazılır. Hareket kimliği istemcide üretilir,
 * aynı kayıt tekrar gönderilirse üzerine yazılır (çift kayıt oluşmaz).
 * Firestore çevrimdışı önbelleği, internet yokken yazılanları sonra gönderir.
 *
 * Yazma başarısız olursa (örn. güvenlik kuralı yok) uygulama ASLA bozulmaz:
 * kayıt cihazda yerel olarak saklanır.
 */

import { state } from './00-state.js';
import { locale } from './01-firebase-core.js';
import { escapeHtml, genId } from './02-utils.js';
import { getActorName } from './03-staff-roles.js';

export const STOCK_MOVEMENT_COLLECTION = "stokHareketleri";
export const STOCK_MOVEMENT_TYPES = [
  "initial", // yeni ürün, açılış stoğu
  "sale", // satış
  "sale_cancel", // satış iptali
  "return", // müşteri iadesi
  "supplier_return", // tedarikçiye iade
  "waste", // fire / kayıp (kırık, bozuk, SKT, kayıp)
  "purchase", // alım (fatura/irsaliye)
  "manual_add", // elle artırma (+)
  "manual_remove", // elle azaltma (-)
  "manual_set", // elle sayı girme
  "count", // fiziksel sayım düzeltmesi
  "warehouse_in", // depoya ekleme
  "transfer_to_shelf", // depodan rafa aktarma
  "reset" // toplu sıfırlama
];

const LOCAL_KEY = "bakkal_stok_hareketleri";
const LOCAL_MAX = 500;

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/**
 * Saf fonksiyon: bir hareket kaydı nesnesi üretir (yazma yapmaz, test edilebilir).
 * - before/after: işlemden önceki/sonraki miktar
 * - requested: istenen değişim (örn. -7). Gerçek değişimden farklıysa kaydedilir;
 *   böylece "10 stok varken 12 satıldı" gibi durumlar görünür kalır.
 * - location: "raf" ya da "depo"
 */
export function buildMovement({ product, type, before, after, location, requested, ref, note, actor, now }) {
  const b = round3(before);
  const a = round3(after);
  const movement = {
    id: genId(),
    productId: product && product.id ? String(product.id) : "",
    productName: (product && product.name) || "",
    type,
    location: location === "depo" ? "depo" : "raf",
    before: b,
    after: a,
    delta: round3(a - b),
    actor: actor || "?",
    timestamp: now || new Date().toISOString()
  };
  if (requested != null && round3(requested) !== movement.delta) movement.requested = round3(requested);
  if (ref) movement.ref = String(ref);
  if (note) movement.note = String(note);
  return movement;
}

function readLocal() {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveLocal(movement) {
  try {
    const list = readLocal();
    list.push(movement);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-LOCAL_MAX)));
  } catch (e) {
    // localStorage doluysa/erişilemiyorsa sessizce vazgeç: kayıt tutma, asıl işlemi bozmamalı.
  }
}

function persist(movement) {
  if (state.cloudEnabled && state.docRef) {
    try {
      state.docRef
        .collection(STOCK_MOVEMENT_COLLECTION)
        .doc(movement.id)
        .set(movement)
        .catch((e) => {
          console.warn("Stok hareketi buluta yazılamadı, yerel olarak saklandı", e && e.code);
          state.stockMovementWriteError = (e && e.code) || "error";
          saveLocal(movement);
        });
      return;
    } catch (e) {
      // aşağıda yerel kayda düşer
    }
  }
  saveLocal(movement);
}

/**
 * Bir stok hareketini kaydeder. Değişim yoksa (delta 0 ve istek farkı yoksa)
 * kayıt oluşturmaz ve null döner. Asla hata fırlatmaz.
 */
export function recordStockMovement(options) {
  try {
    const movement = buildMovement({ actor: getActorName(), ...options });
    if (movement.delta === 0 && movement.requested == null) return null;
    persist(movement);
    return movement;
  } catch (e) {
    console.warn("Stok hareketi kaydedilemedi", e);
    return null;
  }
}

/**
 * Hareketleri okur (en yeni önce). productId verilirse sadece o ürünün hareketleri.
 * Dönüş: { movements, error } — error doluysa bulut okunamadı (yerel kayıtlar yine döner).
 */
export async function loadStockMovements(productId, limit = 100) {
  let list = readLocal().filter((m) => !productId || m.productId === productId);
  let error = null;
  if (state.cloudEnabled && state.docRef) {
    try {
      let query = state.docRef.collection(STOCK_MOVEMENT_COLLECTION);
      // Tek alan eşitliği / tek alan sıralaması: ek (bileşik) indeks gerektirmez.
      query = productId ? query.where("productId", "==", productId).limit(300) : query.orderBy("timestamp", "desc").limit(limit);
      const snap = await query.get();
      snap.forEach((doc) => list.push(doc.data()));
    } catch (e) {
      error = (e && e.code) || "error";
    }
  }
  const seen = new Set();
  list = list.filter((m) => m && m.id && !seen.has(m.id) && seen.add(m.id));
  list.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return { movements: list.slice(0, limit), error };
}

function fmtSigned(n) {
  const v = round3(n);
  return (v > 0 ? "+" : "") + v.toLocaleString(locale(), { maximumFractionDigits: 3 });
}

export function renderMovementRows(movements) {
  return movements
    .map((m) => {
      const d = new Date(m.timestamp);
      const when = d.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const typeLabel = state.t("stockMove_" + m.type) || m.type;
      const place = m.location === "depo" ? ` · ${state.t("stockMoveWarehouse")}` : "";
      const oversold = m.requested != null && m.requested < m.delta ? ` <span class="stock-move-warn">⚠ ${state.t("stockMoveShortfall")}: ${fmtSigned(m.requested)}</span>` : "";
      const cls = m.delta > 0 ? "stock-move-plus" : m.delta < 0 ? "stock-move-minus" : "";
      return `
        <div class="audit-log-row stock-move-row">
          <p class="audit-log-action"><span class="${cls}">${fmtSigned(m.delta)}</span> · ${escapeHtml(typeLabel)}${place}${oversold}</p>
          <p class="audit-log-meta">${when} · ${escapeHtml(m.actor || "?")} · ${m.before} → ${m.after}${m.note ? " · " + escapeHtml(m.note) : ""}</p>
        </div>`;
    })
    .join("");
}

/** Ürün detay penceresindeki "Stok geçmişi" bölümünü doldurur. */
export async function renderStockHistory(productId) {
  const listEl = document.getElementById("stockHistoryList");
  const msgEl = document.getElementById("stockHistoryMsg");
  if (!listEl || !msgEl) return;
  listEl.innerHTML = "";
  msgEl.textContent = state.t("stockHistoryLoading");
  const { movements, error } = await loadStockMovements(productId, 100);
  if (state.activeProductId !== productId) return; // bu arada başka ürün/kapatma
  if (error && !movements.length) {
    msgEl.textContent = error === "permission-denied" ? state.t("stockHistoryNoPermission") : state.t("stockHistoryError");
    return;
  }
  msgEl.textContent = movements.length ? (error ? state.t("stockHistoryPartial") : "") : state.t("stockHistoryEmpty");
  listEl.innerHTML = renderMovementRows(movements);
}
