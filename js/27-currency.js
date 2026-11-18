/**
 * Para birimi ve döviz kuru (Faz 1).
 *
 * - İşletme para birimi: TRY (₺), SYP (ل.س) ya da USD ($). Seçim, tüm ekranlardaki
 *   tutar gösterimini (simge ve ondalık sayısı) değiştirir; ürün fiyatlarını
 *   DÖNÜŞTÜRMEZ.
 * - Kur geçmişi: "1 USD = X (işletme para birimi)" kaydı, tarihli, elle girilir.
 * - Her yeni satışa o anki para birimi ve kur yazılır; böylece ileride kur
 *   değişse bile eski satışın değeri doğru hesaplanabilir.
 *
 * Henüz YOK (Faz 2): tek satışta karışık ödeme (örn. yarısı USD, yarısı SYP),
 * USD borç/tahsilat, kur farkı kâr/zararı, alış/satış kurunu ayrı tutma.
 */

import { state } from './00-state.js';
import { CURRENCIES, escapeHtml, formatMoney, genId, showToast } from './02-utils.js';

export const MAX_RATE_HISTORY = 200;

/** Geçerli (pozitif, sonlu) bir kur değilse 0 döner. */
export function sanitizeRate(value) {
  const v = Number(String(value).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Kur geçmişindeki en yeni kayıt (tarihe göre). Yoksa null. */
export function latestRateEntry(rates) {
  if (!Array.isArray(rates) || !rates.length) return null;
  return rates.reduce((best, r) => (!best || String(r.date) > String(best.date) ? r : best), null);
}

/** En yeni kurun sayısı (1 USD = ?). Yoksa 0. */
export function latestRate(rates) {
  const entry = latestRateEntry(rates);
  return entry ? sanitizeRate(entry.rate) : 0;
}

/** İşletme para biriminden USD'ye (kur: 1 USD = rate yerel birim). */
export function localToUsd(amount, rate) {
  const r = sanitizeRate(rate);
  if (!r) return 0;
  return Math.round(((Number(amount) || 0) / r) * 100) / 100;
}

/** USD'den işletme para birimine. */
export function usdToLocal(amount, rate) {
  const r = sanitizeRate(rate);
  if (!r) return 0;
  return Math.round(((Number(amount) || 0) * r) * 100) / 100;
}

/** Geçmişe yeni kur ekler (yeni dizi döner, en fazla MAX_RATE_HISTORY kayıt). */
export function addRateEntry(rates, rate, now) {
  const r = sanitizeRate(rate);
  if (!r) return Array.isArray(rates) ? rates : [];
  const entry = { id: genId(), date: now || new Date().toISOString(), rate: r };
  return [...(Array.isArray(rates) ? rates : []), entry].slice(-MAX_RATE_HISTORY);
}

/** Para birimi USD değilse ve kur varsa "≈ $12.50" metni; aksi halde "". */
export function usdEquivalentText(total) {
  if (state.currency === "USD") return "";
  const rate = latestRate(state.exchangeRates);
  if (!rate || !(Number(total) > 0)) return "";
  return "≈ " + formatMoney(localToUsd(total, rate), "USD");
}

function persist(fields) {
  const targetRef = state.originalDocRef || state.docRef;
  if (targetRef) {
    targetRef.set(fields, { merge: true }).catch((e) => console.error("Para birimi ayarı kaydedilemedi", e));
  }
}

export function saveCurrencySetting(onChanged) {
  const select = document.getElementById("currencySelect");
  if (!select) return;
  const code = CURRENCIES[select.value] ? select.value : "TRY";
  state.currency = code;
  persist({ currency: code });
  showToast(state.t("currencySaved"), "success");
  renderCurrencySettings();
  if (typeof onChanged === "function") onChanged();
}

export function addExchangeRate(onChanged) {
  const input = document.getElementById("exchangeRateInput");
  const rate = sanitizeRate(input && input.value);
  if (!rate) {
    showToast(state.t("exchangeRateInvalid"), "error");
    return;
  }
  state.exchangeRates = addRateEntry(state.exchangeRates, rate);
  persist({ exchangeRates: state.exchangeRates });
  input.value = "";
  showToast(state.t("exchangeRateSaved"), "success");
  renderCurrencySettings();
  if (typeof onChanged === "function") onChanged();
}

export function renderCurrencySettings() {
  const select = document.getElementById("currencySelect");
  if (!select) return;
  select.value = CURRENCIES[state.currency] ? state.currency : "TRY";
  const rateBox = document.getElementById("exchangeRateBox");
  const needsRate = state.currency !== "USD";
  rateBox.style.display = needsRate ? "" : "none";
  if (!needsRate) return;
  const currentEl = document.getElementById("exchangeRateCurrent");
  const rate = latestRate(state.exchangeRates);
  currentEl.textContent = rate ? `1 USD = ${formatMoney(rate, state.currency)}` : state.t("exchangeRateNone");
  const list = [...(state.exchangeRates || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  document.getElementById("exchangeRateList").innerHTML = list
    .map(
      (r) => `
        <div class="audit-log-row">
          <p class="audit-log-action">1 USD = ${escapeHtml(formatMoney(r.rate, state.currency))}</p>
          <p class="audit-log-meta">${new Date(r.date).toLocaleString()}</p>
        </div>`
    )
    .join("");
}
