/**
 * Karışık nakit ödeme (USD + işletme para birimi).
 *
 * Suriye'de müşteri çoğu zaman bir kısmını dolarla, bir kısmını yerel lirayla
 * öder; para üstü genelde yerel liraya verilir. Bu modül:
 *  - kasada "müşteri verdi" alanlarını (USD ve yerel birim) yönetir,
 *  - alınan tutarı kurla işletme birimine çevirip para üstünü / eksiği hesaplar,
 *  - satış kaydına `payments` (hangi birimde ne kadar, hangi kurla) yazar,
 *  - günün kasasında para birimi bazında ne kadar nakit olması gerektiğini verir.
 *
 * Kurallar: Para üstü her zaman işletme para birimiyle verilir. Alınan tutar
 * eksikse satış tamamlanmaz. Alanlar boş bırakılırsa eskisi gibi tam tutar
 * nakit alınmış sayılır. İşletme para birimi USD ise panel gösterilmez.
 */

import { state } from './00-state.js';
import { CURRENCIES, formatMoney } from './02-utils.js';
import { latestRate, sanitizeRate } from './27-currency.js';

function num(n) {
  const v = Number(String(n).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function roundTo(value, currency) {
  const decimals = (CURRENCIES[currency] || CURRENCIES.TRY).decimals;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

/**
 * Saf fonksiyon. Müşterinin verdiği USD ve yerel birim tutarlarından ödeme dökümünü üretir.
 * Dönüş:
 *  - empty: hiçbir tutar girilmedi (tam tutar nakit sayılır)
 *  - ok: ödeme yeterli
 *  - error: "rate" (USD girildi ama kur yok) | "short" (eksik)
 *  - received / change / short: işletme birimiyle
 *  - payments: satış kaydına yazılacak satırlar
 */
export function computeCashReceipt({ total, usdGiven, localGiven, rate, currency }) {
  const usd = num(usdGiven);
  const local = num(localGiven);
  if (usd === 0 && local === 0) {
    return { ok: true, empty: true, error: null, received: total, change: 0, short: 0, payments: [] };
  }
  const r = sanitizeRate(rate);
  if (usd > 0 && !r) {
    return { ok: false, empty: false, error: "rate", received: 0, change: 0, short: total, payments: [] };
  }
  const usdValue = usd > 0 ? roundTo(usd * r, currency) : 0;
  const localValue = roundTo(local, currency);
  const received = roundTo(usdValue + localValue, currency);
  const short = Math.max(0, roundTo(total - received, currency));
  const change = Math.max(0, roundTo(received - total, currency));
  const payments = [];
  if (usd > 0) payments.push({ method: "nakit", currency: "USD", amount: usd, rate: r, valueLocal: usdValue });
  if (local > 0) payments.push({ method: "nakit", currency, amount: local, valueLocal: localValue });
  return { ok: short === 0, empty: false, error: short > 0 ? "short" : null, received, change, short, payments };
}

/**
 * Seçilen satışlardaki nakit tahsilatı para birimi bazında toplar.
 * Karışık ödemelerde her birimin tutarı ayrı sayılır, para üstü yerel birimden düşülür.
 * Ödeme dökümü olmayan nakit satışlar, satışın kendi (yoksa işletme) birimiyle sayılır.
 */
export function cashByCurrency(sales, localCurrency, predicate) {
  const totals = {};
  const add = (code, amount) => {
    totals[code] = roundTo((totals[code] || 0) + amount, code);
  };
  (sales || []).forEach((s) => {
    if (predicate && !predicate(s)) return;
    if (s.paymentType !== "nakit" && s.paymentType) return;
    const code = s.currency || localCurrency;
    if (Array.isArray(s.payments) && s.payments.length) {
      s.payments.forEach((p) => add(p.currency, Number(p.amount) || 0));
      if (Number(s.changeGiven) > 0) add(code, -Number(s.changeGiven));
    } else {
      add(code, Number(s.total) || 0);
    }
  });
  return totals;
}

/** "20 $ + 4.500 ل.س" gibi okunur metin. Boşsa "—". */
export function formatCashTotals(totals) {
  const parts = Object.entries(totals)
    .filter(([, v]) => v !== 0)
    .map(([code, v]) => formatMoney(v, code));
  return parts.length ? parts.join(" + ") : "—";
}

// ---------------- Kasa arayüzü ----------------

function el(id) {
  return document.getElementById(id);
}

/** Panel gösteriliyor mu? (nakit seçili ve işletme birimi USD değil) */
export function isCashPanelActive() {
  return state.selectedPaymentType === "nakit" && state.currency !== "USD";
}

/** Panel açıkken girilen değerleri döner; kapalıysa null. */
export function readCashInputs() {
  if (!isCashPanelActive()) return null;
  return { usdGiven: el("cashUsdInput").value, localGiven: el("cashLocalInput").value, rate: el("cashRateInput").value };
}

export function clearCashInputs() {
  ["cashUsdInput", "cashLocalInput"].forEach((id) => {
    const input = el(id);
    if (input) input.value = "";
  });
  const preview = el("cashPaymentPreview");
  if (preview) preview.textContent = "";
}

/** Paneli göster/gizle, para birimi etiketini ve varsayılan kuru doldur. */
export function renderCashPanel() {
  const row = el("cashPaymentRow");
  if (!row) return;
  const active = isCashPanelActive();
  row.style.display = active ? "block" : "none";
  if (!active) return;
  el("cashLocalLabel").textContent = state.t("cashLocalLabel").replace("{cur}", (CURRENCIES[state.currency] || CURRENCIES.TRY).symbol);
  const rateInput = el("cashRateInput");
  if (!rateInput.value) {
    const known = latestRate(state.exchangeRates, state.currency);
    if (known) rateInput.value = known;
  }
}

/** Girilenlere göre "Alınan / Para üstü / Eksik" satırını günceller. */
export function updateCashPreview(total) {
  const preview = el("cashPaymentPreview");
  if (!preview) return;
  const input = readCashInputs();
  if (!input) {
    preview.textContent = "";
    return;
  }
  const r = computeCashReceipt({ total, ...input, currency: state.currency });
  if (r.empty) {
    preview.textContent = state.t("cashHint");
    preview.style.color = "";
    return;
  }
  if (r.error === "rate") {
    preview.textContent = state.t("cashRateRequired");
    preview.style.color = "var(--red-text)";
    return;
  }
  if (r.error === "short") {
    preview.textContent = `${state.t("cashShort")}: ${formatMoney(r.short, state.currency)}`;
    preview.style.color = "var(--red-text)";
    return;
  }
  preview.textContent = `${state.t("cashReceived")}: ${formatMoney(r.received, state.currency)} · ${state.t("cashChange")}: ${formatMoney(r.change, state.currency)}`;
  preview.style.color = "var(--green-text)";
}
