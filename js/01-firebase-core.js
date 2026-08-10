import { state } from './00-state.js';
import { mkProduct, showToast } from './02-utils.js';
import { applyAccountTypeUI, checkStaffSelection } from './03-staff-roles.js';
import { productAlreadyExists } from './05-products.js';
import { loadAdminBusinessList, loadAdminFeedback } from './14-admin-panel.js';
import { maybeCreateDailyBackup, reapplySimpleModeIfSet } from './18-settings-backup.js';
import { checkOnboarding } from './19-onboarding.js';
import { renderAll } from './20-navigation.js';

export function locale() {
    const lang = window.i18n.getLang();
    if (lang === "en") return "en-US";
    if (lang === "ar") return "ar-SA";
    return "tr-TR";
  }

export function initFirebaseIfConfigured() {
    try {
      if (typeof firebaseConfig === "undefined") return false;
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey.indexOf("BURAYA") === 0) return false;
      firebase.initializeApp(firebaseConfig);
      state.db = firebase.firestore();
      state.auth = firebase.auth();
      state.storage = firebase.storage();
      state.cloudEnabled = true;

      // Çevrimdışı (offline) destek: Firestore'un kendi yerleşik önbelleğini
      // etkinleştiriyoruz. Bu sayede internet kesildiğinde bile:
      //  - Daha önce yüklenmiş veriler (ürünler, satışlar) okunabilir kalır
      //  - Yapılan değişiklikler (yeni satış, stok güncellemesi) yerel
      //    olarak kaydedilir ve internet geri gelince OTOMATİK olarak
      //    sunucuya gönderilir — elle bir şey yapmaya gerek yok.
      // "synchronizeTabs: true" ile aynı cihazda birden fazla sekme/pencere
      // açık olsa bile önbellek tutarlı kalır.
      state.db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
        if (err.code === "failed-precondition") {
          console.warn("Çevrimdışı önbellek: aynı tarayıcıda başka bir sekme zaten açık, bu sekmede pasif kalacak.");
        } else if (err.code === "unimplemented") {
          console.warn("Bu tarayıcı çevrimdışı önbelleği desteklemiyor.");
        }
      });

      return true;
    } catch (e) {
      console.error("Firebase başlatma hatası", e);
      return false;
    }
  }

export function showApp(show) {
    document.getElementById("app").style.display = show ? "block" : "none";
    document.querySelector(".bottom-nav").style.display = show ? "flex" : "none";
  }

export function handleAuthChange(user) {
    if (state.firestoreUnsubscribe) {
      state.firestoreUnsubscribe();
      state.firestoreUnsubscribe = null;
    }
    if (user) {
      state.currentUser = user;
      document.getElementById("authScreen").style.display = "none";
      document.getElementById("logoutBtn").style.display = "flex";
      showApp(true);
      state.docRef = state.db.collection("isletmeler").doc(user.uid);
      setSyncStatus("connecting");
      attachFirestoreListener();
      const importBtn = document.getElementById("importBackupBtn");
      if (importBtn) importBtn.style.display = hasImportableLocalBackup() ? "flex" : "none";

      const adminNavBtn = document.getElementById("adminNavBtn");
      if (adminNavBtn) {
        adminNavBtn.style.display = user.uid === state.ADMIN_UID ? "flex" : "none";
        if (user.uid === state.ADMIN_UID) {
          loadAdminBusinessList();
          loadAdminFeedback();
        }
      }
    } else {
      state.currentUser = null;
      state.docRef = null;
      state.products = [];
      state.sales = [];
      state.customers = [];
      state.payments = [];
      state.cart = [];
      document.getElementById("authScreen").style.display = "flex";
      document.getElementById("logoutBtn").style.display = "none";
      showApp(false);
      setSyncStatus("local");
      const adminNavBtn = document.getElementById("adminNavBtn");
      if (adminNavBtn) adminNavBtn.style.display = "none";
    }
  }

export function attachFirestoreListener() {
    state.firestoreUnsubscribe = state.docRef.onSnapshot(
      (snap) => {
        if (state.suppressNextSnapshot) {
          state.suppressNextSnapshot = false;
          return;
        }
        if (snap.exists && snap.data().products) {
          const data = snap.data();
          state.products = data.products;
          state.sales = data.sales || [];
          state.customers = data.customers || [];
          state.payments = data.payments || [];
          state.breadLog = data.breadLog || [];
          state.dailyResetConfig = data.dailyResetConfig || [];
          state.breadWhatsAppNumber = data.breadWhatsAppNumber || "";
          state.priceChangeLog = data.priceChangeLog || [];
          state.fiscalEnabled = data.fiscalEnabled || false;
          state.fiscalProvider = data.fiscalProvider || "foriba";
          state.fiscalApiKey = data.fiscalApiKey || "";
          state.fiscalEndpoint = data.fiscalEndpoint || "";
          state.fiscalVkn = data.fiscalVkn || "";
          state.suppliers = data.suppliers || [];
          state.supplierTransactions = data.supplierTransactions || [];
          state.returns = data.returns || [];
          state.expenses = data.expenses || [];
          state.publicCatalogEnabled = data.publicCatalogEnabled || false;
          state.publicCatalogPhone = data.publicCatalogPhone || "";
          state.businessName = data.businessName || "";
          state.loyaltyEnabled = data.loyaltyEnabled || false;
          state.loyaltyEarnRate = data.loyaltyEarnRate || 10;
          state.loyaltyRedeemRate = data.loyaltyRedeemRate || 10;
          state.giftCards = data.giftCards || [];
          state.scaleBarcodeEnabled = data.scaleBarcodeEnabled || false;
          state.scaleBarcodePrefix = data.scaleBarcodePrefix || "20";
          state.scaleBarcodeCodeLength = data.scaleBarcodeCodeLength || 5;
          state.scaleBarcodeWeightLength = data.scaleBarcodeWeightLength || 5;
          state.businessLat = data.businessLat || null;
          state.businessLng = data.businessLng || null;
          state.perKmDeliveryFee = data.perKmDeliveryFee || 0;
          state.businessLogo = data.businessLogo || "";
          state.brandColor = data.brandColor || "#1F3864";
          state.incomingOrders = data.incomingOrders || [];
          state.blockedPhones = data.blockedPhones || [];
          state.blockedIPs = data.blockedIPs || [];
          state.zReports = data.zReports || [];
          state.orderTemplates = data.orderTemplates || [];

          // ---- Çakışma tespiti ----
          // Bu koda ulaşan her anlık görüntü, KENDİ yazdığımız bir kayıt
          // DEĞİLDİR (kendi yazdığımız kayıtlar suppressNextSnapshot ile
          // yukarıda filtreleniyor). Yani buraya ulaşan, ya ilk yükleme ya da
          // BAŞKA bir cihazdan gelen bir değişikliktir. Daha önce zaten veri
          // yüklemişsek ve gelen "_rev" sayacı bizim bildiğimizden farklıysa,
          // bu, başka bir cihazın araya girip veri değiştirdiği anlamına gelir.
          const incomingRev = data._rev || 0;
          if (state._hasLoadedOnce && incomingRev !== state._rev) {
            showToast(state.t("dataChangedElsewhereWarning"), "info");
          }
          state._rev = incomingRev;
          state._hasLoadedOnce = true;
          state.accountType = data.accountType || "standalone";
          state.auditLog = data.auditLog || [];
          state.staffMembers = data.staffMembers || [];
          state.ownerPin = data.ownerPin || "";
          state.masterCatalog = data.masterCatalog || [];
        } else if (snap.metadata.fromCache) {
          // KRİTİK GÜVENLİK KONTROLÜ: Bu anlık görüntü henüz sunucudan değil,
          // cihazın YEREL ÖNBELLEĞİNDEN geliyor (örn. telefon ilk kez açıldığında,
          // internet henüz tam bağlanmadan). Belge "yok" gibi görünse bile bu
          // GERÇEK olmayabilir — sunucudan gelecek asıl veriyi bekle, ASLA bu
          // durumda örnek veriyle üzerine yazma (gerçek veriyi silme riski var).
          console.warn("Önbellekten boş/eksik anlık görüntü geldi, sunucu onayı bekleniyor — üzerine yazılmadı.");
          return;
        } else {
          const initial = { products: seedData(), sales: [], customers: [], payments: [] };
          state.docRef.set(initial);
          state.products = initial.products;
          state.sales = initial.sales;
          state.customers = initial.customers;
          state.payments = initial.payments;
          state.breadLog = [];
          state.dailyResetConfig = [];
          state.breadWhatsAppNumber = "";
          state.priceChangeLog = [];
        }
        applyAccountTypeUI();
        checkStaffSelection();
        reapplySimpleModeIfSet();
        checkOnboarding();
        maybeCreateDailyBackup();
        setSyncStatus("connected");
        renderAll();
      },
      (err) => {
        console.error("Firestore hata", err);
        setSyncStatus("error");
      }
    );
  }

export function setSyncStatus(status) {
    const icon = document.getElementById("syncIcon");
    const text = document.getElementById("syncText");
    if (!icon || !text) return;
    if (status === "connected") {
      icon.className = "fa-solid fa-circle-check";
      text.textContent = state.t("syncConnected");
    } else if (status === "connecting") {
      icon.className = "fa-solid fa-arrows-rotate";
      text.textContent = state.t("syncConnecting");
    } else if (status === "offline") {
      icon.className = "fa-solid fa-plane";
      text.textContent = state.t("syncOffline");
    } else if (status === "error") {
      icon.className = "fa-solid fa-triangle-exclamation";
      text.textContent = state.t("syncError");
    } else {
      icon.className = "fa-solid fa-cloud";
      text.textContent = state.t("syncLocal");
    }
  }

/**
 * Tarayıcının kendi çevrimiçi/çevrimdışı olaylarını dinleyerek senkronizasyon
 * göstergesini günceller. Firestore'un kendi önbelleği zaten arka planda
 * çalışmaya devam ediyor — bu sadece kullanıcıya "şu an internetin yok ama
 * merak etme, değişiklikler kaydediliyor" demenin bir yolu.
 */
export function setupOfflineDetection() {
    window.addEventListener("offline", () => {
      if (state.cloudEnabled) setSyncStatus("offline");
    });
    window.addEventListener("online", () => {
      if (state.cloudEnabled) setSyncStatus("connecting");
    });
    if (!navigator.onLine && state.cloudEnabled) {
      setSyncStatus("offline");
    }
  }

export function showAuthError(message) {
    const el = document.getElementById("authError");
    el.textContent = message;
    el.style.display = "block";
  }

export function mapAuthError(code) {
    const messages = {
      "auth/invalid-email": state.t("authErrInvalidEmail"),
      "auth/user-not-found": state.t("authErrUserNotFound"),
      "auth/wrong-password": state.t("authErrWrongPassword"),
      "auth/invalid-credential": state.t("authErrInvalidCredential"),
      "auth/too-many-requests": state.t("authErrTooMany")
    };
    return messages[code] || state.t("authErrGeneric");
  }

export function submitAuth() {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || !password) {
      showAuthError(state.t("authErrRequired"));
      return;
    }
    document.getElementById("authError").style.display = "none";
    state.auth.signInWithEmailAndPassword(email, password).catch((e) => showAuthError(mapAuthError(e.code)));
  }

export function forgotPassword() {
    const email = document.getElementById("authEmail").value.trim();
    if (!email) {
      showAuthError(state.t("authErrForgotNeedsEmail"));
      return;
    }
    document.getElementById("authError").style.display = "none";
    state.auth
      .sendPasswordResetEmail(email)
      .then(() => showToast(state.t("authResetSent"), "success"))
      .catch((e) => showAuthError(mapAuthError(e.code)));
  }

export function logout() {
    if (confirm(state.t("confirmLogout"))) {
      state.auth.signOut();
    }
  }

export function load() {
    const cloudReady = initFirebaseIfConfigured();
    if (cloudReady) setupOfflineDetection();

    if (!cloudReady) {
      // Yerel mod: Firebase ayarlanmamış, tek cihazlık kullanım
      try {
        const raw = localStorage.getItem(state.STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        state.products = (parsed && parsed.products) || seedData();
        state.sales = (parsed && parsed.sales) || [];
        state.customers = (parsed && parsed.customers) || [];
        state.payments = (parsed && parsed.payments) || [];
        state.dailyResetConfig = (parsed && parsed.dailyResetConfig) || [];
        state.breadWhatsAppNumber = (parsed && parsed.breadWhatsAppNumber) || "";
        state.priceChangeLog = (parsed && parsed.priceChangeLog) || [];
      } catch (e) {
        state.products = seedData();
        state.sales = [];
        state.customers = [];
        state.payments = [];
        state.dailyResetConfig = [];
        state.breadWhatsAppNumber = "";
        state.priceChangeLog = [];
      }
      if (!Array.isArray(state.products) || !state.products.length) state.products = seedData();
      if (!Array.isArray(state.sales)) state.sales = [];
      if (!Array.isArray(state.customers)) state.customers = [];
      if (!Array.isArray(state.payments)) state.payments = [];
      renderAll();
    } else {
      // Bulut modu: giriş yapılana kadar uygulama gizli
      showApp(false);
      state.auth.onAuthStateChanged(handleAuthChange);
    }
  }

export function save() {
    state._rev = (state._rev || 0) + 1;
    if (state.cloudEnabled) {
      if (!state.docRef) return;
      state.suppressNextSnapshot = true;
      state.docRef.set({ products: state.products, sales: state.sales, customers: state.customers, payments: state.payments, dailyResetConfig: state.dailyResetConfig, breadWhatsAppNumber: state.breadWhatsAppNumber, priceChangeLog: state.priceChangeLog, auditLog: state.auditLog, staffMembers: state.staffMembers, suppliers: state.suppliers, supplierTransactions: state.supplierTransactions, returns: state.returns, expenses: state.expenses, giftCards: state.giftCards, incomingOrders: state.incomingOrders, blockedPhones: state.blockedPhones, blockedIPs: state.blockedIPs, zReports: state.zReports, orderTemplates: state.orderTemplates, _rev: state._rev }, { merge: true }).catch((e) => {
        console.error("Bulut kaydetme hatası", e);
        setSyncStatus("error");
        registerBackgroundSync();
      });
    } else {
      try {
        localStorage.setItem(state.STORAGE_KEY, JSON.stringify({ products: state.products, sales: state.sales, customers: state.customers, payments: state.payments, dailyResetConfig: state.dailyResetConfig, breadWhatsAppNumber: state.breadWhatsAppNumber, priceChangeLog: state.priceChangeLog, auditLog: state.auditLog, staffMembers: state.staffMembers, suppliers: state.suppliers, supplierTransactions: state.supplierTransactions, returns: state.returns, expenses: state.expenses, giftCards: state.giftCards, incomingOrders: state.incomingOrders, blockedPhones: state.blockedPhones, blockedIPs: state.blockedIPs, zReports: state.zReports, orderTemplates: state.orderTemplates, _rev: state._rev }));
      } catch (e) {
        console.error("Yerel kaydetme hatası", e);
      }
    }
  }

export function registerBackgroundSync() {
    if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.sync.register("bakkal-sync"))
      .catch(() => {});
  }

export function registerPeriodicSync() {
    if (!("serviceWorker" in navigator) || !("permissions" in navigator)) return;
    navigator.permissions
      .query({ name: "periodic-background-sync" })
      .then((status) => {
        if (status.state !== "granted") return;
        navigator.serviceWorker.ready.then((reg) => {
          if ("periodicSync" in reg) {
            reg.periodicSync.register("bakkal-refresh", { minInterval: 12 * 60 * 60 * 1000 }).catch(() => {});
          }
        });
      })
      .catch(() => {});
  }

export function seedData() {
    return [
      mkProduct("pepsi 1 lt", "içecekler", 12, 10, 22, "", "adet", 16),
      mkProduct("pepsi 2.5 lt", "içecekler", 3, 5, 45, "", "adet", 34),
      mkProduct("cocacola 1 lt", "içecekler", 0, 8, 24, "", "adet", 17),
      mkProduct("ekmek", "fırın", 15, 10, 8, "", "adet", 5),
      mkProduct("beyaz peynir", "süt ürünleri", 5, 2, 180, "", "kg", 140)
    ];
  }

export function hasImportableLocalBackup() {
    try {
      const raw = localStorage.getItem(state.STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.products) && parsed.products.length > 0;
    } catch (e) {
      return false;
    }
  }

export function importLocalBackup() {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(state.STORAGE_KEY));
    } catch (e) {
      showToast(state.t("importParseError"), "error");
      return;
    }
    const localProducts = (parsed && parsed.products) || [];
    if (!localProducts.length) {
      showToast(state.t("importNoLocalBackup"), "info");
      return;
    }
    if (!confirm(state.t("importConfirm").replace("{n}", localProducts.length))) return;

    let addedCount = 0;
    localProducts.forEach((lp) => {
      if (!productAlreadyExists(lp.name)) {
        state.products.push(lp);
        addedCount++;
      }
    });
    if (Array.isArray(parsed.sales)) {
      const existingSaleIds = new Set(state.sales.map((s) => s.id));
      parsed.sales.forEach((s) => {
        if (!existingSaleIds.has(s.id)) state.sales.push(s);
      });
    }
    if (Array.isArray(parsed.customers)) {
      const existingCustomerIds = new Set(state.customers.map((c) => c.id));
      parsed.customers.forEach((c) => {
        if (!existingCustomerIds.has(c.id)) state.customers.push(c);
      });
    }
    if (Array.isArray(parsed.payments)) {
      const existingPaymentIds = new Set(state.payments.map((p) => p.id));
      parsed.payments.forEach((p) => {
        if (!existingPaymentIds.has(p.id)) state.payments.push(p);
      });
    }

    save();
    renderAll();
    document.getElementById("importBackupBtn").style.display = "none";
    showToast(state.t("importSuccess").replace("{n}", addedCount), "success");
  }