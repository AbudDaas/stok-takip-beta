// service-worker.js içindeki CORE_ASSETS listesini doğrular:
//  1) listedeki her yerel dosya gerçekten var mı
//  2) js/ altındaki her .js dosyası listede mi (eksik modül = çevrimdışı açılmaz)
//  3) index.html'deki CDN adresleri CDN_ASSETS içinde mi
// Kullanım: npm run verify-sw
const fs = require("fs");
const path = require("path");

const root = __dirname;
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function listFrom(name) {
  const m = sw.match(new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];"));
  if (!m) throw new Error(name + " service-worker.js içinde bulunamadı");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const core = listFrom("CORE_ASSETS");
const cdn = listFrom("CDN_ASSETS");
const errors = [];

for (const a of core) {
  if (a === "./") continue;
  if (!fs.existsSync(path.join(root, a))) errors.push("Dosya yok: " + a);
}

for (const f of fs.readdirSync(path.join(root, "js"))) {
  if (f.endsWith(".js") && !core.includes("./js/" + f)) errors.push("Listede eksik modül: js/" + f);
}

const htmlCdn = [...html.matchAll(/(?:src|href)="(https:\/\/(?:cdnjs\.cloudflare\.com|unpkg\.com|www\.gstatic\.com\/firebasejs)[^"]+)"/g)].map((x) => x[1]);
for (const u of htmlCdn) {
  if (!cdn.includes(u)) errors.push("CDN_ASSETS'te eksik: " + u);
}

if (errors.length) {
  console.error("Service Worker önbellek listesi HATALI:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log("Service Worker önbellek listesi tamam (" + core.length + " yerel, " + cdn.length + " CDN dosyası).");
