/**
 * Fire / kayıp kaydı ve raporu.
 *
 * Kırılan, bozulan, SKT'si geçen ya da kaybolan ürün stoktan düşülür, "waste" türünde
 * bir stok hareketi olarak kaydedilir ve ayrı bir fire kaydı (state.wasteLog) tutulur.
 * Fire değeri, o günkü alış fiyatından hesaplanır (alış fiyatı sonradan değişse de
 * eski kayıt değişmez). Rapor, seçili dönem için neden bazında toplam adet ve değer verir.
 */

import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { escapeHtml, formatMoney, genId, showToast } from './02-utils.js';
import { getActorName, logAudit } from './03-staff-roles.js';
import { recordStockMovement } from './25-stock-movements.js';

export const WASTE_REASONS = ["broken", "spoiled", "expired", "lost", "other"];

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/**
 * Saf: fire kaydı nesnesi. Hata: { error: "qty" | "stock" | "reason" }.
 */
export function buildWasteRecord({ product, qty, reason, note, by, now, currency }) {
  const q = round3(qty);
  if (!product || !(q > 0)) return { error: "qty" };
  if (!WASTE_REASONS.includes(reason)) return { error: "reason" };
  if (q > round3(product.qty)) return { error: "stock" };
  const cost = Number(product.costPrice) || 0;
  return {
    record: {
      id: genId(),
      productId: product.id,
      name: product.name,
      unit: product.unit || "adet",
      qty: q,
      reason,
      note: note || "",
      costPrice: cost,
      value: Math.round(q * cost * 100) / 100,
      currency,
      by: by || "",
      timestamp: now || new Date().toISOString()
    }
  };
}

/** Saf: kayıtları neden ve para birimine göre toplar. */
export function summarizeWaste(records) {
  const byReason = {};
  const byCurrency = {};
  let count = 0;
  (records || []).forEach((r) => {
    count++;
    const row = byReason[r.reason] || (byReason[r.reason] = { qty: 0, value: {} });
    row.qty = round3(row.qty + (Number(r.qty) || 0));
    const code = r.currency || "TRY";
    row.value[code] = Math.round(((row.value[code] || 0) + (Number(r.value) || 0)) * 100) / 100;
    byCurrency[code] = Math.round(((byCurrency[code] || 0) + (Number(r.value) || 0)) * 100) / 100;
  });
  return { count, byReason, byCurrency };
}

export function saveWaste() {
  const p = state.products.find((x) => x.id === state.activeProductId);
  if (!p) return;
  const qtyEl = document.getElementById("wasteQty");
  const reasonEl = document.getElementById("wasteReason");
  const noteEl = document.getElementById("wasteNote");
  const res = buildWasteRecord({
    product: p,
    qty: qtyEl.value,
    reason: reasonEl.value,
    note: noteEl.value.trim(),
    by: getActorName(),
    currency: state.currency
  });
  if (res.error) {
    showToast(state.t(res.error === "stock" ? "wasteMoreThanStock" : "wasteInvalid"), "error");
    return;
  }
  const before = p.qty;
  p.qty = round3(p.qty - res.record.qty);
  recordStockMovement({ product: p, type: "waste", before, after: p.qty, requested: -res.record.qty, ref: res.record.id, note: res.record.reason });
  state.wasteLog = [...(state.wasteLog || []), res.record].slice(-2000);
  logAudit("Fire/kayıp kaydedildi", `${p.name}: ${res.record.qty} (${res.record.reason}) — ${formatMoney(res.record.value, state.currency)}`);
  save();
  qtyEl.value = "";
  noteEl.value = "";
  showToast(state.t("wasteSaved"), "success");
  document.dispatchEvent(new CustomEvent("waste-changed"));
}

/** Satışlar sekmesindeki fire kartı. `inPeriod(timestamp)` seçili dönemi belirler. */
export function renderWasteReport(inPeriod) {
  const card = document.getElementById("wasteReportCard");
  if (!card) return;
  const records = (state.wasteLog || []).filter((r) => inPeriod(r.timestamp));
  const sum = summarizeWaste(records);
  document.getElementById("wasteReportTotal").textContent = Object.keys(sum.byCurrency).length
    ? Object.entries(sum.byCurrency).map(([c, v]) => formatMoney(v, c)).join(" + ")
    : formatMoney(0, state.currency);
  const reasons = Object.entries(sum.byReason)
    .map(([reason, row]) => {
      const val = Object.entries(row.value).map(([c, v]) => formatMoney(v, c)).join(" + ");
      return `<div class="reminder-row"><div><p class="reminder-name">${escapeHtml(state.t("wasteReason_" + reason))}</p><p class="reminder-meta">${row.qty}</p></div><span style="font-weight:700;">${escapeHtml(val)}</span></div>`;
    })
    .join("");
  const recent = [...records]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10)
    .map(
      (r) =>
        `<div class="reminder-row"><div><p class="reminder-name">${escapeHtml(r.name)} · ${r.qty}</p><p class="reminder-meta">${escapeHtml(state.t("wasteReason_" + r.reason))}${r.note ? " — " + escapeHtml(r.note) : ""} · ${new Date(r.timestamp).toLocaleDateString()}</p></div><span>${escapeHtml(formatMoney(r.value, r.currency || state.currency))}</span></div>`
    )
    .join("");
  document.getElementById("wasteReportList").innerHTML = reasons + recent;
  document.getElementById("wasteReportEmpty").style.display = records.length ? "none" : "block";
}
