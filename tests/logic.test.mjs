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
import { calcSellingPrice, formatQty, formatTL } from "../js/02-utils.js";
import { getBulkDiscountForItem, calcLineTotal } from "../js/07-kasa-checkout.js";
import { getCustomerDebt } from "../js/06-veresiye.js";
import { getSupplierBalance } from "../js/09-suppliers.js";
import { isInPeriod } from "../js/08-sales-returns.js";
import { measurePerf, logPerfEntry, getPerfLog, summarizePerfLog, clearPerfLog } from "../js/22-perf-logger.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
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

console.log(`\n${passed} test geçti, ${failed} test başarısız.\n`);
process.exit(failed > 0 ? 1 : 0);
