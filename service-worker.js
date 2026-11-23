// Sürüm: çekirdek dosyalar değiştiğinde bu numarayı artır (eski önbellek otomatik silinir).
const VERSION = "v19";
const CACHE_NAME = "bakkal-stok-" + VERSION;
const SHARED_PHOTO_CACHE = "shared-photo-cache";

// Zayıf internette fetch sonsuza kadar asılı kalmasın: bu süre içinde cevap
// gelmezse önbellekteki kopya kullanılır.
const NETWORK_TIMEOUT_MS = 4000;

// ---- Kendi sunucundan gelen çekirdek dosyalar ----
// NOT: js/ altındaki tüm modüller burada olmalı (ES modülleri import ile
// yüklenir). Liste `npm run verify-sw` ile kontrol edilir.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/main.js",
  "./js/00-state.js",
  "./js/01-firebase-core.js",
  "./js/02-utils.js",
  "./js/03-staff-roles.js",
  "./js/04-fiscal.js",
  "./js/05-products.js",
  "./js/06-veresiye.js",
  "./js/07-kasa-checkout.js",
  "./js/08-sales-returns.js",
  "./js/09-suppliers.js",
  "./js/10-reminders.js",
  "./js/11-bread-orders.js",
  "./js/12-push-notifications.js",
  "./js/13-branches-chain.js",
  "./js/14-admin-panel.js",
  "./js/15-voice-commands.js",
  "./js/16-bulk-scan-ai.js",
  "./js/17-ai-panel.js",
  "./js/18-settings-backup.js",
  "./js/19-onboarding.js",
  "./js/20-navigation.js",
  "./js/21-expenses.js",
  "./js/22-perf-logger.js",
  "./js/23-giftcards.js",
  "./js/24-incoming-orders.js",
  "./js/25-stock-movements.js",
  "./js/26-case-units.js",
  "./js/27-currency.js",
  "./js/28-order-planning.js",
  "./js/29-mixed-payment.js",
  "./js/30-veresiye-statement.js",
  "./js/31-history-conversion.js",
  "./js/32-image-storage.js",
  "./js/33-staff-sales-report.js",
  "./js/34-cash-opening.js",
  "./js/35-waste.js",
  "./js/36-bulk-price.js",
  "./js/37-credit-control.js",
  "./js/i18n.js",
  "./js/firebase-config.js",
  "./js/bulk-scan-config.js",
  "./js/image-config.js",
  "./js/admin-config.js",
  "./js/push-config.js",
  "./js/chain-config.js"
];

// ---- CDN'den gelen kütüphaneler (index.html ile aynı sürümler) ----
// Bunlar önbelleğe alınmazsa internet yokken uygulama hiç açılmaz.
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js"
];

// Çalışma anında önbelleğe alınmasına izin verilen CDN adresleri
// (Font Awesome yazı tipi dosyaları gibi, listede olmayan ama bu sitelerden
// gelen dosyalar için). Firestore/Auth API çağrıları (googleapis.com) ASLA
// buraya girmez; onlara dokunulmaz.
function isCacheableCdn(url) {
  if (url.hostname === "cdnjs.cloudflare.com" || url.hostname === "unpkg.com") return true;
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) return true;
  return false;
}

// Tek tek önbelleğe al: biri başarısız olursa (404, ağ hatası) diğerleri yine kaydedilir.
// (Eski cache.addAll tek hatada TÜM listeyi iptal ediyordu.)
async function precache(cache, urls, crossOrigin) {
  await Promise.all(
    urls.map(async (u) => {
      try {
        const req = crossOrigin ? new Request(u, { mode: "no-cors" }) : new Request(u, { cache: "reload" });
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) await cache.put(req, res);
      } catch (e) {
        // bu dosya şimdi alınamadı; çalışma sırasında (fetch olayında) tekrar denenecek
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await precache(cache, CORE_ASSETS, false);
      await precache(cache, CDN_ASSETS, true);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Eski sürüm önbelleklerini sil; paylaşılan fotoğraf önbelleğine DOKUNMA.
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== SHARED_PHOTO_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      // Yeni sürüm devreye girdi: açık sekmelere haber ver.
      const clients = await self.clients.matchAll();
      clients.forEach((client) => client.postMessage({ type: "BAKKAL_SW_UPDATED", version: VERSION }));
    })()
  );
});

// ---- Share Target: galeriden/başka uygulamadan paylaşılan fotoğrafı yakala ----
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const file = formData.get("photos");
    if (file) {
      const cache = await caches.open(SHARED_PHOTO_CACHE);
      await cache.put("/shared-photo", new Response(file));
    }
  } catch (e) {
    // paylaşım okunamadıysa sessizce devam et
  }
  return Response.redirect("./index.html?shared=1", 303);
}

// Ağdan dene (zaman aşımıyla); olmazsa önbellekten ver. Başarılı cevabı önbelleğe yazar.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (fallbackUrl ? await cache.match(fallbackUrl) : null);
    if (cached) return cached;
    throw e;
  }
}

// Önce önbellek (kütüphaneler sürümlü URL'dir, değişmez); yoksa ağdan al ve sakla.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Paylaşılan fotoğraf isteği (manifest.json > share_target)
  if (event.request.method === "POST" && url.pathname.endsWith("/index.html")) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (event.request.method !== "GET") return;

  // CDN kütüphaneleri: cache-first
  if (url.origin !== self.location.origin) {
    if (isCacheableCdn(url)) {
      // <script>/<link> istekleri no-cors olduğu için opak cevap da kabul edilir.
      event.respondWith(cacheFirst(event.request));
    }
    return;
  }

  // Sayfa gezintileri: ağ yoksa uygulama kabuğunu (index.html) ver
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  // Kendi dosyalarımız: network-first (taze kod), internet yoksa/yavaşsa önbellek
  event.respondWith(networkFirst(event.request));
});

// ---- Push Notifications (Firebase Cloud Messaging) ----
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");
importScripts("./js/firebase-config.js");

if (typeof firebaseConfig !== "undefined" && firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf("BURAYA") !== 0) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || "Bakkal Stok Takip";
    const options = {
      body: (payload.notification && payload.notification.body) || "",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png"
    };
    self.registration.showNotification(title, options);
  });
}

// ---- Background Sync: bağlantı geri gelince açık sekmelere haber ver ----
self.addEventListener("sync", (event) => {
  if (event.tag === "bakkal-sync") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "BAKKAL_SYNC_RECONNECTED" }));
      })
    );
  }
});

// ---- Periodic Background Sync: uygulama kapalıyken bile temel dosyaları tazele ----
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "bakkal-refresh") {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => precache(cache, CORE_ASSETS, false)));
  }
});