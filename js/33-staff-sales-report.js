/**
 * Satışı yapan personel + personel (kasiyer) bazında satış raporu.
 *
 * Her yeni satışa `staffId` ve `staffName` yazılır. Personel seçilmemişse
 * (sahip girişi) "owner". Bu alanları olmayan eski satışlar "Belirtilmemiş"
 * olarak toplanır.
 */

import { state } from './00-state.js';
import { escapeHtml, formatMoney } from './02-utils.js';

export const OWNER_ID = "owner";
export const UNKNOWN_ID = "unknown";

/** Şu an işlem yapan kişi: { staffId, staffName }. */
export function currentStaffInfo() {
  const s = state.currentStaff;
  if (s && s.id) return { staffId: s.id, staffName: s.name };
  return { staffId: OWNER_ID, staffName: state.t("staffOwnerLabel") };
}

/**
 * Saf: satışları personele göre toplar (para birimi başına ayrı, karışmasın).
 * Dönüş: [{ staffId, name, count, byCurrency: {kod: {total, nakit, kart, veresiye}} }] (çok satandan aza)
 */
export function summarizeByStaff(sales, fallbackCurrency, unknownLabel = "—") {
  const map = new Map();
  (sales || []).forEach((s) => {
    const id = s.staffId || UNKNOWN_ID;
    if (!map.has(id)) map.set(id, { staffId: id, name: s.staffName || unknownLabel, count: 0, byCurrency: {}, _sort: 0 });
    const row = map.get(id);
    if (s.staffName) row.name = s.staffName;
    const code = s.currency || fallbackCurrency;
    const cur = row.byCurrency[code] || (row.byCurrency[code] = { total: 0, nakit: 0, kart: 0, veresiye: 0 });
    const total = Number(s.total) || 0;
    cur.total += total;
    const type = s.paymentType === "kart" || s.paymentType === "veresiye" ? s.paymentType : "nakit";
    cur[type] += total;
    row.count++;
    row._sort += total;
  });
  return [...map.values()].sort((a, b) => b._sort - a._sort).map(({ _sort, ...rest }) => rest);
}

export function renderStaffReport(periodSales) {
  const card = document.getElementById("staffReportCard");
  const list = document.getElementById("staffReportList");
  if (!card || !list) return;
  const rows = summarizeByStaff(periodSales, state.currency, state.t("staffUnknownLabel"));
  list.innerHTML = rows
    .map((r) => {
      const amounts = Object.entries(r.byCurrency)
        .map(([code, v]) => formatMoney(v.total, code))
        .join(" + ");
      const detail = Object.entries(r.byCurrency)
        .map(
          ([code, v]) =>
            `${state.t("payNakit")} ${formatMoney(v.nakit, code)} · ${state.t("payKart")} ${formatMoney(v.kart, code)} · ${state.t("payVeresiye")} ${formatMoney(v.veresiye, code)}`
        )
        .join(" | ");
      return `
        <div class="reminder-row">
          <div>
            <p class="reminder-name">${escapeHtml(r.name)}</p>
            <p class="reminder-meta">${r.count} ${state.t("staffReportSalesCount")} · ${escapeHtml(detail)}</p>
          </div>
          <span style="font-weight:700;">${escapeHtml(amounts)}</span>
        </div>`;
    })
    .join("");
  document.getElementById("staffReportEmpty").style.display = rows.length ? "none" : "block";
}
