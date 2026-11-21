/**
 * Saf mantık fonksiyonları için otomatik testler.
 *
 * ÖNEMLİ: Bu testler artık GERÇEK ES modüllerini (js/ klasöründeki asıl
 * çalışan dosyaları) doğrudan import ediyor — kopya değil, ayrı bir "build"
 * çıktısı değil, tarayıcının çalıştıracağı BİREBİR AYNI dosyalar.
 *
 * Çalıştırmak için: node tests/logic.test.mjs
 */

import assert from "assert";
import "./setup-globals.mjs";
import { state } from "../js/00-state.js";
import { calcSellingPrice, formatMoney, formatQty, formatTL } from "../js/02-utils.js";
import worker from "../r2-worker/worker.js";
import { buildImageUrl, isLegacyStorageUrl, normalizeWorkerUrl, migrateImagesToR2, uploadImage } from "../js/32-image-storage.js";
import { applyBackupExtras, buildFullBackup, convertHistory, previewConversion, tagUntaggedRecords, verifyConversion } from "../js/31-history-conversion.js";
import { buildStatementEntries, buildStatementText } from "../js/30-veresiye-statement.js";
import { cashByCurrency, computeCashReceipt, formatCashTotals } from "../js/29-mixed-payment.js";
import { ORDER_DEFAULTS, buildSalesIndex, findSlowMovers, planOrder, roundOrderQty, soldQuantities, velocityFrom } from "../js/28-order-planning.js";
import { calcOrderSuggestions } from "../js/17-ai-panel.js";
import { saveCurrencySetting } from "../js/27-currency.js";
import { addRateEntry, convertAmount, convertProductPrices, conversionFactor, latestRate, localToUsd, sanitizeRate, usdToLocal, usdEquivalentText } from "../js/27-currency.js";
import { getBulkDiscountForItem, calcLineTotal } from "../js/07-kasa-checkout.js";
import { getCustomerDebt } from "../js/06-veresiye.js";
import { getSupplierBalance } from "../js/09-suppliers.js";
import { isInPeriod } from "../js/08-sales-returns.js";
import { caseCostToUnitCost, casesToUnits, getCaseSize } from "../js/26-case-units.js";
import { buildMovement, recordStockMovement, loadStockMovements, renderMovementRows } from "../js/25-stock-movements.js";
import { measurePerf, logPerfEntry, getPerfLog, summarizePerfLog, clearPerfLog } from "../js/22-perf-logger.js";

let passed = 0;
let failed = 0;

const asyncQueue = [];
function test(name, fn) {
  // async testler sırayla (birbirinin document/fetch taklitlerini bozmadan) en sonda çalıştırılır
  if (fn.constructor && fn.constructor.name === "AsyncFunction") {
    asyncQueue.push({ name, fn });
    return;
  }
  try {
    fn();
    console.log("  ✅", name);
    passed++;
  } catch (e) {
    console.log("  ❌", name, "-", e.message);
    failed++;
  }
}

console.log("\n📦 02-utils.js — calcSellingPrice");
test("varsayılan %20 kâr oranıyla doğru fiyat hesaplar", () => {
  assert.strictEqual(calcSellingPrice(100, null), 120);
});
test("özel kâr oranıyla doğru fiyat hesaplar", () => {
  assert.strictEqual(calcSellingPrice(100, 50), 150);
});
test("küsuratlı sonucu 5'in katına yukarı yuvarlar", () => {
  assert.strictEqual(calcSellingPrice(33.33, 15), 40);
});
test("%0 kâr oranında maliyeti aynen döndürür", () => {
  assert.strictEqual(calcSellingPrice(50, 0), 50);
});

console.log("\n📦 02-utils.js — formatQty / formatTL");
test("adet birimli ürünü doğru formatlar", () => {
  assert.strictEqual(formatQty({ unit: "adet", qty: 5 }), "5 adet");
});
test("kg birimli ürünü doğru formatlar", () => {
  assert.strictEqual(formatQty({ unit: "kg", qty: 2.5 }), "2,5 kg");
});
test("formatTL, TL sembolüyle iki ondalık basar", () => {
  assert.strictEqual(formatTL(1234.5), "1.234,50 ₺");
});
test("formatTL, geçersiz girdide 0 olarak davranır", () => {
  assert.strictEqual(formatTL(null), "0,00 ₺");
});

console.log("\n📦 07-kasa-checkout.js — getBulkDiscountForItem / calcLineTotal");
test("eşik altındaki miktarda indirim uygulanmaz", () => {
  state.products = [{ id: "p1", bulkDiscountQty: 24, bulkDiscountType: "percent", bulkDiscountValue: 10 }];
  assert.strictEqual(getBulkDiscountForItem({ productId: "p1", qty: 10, price: 20 }), null);
});
test("eşiğe ulaşan miktarda yüzde indirimi doğru hesaplar", () => {
  state.products = [{ id: "p1", bulkDiscountQty: 24, bulkDiscountType: "percent", bulkDiscountValue: 10 }];
  const discount = getBulkDiscountForItem({ productId: "p1", qty: 24, price: 20 });
  assert.strictEqual(discount.perUnitDiscount, 2);
  assert.strictEqual(discount.totalDiscount, 48);
});
test("sabit tutar indirimi satır toplamından düşülür (adet başına değil)", () => {
  state.products = [{ id: "p2", bulkDiscountQty: 12, bulkDiscountType: "amount", bulkDiscountValue: 24 }];
  const discount = getBulkDiscountForItem({ productId: "p2", qty: 12, price: 15 });
  assert.strictEqual(discount.totalDiscount, 24);
  assert.strictEqual(discount.perUnitDiscount, 2);
});
test("sabit tutar indirimi satır toplamını aşamaz", () => {
  state.products = [{ id: "p3", bulkDiscountQty: 2, bulkDiscountType: "amount", bulkDiscountValue: 999 }];
  const discount = getBulkDiscountForItem({ productId: "p3", qty: 2, price: 10 });
  assert.strictEqual(discount.totalDiscount, 20);
});
test("toplu indirimi olmayan üründe null döner", () => {
  state.products = [{ id: "p3" }];
  assert.strictEqual(getBulkDiscountForItem({ productId: "p3", qty: 100, price: 20 }), null);
});
test("calcLineTotal, indirim yokken adet × fiyat döner", () => {
  state.products = [{ id: "p3" }];
  assert.strictEqual(calcLineTotal({ productId: "p3", qty: 3, price: 20 }), 60);
});
test("calcLineTotal, indirim varken doğru düşülmüş toplamı döner", () => {
  state.products = [{ id: "p1", bulkDiscountQty: 24, bulkDiscountType: "percent", bulkDiscountValue: 10 }];
  assert.strictEqual(calcLineTotal({ productId: "p1", qty: 24, price: 20 }), 432);
});
test("indirim, ürünün kendi fiyatını aşamaz (adet başı)", () => {
  state.products = [{ id: "p4", bulkDiscountQty: 1, bulkDiscountType: "amount", bulkDiscountValue: 999 }];
  const discount = getBulkDiscountForItem({ productId: "p4", qty: 1, price: 10 });
  assert.strictEqual(discount.perUnitDiscount, 10);
});

console.log("\n📦 06-veresiye.js — getCustomerDebt");
test("sadece veresiye satışlarını borca sayar, nakit satışları saymaz", () => {
  state.sales = [
    { paymentType: "veresiye", customerId: "c1", total: 100 },
    { paymentType: "veresiye", customerId: "c1", total: 50 },
    { paymentType: "nakit", customerId: "c1", total: 999 }
  ];
  state.payments = [{ customerId: "c1", amount: 40 }];
  assert.strictEqual(getCustomerDebt("c1"), 110);
});
test("başka müşterinin borcunu karıştırmaz", () => {
  state.sales = [{ paymentType: "veresiye", customerId: "c2", total: 30 }];
  state.payments = [];
  assert.strictEqual(getCustomerDebt("c2"), 30);
});
test("hiç kaydı olmayan müşteri için 0 döner", () => {
  assert.strictEqual(getCustomerDebt("c999"), 0);
});
test("ödeme borçtan fazlaysa negatif değil 0 döner", () => {
  state.sales = [{ paymentType: "veresiye", customerId: "c1", total: 20 }];
  state.payments = [{ customerId: "c1", amount: 100 }];
  assert.strictEqual(getCustomerDebt("c1"), 0);
});

console.log("\n📦 09-suppliers.js — getSupplierBalance");
test("borç ve ödemeleri doğru netleştirir", () => {
  state.supplierTransactions = [
    { supplierId: "s1", type: "debt", amount: 500 },
    { supplierId: "s1", type: "payment", amount: 200 }
  ];
  assert.strictEqual(getSupplierBalance("s1"), 300);
});
test("başka tedarikçinin işlemini karıştırmaz", () => {
  state.supplierTransactions = [{ supplierId: "s2", type: "debt", amount: 80 }];
  assert.strictEqual(getSupplierBalance("s2"), 80);
});
test("hiç işlemi olmayan tedarikçi için 0 döner", () => {
  assert.strictEqual(getSupplierBalance("s999"), 0);
});

console.log("\n📦 08-sales-returns.js — isInPeriod");
test("bugünün tarihi 'today' periyoduna dahildir", () => {
  assert.strictEqual(isInPeriod(new Date().toISOString(), "today"), true);
});
test("30 gün önceki tarih 'today' periyoduna dahil değildir", () => {
  assert.strictEqual(isInPeriod(new Date(Date.now() - 30 * 86400000).toISOString(), "today"), false);
});
test("1 yıl önceki tarih 'week' periyoduna dahil değildir", () => {
  assert.strictEqual(isInPeriod(new Date(Date.now() - 365 * 86400000).toISOString(), "week"), false);
});

console.log("\n📦 22-perf-logger.js — measurePerf / logPerfEntry / summarizePerfLog");
test("measurePerf başarılı fonksiyonun sonucunu döner ve hatasız kayıt yazar", () => {
  clearPerfLog();
  const result = measurePerf("testOp", () => 1 + 1);
  assert.strictEqual(result, 2);
  const log = getPerfLog();
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].label, "testOp");
  assert.strictEqual(log[0].errorOccurred, false);
});
test("measurePerf, fonksiyon hata fırlatırsa hatayı loglar ve tekrar fırlatır", () => {
  clearPerfLog();
  assert.throws(() => {
    measurePerf("failingOp", () => {
      throw new Error("boom");
    });
  }, /boom/);
  const log = getPerfLog();
  assert.strictEqual(log[0].errorOccurred, true);
});
test("summarizePerfLog aynı etiket için çağrı sayısını, ortalamayı ve en yavaşı doğru hesaplar", () => {
  clearPerfLog();
  logPerfEntry("repeatedOp", 10);
  logPerfEntry("repeatedOp", 30);
  const summary = summarizePerfLog();
  assert.strictEqual(summary.length, 1);
  assert.strictEqual(summary[0].count, 2);
  assert.strictEqual(summary[0].avgMs, 20);
  assert.strictEqual(summary[0].maxMs, 30);
});
test("logPerfEntry en fazla 200 kayıt tutar (en eskiler düşer)", () => {
  clearPerfLog();
  for (let i = 0; i < 210; i++) logPerfEntry("op" + i, 1);
  const log = getPerfLog();
  assert.strictEqual(log.length, 200);
  assert.strictEqual(log[0].label, "op10");
});

console.log("\n📦 25-stock-movements.js — stok hareketleri");
const mvProduct = { id: "p1", name: "süt" };
test("buildMovement önce/sonra ve farkı doğru hesaplar", () => {
  const m = buildMovement({ product: mvProduct, type: "sale", before: 10, after: 3, actor: "Ali", now: "2026-01-01T10:00:00.000Z" });
  assert.strictEqual(m.delta, -7);
  assert.strictEqual(m.before, 10);
  assert.strictEqual(m.after, 3);
  assert.strictEqual(m.productId, "p1");
  assert.strictEqual(m.location, "raf");
  assert.strictEqual(m.actor, "Ali");
  assert.strictEqual(m.requested, undefined);
});
test("buildMovement, stokta olandan fazla satışta istenen miktarı ayrıca saklar", () => {
  const m = buildMovement({ product: mvProduct, type: "sale", before: 10, after: 0, requested: -12 });
  assert.strictEqual(m.delta, -10);
  assert.strictEqual(m.requested, -12);
});
test("buildMovement küsuratı 3 ondalığa yuvarlar ve undefined alan bırakmaz", () => {
  const m = buildMovement({ product: mvProduct, type: "manual_add", before: 0.1, after: 0.3 });
  assert.strictEqual(m.delta, 0.2);
  assert.ok(Object.values(m).every((v) => v !== undefined));
});
test("buildMovement depo konumunu saklar", () => {
  const m = buildMovement({ product: mvProduct, type: "warehouse_in", location: "depo", before: 0, after: 5 });
  assert.strictEqual(m.location, "depo");
});
test("recordStockMovement değişim yoksa kayıt oluşturmaz", () => {
  localStorage.clear();
  assert.strictEqual(recordStockMovement({ product: mvProduct, type: "count", before: 4, after: 4 }), null);
});
test("recordStockMovement buluta bağlı değilken yerel olarak saklar, loadStockMovements ürüne göre okur", async () => {
  localStorage.clear();
  state.cloudEnabled = false;
  recordStockMovement({ product: mvProduct, type: "sale", before: 10, after: 7, ref: "s1" });
  recordStockMovement({ product: { id: "p2", name: "ekmek" }, type: "sale", before: 5, after: 4 });
  const { movements, error } = await loadStockMovements("p1");
  assert.strictEqual(error, null);
  assert.strictEqual(movements.length, 1);
  assert.strictEqual(movements[0].ref, "s1");
  const all = await loadStockMovements(null);
  assert.strictEqual(all.movements.length, 2);
});
test("renderMovementRows özel karakterleri kaçırır (XSS) ve eksik stok uyarısı gösterir", () => {
  const m = buildMovement({ product: mvProduct, type: "sale", before: 2, after: 0, requested: -5, actor: "<img src=x onerror=alert(1)>" });
  const html = renderMovementRows([m]);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("stock-move-warn"));
});


console.log("\n📦 26-case-units.js — koli / adet dönüşümü");
test("getCaseSize önce elle girilen koli içi adedi kullanır", () => {
  assert.strictEqual(getCaseSize({ caseSize: 24, caseBarcodes: [{ barcode: "1", qty: 12 }] }), 24);
});
test("getCaseSize tanım yoksa ilk koli barkodunun adedini kullanır", () => {
  assert.strictEqual(getCaseSize({ caseBarcodes: [{ barcode: "1", qty: 12 }] }), 12);
  assert.strictEqual(getCaseSize({ caseQty: 6 }), 6);
});
test("getCaseSize tanım yoksa veya geçersizse 0 döner", () => {
  assert.strictEqual(getCaseSize({}), 0);
  assert.strictEqual(getCaseSize(null), 0);
  assert.strictEqual(getCaseSize({ caseSize: -3 }), 0);
  assert.strictEqual(getCaseSize({ caseSize: "abc" }), 0);
});
test("casesToUnits koliyi adede çevirir", () => {
  assert.strictEqual(casesToUnits(3, 12), 36);
  assert.strictEqual(casesToUnits(-1, 12), -12);
  assert.strictEqual(casesToUnits(2, 0), 0);
});
test("caseCostToUnitCost koli fiyatından adet maliyetini hesaplar", () => {
  assert.strictEqual(caseCostToUnitCost(120, 12), 10);
  assert.strictEqual(caseCostToUnitCost(100, 12), 8.33);
  assert.strictEqual(caseCostToUnitCost(0, 12), 0);
  assert.strictEqual(caseCostToUnitCost(120, 0), 0);
});

console.log("\n📦 27-currency.js — para birimi ve kur");
test("formatMoney TRY iki ondalık, SYP sıfır ondalık, USD $ simgesiyle basar", () => {
  assert.strictEqual(formatMoney(1234.5, "TRY"), "1.234,50 ₺");
  assert.strictEqual(formatMoney(1234567.4, "SYP"), "1.234.567 ل.س");
  assert.strictEqual(formatMoney(12.5, "USD"), "12,50 $");
  assert.strictEqual(formatMoney(5, "XXX"), "5,00 ₺");
});
test("formatTL işletmenin seçtiği para birimini kullanır", () => {
  state.currency = "SYP";
  assert.strictEqual(formatTL(1500), "1.500 ل.س");
  state.currency = "TRY";
  assert.strictEqual(formatTL(1500), "1.500,00 ₺");
});
test("sanitizeRate virgülü kabul eder, geçersizi 0 yapar", () => {
  assert.strictEqual(sanitizeRate("13500,5"), 13500.5);
  assert.strictEqual(sanitizeRate("abc"), 0);
  assert.strictEqual(sanitizeRate(-5), 0);
  assert.strictEqual(sanitizeRate(0), 0);
});
test("latestRate tarihe göre en yeni kuru seçer (sıra önemli değil)", () => {
  const rates = [
    { id: "a", date: "2026-01-02T00:00:00.000Z", rate: 14000 },
    { id: "b", date: "2026-01-03T00:00:00.000Z", rate: 14500 },
    { id: "c", date: "2026-01-01T00:00:00.000Z", rate: 13000 }
  ];
  assert.strictEqual(latestRate(rates), 14500);
  assert.strictEqual(latestRate([]), 0);
  assert.strictEqual(latestRate(undefined), 0);
});
test("localToUsd ve usdToLocal kurla doğru dönüştürür, kur yoksa 0 döner", () => {
  assert.strictEqual(localToUsd(140000, 14000), 10);
  assert.strictEqual(usdToLocal(10, 14000), 140000);
  assert.strictEqual(localToUsd(100, 0), 0);
});
test("addRateEntry geçersiz kuru eklemez ve geçmişi 200 kayıtla sınırlar", () => {
  assert.strictEqual(addRateEntry([], "abc").length, 0);
  let rates = [];
  for (let i = 1; i <= 210; i++) rates = addRateEntry(rates, 10000 + i, "2026-01-01T00:00:" + String(i % 60).padStart(2, "0") + "Z");
  assert.strictEqual(rates.length, 200);
  assert.strictEqual(rates[199].rate, 10210);
});
test("usdEquivalentText yalnızca USD dışı para biriminde ve kur varken metin döner", () => {
  state.currency = "SYP";
  state.exchangeRates = [{ id: "x", date: "2026-01-01T00:00:00.000Z", rate: 14000 }];
  assert.strictEqual(usdEquivalentText(140000), "≈ 10,00 $");
  assert.strictEqual(usdEquivalentText(0), "");
  state.currency = "USD";
  assert.strictEqual(usdEquivalentText(140000), "");
  state.currency = "SYP";
  state.exchangeRates = [];
  assert.strictEqual(usdEquivalentText(140000), "");
  state.currency = "TRY";
});

test("conversionFactor: TRY → USD, kur 1 USD = 50 ₺ ise çarpan 0,02", () => {
  assert.strictEqual(conversionFactor("TRY", "USD", 50), 0.02);
  assert.strictEqual(conversionFactor("USD", "SYP", 14000), 14000);
  assert.strictEqual(conversionFactor("TRY", "SYP", 300), 300);
  assert.strictEqual(conversionFactor("TRY", "TRY", 50), 0);
  assert.strictEqual(conversionFactor("TRY", "USD", 0), 0);
});
test("convertAmount: 35 ₺ → 0,70 $ (kur 50), USD → SYP tam sayıya yuvarlanır", () => {
  assert.strictEqual(convertAmount(35, conversionFactor("TRY", "USD", 50), "USD"), 0.7);
  assert.strictEqual(convertAmount(0.7, conversionFactor("USD", "SYP", 14000), "SYP"), 9800);
  assert.strictEqual(convertAmount(12.5, 0.02, "USD"), 0.25);
});
test("convertAmount: pozitif tutar hedef birimin en küçük değerinin altına düşmez, 0 ve geçersiz korunur", () => {
  assert.strictEqual(convertAmount(0.1, 0.02, "USD"), 0.01);
  assert.strictEqual(convertAmount(0, 0.02, "USD"), 0);
  assert.strictEqual(convertAmount("abc", 0.02, "USD"), 0);
});
test("convertProductPrices fiyat, maliyet, koli maliyeti ve indirimli fiyatı çevirir; yüzde indirime dokunmaz", () => {
  const p = { price: 35, costPrice: 25, caseCostPrice: 300, discountedPrice: 30, bulkDiscountType: "percent", bulkDiscountValue: 10, qty: 7, min: 3 };
  const changed = convertProductPrices(p, 0.02, "USD");
  assert.strictEqual(changed, 4);
  assert.strictEqual(p.price, 0.7);
  assert.strictEqual(p.costPrice, 0.5);
  assert.strictEqual(p.caseCostPrice, 6);
  assert.strictEqual(p.discountedPrice, 0.6);
  assert.strictEqual(p.bulkDiscountValue, 10);
  assert.strictEqual(p.qty, 7);
});
test("convertProductPrices sabit tutarlı toplu indirimi de çevirir", () => {
  const p = { price: 100, bulkDiscountType: "amount", bulkDiscountValue: 50 };
  convertProductPrices(p, 0.02, "USD");
  assert.strictEqual(p.bulkDiscountValue, 1);
});
test("latestRate para birimine göre süzer; kaydı olmayan eski girdiler her birime uyar", () => {
  const rates = [
    { id: "a", date: "2026-01-01T00:00:00.000Z", rate: 50, currency: "TRY" },
    { id: "b", date: "2026-01-02T00:00:00.000Z", rate: 14000, currency: "SYP" },
    { id: "c", date: "2025-12-01T00:00:00.000Z", rate: 45 }
  ];
  assert.strictEqual(latestRate(rates, "TRY"), 50);
  assert.strictEqual(latestRate(rates, "SYP"), 14000);
  assert.strictEqual(latestRate([{ id: "x", date: "2026-01-01T00:00:00.000Z", rate: 45, currency: "SYP" }], "TRY"), 0);
});
test("addRateEntry para birimini kaydeder", () => {
  const rates = addRateEntry([], 50, "2026-01-01T00:00:00.000Z", "TRY");
  assert.strictEqual(rates[0].currency, "TRY");
});

test("saveCurrencySetting: 35 ₺ ürün, kur 1 USD = 50 ₺ → 0,70 $ olur (uçtan uca)", () => {
  const els = {};
  const mk = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, textContent: "", innerHTML: "", value: "", checked: true, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, querySelector: () => mk(), querySelectorAll: () => [] });
  els.currencyConvertHistoryCheck = Object.assign(mk(), { checked: false });
  const el = (id) => (els[id] = els[id] || mk());
  const prevDoc = globalThis.document;
  const prevConfirm = globalThis.confirm;
  globalThis.document = { getElementById: el, createElement: () => mk(), body: { appendChild() {} }, querySelector: () => null };
  globalThis.confirm = () => true;
  try {
    state.currency = "TRY";
    state.exchangeRates = [];
    state.perKmDeliveryFee = 10;
    state.products = [
      { id: "a", name: "Ekmek", price: 35, costPrice: 25, qty: 4, min: 2 },
      { id: "b", name: "Süt", price: 0, qty: 1, min: 1 }
    ];
    el("currencySelect").value = "USD";
    el("currencyConvertCheck").checked = true;
    el("currencyConvertRate").value = "50";
    saveCurrencySetting();
    assert.strictEqual(state.currency, "USD");
    assert.strictEqual(state.products[0].price, 0.7);
    assert.strictEqual(state.products[0].costPrice, 0.5);
    assert.strictEqual(state.products[0].qty, 4);
    assert.strictEqual(state.products[1].price, 0);
    assert.strictEqual(state.perKmDeliveryFee, 0.2);
    assert.strictEqual(latestRate(state.exchangeRates, "TRY"), 50);
    assert.strictEqual(formatTL(state.products[0].price), "0,70 $");
    // geri dönüş: USD → TRY, aynı kurla
    el("currencySelect").value = "TRY";
    el("currencyConvertRate").value = "50";
    saveCurrencySetting();
    assert.strictEqual(state.currency, "TRY");
    assert.strictEqual(state.products[0].price, 35);
  } finally {
    globalThis.document = prevDoc;
    globalThis.confirm = prevConfirm;
    state.currency = "TRY";
    state.exchangeRates = [];
    state.perKmDeliveryFee = 0;
    state.products = [];
  }
});
test("saveCurrencySetting: dönüştür işareti kapalıysa fiyatlar değişmez (eski davranış)", () => {
  const els = {};
  const mk = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, textContent: "", innerHTML: "", value: "", checked: true, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, querySelector: () => mk(), querySelectorAll: () => [] });
  els.currencyConvertHistoryCheck = Object.assign(mk(), { checked: false });
  const el = (id) => (els[id] = els[id] || mk());
  const prevDoc = globalThis.document;
  const prevConfirm = globalThis.confirm;
  globalThis.document = { getElementById: el, createElement: () => mk(), body: { appendChild() {} }, querySelector: () => null };
  globalThis.confirm = () => true;
  try {
    state.currency = "TRY";
    state.products = [{ id: "a", name: "Ekmek", price: 35, qty: 1, min: 1 }];
    el("currencySelect").value = "SYP";
    el("currencyConvertCheck").checked = false;
    saveCurrencySetting();
    assert.strictEqual(state.currency, "SYP");
    assert.strictEqual(state.products[0].price, 35);
  } finally {
    globalThis.document = prevDoc;
    globalThis.confirm = prevConfirm;
    state.currency = "TRY";
    state.products = [];
  }
});
test("saveCurrencySetting: kur geçersizse ya da kullanıcı onaylamazsa hiçbir şey değişmez", () => {
  const els = {};
  const mk = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, textContent: "", innerHTML: "", value: "", checked: true, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, querySelector: () => mk(), querySelectorAll: () => [] });
  els.currencyConvertHistoryCheck = Object.assign(mk(), { checked: false });
  const el = (id) => (els[id] = els[id] || mk());
  const prevDoc = globalThis.document;
  const prevConfirm = globalThis.confirm;
  globalThis.document = { getElementById: el, createElement: () => mk(), body: { appendChild() {} }, querySelector: () => null };
  try {
    state.currency = "TRY";
    state.products = [{ id: "a", name: "Ekmek", price: 35, qty: 1, min: 1 }];
    el("currencySelect").value = "USD";
    el("currencyConvertCheck").checked = true;
    el("currencyConvertRate").value = "abc";
    globalThis.confirm = () => true;
    saveCurrencySetting();
    assert.strictEqual(state.currency, "TRY");
    assert.strictEqual(state.products[0].price, 35);
    el("currencyConvertRate").value = "50";
    globalThis.confirm = () => false;
    saveCurrencySetting();
    assert.strictEqual(state.currency, "TRY");
    assert.strictEqual(state.products[0].price, 35);
  } finally {
    globalThis.document = prevDoc;
    globalThis.confirm = prevConfirm;
    state.currency = "TRY";
    state.products = [];
  }
});

console.log("\n📦 28-order-planning.js — akıllı sipariş planlaması");
const NOW = new Date("2026-06-30T12:00:00.000Z").getTime();
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
test("planOrder: günde 5 adet, teslimat 3 gün → sipariş noktası ve miktar doğru", () => {
  const plan = planOrder({ stock: 20, avgDaily: 5, leadDays: 3, safetyDays: 2, coverDays: 7, unit: "adet", caseSize: 0 });
  assert.strictEqual(plan.reorderPoint, 25);
  assert.strictEqual(plan.targetStock, 60);
  assert.strictEqual(plan.needsOrder, true);
  assert.strictEqual(plan.orderQty, 40);
  assert.strictEqual(plan.daysLeft, 4);
});
test("planOrder: stok sipariş noktasının üstündeyse sipariş önermez", () => {
  const plan = planOrder({ stock: 26, avgDaily: 5, leadDays: 3, safetyDays: 2, coverDays: 7, unit: "adet" });
  assert.strictEqual(plan.needsOrder, false);
  assert.strictEqual(plan.orderQty, 0);
});
test("planOrder: koli bilgisi varsa miktar koli katına yukarı yuvarlanır", () => {
  const plan = planOrder({ stock: 20, avgDaily: 5, leadDays: 3, safetyDays: 2, coverDays: 7, unit: "adet", caseSize: 12 });
  assert.strictEqual(plan.orderQty, 48);
  assert.strictEqual(plan.cases, 4);
});
test("planOrder: satış yoksa sipariş önermez", () => {
  const plan = planOrder({ stock: 0, avgDaily: 0, leadDays: 3, safetyDays: 2, coverDays: 7, unit: "adet" });
  assert.strictEqual(plan.needsOrder, false);
});
test("roundOrderQty: kg 0.1'e, adet tam sayıya yukarı yuvarlanır", () => {
  assert.strictEqual(roundOrderQty(2.31, "kg", 0).qty, 2.4);
  assert.strictEqual(roundOrderQty(2.1, "adet", 0).qty, 3);
  assert.strictEqual(roundOrderQty(0, "adet", 12).qty, 0);
});
test("velocityFrom 7 ve 30 günlük hızı karıştırır, eğilimi hesaplar", () => {
  const v = velocityFrom(70, 150); // 10/gün son hafta, 5/gün ay → 7,5
  assert.strictEqual(v.avgDaily, 7.5);
  assert.strictEqual(v.trend, 2);
  assert.deepStrictEqual(velocityFrom(0, 0), { avgDaily: 0, trend: null });
});
test("buildSalesIndex: 30 günden eski satışı saymaz; ürün kimliği ve ad eşleşir", () => {
  const sales = [
    { timestamp: daysAgo(2), items: [{ productId: "p1", name: "süt", qty: 3 }] },
    { timestamp: daysAgo(10), items: [{ name: "süt", qty: 4 }] },
    { timestamp: daysAgo(40), items: [{ name: "süt", qty: 99 }] }
  ];
  const q = soldQuantities(buildSalesIndex(sales, NOW), { id: "p1", name: "süt" });
  assert.strictEqual(q.d7, 3);
  assert.strictEqual(q.d30, 7);
});
test("findSlowMovers: stokta olup 30 günde satılmayanları, stok değeri yüksek olan önce döner", () => {
  const products = [
    { id: "a", name: "A", qty: 5, costPrice: 10 },
    { id: "b", name: "B", qty: 2, warehouseQty: 10, costPrice: 20 },
    { id: "c", name: "C", qty: 0, costPrice: 5 },
    { id: "d", name: "D", qty: 9, costPrice: 1 }
  ];
  const sales = [{ timestamp: daysAgo(1), items: [{ productId: "d", name: "D", qty: 1 }] }];
  const slow = findSlowMovers(products, buildSalesIndex(sales, NOW));
  assert.deepStrictEqual(slow.map((x) => x.product.id), ["b", "a"]);
});
test("calcOrderSuggestions: depodaki stok sayılır ve tedarikçinin teslimat süresi kullanılır", () => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    state.suppliers = [{ id: "s1", name: "Toptancı", leadTimeDays: 5 }];
    state.products = [{ id: "p1", name: "süt", qty: 10, warehouseQty: 30, min: 5, price: 20, unit: "adet", supplierId: "s1", caseBarcodes: [{ barcode: "1", qty: 12 }] }];
    // son 30 günde 300 adet → ~10/gün; stok 40; sipariş noktası = 10 × (5+2) = 70 → sipariş gerekir
    state.sales = [{ timestamp: daysAgo(3), items: [{ productId: "p1", name: "süt", qty: 100 }] }, { timestamp: daysAgo(20), items: [{ productId: "p1", name: "süt", qty: 200 }] }];
    const list = calcOrderSuggestions(() => true);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].leadDays, 5);
    assert.strictEqual(list[0].suggestedOrder % 12, 0);
    assert.ok(list[0].cases > 0);
    // depo stoğu sayılmasaydı (10) daysLeft çok daha az olurdu
    assert.ok(list[0].daysLeft > 3);
  } finally {
    Date.now = realNow;
    state.suppliers = [];
    state.products = [];
    state.sales = [];
  }
});
test("ORDER_DEFAULTS makul varsayılanlar içerir", () => {
  assert.deepStrictEqual(ORDER_DEFAULTS, { leadDays: 3, safetyDays: 2, coverDays: 7 });
});

test("karışık ödeme: boş girişte tam tutar nakit sayılır", () => {
  const r = computeCashReceipt({ total: 5000, usdGiven: "", localGiven: "", rate: "", currency: "SYP" });
  assert.ok(r.ok && r.empty && r.change === 0 && r.payments.length === 0);
});
test("karışık ödeme: 20$ + 5000 ل.س, kur 12000, toplam 200000 → para üstü 45000", () => {
  const r = computeCashReceipt({ total: 200000, usdGiven: "20", localGiven: "5000", rate: "12000", currency: "SYP" });
  assert.ok(r.ok);
  assert.strictEqual(r.received, 245000);
  assert.strictEqual(r.change, 45000);
  assert.strictEqual(r.payments.length, 2);
  assert.strictEqual(r.payments[0].currency, "USD");
});
test("karışık ödeme: yetersiz tutar eksik olarak döner", () => {
  const r = computeCashReceipt({ total: 300000, usdGiven: "10", localGiven: "", rate: "12000", currency: "SYP" });
  assert.ok(!r.ok);
  assert.strictEqual(r.error, "short");
  assert.strictEqual(r.short, 180000);
});
test("karışık ödeme: dolar girilip kur yoksa hata", () => {
  const r = computeCashReceipt({ total: 100, usdGiven: "5", localGiven: "", rate: "", currency: "SYP" });
  assert.ok(!r.ok);
  assert.strictEqual(r.error, "rate");
});
test("karışık ödeme: yalnızca yerel para, kur gerekmez; virgüllü sayı kabul edilir", () => {
  const r = computeCashReceipt({ total: 85.5, usdGiven: "", localGiven: "100,5", rate: "", currency: "TRY" });
  assert.ok(r.ok);
  assert.strictEqual(r.change, 15);
});
test("cashByCurrency: para birimi bazında toplar, para üstünü yerel birimden düşer", () => {
  const sales = [
    { paymentType: "nakit", currency: "SYP", total: 200000, payments: [
      { currency: "USD", amount: 20 }, { currency: "SYP", amount: 5000 }], changeGiven: 45000 },
    { paymentType: "nakit", currency: "SYP", total: 10000 },
    { paymentType: "kart", currency: "SYP", total: 99999 }
  ];
  const t = cashByCurrency(sales, "SYP");
  assert.strictEqual(t.USD, 20);
  assert.strictEqual(t.SYP, -30000); // 5000 - 45000 + 10000
});

test("veresiye ekstresi: yürüyen bakiye ve metin", () => {
  const sales = [{ paymentType: "veresiye", customerId: "c1", timestamp: "2026-11-01T10:00:00Z", total: 100, currency: "TRY" },
    { paymentType: "veresiye", customerId: "c2", timestamp: "2026-11-02T10:00:00Z", total: 999, currency: "TRY" }];
  const payments = [{ customerId: "c1", timestamp: "2026-11-03T10:00:00Z", amount: 40 }];
  const e = buildStatementEntries(sales, payments, "c1", "TRY");
  assert.strictEqual(e.length, 2);
  assert.strictEqual(e[1].balance, 60);
  const text = buildStatementText({ name: "Ali", entries: e, debt: 60, currency: "TRY",
    labels: { title: "T", debt: "D", payment: "P", balance: "B" }, dateFmt: () => "x" });
  assert.ok(text.includes("B: ") && text.startsWith("T - Ali"));
});
test("veresiye ekstresi: karışık para biriminde yürüyen bakiye yazılmaz", () => {
  const e = buildStatementEntries([{ paymentType: "veresiye", customerId: "c1", timestamp: "2026-11-01T10:00:00Z", total: 5, currency: "USD" }],
    [{ customerId: "c1", timestamp: "2026-11-02T10:00:00Z", amount: 100 }], "c1", "SYP");
  assert.strictEqual(e[0].balance, null);
});

console.log("\n📦 31-history-conversion.js — geçmiş dönüşümü ve yedek");
function sampleData() {
  return {
    sales: [
      { id: "s1", paymentType: "veresiye", customerId: "c1", total: 100, subtotal: 100, discount: 0, cost: 60, profit: 40, items: [{ name: "A", qty: 2, price: 50, costPrice: 30 }], usdRate: 50 },
      { id: "s2", paymentType: "nakit", total: 85, subtotal: 85, discount: 0, cost: 50, profit: 35, items: [], payments: [{ method: "nakit", currency: "USD", amount: 2, rate: 50, valueLocal: 100 }, { method: "nakit", currency: "TRY", amount: 0, valueLocal: 0 }], cashReceived: 100, changeGiven: 15 },
      { id: "s3", paymentType: "nakit", total: 10, currency: "USD", items: [] }
    ],
    payments: [{ id: "p1", customerId: "c1", amount: 40 }],
    supplierTransactions: [{ id: "t1", type: "debt", amount: 500 }, { id: "t2", type: "payment", amount: 200 }],
    expenses: [{ id: "e1", amount: 75 }],
    returns: [{ id: "r1", totalRefund: 50, items: [{ name: "A", qty: 1, price: 50 }] }],
    zReports: [{ id: "z1", expected: 185, actual: 180, difference: -5 }],
    giftCards: [{ id: "g1", initialAmount: 100, remainingBalance: 60 }]
  };
}
test("convertHistory: ₺→ل.س (kur 1 ₺ = 300): tutarlar çarpılır, USD tutarı değişmez, etiketlenir", () => {
  const d = sampleData();
  const r = convertHistory(d, 300, "TRY", "SYP");
  assert.strictEqual(d.sales[0].total, 30000);
  assert.strictEqual(d.sales[0].items[0].price, 15000);
  assert.strictEqual(d.sales[0].currency, "SYP");
  assert.strictEqual(d.sales[0].convertedFrom.currency, "TRY");
  assert.strictEqual(d.sales[0].convertedFrom.usdRate, 50);
  assert.strictEqual(d.sales[1].payments[0].amount, 2); // USD aynen
  assert.strictEqual(d.sales[1].payments[0].valueLocal, 30000);
  assert.strictEqual(d.sales[1].changeGiven, 4500);
  assert.strictEqual(d.payments[0].amount, 12000);
  assert.strictEqual(d.supplierTransactions[0].amount, 150000);
  assert.strictEqual(d.expenses[0].amount, 22500);
  assert.strictEqual(d.returns[0].totalRefund, 15000);
  assert.strictEqual(d.zReports[0].difference, -1500);
  assert.strictEqual(d.giftCards[0].remainingBalance, 18000);
  assert.strictEqual(r.counts.sales, 2);
  assert.strictEqual(r.skipped, 1); // USD satışı atlandı
  assert.strictEqual(d.sales[2].total, 10);
  assert.ok(verifyConversion(r, 300, "SYP").ok);
});
test("convertHistory: kur 1 USD = 50 ₺ ile ₺→$: 100 ₺ = 2 $ ve doğrulama geçer", () => {
  const d = sampleData();
  const r = convertHistory(d, 1 / 50, "TRY", "USD");
  assert.strictEqual(d.sales[0].total, 2);
  assert.strictEqual(d.supplierTransactions[0].amount, 10);
  assert.ok(verifyConversion(r, 1 / 50, "USD").ok);
});
test("verifyConversion: bozuk dönüşümü yakalar", () => {
  const d = sampleData();
  const r = convertHistory(d, 300, "TRY", "SYP");
  r.sums.supplierDebt.after += 5000;
  const v = verifyConversion(r, 300, "SYP");
  assert.ok(!v.ok);
  assert.strictEqual(v.problems[0].key, "supplierDebt");
});
test("previewConversion gerçek veriye dokunmaz", () => {
  const prevSales = state.sales;
  state.sales = sampleData().sales;
  const p = previewConversion(state, 300, "TRY", "SYP");
  assert.strictEqual(state.sales[0].total, 100);
  assert.strictEqual(p.counts.sales, 2);
  assert.ok(p.verification.ok);
  state.sales = prevSales;
});
test("aynı kayıt iki kez çevrilmez (etiketli kayıt hedef birimdeyse atlanır)", () => {
  const d = sampleData();
  convertHistory(d, 300, "TRY", "SYP");
  const again = convertHistory(d, 300, "TRY", "SYP");
  assert.strictEqual(again.counts.sales, 0);
  assert.strictEqual(d.sales[0].total, 30000);
});
test("tagUntaggedRecords: birimi olmayan kayıtlara birim yazar", () => {
  const d = sampleData();
  const n = tagUntaggedRecords(d, "TRY");
  assert.ok(n >= 8);
  assert.strictEqual(d.sales[0].currency, "TRY");
  assert.strictEqual(d.sales[2].currency, "USD");
});
test("buildFullBackup: borç, tedarikçi, gider, iade, hediye kartı ve kur geçmişini içerir", () => {
  const keys = ["supplierTransactions", "suppliers", "payments", "expenses", "returns", "giftCards", "zReports", "exchangeRates", "currency"];
  const b = buildFullBackup({ ...sampleData(), suppliers: [{ id: "x" }], exchangeRates: [{ rate: 1 }], currency: "TRY", products: [] });
  keys.forEach((k) => assert.ok(k in b, k));
  assert.ok(b.savedAt);
});
test("applyBackupExtras: para birimi ve kur geçmişi geri yüklenir", () => {
  const target = { currency: "SYP", exchangeRates: [], giftCards: [] };
  applyBackupExtras({ currency: "TRY", exchangeRates: [{ rate: 50 }], giftCards: [{ id: "g" }], perKmDeliveryFee: 3 }, target);
  assert.strictEqual(target.currency, "TRY");
  assert.strictEqual(target.exchangeRates.length, 1);
  assert.strictEqual(target.perKmDeliveryFee, 3);
});

function currencyEnv(historyChecked) {
  const els = {};
  const mk = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, textContent: "", innerHTML: "", value: "", checked: true, click() {}, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, querySelector: () => mk(), querySelectorAll: () => [] });
  els.currencyConvertHistoryCheck = Object.assign(mk(), { checked: historyChecked });
  const el = (id) => (els[id] = els[id] || mk());
  globalThis.document = { getElementById: el, createElement: () => mk(), body: { appendChild() {}, removeChild() {} }, querySelector: () => null };
  globalThis.confirm = () => true;
  return el;
}
test("saveCurrencySetting + geçmiş: yedek alınır, borçlar kurla çevrilir (uçtan uca)", async () => {
  const prev = { doc: globalThis.document, confirm: globalThis.confirm, docRef: state.docRef };
  const el = currencyEnv(true);
  let cloudBackup = null;
  state.docRef = { collection: () => ({ doc: (id) => ({ set: async (data) => { cloudBackup = { id, data }; } }) }), set: () => Promise.resolve() };
  try {
    const d = sampleData();
    state.currency = "TRY";
    state.exchangeRates = [];
    state.products = [{ id: "a", name: "A", price: 50, qty: 1, min: 1 }];
    Object.assign(state, { sales: d.sales, payments: d.payments, supplierTransactions: d.supplierTransactions, expenses: d.expenses, returns: d.returns, zReports: d.zReports, giftCards: d.giftCards });
    el("currencySelect").value = "SYP";
    el("currencyConvertCheck").checked = true;
    el("currencyConvertRate").value = "300";
    saveCurrencySetting();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(cloudBackup && cloudBackup.id.startsWith("pre-convert-"));
    assert.strictEqual(cloudBackup.data.supplierTransactions[0].amount, 500); // yedek ESKİ değerleri tutar
    assert.strictEqual(cloudBackup.data.sales[0].total, 100);
    assert.strictEqual(state.currency, "SYP");
    assert.strictEqual(state.sales[0].total, 30000);
    assert.strictEqual(state.supplierTransactions[0].amount, 150000);
    assert.strictEqual(state.payments[0].amount, 12000);
    assert.strictEqual(state.products[0].price, 15000);
  } finally {
    Object.assign(state, { currency: "TRY", exchangeRates: [], products: [], sales: [], payments: [], supplierTransactions: [], expenses: [], returns: [], zReports: [], giftCards: [], docRef: prev.docRef });
    globalThis.document = prev.doc;
    globalThis.confirm = prev.confirm;
  }
});
test("saveCurrencySetting + geçmiş: yedek alınamazsa HİÇBİR ŞEY değişmez", async () => {
  const prev = { doc: globalThis.document, confirm: globalThis.confirm, docRef: state.docRef };
  const el = currencyEnv(true);
  const origCreate = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => { if (tag === "a") throw new Error("indirme yok"); return origCreate(tag); };
  state.docRef = { collection: () => ({ doc: () => ({ set: async () => { throw new Error("boyut"); } }) }), set: () => Promise.resolve() };
  try {
    state.currency = "TRY";
    state.supplierTransactions = [{ id: "t1", type: "debt", amount: 500 }];
    state.products = [{ id: "a", name: "A", price: 50, qty: 1, min: 1 }];
    el("currencySelect").value = "SYP";
    el("currencyConvertCheck").checked = true;
    el("currencyConvertRate").value = "300";
    saveCurrencySetting();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(state.currency, "TRY");
    assert.strictEqual(state.supplierTransactions[0].amount, 500);
    assert.strictEqual(state.products[0].price, 50);
  } finally {
    Object.assign(state, { currency: "TRY", products: [], supplierTransactions: [], docRef: prev.docRef });
    globalThis.document = prev.doc;
    globalThis.confirm = prev.confirm;
  }
});
test("saveCurrencySetting: geçmiş dönüştürülmezse eski kayıtlar etiketlenir (karışmaz)", () => {
  const prev = { doc: globalThis.document, confirm: globalThis.confirm };
  const el = currencyEnv(false);
  try {
    state.currency = "TRY";
    state.sales = [{ id: "s", total: 100, items: [], paymentType: "nakit" }];
    el("currencySelect").value = "SYP";
    el("currencyConvertCheck").checked = false;
    saveCurrencySetting();
    assert.strictEqual(state.currency, "SYP");
    assert.strictEqual(state.sales[0].total, 100);
    assert.strictEqual(state.sales[0].currency, "TRY");
  } finally {
    Object.assign(state, { currency: "TRY", sales: [] });
    globalThis.document = prev.doc;
    globalThis.confirm = prev.confirm;
  }
});

console.log("\n📦 32-image-storage.js + r2-worker — görsel depolama");
function withImageEnv(workerUrl, fn) {
  return async () => {
    const prev = { cfg: globalThis.imageConfig, fetch: globalThis.fetch, user: state.currentUser, docRef: state.docRef, orig: state.originalDocRef };
    globalThis.imageConfig = { workerUrl };
    state.currentUser = { getIdToken: async () => "TOKEN" };
    state.docRef = { id: "biz123456789", set: async () => {} };
    state.originalDocRef = null;
    try {
      await fn();
    } finally {
      globalThis.imageConfig = prev.cfg;
      globalThis.fetch = prev.fetch;
      state.currentUser = prev.user;
      state.docRef = prev.docRef;
      state.originalDocRef = prev.orig;
    }
  };
}
test("normalizeWorkerUrl: https:// yoksa ekler, sondaki / ve boşluğu atar", () => {
  assert.strictEqual(normalizeWorkerUrl("bakkal-images.abc.workers.dev"), "https://bakkal-images.abc.workers.dev");
  assert.strictEqual(normalizeWorkerUrl("  https://x.workers.dev/ "), "https://x.workers.dev");
  assert.strictEqual(normalizeWorkerUrl(""), "");
});
test("buildImageUrl / isLegacyStorageUrl", () => {
  assert.strictEqual(buildImageUrl("https://w.dev", "product-images/b/p.jpg", 5), "https://w.dev/img/product-images/b/p.jpg?v=5");
  assert.ok(isLegacyStorageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media"));
  assert.ok(!isLegacyStorageUrl("https://w.workers.dev/img/a/b/c.jpg?v=1"));
  assert.ok(!isLegacyStorageUrl(""));
});
test("uploadImage: R2 ayarlıysa Worker'a PUT eder, belirteç ve adres doğru", withImageEnv("https://w.workers.dev/", async () => {
  let call = null;
  globalThis.fetch = async (url, init) => { call = { url, init }; return { ok: true, status: 200 }; };
  const url = await uploadImage("product-images/biz123456789/p1.jpg", new Blob(["x"], { type: "image/jpeg" }));
  assert.strictEqual(call.url, "https://w.workers.dev/img/product-images/biz123456789/p1.jpg");
  assert.strictEqual(call.init.method, "PUT");
  assert.strictEqual(call.init.headers.Authorization, "Bearer TOKEN");
  assert.ok(url.startsWith("https://w.workers.dev/img/product-images/biz123456789/p1.jpg?v="));
}));
test("uploadImage: R2 ayarı boşsa eski Firebase Storage yolu kullanılır", withImageEnv("", async () => {
  const prevStorage = state.storage;
  const calls = [];
  state.storage = { ref: (path) => ({ put: async () => calls.push(path), getDownloadURL: async () => "https://firebasestorage.googleapis.com/x" }) };
  const url = await uploadImage("product-images/b/p.jpg", new Blob(["x"]));
  state.storage = prevStorage;
  assert.deepStrictEqual(calls, ["product-images/b/p.jpg"]);
  assert.ok(url.includes("firebasestorage"));
}));
test("uploadImage: sunucu hata dönerse fırlatır", withImageEnv("https://w.workers.dev", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(() => uploadImage("product-images/b/p.jpg", new Blob(["x"])));
}));
test("migrateImagesToR2: eski adresleri taşır, yenileri atlar", withImageEnv("https://w.workers.dev", async () => {
  const prevProducts = state.products;
  state.products = [
    { id: "pa1", name: "A", image: "https://firebasestorage.googleapis.com/v0/b/x/o/a?alt=media" },
    { id: "pb1", name: "B", image: "https://w.workers.dev/img/product-images/biz123456789/pb1.jpg?v=1" },
    { id: "pc1", name: "C" }
  ];
  globalThis.fetch = async (url, init) => (init && init.method === "PUT" ? { ok: true, status: 200 } : { ok: true, status: 200, blob: async () => new Blob(["img"], { type: "image/jpeg" }) });
  const r = await migrateImagesToR2();
  const moved = state.products[0].image;
  state.products = prevProducts;
  assert.strictEqual(r.migrated, 1);
  assert.strictEqual(r.skipped, 1);
  assert.ok(moved.startsWith("https://w.workers.dev/img/product-images/biz123456789/pa1.jpg?v="));
}));
test("migrateImagesToR2: eski depo 402 veriyorsa durur ve hiçbir adresi bozmaz", withImageEnv("https://w.workers.dev", async () => {
  const prevProducts = state.products;
  const old = "https://firebasestorage.googleapis.com/v0/b/x/o/a?alt=media";
  state.products = Array.from({ length: 12 }, (_, i) => ({ id: "p" + i + "xxxx", name: "P" + i, image: old }));
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return { ok: false, status: 402 }; };
  const r = await migrateImagesToR2();
  const intact = state.products.every((p) => p.image === old);
  state.products = prevProducts;
  assert.ok(r.aborted);
  assert.strictEqual(r.migrated, 0);
  assert.ok(intact);
  assert.ok(fetches < 12);
}));

function r2Env() {
  const store = new Map();
  return {
    store,
    IMAGES: {
      get: async (k) => (store.has(k) ? { body: store.get(k).data, httpMetadata: { contentType: store.get(k).type }, httpEtag: '"e"' } : null),
      put: async (k, data, opt) => store.set(k, { data, type: opt.httpMetadata.contentType }),
      delete: async (k) => store.delete(k)
    },
    FIREBASE_PROJECT_ID: "bakkal-stok"
  };
}
const imgReq = (method, path, opts = {}) => new Request("https://w.dev" + path, { method, ...opts });
test("worker: yetkisiz PUT 403, yetkili PUT kaydeder, GET herkese açık", async () => {
  const env = r2Env();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => ({ status: init && init.headers && init.headers.Authorization === "Bearer GOOD" ? 200 : 403 });
  try {
    const path = "/img/product-images/biz123456789/p1.jpg";
    let res = await worker.fetch(imgReq("PUT", path, { body: "abc", headers: { "Content-Type": "image/jpeg" } }), env);
    assert.strictEqual(res.status, 403);
    res = await worker.fetch(imgReq("PUT", path, { body: "abc", headers: { "Content-Type": "image/jpeg", Authorization: "Bearer BAD" } }), env);
    assert.strictEqual(res.status, 403);
    assert.ok((await res.json()).reason.includes("Firestore 403"));
    const noVar = await worker.fetch(imgReq("PUT", path, { body: "abc", headers: { "Content-Type": "image/jpeg", Authorization: "Bearer GOOD" } }), { ...env, FIREBASE_PROJECT_ID: "" });
    assert.ok((await noVar.json()).reason.includes("FIREBASE_PROJECT_ID"));
    res = await worker.fetch(imgReq("PUT", path, { body: "abc", headers: { "Content-Type": "image/jpeg", Authorization: "Bearer GOOD" } }), env);
    assert.strictEqual(res.status, 200);
    res = await worker.fetch(imgReq("GET", path), env);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get("Cache-Control").includes("immutable"));
    assert.strictEqual(await res.text(), "abc");
  } finally {
    globalThis.fetch = prevFetch;
  }
});
test("worker: geçersiz yol, tür ve boyut reddedilir; CORS ön kontrolü çalışır", async () => {
  const env = r2Env();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200 });
  try {
    const auth = { Authorization: "Bearer GOOD" };
    assert.strictEqual((await worker.fetch(imgReq("GET", "/img/../../etc/passwd"), env)).status, 404);
    assert.strictEqual((await worker.fetch(imgReq("GET", "/img/other/biz123456789/p.jpg"), env)).status, 404);
    assert.strictEqual((await worker.fetch(imgReq("PUT", "/img/product-images/biz123456789/p.jpg", { body: "x", headers: { ...auth, "Content-Type": "text/html" } }), env)).status, 415);
    assert.strictEqual((await worker.fetch(imgReq("PUT", "/img/product-images/biz123456789/p.jpg", { body: new Uint8Array(1024 * 1024 + 1), headers: { ...auth, "Content-Type": "image/jpeg" } }), env)).status, 413);
    const pre = await worker.fetch(imgReq("OPTIONS", "/img/product-images/biz123456789/p.jpg"), env);
    assert.strictEqual(pre.status, 204);
    assert.ok(pre.headers.get("Access-Control-Allow-Methods").includes("PUT"));
    assert.strictEqual((await worker.fetch(imgReq("GET", "/img/product-images/biz123456789/yok.jpg"), env)).status, 404);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

console.log("\n⏱️ async testler");
for (const { name, fn } of asyncQueue) {
  try {
    await fn();
    console.log("  ✅", name);
    passed++;
  } catch (e) {
    console.log("  ❌", name, "-", e.message);
    failed++;
  }
}
console.log(`\n${passed} test geçti, ${failed} test başarısız.\n`);
process.exit(failed > 0 ? 1 : 0);