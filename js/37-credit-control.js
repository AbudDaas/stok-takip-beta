/**
 * Veresiye kontrolü: borç limiti, vade ve geciken borç listesi.
 * Ayarlar'dan açılıp kapatılır; limit ve vade günü oradan belirlenir.
 *
 *  - Limit: bir müşterinin toplam açık borcu (yeni satış dahil) bu tutarı geçemez.
 *    Mod "block": satış engellenir, "warn": uyarı verilir, onaylarsan devam eder.
 *    0 = sınırsız.
 *  - Vade: her veresiye satışın vadesi = satış tarihi + vade günü. Müşterinin
 *    ödemeleri EN ESKİ borçtan başlayarak düşülür (FIFO). Vadesi geçip hâlâ
 *    ödenmemiş kalan tutar "gecikmiş" sayılır.
 *  - Tutarlar işletme para biriminde toplanır (satışın para birimi farklıysa o satır
 *    kendi biriminde gösterilir, limit hesabına katılmaz).
 */

import { state } from './00-state.js';
import { escapeHtml, formatMoney, showToast } from './02-utils.js';
import { getCustomerDebt } from './06-veresiye.js';

export const CREDIT_DEFAULTS = { enabled: false, limit: 0, dueDays: 0, mode: "block" };
const DAY_MS = 86400000;

/** Saf: kayıtlı ayarı güvenli değerlere çevirir. */
export function normalizeCreditSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return {
    enabled: Boolean(r.enabled),
    limit: num(r.limit),
    dueDays: Math.floor(num(r.dueDays)),
    mode: r.mode === "warn" ? "warn" : "block"
  };
}

/** Saf: yeni satış limiti aşar mı? limit 0 ise asla. */
export function checkLimit({ debt, add, limit }) {
  if (!(limit > 0)) return { exceeds: false, available: Number.POSITIVE_INFINITY };
  const available = Math.max(0, limit - debt);
  return { exceeds: debt + add > limit + 1e-9, available };
}

/**
 * Saf: müşterinin ödenmemiş veresiye satırları (ödemeler en eskiden düşülür).
 * Dönüş: [{ saleId, timestamp, total, remaining, currency }] (eskiden yeniye, yalnızca kalanı > 0 olanlar)
 */
export function openDebtItems(sales, payments, customerId, fallbackCurrency) {
  let paid = (payments || []).filter((p) => p.customerId === customerId).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const debts = (sales || [])
    .filter((s) => s.paymentType === "veresiye" && s.customerId === customerId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const items = [];
  debts.forEach((s) => {
    const total = Number(s.total) || 0;
    const applied = Math.min(paid, total);
    paid -= applied;
    const remaining = Math.round((total - applied) * 100) / 100;
    if (remaining > 0) items.push({ saleId: s.id, timestamp: s.timestamp, total, remaining, currency: s.currency || fallbackCurrency });
  });
  return items;
}

/** Saf: vadesi geçmiş kalan tutar ve en eski gecikme (gün). dueDays 0 ise vade yok. */
export function overdueInfo(items, dueDays, now = Date.now()) {
  if (!(dueDays > 0)) return { overdueAmount: 0, oldestDays: 0, items: [] };
  const late = [];
  items.forEach((it) => {
    const dueAt = new Date(it.timestamp).getTime() + dueDays * DAY_MS;
    if (dueAt < now) late.push({ ...it, daysLate: Math.floor((now - dueAt) / DAY_MS) });
  });
  return {
    overdueAmount: Math.round(late.reduce((s, i) => s + i.remaining, 0) * 100) / 100,
    oldestDays: late.reduce((m, i) => Math.max(m, i.daysLate), 0),
    items: late
  };
}

/** Saf: gecikmiş borcu olan müşteriler (en çok geciken önce). */
export function listOverdueCustomers(customers, sales, payments, dueDays, fallbackCurrency, now = Date.now()) {
  return (customers || [])
    .map((c) => {
      const items = openDebtItems(sales, payments, c.id, fallbackCurrency);
      const info = overdueInfo(items, dueDays, now);
      return { customer: c, ...info, debt: Math.round(items.reduce((s, i) => s + i.remaining, 0) * 100) / 100 };
    })
    .filter((r) => r.overdueAmount > 0)
    .sort((a, b) => b.oldestDays - a.oldestDays);
}

/**
 * Kasada veresiye satışından önce çağrılır. true: devam, false: durdur.
 */
export function creditCheckPassed(customer, total) {
  const cfg = state.creditControl;
  if (!cfg || !cfg.enabled || !(cfg.limit > 0)) return true;
  const debt = getCustomerDebt(customer.id);
  const res = checkLimit({ debt, add: total, limit: cfg.limit });
  if (!res.exceeds) return true;
  const msg = state
    .t("creditLimitExceeded")
    .replace("{name}", customer.name)
    .replace("{debt}", formatMoney(debt, state.currency))
    .replace("{limit}", formatMoney(cfg.limit, state.currency))
    .replace("{available}", formatMoney(res.available, state.currency));
  if (cfg.mode === "warn") return confirm(msg + "\n\n" + state.t("creditContinueAnyway"));
  showToast(msg, "error");
  return false;
}

// ---------------- Ayarlar ----------------

function persist(fields) {
  const ref = state.originalDocRef || state.docRef;
  if (ref) ref.set(fields, { merge: true }).catch((e) => console.error("Veresiye ayarı kaydedilemedi", e));
}

export function toggleCreditControl() {
  state.creditControl = { ...normalizeCreditSettings(state.creditControl), enabled: document.getElementById("creditEnabledCheck").checked };
  persist({ creditControl: state.creditControl });
  renderCreditSettings();
  renderOverdueList();
}

export function saveCreditSettings() {
  const limit = Number(String(document.getElementById("creditLimitInput").value).replace(",", "."));
  const days = Number(document.getElementById("creditDueDaysInput").value);
  if ((document.getElementById("creditLimitInput").value !== "" && !(limit >= 0)) || (document.getElementById("creditDueDaysInput").value !== "" && !(days >= 0))) {
    showToast(state.t("alertInvalidAmount"), "error");
    return;
  }
  state.creditControl = normalizeCreditSettings({
    enabled: state.creditControl && state.creditControl.enabled,
    limit: limit || 0,
    dueDays: days || 0,
    mode: document.getElementById("creditModeSelect").value
  });
  persist({ creditControl: state.creditControl });
  showToast(state.t("creditSaved"), "success");
  renderOverdueList();
}

export function renderCreditSettings() {
  const check = document.getElementById("creditEnabledCheck");
  const panel = document.getElementById("creditPanel");
  if (!check || !panel) return;
  const cfg = normalizeCreditSettings(state.creditControl);
  check.checked = cfg.enabled;
  panel.style.display = cfg.enabled ? "" : "none";
  if (!cfg.enabled || panel.dataset.synced === JSON.stringify(cfg)) return;
  panel.dataset.synced = JSON.stringify(cfg);
  document.getElementById("creditLimitInput").value = cfg.limit || "";
  document.getElementById("creditDueDaysInput").value = cfg.dueDays || "";
  document.getElementById("creditModeSelect").value = cfg.mode;
}

// ---------------- Geciken borç listesi ----------------

export function renderOverdueList() {
  const card = document.getElementById("overdueCard");
  const list = document.getElementById("overdueList");
  if (!card || !list) return;
  const cfg = normalizeCreditSettings(state.creditControl);
  card.style.display = cfg.enabled && cfg.dueDays > 0 ? "" : "none";
  if (card.style.display === "none") return;
  const rows = listOverdueCustomers(state.customers, state.sales, state.payments, cfg.dueDays, state.currency);
  list.innerHTML = rows
    .map((r) => {
      const amount = formatMoney(r.overdueAmount, state.currency);
      return `
        <div class="reminder-row">
          <div>
            <p class="reminder-name">${escapeHtml(r.customer.name)}</p>
            <p class="reminder-meta">${escapeHtml(state.t("overdueMeta").replace("{days}", r.oldestDays))}</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;color:var(--red-text);">${escapeHtml(amount)}</span>
            <button type="button" class="btn btn-small" data-overdue-wa="${escapeHtml(r.customer.id)}" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></button>
          </div>
        </div>`;
    })
    .join("");
  document.getElementById("overdueEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("overdueTotal").textContent = formatMoney(rows.reduce((s, r) => s + r.overdueAmount, 0), state.currency);
}

/** Geciken müşteriye WhatsApp hatırlatması açar. */
export function sendOverdueReminder(customerId) {
  const cfg = normalizeCreditSettings(state.creditControl);
  const row = listOverdueCustomers(state.customers, state.sales, state.payments, cfg.dueDays, state.currency).find((r) => r.customer.id === customerId);
  if (!row) return;
  const phone = String(row.customer.phone || "").replace(/[^\d]/g, "");
  if (!phone) {
    showToast(state.t("statementNoPhone"), "error");
    return;
  }
  const text = state
    .t("overdueWhatsappMsg")
    .replace("{name}", row.customer.name)
    .replace("{amount}", formatMoney(row.overdueAmount, state.currency))
    .replace("{days}", row.oldestDays);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
}
