/**
 * Fiş / makbuz + termal yazıcı bağlantısı.
 *
 * Fiş bir CANVAS üzerine resim olarak çizilir (tarayıcı Arapça harf birleştirme
 * ve sağdan sola yazımı kendisi yapar) ve ESC/POS "raster" komutuyla yazıcıya
 * gönderilir. Böylece Arapça/Türkçe karakter, kod sayfası (codepage) derdi
 * olmadan hemen her ESC/POS termal yazıcıda (58 mm / 80 mm) çalışır.
 *
 * Bağlantı türleri (Ayarlar'dan seçilir):
 *  - usb:       Kablolu (Web Serial; USB-seri/COM olarak görünen yazıcılar)
 *  - bluetooth: Bluetooth LE (Web Bluetooth; Chrome/Edge, Android ve bilgisayar)
 *  - system:    Sistem yazıcısı (tarayıcı yazdır penceresi; sürücüsü kurulu her yazıcı)
 * Web Serial / Web Bluetooth yalnızca Chrome/Edge'de ve https üzerinde çalışır.
 */

import { state } from './00-state.js';
import { CURRENCIES, escapeHtml, formatMoney, showToast } from './02-utils.js';

export const RECEIPT_DEFAULTS = {
  enabled: false,
  connection: "system", // usb | bluetooth | system
  paper: 58, // mm: 58 → 384 nokta, 80 → 576 nokta
  lang: "auto", // auto | tr | ar | en
  baud: 9600,
  shopName: "",
  headerExtra: "",
  footer: "",
  autoPrint: false
};

export function normalizeReceiptSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const baud = Number(r.baud);
  return {
    enabled: Boolean(r.enabled),
    connection: ["usb", "bluetooth", "system"].includes(r.connection) ? r.connection : "system",
    paper: Number(r.paper) === 80 ? 80 : 58,
    lang: ["tr", "ar", "en"].includes(r.lang) ? r.lang : "auto",
    baud: [9600, 19200, 38400, 57600, 115200].includes(baud) ? baud : 9600,
    shopName: String(r.shopName || "").slice(0, 60),
    headerExtra: String(r.headerExtra || "").slice(0, 200),
    footer: String(r.footer || "").slice(0, 120),
    autoPrint: Boolean(r.autoPrint)
  };
}

export function getReceiptSettings() {
  return normalizeReceiptSettings(state.receiptSettings);
}

export function isReceiptEnabled() {
  return getReceiptSettings().enabled;
}

// ---------------- Fiş metinleri (arayüz dilinden bağımsız) ----------------

const RC = {
  tr: { receipt: "SATIŞ FİŞİ", no: "Fiş No", date: "Tarih", cashier: "Kasiyer", customer: "Müşteri", subtotal: "Ara toplam", discount: "İndirim", total: "TOPLAM", nakit: "Nakit", kart: "Kart", veresiye: "Veresiye", hediye: "Hediye kartı", received: "Alınan", change: "Para üstü", thanks: "Teşekkür ederiz", kg: "kg", test: "TEST FİŞİ", locale: "tr-TR" },
  ar: { receipt: "إيصال بيع", no: "رقم الإيصال", date: "التاريخ", cashier: "الكاشير", customer: "الزبون", subtotal: "المجموع الفرعي", discount: "الخصم", total: "الإجمالي", nakit: "نقداً", kart: "بطاقة", veresiye: "دين", hediye: "بطاقة هدية", received: "المستلم", change: "الباقي", thanks: "شكراً لزيارتكم", kg: "كغ", test: "إيصال تجريبي", locale: "ar-SY-u-nu-latn" },
  en: { receipt: "SALES RECEIPT", no: "Receipt No", date: "Date", cashier: "Cashier", customer: "Customer", subtotal: "Subtotal", discount: "Discount", total: "TOTAL", nakit: "Cash", kart: "Card", veresiye: "On credit", hediye: "Gift card", received: "Received", change: "Change", thanks: "Thank you", kg: "kg", test: "TEST RECEIPT", locale: "en-GB" }
};

export function resolveReceiptLang(cfg) {
  if (cfg.lang !== "auto") return cfg.lang;
  const ui = window.i18n && window.i18n.getLang ? window.i18n.getLang() : "tr";
  return RC[ui] ? ui : "tr";
}

/**
 * Saf: satıştan fiş belgesi üretir.
 * Öğeler: {t:"title"|"text"|"rule"|"kv"|"item", ...}; align: "center" | "start"
 */
export function buildReceipt(sale, { lang = "tr", shopName = "", headerExtra = "", footer = "", fallbackCurrency = "TRY", test = false } = {}) {
  const L = RC[lang] || RC.tr;
  const cur = sale.currency || fallbackCurrency;
  const money = (v, code) => formatMoney(v, code || cur);
  const doc = [];
  if (shopName) doc.push({ t: "title", text: shopName });
  String(headerExtra || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((line) => doc.push({ t: "text", text: line, align: "center" }));
  doc.push({ t: "rule" });
  doc.push({ t: "text", text: test ? L.test : L.receipt, align: "center", bold: true });
  const when = new Date(sale.timestamp);
  doc.push({ t: "kv", k: L.no, v: String(sale.id || "").slice(-6).toUpperCase() });
  doc.push({ t: "kv", k: L.date, v: when.toLocaleString(L.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) });
  if (sale.staffName) doc.push({ t: "kv", k: L.cashier, v: sale.staffName });
  if (sale.customerName) doc.push({ t: "kv", k: L.customer, v: sale.customerName });
  doc.push({ t: "rule" });
  (sale.items || []).forEach((it) => {
    const qty = it.unit === "kg" ? `${it.qty} ${L.kg}` : String(it.qty);
    const lineTotal = Math.round((Number(it.qty) || 0) * (Number(it.price) || 0) * 100) / 100;
    doc.push({ t: "item", name: it.name, qtyPrice: `${qty} × ${money(it.price)}`, total: money(lineTotal) });
  });
  doc.push({ t: "rule" });
  if (Number(sale.discount) > 0) {
    doc.push({ t: "kv", k: L.subtotal, v: money(sale.subtotal) });
    doc.push({ t: "kv", k: L.discount, v: "-" + money(sale.discount) });
  }
  doc.push({ t: "kv", k: L.total, v: money(sale.total), bold: true, big: true });
  doc.push({ t: "kv", k: L[sale.paymentType] ? L[sale.paymentType] : String(sale.paymentType || ""), v: "" });
  if (Array.isArray(sale.payments) && sale.payments.length) {
    sale.payments.forEach((p) => doc.push({ t: "kv", k: `${L.received} (${(CURRENCIES[p.currency] || { symbol: p.currency }).symbol})`, v: money(p.amount, p.currency) }));
    if (Number(sale.changeGiven) > 0) doc.push({ t: "kv", k: L.change, v: money(sale.changeGiven) });
  }
  doc.push({ t: "rule" });
  doc.push({ t: "text", text: footer || L.thanks, align: "center" });
  return doc;
}

// ---------------- Çizim (canvas) ----------------

export function dotsForPaper(paper) {
  return Number(paper) === 80 ? 576 : 384;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/** Fiş belgesini canvas'a çizer ve canvas'ı döner. */
export function renderReceiptCanvas(doc, { width, rtl }) {
  const pad = 8;
  const base = width > 450 ? 26 : 22;
  const font = (size, bold) => `${bold ? "bold " : ""}${size}px Tahoma, "Segoe UI", Arial, sans-serif`;
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = width;
  const mctx = measureCanvas.getContext("2d");

  // 1. geçiş: yüksekliği hesapla; 2. geçiş: çiz
  const steps = [];
  let y = 8;
  const push = (fn, h) => {
    steps.push({ fn, y });
    y += h;
  };
  const textLines = (text, size, bold) => {
    mctx.font = font(size, bold);
    return wrapText(mctx, text, width - pad * 2);
  };
  doc.forEach((e) => {
    if (e.t === "rule") {
      push((ctx, yy) => {
        ctx.fillRect(pad, yy + 6, width - pad * 2, 2);
      }, 14);
    } else if (e.t === "title" || e.t === "text") {
      const size = e.t === "title" ? base + 8 : base;
      const bold = e.t === "title" || e.bold;
      textLines(e.text, size, bold).forEach((ln) => {
        push((ctx, yy) => {
          ctx.font = font(size, bold);
          ctx.textAlign = "center";
          ctx.fillText(ln, width / 2, yy + size);
        }, size + 8);
      });
    } else if (e.t === "kv") {
      const size = e.big ? base + 6 : base;
      push((ctx, yy) => {
        ctx.font = font(size, e.bold);
        ctx.textAlign = rtl ? "right" : "left";
        ctx.fillText(e.k, rtl ? width - pad : pad, yy + size);
        ctx.textAlign = rtl ? "left" : "right";
        ctx.fillText(e.v, rtl ? pad : width - pad, yy + size);
      }, size + 8);
    } else if (e.t === "item") {
      textLines(e.name, base, true).forEach((ln) => {
        push((ctx, yy) => {
          ctx.font = font(base, true);
          ctx.textAlign = rtl ? "right" : "left";
          ctx.fillText(ln, rtl ? width - pad : pad, yy + base);
        }, base + 6);
      });
      push((ctx, yy) => {
        ctx.font = font(base - 2, false);
        ctx.textAlign = rtl ? "right" : "left";
        ctx.fillText(e.qtyPrice, rtl ? width - pad : pad, yy + base);
        ctx.font = font(base, true);
        ctx.textAlign = rtl ? "left" : "right";
        ctx.fillText(e.total, rtl ? pad : width - pad, yy + base);
      }, base + 10);
    }
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(40, y + 16);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.direction = rtl ? "rtl" : "ltr";
  steps.forEach((s) => s.fn(ctx, s.y));
  return canvas;
}

// ---------------- ESC/POS ----------------

/** Saf: RGBA piksellerden 1-bit raster (satır başına ceil(w/8) bayt; 1 = siyah). */
export function rasterFromRGBA(rgba, w, h) {
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
      if (lum < 140) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { data: out, bytesPerRow };
}

/** Saf: raster'ı ESC/POS komut dizisine çevirir (başlat + bantlar + kağıt ilerlet + kes). */
export function escposFromRaster(raster, h, { band = 96, cut = true } = {}) {
  const parts = [Uint8Array.from([0x1b, 0x40])]; // ESC @
  for (let y = 0; y < h; y += band) {
    const rows = Math.min(band, h - y);
    const head = Uint8Array.from([0x1d, 0x76, 0x30, 0x00, raster.bytesPerRow & 255, raster.bytesPerRow >> 8, rows & 255, rows >> 8]);
    parts.push(head, raster.data.subarray(y * raster.bytesPerRow, (y + rows) * raster.bytesPerRow));
  }
  parts.push(Uint8Array.from([0x1b, 0x64, 0x04])); // 4 satır ilerlet
  if (cut) parts.push(Uint8Array.from([0x1d, 0x56, 0x42, 0x00])); // ilerlet + kısmi kes
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach((p) => {
    out.set(p, off);
    off += p.length;
  });
  return out;
}

export function escposFromCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return escposFromRaster(rasterFromRGBA(img.data, canvas.width, canvas.height), canvas.height);
}

// ---------------- Bağlantı ----------------

const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
];

let serialPort = null;
let btDevice = null;
let btChar = null;

export function isConnectionSupported(kind) {
  if (kind === "usb") return typeof navigator !== "undefined" && "serial" in navigator;
  if (kind === "bluetooth") return typeof navigator !== "undefined" && "bluetooth" in navigator;
  return true;
}

export function connectionLabel() {
  const cfg = getReceiptSettings();
  if (cfg.connection === "system") return state.t("receiptStatusSystem");
  if (cfg.connection === "usb" && serialPort) return state.t("receiptStatusConnected").replace("{name}", "USB");
  if (cfg.connection === "bluetooth" && btDevice && btDevice.gatt && btDevice.gatt.connected) {
    return state.t("receiptStatusConnected").replace("{name}", btDevice.name || "Bluetooth");
  }
  return state.t("receiptStatusNone");
}

async function openSerial(baud) {
  if (!serialPort.readable) await serialPort.open({ baudRate: baud });
}

/** Seçili bağlantıya yazıcı seçtirir (kullanıcı tıklamasıyla çağrılmalı). */
export async function connectPrinter() {
  const cfg = getReceiptSettings();
  if (cfg.connection === "system") return;
  if (!isConnectionSupported(cfg.connection)) throw new Error("unsupported");
  if (cfg.connection === "usb") {
    serialPort = await navigator.serial.requestPort();
    await openSerial(cfg.baud);
    return;
  }
  btDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  await connectBle();
}

async function connectBle() {
  const server = await btDevice.gatt.connect();
  const services = await server.getPrimaryServices();
  btChar = null;
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    const c = chars.find((x) => x.properties.write || x.properties.writeWithoutResponse);
    if (c) {
      btChar = c;
      break;
    }
  }
  if (!btChar) throw new Error("no_characteristic");
}

async function sendUsb(bytes, baud) {
  if (!serialPort && "serial" in navigator) {
    const granted = await navigator.serial.getPorts();
    serialPort = granted[0] || null;
  }
  if (!serialPort) throw new Error("not_connected");
  await openSerial(baud);
  const writer = serialPort.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

async function sendBluetooth(bytes) {
  if (!btDevice) throw new Error("not_connected");
  if (!btDevice.gatt.connected || !btChar) await connectBle();
  const size = 100;
  for (let i = 0; i < bytes.length; i += size) {
    const chunk = bytes.subarray(i, i + size);
    if (btChar.properties.writeWithoutResponse) await btChar.writeValueWithoutResponse(chunk);
    else await btChar.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function printViaBrowser(canvas, paper) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${paper}mm auto;margin:0}html,body{margin:0;padding:0}img{width:${paper}mm;display:block}</style></head><body><img id="r" src="${canvas.toDataURL("image/png")}"></body></html>`);
  doc.close();
  const img = doc.getElementById("r");
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  if (img.complete) go();
  else img.onload = go;
}

/** Belgeyi seçili bağlantıdan yazdırır. Hata fırlatabilir. */
export async function printDocument(doc, cfg = getReceiptSettings()) {
  const canvas = renderReceiptCanvas(doc, { width: dotsForPaper(cfg.paper), rtl: resolveReceiptLang(cfg) === "ar" });
  if (cfg.connection === "system") return printViaBrowser(canvas, cfg.paper);
  if (!isConnectionSupported(cfg.connection)) throw new Error("unsupported");
  const bytes = escposFromCanvas(canvas);
  if (cfg.connection === "usb") return sendUsb(bytes, cfg.baud);
  return sendBluetooth(bytes);
}

function receiptOptions(cfg, extra) {
  return {
    lang: resolveReceiptLang(cfg),
    shopName: cfg.shopName || state.businessName || "",
    headerExtra: cfg.headerExtra,
    footer: cfg.footer,
    fallbackCurrency: state.currency,
    ...(extra || {})
  };
}

function reportPrintError(e) {
  console.error("Fiş yazdırılamadı", e);
  const key = e && e.message === "unsupported" ? "receiptUnsupported" : e && e.message === "not_connected" ? "receiptNotConnected" : "receiptPrintFailed";
  showToast(state.t(key), "error");
}

/** Bir satışın fişini yazdırır (hatayı kullanıcıya bildirir, fırlatmaz). */
export async function printSale(sale) {
  const cfg = getReceiptSettings();
  try {
    await printDocument(buildReceipt(sale, receiptOptions(cfg)), cfg);
    return true;
  } catch (e) {
    reportPrintError(e);
    return false;
  }
}

export function autoPrintIfEnabled(sale) {
  const cfg = getReceiptSettings();
  if (cfg.enabled && cfg.autoPrint) printSale(sale);
}

export async function printTestReceipt() {
  const cfg = getReceiptSettings();
  const sale = {
    id: "TEST01",
    timestamp: new Date().toISOString(),
    items: [
      { name: "Ekmek / خبز", qty: 2, price: 10, unit: "adet" },
      { name: "Domates / بندورة", qty: 1.5, price: 40, unit: "kg" }
    ],
    subtotal: 80,
    discount: 0,
    total: 80,
    paymentType: "nakit",
    currency: state.currency
  };
  try {
    await printDocument(buildReceipt(sale, receiptOptions(cfg, { test: true })), cfg);
    showToast(state.t("receiptPrinted"), "success");
  } catch (e) {
    reportPrintError(e);
  }
}

// ---------------- Ayarlar arayüzü ----------------

function persist() {
  const ref = state.originalDocRef || state.docRef;
  if (ref) ref.set({ receiptSettings: state.receiptSettings }, { merge: true }).catch((e) => console.error("Fiş ayarı kaydedilemedi", e));
}

export function toggleReceipt() {
  state.receiptSettings = { ...getReceiptSettings(), enabled: document.getElementById("receiptEnabledCheck").checked };
  persist();
  renderReceiptSettings();
  document.dispatchEvent(new CustomEvent("receipt-settings-changed"));
}

export function saveReceiptSettings() {
  const v = (id) => document.getElementById(id).value;
  state.receiptSettings = normalizeReceiptSettings({
    enabled: getReceiptSettings().enabled,
    connection: v("receiptConnection"),
    paper: v("receiptPaper"),
    lang: v("receiptLang"),
    baud: v("receiptBaud"),
    shopName: v("receiptShopName").trim(),
    headerExtra: v("receiptHeaderExtra"),
    footer: v("receiptFooter").trim(),
    autoPrint: document.getElementById("receiptAutoPrint").checked
  });
  persist();
  showToast(state.t("receiptSaved"), "success");
  renderReceiptSettings();
}

export async function connectPrinterClick() {
  saveReceiptSettings();
  try {
    await connectPrinter();
    showToast(state.t("receiptConnected"), "success");
  } catch (e) {
    if (e && e.name === "NotFoundError") return; // kullanıcı seçimi iptal etti
    reportPrintError(e);
  }
  renderReceiptSettings();
}

export function renderReceiptSettings() {
  const check = document.getElementById("receiptEnabledCheck");
  const panel = document.getElementById("receiptPanel");
  if (!check || !panel) return;
  const cfg = getReceiptSettings();
  check.checked = cfg.enabled;
  panel.style.display = cfg.enabled ? "" : "none";
  if (!cfg.enabled) return;
  const key = JSON.stringify(cfg);
  if (panel.dataset.synced !== key) {
    panel.dataset.synced = key;
    const set = (id, val) => (document.getElementById(id).value = val);
    set("receiptConnection", cfg.connection);
    set("receiptPaper", String(cfg.paper));
    set("receiptLang", cfg.lang);
    set("receiptBaud", String(cfg.baud));
    set("receiptShopName", cfg.shopName);
    set("receiptHeaderExtra", cfg.headerExtra);
    set("receiptFooter", cfg.footer);
    document.getElementById("receiptAutoPrint").checked = cfg.autoPrint;
  }
  const kind = document.getElementById("receiptConnection").value;
  document.getElementById("receiptBaudRow").style.display = kind === "usb" ? "" : "none";
  document.getElementById("receiptConnectBtn").style.display = kind === "system" ? "none" : "";
  const note = document.getElementById("receiptNote");
  note.textContent = state.t(kind === "usb" ? "receiptNoteUsb" : kind === "bluetooth" ? "receiptNoteBt" : "receiptNoteSystem");
  const supported = isConnectionSupported(kind);
  const status = document.getElementById("receiptStatus");
  status.textContent = supported ? connectionLabel() : state.t("receiptUnsupported");
  status.style.color = supported ? "" : "var(--red-text)";
}

export function receiptButtonHtml(saleId) {
  if (!isReceiptEnabled()) return "";
  return `<button class="sale-receipt-btn" data-id="${escapeHtml(saleId)}"><i class="fa-solid fa-receipt" aria-hidden="true"></i> ${escapeHtml(state.t("receiptBtn"))}</button>`;
}
