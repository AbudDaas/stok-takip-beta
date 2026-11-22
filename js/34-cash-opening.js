/**
 * Kasa açılış bakiyesi.
 *
 * Gün başında çekmecede ne kadar nakit olduğu (işletme birimi + dolar ayrı) kaydedilir.
 * Gün sonu sayımında "olması gereken" nakit = açılış + bugünkü nakit satışlar.
 * Böylece sayım farkı gerçek kasayı yansıtır. Dolar, kayıt anındaki kurla işletme
 * birimine çevrilerek toplanır (kur kayda yazılır).
 */

import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { formatMoney, genId, showToast } from './02-utils.js';
import { getActorName, logAudit } from './03-staff-roles.js';
import { latestRate, sanitizeRate } from './27-currency.js';

/** Yerel takvime göre "YYYY-MM-DD". */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(v) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Saf: o günün açılış kaydı (yoksa null). */
export function getOpeningFor(sessions, key) {
  return (sessions || []).find((s) => s.date === key) || null;
}

/** Saf: açılışın işletme birimindeki toplam değeri (dolar kayıttaki kurla çevrilir). */
export function openingValueLocal(session) {
  if (!session) return 0;
  const usd = num(session.usd);
  const rate = sanitizeRate(session.rate);
  return Math.round((num(session.local) + (usd && rate ? usd * rate : 0)) * 100) / 100;
}

/**
 * Saf: o gün için açılışı ekler ya da günceller (yeni dizi döner).
 * Hata: usd > 0 ama kur yoksa → { error: "rate" }
 */
export function upsertOpening(sessions, { key, local, usd, rate, by, now, id }) {
  const l = num(local);
  const u = num(usd);
  const r = sanitizeRate(rate);
  if (u > 0 && !r) return { error: "rate" };
  const entry = { id: id || genId(), date: key, local: l, usd: u, rate: u > 0 ? r : 0, by: by || "", updatedAt: now || new Date().toISOString() };
  const rest = (sessions || []).filter((s) => s.date !== key);
  return { sessions: [...rest, entry].slice(-400), entry };
}

export function saveCashOpening() {
  const localEl = document.getElementById("cashOpeningLocal");
  const usdEl = document.getElementById("cashOpeningUsd");
  const usdValue = state.currency !== "USD" && usdEl ? usdEl.value : "";
  const res = upsertOpening(state.cashSessions, {
    key: dayKey(),
    local: localEl.value,
    usd: usdValue,
    rate: latestRate(state.exchangeRates, state.currency),
    by: getActorName()
  });
  if (res.error) {
    showToast(state.t("cashRateRequired"), "error");
    return;
  }
  state.cashSessions = res.sessions;
  logAudit("Kasa açılış bakiyesi girildi", `${formatMoney(res.entry.local, state.currency)}${res.entry.usd ? " + " + formatMoney(res.entry.usd, "USD") : ""}`);
  save();
  localEl.value = "";
  if (usdEl) usdEl.value = "";
  showToast(state.t("cashOpeningSaved"), "success");
  renderCashOpening();
  document.dispatchEvent(new CustomEvent("cash-opening-changed"));
}

export function renderCashOpening() {
  const cur = document.getElementById("cashOpeningCurrent");
  if (!cur) return;
  const usdEl = document.getElementById("cashOpeningUsd");
  if (usdEl) usdEl.style.display = state.currency === "USD" ? "none" : "";
  const s = getOpeningFor(state.cashSessions, dayKey());
  if (!s) {
    cur.textContent = state.t("cashOpeningNone");
    return;
  }
  cur.textContent = [s.local ? formatMoney(s.local, state.currency) : "", s.usd ? formatMoney(s.usd, "USD") : ""].filter(Boolean).join(" + ") || formatMoney(0, state.currency);
}
