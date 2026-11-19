// Testler bir tarayıcıda değil Node.js'te çalıştığı için, uygulamanın modül
// yüklenirken (import anında) okuduğu birkaç tarayıcı global'ini burada
// sahte (mock) olarak tanımlıyoruz. Bu dosya, gerçek uygulama modüllerinden
// ÖNCE import edilmelidir.
globalThis.window = {
  location: { search: "" },
  i18n: {
    getLang: () => "tr",
    t: (key) => (key === "unitKgShort" ? "kg" : key === "unitAdetShort" ? "adet" : key)
  }
};

// Node.js'te localStorage yok; basit bir bellek içi sahte sürüm (performans logu testleri için).
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear()
  };
}

// Node.js'te requestAnimationFrame yok (toast animasyonu kullanıyor); hemen çalıştıran sahte sürüm.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };
}
