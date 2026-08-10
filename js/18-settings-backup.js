import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { escapeHtml, isChainConfigured, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { renderAll } from './20-navigation.js';

export function sendFeedback() {
    const textEl = document.getElementById("feedbackText");
    const message = textEl.value.trim();
    if (!message) {
      showToast(state.t("feedbackEmptyError"), "error");
      return;
    }
    if (!isChainConfigured()) {
      showToast(state.t("feedbackNotConfigured"), "error");
      return;
    }
    state.currentUser
      .getIdToken()
      .then((idToken) =>
        fetch(`${chainConfig.workerUrl}/submit-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, message })
        })
      )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          showToast(data.error, "error");
          return;
        }
        textEl.value = "";
        showToast(state.t("feedbackSentSuccess"), "success");
      })
      .catch((e) => {
        console.error(e);
        showToast(state.t("feedbackSendError"), "error");
      });
  }

export function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const lightBtn = document.getElementById("themeLightBtn");
    const darkBtn = document.getElementById("themeDarkBtn");
    if (lightBtn) lightBtn.classList.toggle("active", theme === "light");
    if (darkBtn) darkBtn.classList.toggle("active", theme === "dark");
    try {
      localStorage.setItem("bakkal_theme", theme);
    } catch (e) {}
  }

export function applyNavPosition(position) {
    document.body.classList.toggle("nav-side", position === "side");
    const bottomBtn = document.getElementById("navBottomBtn");
    const sideBtn = document.getElementById("navSideBtn");
    if (bottomBtn) bottomBtn.classList.toggle("active", position === "bottom");
    if (sideBtn) sideBtn.classList.toggle("active", position === "side");
    try {
      localStorage.setItem("bakkal_nav_position", position);
    } catch (e) {}
  }

export function applyFontSize(size) {
    document.body.classList.toggle("font-large", size === "large");
    const normalBtn = document.getElementById("fontNormalBtn");
    const largeBtn = document.getElementById("fontLargeBtn");
    if (normalBtn) normalBtn.classList.toggle("active", size === "normal");
    if (largeBtn) largeBtn.classList.toggle("active", size === "large");
    try {
      localStorage.setItem("bakkal_font_size", size);
    } catch (e) {}
  }

export function applyScanFps(fps) {
    state.scanFps = fps;
    const buttons = { 5: "scanFpsLowBtn", 10: "scanFpsNormalBtn", 20: "scanFpsHighBtn" };
    Object.keys(buttons).forEach((val) => {
      const btn = document.getElementById(buttons[val]);
      if (btn) btn.classList.toggle("active", Number(val) === fps);
    });
    try {
      localStorage.setItem("bakkal_scan_fps", String(fps));
    } catch (e) {}
  }

export function applyScanCooldown(ms) {
    state.scanCooldownMs = ms;
    const buttons = { 1000: "scanCooldownFastBtn", 3000: "scanCooldownNormalBtn", 5000: "scanCooldownSlowBtn" };
    Object.keys(buttons).forEach((val) => {
      const btn = document.getElementById(buttons[val]);
      if (btn) btn.classList.toggle("active", Number(val) === ms);
    });
    try {
      localStorage.setItem("bakkal_scan_cooldown_ms", String(ms));
    } catch (e) {}
  }

export function applySimpleMode(mode) {
    const simpleBtn = document.getElementById("simpleModeBtn");
    const advancedBtn = document.getElementById("advancedModeBtn");
    if (simpleBtn) simpleBtn.classList.toggle("active", mode === "simple");
    if (advancedBtn) advancedBtn.classList.toggle("active", mode === "advanced");
    try {
      localStorage.setItem("bakkal_simple_mode", mode);
    } catch (e) {}

    const advancedOnlyTabs = ["tab-scan", "tab-orders", "tab-pricechanges", "tab-ai", "tab-suppliers", "tab-expenses"];
    advancedOnlyTabs.forEach((tabId) => {
      const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
      if (btn) btn.style.display = mode === "simple" ? "none" : "flex";
    });
  }

export function reapplySimpleModeIfSet() {
    let mode = "advanced";
    try {
      mode = localStorage.getItem("bakkal_simple_mode") || "advanced";
    } catch (e) {}
    applySimpleMode(mode);
  }

export function renderDataSize() {
    const fillEl = document.getElementById("dataSizeBarFill");
    const labelEl = document.getElementById("dataSizeLabel");
    if (!fillEl) return;

    const dataObj = {
      products: state.products,
      sales: state.sales,
      customers: state.customers,
      payments: state.payments,
      dailyResetConfig: state.dailyResetConfig,
      breadLog: state.breadLog,
      priceChangeLog: state.priceChangeLog,
      auditLog: state.auditLog,
      staffMembers: state.staffMembers,
      suppliers: state.suppliers,
      supplierTransactions: state.supplierTransactions,
      returns: state.returns,
      expenses: state.expenses
    };
    const sizeBytes = new Blob([JSON.stringify(dataObj)]).size;
    const sizeKB = Math.round(sizeBytes / 1024);
    const limitKB = 1024;
    const percent = Math.min(100, Math.round((sizeKB / limitKB) * 100));

    fillEl.style.width = percent + "%";
    fillEl.classList.toggle("data-size-warn", percent >= 60 && percent < 85);
    fillEl.classList.toggle("data-size-danger", percent >= 85);

    labelEl.textContent = `${sizeKB} KB / ${limitKB} KB (%${percent})`;
  }

export function maybeCreateDailyBackup() {
    if (state.viewingBranchUid) return; // bir şubeyi görüntülerken yedek almıyoruz, sadece kendi hesabında
    if (!state.products.length && !state.sales.length) return; // gerçekten veri yoksa boş bir yedek almaya gerek yok
    if (!state.docRef) return;

    const todayKey = new Date().toISOString().slice(0, 10);
    let lastBackupDate = null;
    const storageKey = "bakkal_last_auto_backup_" + (state.currentUser ? state.currentUser.uid : "");
    try {
      lastBackupDate = localStorage.getItem(storageKey);
    } catch (e) {}
    if (lastBackupDate === todayKey) return; // bu cihazda bugün zaten yedek alındı

    const backupData = {
      products: state.products,
      sales: state.sales,
      customers: state.customers,
      payments: state.payments,
      dailyResetConfig: state.dailyResetConfig,
      breadLog: state.breadLog,
      priceChangeLog: state.priceChangeLog,
      auditLog: state.auditLog,
      staffMembers: state.staffMembers,
      suppliers: state.suppliers,
      supplierTransactions: state.supplierTransactions,
      returns: state.returns,
      expenses: state.expenses,
      savedAt: new Date().toISOString()
    };

    state.docRef
      .collection("backups")
      .doc(todayKey)
      .set(backupData)
      .then(() => {
        try {
          localStorage.setItem(storageKey, todayKey);
        } catch (e) {}
      })
      .catch((e) => console.error("Otomatik yedek oluşturulamadı", e));
  }

export function loadAutoBackups() {
    if (!state.docRef) return;
    state.docRef
      .collection("backups")
      .get()
      .then((snap) => {
        const backups = [];
        snap.forEach((doc) => backups.push({ id: doc.id, ...doc.data() }));
        renderAutoBackups(backups);
      })
      .catch((e) => {
        console.error("Yedekler okunamadı", e);
        renderAutoBackups([]);
      });
  }

export function renderAutoBackups(backups) {
    const listEl = document.getElementById("autoBackupList");
    const emptyEl = document.getElementById("autoBackupEmptyState");
    if (!listEl) return;

    if (!backups.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    const sorted = backups.sort((a, b) => (a.id < b.id ? 1 : -1));
    listEl.innerHTML = sorted
      .map((b) => {
        const productCount = (b.products || []).length;
        return `
          <div class="branch-row">
            <div class="branch-info">
              <p class="branch-name">${escapeHtml(b.id)}</p>
              <p class="branch-meta">${productCount} ürün</p>
            </div>
            <button class="branch-view-btn" data-id="${b.id}">${state.t("autoBackupRestoreBtn")}</button>
          </div>`;
      })
      .join("");

    listEl.querySelectorAll(".branch-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => restoreFromAutoBackup(btn.dataset.id, backups));
    });
  }

export function restoreFromAutoBackup(backupId, backups) {
    const backup = backups.find((b) => b.id === backupId);
    if (!backup) return;
    if (!confirm(`${state.t("autoBackupConfirmRestore")} (${backupId})`)) return;

    state.products = backup.products || [];
    state.sales = backup.sales || [];
    state.customers = backup.customers || [];
    state.payments = backup.payments || [];
    state.dailyResetConfig = backup.dailyResetConfig || [];
    state.breadLog = backup.breadLog || [];
    state.priceChangeLog = backup.priceChangeLog || [];
    state.auditLog = backup.auditLog || [];
    state.staffMembers = backup.staffMembers || [];
    state.suppliers = backup.suppliers || [];
    state.supplierTransactions = backup.supplierTransactions || [];
    state.returns = backup.returns || [];
    state.expenses = backup.expenses || [];

    logAudit("Yedekten geri yüklendi", backupId);
    save();
    renderAll();
    showToast(state.t("autoBackupRestoreSuccess"), "success");
  }

export function downloadBackup() {
    const backup = {
      exportedAt: new Date().toISOString(),
      products: state.products,
      sales: state.sales,
      customers: state.customers,
      payments: state.payments,
      dailyResetConfig: state.dailyResetConfig,
      breadLog: state.breadLog,
      priceChangeLog: state.priceChangeLog
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `bakkal-yedek-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(state.t("settingsBackupSuccess"), "success");
  }

export function togglePublicCatalog(checked) {
    state.publicCatalogEnabled = checked;
    document.getElementById("publicCatalogConfig").style.display = checked ? "block" : "none";
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ publicCatalogEnabled: checked }, { merge: true }).catch((e) => console.error("Katalog ayarı kaydedilemedi", e));
    }
    if (checked) renderPublicCatalogLink();
  }

export function savePublicCatalogSettings() {
    const phone = document.getElementById("publicCatalogPhone").value.trim();
    state.publicCatalogPhone = phone;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef
        .set({ publicCatalogPhone: phone, businessName: state.businessName || "" }, { merge: true })
        .catch((e) => console.error("Katalog ayarları kaydedilemedi", e));
    }
    showToast(state.t("publicCatalogSaved"), "success");
  }

export function renderPublicCatalogSettings() {
    const toggle = document.getElementById("publicCatalogToggle");
    if (!toggle) return;
    toggle.checked = !!state.publicCatalogEnabled;
    document.getElementById("publicCatalogConfig").style.display = state.publicCatalogEnabled ? "block" : "none";
    document.getElementById("publicCatalogPhone").value = state.publicCatalogPhone || "";
    if (state.publicCatalogEnabled) renderPublicCatalogLink();
  }

function renderPublicCatalogLink() {
    const linkEl = document.getElementById("publicCatalogLink");
    if (!linkEl) return;
    const targetRef = state.originalDocRef || state.docRef;
    if (!targetRef) return;
    const businessId = targetRef.id;
    const currentUrl = new URL(window.location.href);
    const baseUrl = currentUrl.href.replace(/index\.html.*$/, "").replace(/\/$/, "");
    linkEl.value = `${baseUrl}/katalog.html?id=${businessId}`;
  }

export function copyPublicCatalogLink() {
    const linkEl = document.getElementById("publicCatalogLink");
    if (!linkEl || !linkEl.value) return;
    navigator.clipboard
      .writeText(linkEl.value)
      .then(() => showToast(state.t("linkCopied"), "success"))
      .catch(() => {});
  }

export function toggleLoyalty(checked) {
    state.loyaltyEnabled = checked;
    document.getElementById("loyaltyConfig").style.display = checked ? "block" : "none";
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ loyaltyEnabled: checked }, { merge: true }).catch((e) => console.error("Sadakat ayarı kaydedilemedi", e));
    }
  }

export function saveLoyaltySettings() {
    const earnRate = Number(document.getElementById("loyaltyEarnRate").value) || 10;
    const redeemRate = Number(document.getElementById("loyaltyRedeemRate").value) || 10;
    state.loyaltyEarnRate = earnRate;
    state.loyaltyRedeemRate = redeemRate;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ loyaltyEarnRate: earnRate, loyaltyRedeemRate: redeemRate }, { merge: true }).catch((e) => console.error("Sadakat ayarları kaydedilemedi", e));
    }
    showToast(state.t("loyaltySettingsSaved"), "success");
  }

export function renderLoyaltySettings() {
    const toggle = document.getElementById("loyaltyToggle");
    if (!toggle) return;
    toggle.checked = !!state.loyaltyEnabled;
    document.getElementById("loyaltyConfig").style.display = state.loyaltyEnabled ? "block" : "none";
    document.getElementById("loyaltyEarnRate").value = state.loyaltyEarnRate || 10;
    document.getElementById("loyaltyRedeemRate").value = state.loyaltyRedeemRate || 10;
  }

export function toggleScaleBarcodeEnabled(checked) {
    state.scaleBarcodeEnabled = checked;
    document.getElementById("scaleBarcodeConfig").style.display = checked ? "block" : "none";
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ scaleBarcodeEnabled: checked }, { merge: true }).catch((e) => console.error("Terazi ayarı kaydedilemedi", e));
    }
  }

export function saveScaleBarcodeSettings() {
    const prefix = document.getElementById("scaleBarcodePrefix").value.trim() || "20";
    const codeLength = Number(document.getElementById("scaleBarcodeCodeLength").value) || 5;
    const weightLength = Number(document.getElementById("scaleBarcodeWeightLength").value) || 5;
    state.scaleBarcodePrefix = prefix;
    state.scaleBarcodeCodeLength = codeLength;
    state.scaleBarcodeWeightLength = weightLength;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef
        .set({ scaleBarcodePrefix: prefix, scaleBarcodeCodeLength: codeLength, scaleBarcodeWeightLength: weightLength }, { merge: true })
        .catch((e) => console.error("Terazi ayarları kaydedilemedi", e));
    }
    showToast(state.t("scaleBarcodeSettingsSaved"), "success");
  }

export function renderScaleBarcodeSettings() {
    const toggle = document.getElementById("scaleBarcodeToggle");
    if (!toggle) return;
    toggle.checked = !!state.scaleBarcodeEnabled;
    document.getElementById("scaleBarcodeConfig").style.display = state.scaleBarcodeEnabled ? "block" : "none";
    document.getElementById("scaleBarcodePrefix").value = state.scaleBarcodePrefix || "20";
    document.getElementById("scaleBarcodeCodeLength").value = state.scaleBarcodeCodeLength || 5;
    document.getElementById("scaleBarcodeWeightLength").value = state.scaleBarcodeWeightLength || 5;
  }

let businessLocationMap = null;
let businessLocationMarker = null;

export function openBusinessLocationPicker() {
    const modal = document.getElementById("businessLocationModal");
    modal.style.display = "flex";

    const startLat = state.businessLat || 39.0;
    const startLng = state.businessLng || 35.0;
    const startZoom = state.businessLat ? 15 : 6;

    setTimeout(() => {
      if (!businessLocationMap) {
        businessLocationMap = L.map("businessLocationMap").setView([startLat, startLng], startZoom);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap"
        }).addTo(businessLocationMap);
        businessLocationMarker = L.marker([startLat, startLng], { draggable: true }).addTo(businessLocationMap);
        businessLocationMap.on("click", (e) => {
          businessLocationMarker.setLatLng(e.latlng);
        });
      } else {
        businessLocationMap.setView([startLat, startLng], startZoom);
        businessLocationMarker.setLatLng([startLat, startLng]);
      }
      // Harita, pencere tam görünür olmadan oluşturulduğu için (ya da
      // modal her açıldığında) Leaflet'in kutu boyutunu YENİDEN
      // hesaplaması gerekiyor — yoksa bomboş/gri görünüyor. Bunu hem ilk
      // oluşturmada hem sonraki açılışlarda çağırıyoruz.
      businessLocationMap.invalidateSize();
    }, 250);
  }

export function closeBusinessLocationModal() {
    document.getElementById("businessLocationModal").style.display = "none";
  }

export function confirmBusinessLocation() {
    if (!businessLocationMarker) return;
    const pos = businessLocationMarker.getLatLng();
    state.businessLat = pos.lat;
    state.businessLng = pos.lng;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ businessLat: pos.lat, businessLng: pos.lng }, { merge: true }).catch((e) => console.error("Konum kaydedilemedi", e));
    }
    closeBusinessLocationModal();
    renderDeliverySettings();
    showToast(state.t("businessLocationSaved"), "success");
  }

export function saveDeliverySettings() {
    const fee = Number(document.getElementById("perKmDeliveryFee").value) || 0;
    state.perKmDeliveryFee = fee;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ perKmDeliveryFee: fee }, { merge: true }).catch((e) => console.error("Teslimat ücreti kaydedilemedi", e));
    }
    showToast(state.t("deliverySettingsSaved"), "success");
  }

export function renderDeliverySettings() {
    const statusEl = document.getElementById("businessLocationStatus");
    const feeInput = document.getElementById("perKmDeliveryFee");
    if (!statusEl) return;
    statusEl.textContent = state.businessLat
      ? `✅ ${state.t("businessLocationSet")}`
      : `⚠️ ${state.t("businessLocationNotSet")}`;
    if (feeInput) feeInput.value = state.perKmDeliveryFee || 0;
  }

function lightenHexColor(hex, amount) {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0x00ff) + amount);
    const b = Math.min(255, (num & 0x0000ff) + amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

export function applyBrandColor(color) {
    let styleTag = document.getElementById("brandColorOverride");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "brandColorOverride";
      document.head.appendChild(styleTag);
    }
    const lightVariant = lightenHexColor(color, 25);
    styleTag.textContent = `:root, :root[data-theme="dark"] { --navy: ${color} !important; --navy-light: ${lightVariant} !important; }`;
  }

export function handleLogoUpload(file) {
    if (!file) return;
    if (!state.storage) {
      showToast(state.t("photoUploadFailed"), "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Logoyu küçük bir kareye sıkıştırıyoruz — hem hızlı yüklensin hem
        // katalog sayfasının yanıtını şişirmesin.
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

        canvas.toBlob(
          (blob) => {
            // Logoyu da ürün fotoğrafları gibi Firebase Storage'a
            // yüklüyoruz — Firestore belgesine SADECE küçük bir bağlantı
            // (URL) kaydediliyor, büyük bir base64 metni DEĞİL. Bu,
            // katalog sayfasının yanıt boyutunu önemli ölçüde küçültür.
            const businessId = (state.originalDocRef || state.docRef).id;
            const ref = state.storage.ref(`business-logos/${businessId}/logo.jpg`);
            ref
              .put(blob)
              .then(() => ref.getDownloadURL())
              .then((url) => {
                state.businessLogo = url;
                const preview = document.getElementById("businessLogoPreview");
                const placeholder = document.getElementById("businessLogoPlaceholder");
                if (preview) {
                  preview.src = url;
                  preview.style.display = "block";
                }
                if (placeholder) placeholder.style.display = "none";
              })
              .catch((err) => {
                console.error("Logo yüklenemedi", err);
                showToast(state.t("photoUploadFailed"), "error");
              });
          },
          "image/jpeg",
          0.85
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

export function resetBrandIdentity() {
    const confirmed = confirm(state.t("resetBrandIdentityConfirm"));
    if (!confirmed) return;

    state.businessName = "";
    state.businessLogo = "";
    state.brandColor = "#1F3864";
    applyBrandColor("#1F3864");

    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef
        .set({ businessName: "", businessLogo: "", brandColor: "#1F3864" }, { merge: true })
        .catch((e) => console.error("Marka kimliği sıfırlanamadı", e));
    }
    renderBrandIdentitySettings();
    const logoInput = document.getElementById("businessLogoInput");
    if (logoInput) logoInput.value = "";
    showToast(state.t("brandIdentityReset"), "success");
  }

export function saveBrandIdentity() {
    const name = document.getElementById("businessNameInput").value.trim();
    const color = document.getElementById("brandColorInput").value;
    state.businessName = name;
    state.brandColor = color;
    applyBrandColor(color);

    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef
        .set({ businessName: name, brandColor: color, businessLogo: state.businessLogo || "" }, { merge: true })
        .catch((e) => console.error("Marka kimliği kaydedilemedi", e));
    }
    showToast(state.t("brandIdentitySaved"), "success");
  }

export function renderBrandIdentitySettings() {
    const nameInput = document.getElementById("businessNameInput");
    if (!nameInput) return;
    nameInput.value = state.businessName || "";
    document.getElementById("brandColorInput").value = state.brandColor || "#1F3864";
    const preview = document.getElementById("businessLogoPreview");
    const placeholder = document.getElementById("businessLogoPlaceholder");
    if (state.businessLogo) {
      preview.src = state.businessLogo;
      preview.style.display = "block";
      placeholder.style.display = "none";
    } else {
      preview.style.display = "none";
      placeholder.style.display = "flex";
    }
    applyBrandColor(state.brandColor || "#1F3864");
  }

export function initSettings() {
    let theme = "light";
    let navPosition = "bottom";
    let fontSize = "normal";
    let simpleMode = "advanced";
    let scanFps = 10;
    let scanCooldownMs = 3000;
    try {
      theme = localStorage.getItem("bakkal_theme") || "light";
      navPosition = localStorage.getItem("bakkal_nav_position") || "bottom";
      fontSize = localStorage.getItem("bakkal_font_size") || "normal";
      simpleMode = localStorage.getItem("bakkal_simple_mode") || "advanced";
      scanFps = Number(localStorage.getItem("bakkal_scan_fps")) || 10;
      scanCooldownMs = Number(localStorage.getItem("bakkal_scan_cooldown_ms")) || 3000;
    } catch (e) {}
    applyTheme(theme);
    applyNavPosition(navPosition);
    applyFontSize(fontSize);
    applySimpleMode(simpleMode);
    applyScanFps(scanFps);
    applyScanCooldown(scanCooldownMs);
  }