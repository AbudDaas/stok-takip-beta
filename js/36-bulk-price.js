/**
 * Toplu fiyat güncelleme (Ayarlar'dan açılıp kapatılır).
 *
 * Kur oynayınca tüm fiyatları tek seferde yüzdeyle (ya da sabit tutarla)
 * değiştirmek için. Kapsam: tüm ürünler ya da tek kategori. Hedef: satış fiyatı,
 * alış fiyatı ya da ikisi. Sonuç, seçilen basamağa yuvarlanabilir (örn. 100 ل.س'ye).
 *
 * Güvenlik: uygulamadan önce önizleme + onay; son güncelleme "Geri al" için saklanır;
 * değişen her satış fiyatı fiyat değişim günlüğüne yazılır.
 */

import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { CURRENCIES, escapeHtml, formatMoney, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';

export const ROUNDING_OPTIONS = [0, 1, 5, 10, 50, 100, 500, 1000];

const PRICE_FIELDS = ["price", "discountedPrice"];
const COST_FIELDS = ["costPrice", "caseCostPrice"];

/**
 * Saf: tek bir tutarın yeni değeri. mode: "percent" (change = %) | "amount" (change = ± tutar).
 * rounding 0 ise para biriminin ondalığına; aksi halde en yakın katına yuvarlar.
 * Sonuç hiçbir zaman 0'ın altına düşmez; pozitif tutar 0'a düşmez (en küçük birim).
 */
export function computeNewValue(value, { mode, change, rounding, currency }) {
  const v = Number(value);
  const c = Number(change);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(c)) return v;
  const decimals = (CURRENCIES[currency] || CURRENCIES.TRY).decimals;
  const unit = Math.pow(10, -decimals);
  const raw = mode === "percent" ? v * (1 + c / 100) : v + c;
  const step = Number(rounding) > 0 ? Number(rounding) : unit;
  let result = Math.round(raw / step) * step;
  result = Math.round(result * 1e6) / 1e6;
  if (result < unit) result = unit;
  return Math.round(result / unit) * unit > 0 ? Math.round((result / unit)) * unit : unit;
}

/** Hedefe göre güncellenecek alan adları. */
export function fieldsFor(target, product) {
  const fields = [];
  if (target === "price" || target === "both") {
    fields.push(...PRICE_FIELDS);
    if (product && product.bulkDiscountType === "amount") fields.push("bulkDiscountValue");
  }
  if (target === "cost" || target === "both") fields.push(...COST_FIELDS);
  return fields;
}

/**
 * Saf: plan üretir (ürünlere dokunmaz).
 * opts: { mode, change, target, category, rounding, currency }
 * Dönüş: [{ id, name, changes: [{field, from, to}] }] (yalnızca değişenler)
 */
export function planBulkUpdate(products, opts) {
  const plan = [];
  (products || []).forEach((p) => {
    if (opts.category && p.category !== opts.category) return;
    const changes = [];
    fieldsFor(opts.target, p).forEach((field) => {
      if (!(Number(p[field]) > 0)) return;
      const to = computeNewValue(p[field], opts);
      if (to !== p[field]) changes.push({ field, from: p[field], to });
    });
    if (changes.length) plan.push({ id: p.id, name: p.name, changes });
  });
  return plan;
}

/** Planı ürünlere uygular, geri alma için eski değerleri döner. */
export function applyPlan(products, plan) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const snapshot = [];
  plan.forEach((item) => {
    const p = byId.get(item.id);
    if (!p) return;
    const old = {};
    item.changes.forEach((c) => {
      old[c.field] = p[c.field];
      p[c.field] = c.to;
    });
    snapshot.push({ id: p.id, old });
  });
  return snapshot;
}

/** Geri alma: eski değerleri yazar. Dönüş: geri alınan ürün sayısı. */
export function restoreSnapshot(products, snapshot) {
  const byId = new Map(products.map((p) => [p.id, p]));
  let n = 0;
  (snapshot || []).forEach((s) => {
    const p = byId.get(s.id);
    if (!p) return;
    Object.entries(s.old).forEach(([field, value]) => {
      p[field] = value;
    });
    n++;
  });
  return n;
}

function persist(fields) {
  const ref = state.originalDocRef || state.docRef;
  if (ref) ref.set(fields, { merge: true }).catch((e) => console.error("Toplu fiyat ayarı kaydedilemedi", e));
}

function readOptions() {
  return {
    mode: document.getElementById("bulkPriceMode").value,
    change: Number(String(document.getElementById("bulkPriceChange").value).replace(",", ".")),
    target: document.getElementById("bulkPriceTarget").value,
    category: document.getElementById("bulkPriceCategory").value,
    rounding: Number(document.getElementById("bulkPriceRounding").value),
    currency: state.currency
  };
}

export function toggleBulkPrice() {
  state.bulkPriceEnabled = document.getElementById("bulkPriceEnabledCheck").checked;
  persist({ bulkPriceEnabled: state.bulkPriceEnabled });
  renderBulkPriceSettings();
}

export function previewBulkPrice() {
  const opts = readOptions();
  const out = document.getElementById("bulkPricePreview");
  if (!Number.isFinite(opts.change) || opts.change === 0) {
    out.textContent = state.t("bulkPriceInvalid");
    return null;
  }
  const plan = planBulkUpdate(state.products, opts);
  if (!plan.length) {
    out.textContent = state.t("bulkPriceNothing");
    return null;
  }
  const sample = plan
    .slice(0, 5)
    .map((it) => {
      const c = it.changes[0];
      return `<div class="reminder-row"><p class="reminder-name">${escapeHtml(it.name)}</p><span>${escapeHtml(formatMoney(c.from, state.currency))} → <b>${escapeHtml(formatMoney(c.to, state.currency))}</b></span></div>`;
    })
    .join("");
  out.innerHTML = `<p class="card-subtitle">${escapeHtml(state.t("bulkPricePreviewCount").replace("{n}", plan.length))}</p>${sample}`;
  return plan;
}

export function applyBulkPrice() {
  const plan = previewBulkPrice();
  if (!plan) return;
  if (!confirm(state.t("bulkPriceConfirm").replace("{n}", plan.length))) return;
  const now = new Date().toISOString();
  const snapshot = applyPlan(state.products, plan);
  plan.forEach((it) => {
    const priceChange = it.changes.find((c) => c.field === "price");
    if (priceChange) {
      state.priceChangeLog.push({
        productName: it.name,
        oldPrice: priceChange.from,
        newPrice: priceChange.to,
        direction: priceChange.to > priceChange.from ? "up" : "down",
        timestamp: now
      });
    }
  });
  state.lastBulkPrice = { at: now, count: snapshot.length, items: snapshot };
  persist({ lastBulkPrice: state.lastBulkPrice });
  const o = readOptions();
  logAudit("Toplu fiyat güncellendi", `${o.mode === "percent" ? "%" + o.change : o.change} · ${o.target} · ${plan.length} ürün`);
  save();
  document.getElementById("bulkPriceChange").value = "";
  showToast(state.t("bulkPriceDone").replace("{n}", plan.length), "success");
  document.dispatchEvent(new CustomEvent("bulk-price-changed"));
}

export function undoBulkPrice() {
  const last = state.lastBulkPrice;
  if (!last || !last.items || !last.items.length) return;
  if (!confirm(state.t("bulkPriceUndoConfirm").replace("{n}", last.count))) return;
  const n = restoreSnapshot(state.products, last.items);
  state.lastBulkPrice = null;
  persist({ lastBulkPrice: null });
  logAudit("Toplu fiyat güncellemesi geri alındı", `${n} ürün`);
  save();
  showToast(state.t("bulkPriceUndone").replace("{n}", n), "success");
  document.dispatchEvent(new CustomEvent("bulk-price-changed"));
}

export function renderBulkPriceSettings() {
  const check = document.getElementById("bulkPriceEnabledCheck");
  const panel = document.getElementById("bulkPricePanel");
  if (!check || !panel) return;
  check.checked = Boolean(state.bulkPriceEnabled);
  panel.style.display = state.bulkPriceEnabled ? "" : "none";
  if (!state.bulkPriceEnabled) return;

  const catSelect = document.getElementById("bulkPriceCategory");
  const current = catSelect.value;
  const cats = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort();
  catSelect.innerHTML = `<option value="">${escapeHtml(state.t("bulkPriceAllCategories"))}</option>` + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  catSelect.value = cats.includes(current) ? current : "";

  const roundSelect = document.getElementById("bulkPriceRounding");
  if (!roundSelect.options.length) {
    roundSelect.innerHTML = ROUNDING_OPTIONS.map((r) => `<option value="${r}">${r === 0 ? escapeHtml(state.t("bulkPriceNoRounding")) : escapeHtml(state.t("bulkPriceRoundTo").replace("{n}", r))}</option>`).join("");
  }
  const undo = document.getElementById("bulkPriceUndoBtn");
  const last = state.lastBulkPrice;
  undo.style.display = last && last.items && last.items.length ? "" : "none";
  if (last && last.at) undo.querySelector("span").textContent = `${state.t("bulkPriceUndoBtn")} (${new Date(last.at).toLocaleDateString()}, ${last.count})`;
}
