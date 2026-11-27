// Veri koruması: (1) yedek doğrulama, (2) tek belge 1 MB sınırına yaklaşınca uyarı.
import { state } from './00-state.js';
import { showToast } from './02-utils.js';
import { BACKUP_KEYS } from './31-history-conversion.js';

const ARRAY_KEYS = [
  "products", "sales", "customers", "payments", "dailyResetConfig", "breadLog", "priceChangeLog", "auditLog",
  "staffMembers", "suppliers", "supplierTransactions", "returns", "expenses", "giftCards", "zReports",
  "incomingOrders", "orderTemplates", "cashSessions", "wasteLog", "exchangeRates"
];

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** Yedeği şema açısından doğrular. Döner: { ok, errors: string[] } — veriyi DEĞİŞTİRMEZ. */
export function validateBackup(b) {
  const errors = [];
  if (!isObj(b)) return { ok: false, errors: ["not_object"] };
  ARRAY_KEYS.forEach((k) => {
    if (b[k] !== undefined && !Array.isArray(b[k])) errors.push(`${k}: dizi değil`);
  });
  if (Array.isArray(b.products)) {
    b.products.forEach((p, i) => {
      if (!isObj(p) || typeof p.name !== "string" || !p.name.trim()) return errors.push(`products[${i}]: ad yok`);
      if (p.qty !== undefined && !isNum(p.qty)) errors.push(`products[${i}]: adet sayı değil`);
      if (p.price !== undefined && !isNum(p.price)) errors.push(`products[${i}]: fiyat sayı değil`);
    });
  }
  if (Array.isArray(b.sales)) {
    b.sales.forEach((s, i) => {
      if (!isObj(s) || !Array.isArray(s.items)) return errors.push(`sales[${i}]: kalem listesi yok`);
      if (s.total !== undefined && !isNum(s.total)) errors.push(`sales[${i}]: toplam sayı değil`);
    });
  }
  ["customers", "payments", "suppliers", "supplierTransactions", "returns", "expenses"].forEach((k) => {
    if (Array.isArray(b[k])) b[k].forEach((r, i) => !isObj(r) && errors.push(`${k}[${i}]: kayıt değil`));
  });
  return { ok: errors.length === 0, errors: errors.slice(0, 20) };
}

// ---- Belge boyutu ----
export const DOC_LIMIT_BYTES = 1048576;

export function estimateDocBytes(src = state) {
  const obj = {};
  BACKUP_KEYS.forEach((k) => {
    if (src[k] !== undefined) obj[k] = src[k];
  });
  obj.blockedPhones = src.blockedPhones;
  obj.blockedIPs = src.blockedIPs;
  obj.staffMembers = src.staffMembers;
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

/** 'ok' | 'warn' (>=%80) | 'danger' (>=%92) */
export function sizeLevel(bytes) {
  const ratio = bytes / DOC_LIMIT_BYTES;
  if (ratio >= 0.92) return "danger";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

let lastCheck = 0;
let lastLevel = "ok";

/** save() içinden çağrılır; en fazla 60 sn'de bir ölçer, seviye yükselirse uyarır. */
export function checkDataSize(now = Date.now()) {
  if (!state.cloudEnabled || now - lastCheck < 60000) return lastLevel;
  lastCheck = now;
  const bytes = estimateDocBytes();
  const level = sizeLevel(bytes);
  if (level !== "ok" && level !== lastLevel) {
    const pct = Math.round((bytes / DOC_LIMIT_BYTES) * 100);
    showToast(state.t(level === "danger" ? "dataSizeDanger" : "dataSizeWarn").replace("{p}", pct), level === "danger" ? "error" : "info");
  }
  lastLevel = level;
  return level;
}
