/**
 * Geçmiş kayıtların para birimi dönüşümü + yedek güvencesi.
 *
 * Para birimi değişince (örn. ₺ → ل.س, kur 1 USD = X) YALNIZCA ürün fiyatları
 * değil, istenirse tüm geçmiş para kayıtları da yeni birime çevrilir:
 * satışlar, iadeler, müşteri ödemeleri (veresiye tahsilatı), tedarikçi borç ve
 * ödemeleri, giderler, Z raporları, hediye kartları.
 *
 * GÜVENLİK KURALLARI (borç ve fatura kayıtları kaybolmasın diye):
 *  1. Dönüşümden ÖNCE tam yedek alınır: hem Firestore'a (backups/pre-convert-…)
 *     hem de bilgisayara JSON dosyası olarak indirilir.
 *  2. Dönüşüm önce bir kopya üzerinde denenir (dry-run); toplamlar
 *     (satış, veresiye borcu, tahsilat, tedarikçi borcu, gider) kurla beklenen
 *     değerle karşılaştırılır. Sapma sınırı aşılırsa hiçbir şey değişmez.
 *  3. Sadece doğrulama geçerse gerçek verinin yerine konur.
 *  4. Dönüştürülen her kaydın `currency` alanı yeni birim yapılır ve eski birim
 *     `convertedFrom` ile saklanır. Yedekten geri yükleme bunu eski haline getirir.
 *
 * Birimi yazılı olmayan eski kayıtlar, dönüşüm anındaki işletme birimindeymiş
 * gibi kabul edilir. Para birimi değişip geçmiş dönüştürülmediyse, o an kayıtlar
 * `tagUntaggedRecords` ile etiketlenir ki ileride yanlış yorumlanmasınlar.
 *
 * Dönüştürülmeyenler: gelen katalog siparişleri, stok hareketi geçmişi,
 * fiyat değişim günlüğü, ekmek kaydı, fiscal (e-fatura) kayıtları.
 */

import { state } from './00-state.js';
import { CURRENCIES } from './02-utils.js';
import { convertAmount } from './27-currency.js';

/** Tam yedeğe giren alanlar. */
export const BACKUP_KEYS = [
  "products", "sales", "customers", "payments", "dailyResetConfig", "breadLog", "priceChangeLog", "auditLog",
  "staffMembers", "suppliers", "supplierTransactions", "returns", "expenses", "giftCards", "zReports",
  "incomingOrders", "orderTemplates", "cashSessions", "wasteLog", "exchangeRates", "currency", "perKmDeliveryFee"
];

/** Verinin derin kopyası (yedek ve dry-run için). */
export function cloneData(src) {
  const out = {};
  BACKUP_KEYS.forEach((k) => {
    if (src[k] !== undefined) out[k] = JSON.parse(JSON.stringify(src[k]));
  });
  return out;
}

/** Tam yedek nesnesi (state'ten). */
export function buildFullBackup(src = state) {
  return { ...cloneData(src), savedAt: new Date().toISOString() };
}

function unitOf(code) {
  return Math.pow(10, -(CURRENCIES[code] || CURRENCIES.TRY).decimals);
}

function belongs(record, from) {
  return !record.currency || record.currency === from;
}

/**
 * Birimi yazılmamış kayıtlara `currency` yazar (kayıtların hangi birimde
 * olduğu kaybolmasın). Etiketlenen kayıt sayısını döner.
 */
export function tagUntaggedRecords(data, code) {
  let n = 0;
  ["sales", "returns", "payments", "supplierTransactions", "expenses", "zReports", "giftCards"].forEach((key) => {
    (data[key] || []).forEach((r) => {
      if (!r.currency) {
        r.currency = code;
        n++;
      }
    });
  });
  return n;
}

/**
 * Saf: geçmişi dönüştürür (veriyi YERİNDE değiştirir → çağıran kopya vermeli).
 * Dönüş: { counts, sums, skipped }
 *  sums.<kategori> = { before, after } (yalnızca dönüştürülen kayıtlar)
 */
export function convertHistory(data, factor, from, to) {
  const conv = (v) => convertAmount(v, factor, to);
  const sums = {
    salesTotal: { before: 0, after: 0 },
    customerDebtSales: { before: 0, after: 0 },
    customerPayments: { before: 0, after: 0 },
    supplierDebt: { before: 0, after: 0 },
    supplierPaid: { before: 0, after: 0 },
    expenses: { before: 0, after: 0 }
  };
  const counts = { sales: 0, returns: 0, payments: 0, supplierTransactions: 0, expenses: 0, zReports: 0, giftCards: 0 };
  let skipped = 0;

  const field = (obj, name, sumKey) => {
    if (typeof obj[name] !== "number" || !Number.isFinite(obj[name])) return;
    const before = obj[name];
    obj[name] = conv(before);
    if (sumKey) {
      sums[sumKey].before += before;
      sums[sumKey].after += obj[name];
    }
  };
  const mark = (r, extra) => {
    r.convertedFrom = { currency: from, ...(extra || {}) };
    r.currency = to;
  };

  (data.sales || []).forEach((s) => {
    if (!belongs(s, from)) return void skipped++;
    const totalBefore = s.total;
    field(s, "total", "salesTotal");
    if (s.paymentType === "veresiye" && typeof totalBefore === "number") {
      sums.customerDebtSales.before += totalBefore;
      sums.customerDebtSales.after += s.total;
    }
    ["subtotal", "discount", "cost", "profit", "cashReceived", "changeGiven"].forEach((f) => field(s, f));
    (s.items || []).forEach((it) => {
      field(it, "price");
      field(it, "costPrice");
    });
    // Karışık ödeme: yerel birimdeki satırlar ve her satırın yerel karşılığı dönüşür; USD tutarı değişmez.
    (s.payments || []).forEach((p) => {
      field(p, "valueLocal");
      if (p.currency === from) {
        field(p, "amount");
        p.currency = to;
      }
    });
    mark(s, { usdRate: s.usdRate || null });
    s.usdRate = null;
    counts.sales++;
  });
  (data.returns || []).forEach((r) => {
    if (!belongs(r, from)) return void skipped++;
    field(r, "totalRefund");
    (r.items || []).forEach((it) => field(it, "price"));
    mark(r);
    counts.returns++;
  });
  (data.payments || []).forEach((p) => {
    if (!belongs(p, from)) return void skipped++;
    field(p, "amount", "customerPayments");
    mark(p);
    counts.payments++;
  });
  (data.supplierTransactions || []).forEach((t) => {
    if (!belongs(t, from)) return void skipped++;
    field(t, "amount", t.type === "debt" ? "supplierDebt" : "supplierPaid");
    mark(t);
    counts.supplierTransactions++;
  });
  (data.expenses || []).forEach((e) => {
    if (!belongs(e, from)) return void skipped++;
    field(e, "amount", "expenses");
    mark(e);
    counts.expenses++;
  });
  (data.zReports || []).forEach((z) => {
    if (!belongs(z, from)) return void skipped++;
    ["expected", "actual", "difference", "localCounted"].forEach((f) => field(z, f));
    mark(z, z.rate ? { rate: z.rate } : {});
    counts.zReports++;
  });
  (data.giftCards || []).forEach((g) => {
    if (!belongs(g, from)) return void skipped++;
    field(g, "initialAmount");
    field(g, "remainingBalance");
    mark(g);
    counts.giftCards++;
  });
  return { counts, sums, skipped };
}

/**
 * Saf: dönüşüm raporunun kurla uyumunu doğrular.
 * Her kategori için |after − before×factor| ≤ (kayıt sayısı × birim) olmalı.
 */
export function verifyConversion(result, factor, to) {
  const unit = unitOf(to);
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  const problems = [];
  Object.entries(result.sums).forEach(([key, { before, after }]) => {
    const expected = before * factor;
    const tolerance = Math.max(unit, total * unit) + Math.abs(expected) * 1e-9;
    if (Math.abs(after - expected) > tolerance) problems.push({ key, expected, after });
  });
  return { ok: problems.length === 0, problems };
}

/** Önizleme: kopya üzerinde dener, gerçek veriye dokunmaz. */
export function previewConversion(src, factor, from, to) {
  const copy = cloneData(src);
  const result = convertHistory(copy, factor, from, to);
  return { ...result, verification: verifyConversion(result, factor, to) };
}

// ---------------- Yedek alma ----------------

/** Yedeği JSON dosyası olarak indirir. */
export function downloadJson(obj, fileName) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Dönüşümden önce yedek: bulut (Firestore) + dosya. Dönüş:
 *  { cloud: boolean, file: boolean, id }
 * Asla fırlatmaz.
 */
export async function createPreConversionBackup() {
  const backup = buildFullBackup(state);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `pre-convert-${stamp}`;
  let file = false;
  let cloud = false;
  try {
    downloadJson(backup, `bakkal-yedek-donusum-oncesi-${stamp}.json`);
    file = true;
  } catch (e) {
    console.error("Yedek dosyası indirilemedi", e);
  }
  try {
    if (state.docRef) {
      await state.docRef.collection("backups").doc(id).set(backup);
      cloud = true;
    }
  } catch (e) {
    console.error("Bulut yedeği alınamadı", e);
  }
  return { cloud, file, id };
}

/**
 * Yedekten geri yüklerken para birimiyle ilgili alanları da döndürür
 * (para birimi, kur geçmişi, hediye kartları, Z raporları, …).
 * Yedekte olmayan alana dokunmaz.
 */
export function applyBackupExtras(backup, target = state) {
  ["giftCards", "zReports", "incomingOrders", "orderTemplates", "cashSessions", "wasteLog", "exchangeRates"].forEach((k) => {
    if (Array.isArray(backup[k])) target[k] = backup[k];
  });
  if (typeof backup.currency === "string" && CURRENCIES[backup.currency]) target.currency = backup.currency;
  if (typeof backup.perKmDeliveryFee === "number") target.perKmDeliveryFee = backup.perKmDeliveryFee;
  const ref = target.originalDocRef || target.docRef;
  if (ref && typeof backup.currency === "string") {
    ref
      .set({ currency: target.currency, exchangeRates: target.exchangeRates || [], perKmDeliveryFee: target.perKmDeliveryFee || 0 }, { merge: true })
      .catch((e) => console.error("Para birimi ayarı geri yüklenemedi", e));
  }
}
