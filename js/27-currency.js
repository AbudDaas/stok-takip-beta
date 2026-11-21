/**
 * Para birimi ve döviz kuru (Faz 1).
 *
 * - İşletme para birimi: TRY (₺), SYP (ل.س) ya da USD ($). Seçim, tüm ekranlardaki
 *   tutar gösterimini (simge ve ondalık sayısı) değiştirir. Para birimi
 *   değiştirilirken girilen kurla ÜRÜN FİYATLARI da dönüştürülür (35 ₺, kur
 *   1 USD = 50 ₺ ise 0,70 $). Geçmiş satış, veresiye, gider ve tedarikçi
 *   kayıtları dönüştürülmez.
 * - Kur geçmişi: "1 USD = X (işletme para birimi)" kaydı, tarihli, elle girilir.
 * - Her yeni satışa o anki para birimi ve kur yazılır; böylece ileride kur
 *   değişse bile eski satışın değeri doğru hesaplanabilir.
 *
 * Henüz YOK (Faz 2): tek satışta karışık ödeme (örn. yarısı USD, yarısı SYP),
 * USD borç/tahsilat, kur farkı kâr/zararı, alış/satış kurunu ayrı tutma.
 */

import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { CURRENCIES, escapeHtml, formatMoney, genId, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { cloneData, convertHistory, createPreConversionBackup, previewConversion, tagUntaggedRecords, verifyConversion } from './31-history-conversion.js';

const HISTORY_KEYS = ["sales", "returns", "payments", "supplierTransactions", "expenses", "zReports", "giftCards"];

export const MAX_RATE_HISTORY = 200;

/** Geçerli (pozitif, sonlu) bir kur değilse 0 döner. */
export function sanitizeRate(value) {
  const v = Number(String(value).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Kur geçmişindeki en yeni kayıt (tarihe göre). Yoksa null.
 * currencyCode verilirse yalnızca o para birimine ait kayıtlara bakılır
 * (para birimi kaydı olmayan eski kayıtlar her birime uyar).
 */
export function latestRateEntry(rates, currencyCode) {
  if (!Array.isArray(rates) || !rates.length) return null;
  return rates
    .filter((r) => !currencyCode || !r.currency || r.currency === currencyCode)
    .reduce((best, r) => (!best || String(r.date) > String(best.date) ? r : best), null);
}

/** En yeni kurun sayısı (1 USD = ?). Yoksa 0. */
export function latestRate(rates, currencyCode) {
  const entry = latestRateEntry(rates, currencyCode);
  return entry ? sanitizeRate(entry.rate) : 0;
}

/**
 * Para birimi değişirken fiyatları çarpacak katsayı.
 * Kur anlamı: iki taraftan biri USD ise "1 USD = ? (diğer birim)", değilse "1 [eski] = ? [yeni]".
 * Geçersizse 0.
 */
export function conversionFactor(from, to, rate) {
  const r = sanitizeRate(rate);
  if (!r || from === to) return 0;
  if (to === "USD") return 1 / r; // eski birim / (eski birim per USD)
  return r; // USD → diğer ya da diğer → diğer: kur doğrudan çarpan
}

/** Tutarı katsayıyla çarpar ve hedef para biriminin ondalığına yuvarlar (pozitif tutar 0'a düşmez). */
export function convertAmount(value, factor, toCode) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0 || !(factor > 0)) return Number.isFinite(v) ? v : 0;
  const decimals = (CURRENCIES[toCode] || CURRENCIES.TRY).decimals;
  const unit = Math.pow(10, -decimals);
  const scaled = Math.round((v * factor) / unit) * unit;
  const result = v > 0 ? Math.max(unit, scaled) : Math.min(-unit, scaled);
  return Math.round(result * 1e6) / 1e6;
}

/** Ürünün para tutan alanlarını dönüştürür (yerinde değiştirir, değişen alan sayısını döner). */
export function convertProductPrices(product, factor, toCode) {
  let changed = 0;
  const apply = (field) => {
    if (Number(product[field]) > 0) {
      product[field] = convertAmount(product[field], factor, toCode);
      changed++;
    }
  };
  ["price", "costPrice", "caseCostPrice", "discountedPrice"].forEach(apply);
  if (product.bulkDiscountType === "amount") apply("bulkDiscountValue");
  return changed;
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
export function addRateEntry(rates, rate, now, currencyCode) {
  const r = sanitizeRate(rate);
  if (!r) return Array.isArray(rates) ? rates : [];
  const entry = { id: genId(), date: now || new Date().toISOString(), rate: r };
  if (currencyCode) entry.currency = currencyCode;
  return [...(Array.isArray(rates) ? rates : []), entry].slice(-MAX_RATE_HISTORY);
}

/** Para birimi USD değilse ve kur varsa "≈ $12.50" metni; aksi halde "". */
export function usdEquivalentText(total) {
  if (state.currency === "USD") return "";
  const rate = latestRate(state.exchangeRates, state.currency);
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
  const to = CURRENCIES[select.value] ? select.value : "TRY";
  const from = CURRENCIES[state.currency] ? state.currency : "TRY";
  if (to === from) {
    showToast(state.t("currencySaved"), "success");
    return;
  }

  const convert = document.getElementById("currencyConvertCheck").checked;
  let factor = 0;
  let enteredRate = 0;
  if (convert) {
    enteredRate = sanitizeRate(document.getElementById("currencyConvertRate").value);
    factor = conversionFactor(from, to, enteredRate);
    if (!factor) {
      showToast(state.t("exchangeRateInvalid"), "error");
      return;
    }
  }

  const productCount = convert ? state.products.filter((p) => Number(p.price) > 0).length : 0;
  const historyBox = document.getElementById("currencyConvertHistoryCheck");
  const convertHistoryToo = Boolean(convert && historyBox && historyBox.checked);

  // Geçmiş dönüşümü: önce kopya üzerinde dene; toplamlar kurla tutmuyorsa HİÇBİR ŞEY değiştirme.
  let preview = null;
  if (convertHistoryToo) {
    preview = previewConversion(state, factor, from, to);
    if (!preview.verification.ok) {
      showToast(state.t("historyConvertVerifyFailed"), "error");
      return;
    }
  }

  let message = convert
    ? state.t("currencyConvertConfirm").replace("{from}", from).replace("{to}", to).replace("{n}", productCount)
    : state.t("currencyNoConvertConfirm").replace("{from}", from).replace("{to}", to);
  if (preview) message += "\n\n" + describePreview(preview, from, to);
  if (!confirm(message)) return;

  const apply = () => {
    if (convert) {
      state.products.forEach((p) => convertProductPrices(p, factor, to));
      state.perKmDeliveryFee = convertAmount(state.perKmDeliveryFee, factor, to);
    }
    let historyCount = 0;
    if (convertHistoryToo) {
      // Veri, yedek alınırken değişmiş olabilir: kopyada yeniden dönüştür ve doğrula, sonra yerine koy.
      const copy = cloneData(state);
      const result = convertHistory(copy, factor, from, to);
      if (!verifyConversion(result, factor, to).ok) {
        showToast(state.t("historyConvertVerifyFailed"), "error");
        return false;
      }
      HISTORY_KEYS.forEach((k) => {
        state[k] = copy[k];
      });
      historyCount = Object.values(result.counts).reduce((a, b) => a + b, 0);
    } else {
      // Geçmiş dönüştürülmüyor: kayıtlar hangi birimdeydi, ileride karışmasın diye etiketle.
      historyCount = -tagUntaggedRecords(state, from);
    }
    state.currency = to;
    // USD taraflı bir dönüşümde girilen kur, yeni birim için de geçerli kur kaydı olur.
    const usdInvolved = from === "USD" || to === "USD";
    if (convert && usdInvolved) {
      const localCode = to === "USD" ? from : to;
      // Aynı kur zaten en yeni kayıtsa tekrar ekleme.
      if (latestRate(state.exchangeRates, localCode) !== enteredRate) {
        state.exchangeRates = addRateEntry(state.exchangeRates, enteredRate, null, localCode);
      }
    }
    logAudit(
      "Para birimi değiştirildi",
      `${from} → ${to}${convert ? `, kur ${enteredRate}, ${productCount} ürün` : ", fiyatlar dönüştürülmedi"}${convertHistoryToo ? `, ${historyCount} geçmiş kayıt dönüştürüldü` : ""}`
    );
    if (convert || historyCount !== 0) save();
    persist({ currency: to, exchangeRates: state.exchangeRates, perKmDeliveryFee: state.perKmDeliveryFee || 0 });
    showToast(state.t("currencySaved"), "success");
    renderCurrencySettings();
    if (typeof onChanged === "function") onChanged();
    return true;
  };

  if (!convertHistoryToo) {
    apply();
    return;
  }

  // Borç ve fatura kayıtları için: dönüşümden ÖNCE bulut + dosya yedeği.
  showToast(state.t("historyConvertBackingUp"), "success");
  createPreConversionBackup().then((backup) => {
    if (!backup.cloud && !backup.file) {
      showToast(state.t("historyConvertNoBackup"), "error");
      return;
    }
    if (!backup.cloud && !confirm(state.t("historyConvertCloudFailed"))) return;
    if (apply()) showToast(state.t("historyConvertDone").replace("{id}", backup.id), "success");
  });
}

/** Onay penceresinde gösterilecek özet: kayıt sayıları ve toplamlar (önce → sonra). */
function describePreview(preview, from, to) {
  const c = preview.counts;
  const fmt = (v, code) => formatMoney(v, code);
  const line = (labelKey, key) => {
    const x = preview.sums[key];
    return x.before || x.after ? `• ${state.t(labelKey)}: ${fmt(x.before, from)} → ${fmt(x.after, to)}` : "";
  };
  return [
    state.t("historyConvertSummary")
      .replace("{sales}", c.sales)
      .replace("{debts}", c.supplierTransactions)
      .replace("{payments}", c.payments)
      .replace("{expenses}", c.expenses),
    line("historyLblCustomerDebt", "customerDebtSales"),
    line("historyLblCustomerPaid", "customerPayments"),
    line("historyLblSupplierDebt", "supplierDebt"),
    line("historyLblSupplierPaid", "supplierPaid"),
    line("historyLblExpenses", "expenses"),
    preview.skipped ? state.t("historyConvertSkipped").replace("{n}", preview.skipped) : "",
    state.t("historyConvertBackupNote")
  ]
    .filter(Boolean)
    .join("\n");
}

export function addExchangeRate(onChanged) {
  const input = document.getElementById("exchangeRateInput");
  const rate = sanitizeRate(input && input.value);
  if (!rate) {
    showToast(state.t("exchangeRateInvalid"), "error");
    return;
  }
  state.exchangeRates = addRateEntry(state.exchangeRates, rate, null, state.currency);
  persist({ exchangeRates: state.exchangeRates });
  input.value = "";
  showToast(state.t("exchangeRateSaved"), "success");
  renderCurrencySettings();
  if (typeof onChanged === "function") onChanged();
}

/** Seçili birim, kayıtlı birimden farklıysa dönüşüm kutusunu doldurur ve örnek satırı hesaplar. */
export function renderConversionBox() {
  const select = document.getElementById("currencySelect");
  const box = document.getElementById("currencyConvertBox");
  if (!select || !box) return;
  const from = CURRENCIES[state.currency] ? state.currency : "TRY";
  const to = select.value;
  if (!CURRENCIES[to] || to === from) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";
  const usdInvolved = from === "USD" || to === "USD";
  const other = from === "USD" ? to : from;
  document.getElementById("currencyConvertRateLabel").textContent = usdInvolved
    ? state.t("currencyRateLabelUsd").replace("{other}", other)
    : state.t("currencyRateLabelPair").replace("{from}", from).replace("{to}", to);

  const rateInput = document.getElementById("currencyConvertRate");
  if (!rateInput.dataset.touched && usdInvolved) {
    const known = latestRate(state.exchangeRates, other);
    rateInput.value = known || "";
  }
  const example = document.getElementById("currencyConvertExample");
  const factor = document.getElementById("currencyConvertCheck").checked ? conversionFactor(from, to, rateInput.value) : 0;
  const sample = state.products.find((p) => Number(p.price) > 0);
  example.textContent = factor && sample ? `${formatMoney(sample.price, from)} → ${formatMoney(convertAmount(sample.price, factor, to), to)}` : "";
}

export function renderCurrencySettings() {
  const select = document.getElementById("currencySelect");
  if (!select) return;
  // Kullanıcı seçimi değiştirirken ekran sıfırlanmasın: sadece kaydedilmiş birimle ilk kez/yenilemede eşitle.
  if (select.dataset.synced !== state.currency) {
    select.value = CURRENCIES[state.currency] ? state.currency : "TRY";
    select.dataset.synced = state.currency;
    const rateInput = document.getElementById("currencyConvertRate");
    if (rateInput) {
      rateInput.value = "";
      delete rateInput.dataset.touched;
    }
  }
  renderConversionBox();
  const rateBox = document.getElementById("exchangeRateBox");
  const needsRate = state.currency !== "USD";
  rateBox.style.display = needsRate ? "" : "none";
  if (!needsRate) return;
  const currentEl = document.getElementById("exchangeRateCurrent");
  const rate = latestRate(state.exchangeRates, state.currency);
  currentEl.textContent = rate ? `1 USD = ${formatMoney(rate, state.currency)}` : state.t("exchangeRateNone");
  const list = (state.exchangeRates || [])
    .filter((r) => !r.currency || r.currency === state.currency)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 10);
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
