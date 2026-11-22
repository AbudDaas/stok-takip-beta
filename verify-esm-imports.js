const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const escope = require("eslint-scope");

const SRC_DIR = require("path").join(__dirname, "js");

const KNOWN_GLOBALS = new Set([
  "window", "document", "navigator", "console", "fetch", "localStorage", "sessionStorage",
  "Notification", "SpeechSynthesisUtterance", "FileReader", "FormData", "File", "Blob",
  "URL", "URLSearchParams", "QRCode", "L", "Image", "performance", "XLSX", "confirm", "firebase", "setTimeout",
  "clearTimeout", "requestAnimationFrame", "caches", "Html5Qrcode", "chainConfig",
  "bulkScanConfig", "imageConfig", "CustomEvent", "pushConfig", "adminConfig", "firebaseConfig", "Math", "Date",
  "JSON", "Object", "Array", "String", "Number", "Boolean", "Promise", "Map", "Set",
  "RegExp", "undefined", "Error", "isNaN", "parseInt", "parseFloat", "encodeURIComponent",
  "decodeURIComponent", "Intl", "Symbol", "WeakMap", "structuredClone", "AbortController",
  "CustomEvent", "Event", "Image", "clearInterval", "setInterval", "globalThis",
  "SpeechRecognition", "webkitSpeechRecognition", "speechSynthesis", "navigator",
  "Uint8Array"
]);

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".js") && f !== "i18n.js" && !f.includes("config"));
let anyProblem = false;

files.forEach((fileName) => {
  const filePath = path.join(SRC_DIR, fileName);
  const src = fs.readFileSync(filePath, "utf8");
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module", ranges: true, locations: true });

  const scopeManager = escope.analyze(ast, {
    ecmaVersion: 2022,
    sourceType: "module",
    optimistic: false,
    ignoreEval: true,
    nodejsScope: false
  });

  // Modül kapsamındaki (import edilenler + üst düzey tanımlar dahil) "through"
  // referansları — bunlar GERÇEKTEN hiçbir yerde tanımlanmamış demektir.
  const moduleScope = scopeManager.scopes.find((s) => s.type === "module") || scopeManager.globalScope;

  const unresolved = new Set();
  moduleScope.through.forEach((ref) => {
    const name = ref.identifier.name;
    if (!KNOWN_GLOBALS.has(name)) {
      unresolved.add(name);
    }
  });

  if (unresolved.size > 0) {
    anyProblem = true;
    console.log(`❌ ${fileName}: eksik/çözülmemiş referanslar:`, [...unresolved].join(", "));
  } else {
    console.log(`✅ ${fileName}`);
  }
});

console.log(anyProblem ? "\n❌ SORUN VAR — yukarıya bak." : "\n✅ HİÇBİR DOSYADA EKSİK/ÇÖZÜLMEMİŞ REFERANS YOK.");
