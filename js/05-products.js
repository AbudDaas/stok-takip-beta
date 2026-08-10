import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { escapeHtml, formatQty, formatTL, genId, getStatus, getStatusLabel, mkProduct, printOrderListAsPdf, showPrompt, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { callGeminiWithRetry } from './16-bulk-scan-ai.js';
import { renderAll } from './20-navigation.js';

export function findProductByExactName(name) {
    const normalized = name.trim().toLowerCase();
    return state.products.find((p) => p.name.trim().toLowerCase() === normalized);
  }

export function findProductByFuzzyName(name) {
    if (!name) return null;
    const normalized = name.trim().toLowerCase();
    let match = state.products.find((p) => p.name.trim().toLowerCase() === normalized);
    if (match) return match;
    match = state.products.find((p) => p.name.toLowerCase().includes(normalized) || normalized.includes(p.name.toLowerCase()));
    return match || null;
  }

export function renderPendingExtraBarcodesList() {
    const listEl = document.getElementById("pendingExtraBarcodesList");
    if (!listEl) return;
    if (!state.pendingExtraBarcodes.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = state.pendingExtraBarcodes
      .map(
        (code, i) => `
        <div class="extra-barcode-row">
          <span class="extra-barcode-value">${escapeHtml(code)}</span>
          <button class="pending-extra-barcode-remove-btn" data-index="${i}" aria-label="Sil"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".pending-extra-barcode-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.pendingExtraBarcodes.splice(Number(btn.dataset.index), 1);
        renderPendingExtraBarcodesList();
      });
    });
  }

export function addPendingExtraBarcode() {
    const input = document.getElementById("newExtraBarcodeSingle");
    const code = input.value.trim();
    if (!code) return;
    if (state.pendingExtraBarcodes.includes(code)) {
      showToast(state.t("extraBarcodeDuplicate"), "error");
      return;
    }
    state.pendingExtraBarcodes.push(code);
    input.value = "";
    renderPendingExtraBarcodesList();
  }

export function renderPendingCaseBarcodesList() {
    const listEl = document.getElementById("pendingCaseBarcodesList");
    if (!listEl) return;
    if (!state.pendingCaseBarcodes.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = state.pendingCaseBarcodes
      .map(
        (entry, i) => `
        <div class="extra-barcode-row">
          <span class="extra-barcode-value">${escapeHtml(entry.barcode)} — ${entry.qty} ${state.t("unitAdetShort")}</span>
          <button class="pending-case-barcode-remove-btn" data-index="${i}" aria-label="Sil"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".pending-case-barcode-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.pendingCaseBarcodes.splice(Number(btn.dataset.index), 1);
        renderPendingCaseBarcodesList();
      });
    });
  }

export function addPendingCaseBarcode() {
    const barcodeInput = document.getElementById("newCaseBarcode");
    const qtyInput = document.getElementById("newCaseQty");
    const barcode = barcodeInput.value.trim();
    const qty = Number(qtyInput.value);
    if (!barcode || !qty || qty <= 0) {
      showToast(state.t("caseBarcodeInvalid"), "error");
      return;
    }
    if (state.pendingCaseBarcodes.some((cb) => cb.barcode === barcode)) {
      showToast(state.t("extraBarcodeDuplicate"), "error");
      return;
    }
    state.pendingCaseBarcodes.push({ barcode, qty });
    barcodeInput.value = "";
    qtyInput.value = "";
    renderPendingCaseBarcodesList();
  }

/**
 * Bir görsel dosyasını, yüklemeden önce küçültüp sıkıştırır (hem hızlı
 * yüklensin hem depolama alanını az kullansın).
 */
function resizeImageForUpload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Ürün fotoğrafları hem listede hem katalogda KARE bir alanda
          // gösteriliyor. Yüklenen fotoğraf kare değilse (dikdörtgense),
          // ortadan kırpıp kareye çeviriyoruz — böylece hangi boy/oranda
          // fotoğraf yüklersen yükle, hiçbir yerde beklenmedik şekilde
          // kırpılmış/bozuk görünmüyor.
          const size = 500;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

/**
 * Görseli Firebase Storage'a yükler (Firestore belgesinin İÇİNE DEĞİL —
 * çünkü yüzlerce ürün fotoğrafı, Firestore'un 1MB belge sınırını
 * kolayca aşardı). Firestore'a sadece küçük bir bağlantı (URL) kaydedilir.
 */
async function uploadImageToStorage(file, productId) {
    if (!state.storage) throw new Error("Storage etkin değil");
    const businessId = (state.originalDocRef || state.docRef).id;
    const blob = await resizeImageForUpload(file);
    const ref = state.storage.ref(`product-images/${businessId}/${productId}.jpg`);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }

export function handleNewProductPhotoUpload(file) {
    if (!file) return;
    const tempId = genId();
    uploadImageToStorage(file, tempId)
      .then((url) => {
        state.pendingProductImage = url;
        const preview = document.getElementById("newProductPhotoPreview");
        const placeholder = document.getElementById("newProductPhotoPlaceholder");
        preview.src = url;
        preview.style.display = "block";
        placeholder.style.display = "none";
      })
      .catch((e) => {
        console.error("Fotoğraf yüklenemedi", e);
        showToast(state.t("photoUploadFailed"), "error");
      });
  }

export function handleEditProductPhotoUpload(file) {
    if (!file) return;
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    uploadImageToStorage(file, p.id)
      .then((url) => {
        p.image = url;
        const preview = document.getElementById("editProductPhotoPreview");
        const placeholder = document.getElementById("editProductPhotoPlaceholder");
        preview.src = url;
        preview.style.display = "block";
        placeholder.style.display = "none";
        save();
        showToast(state.t("photoUploaded"), "success");
      })
      .catch((e) => {
        console.error("Fotoğraf yüklenemedi", e);
        showToast(state.t("photoUploadFailed"), "error");
      });
  }

export function addProduct() {
    const nameInput = document.getElementById("newName");
    const catInput = document.getElementById("newCategory");
    const minInput = document.getElementById("newMin");
    const qtyInput = document.getElementById("newQty");
    const priceInput = document.getElementById("newPrice");
    const costPriceInput = document.getElementById("newCostPrice");
    const barcodeInput = document.getElementById("newBarcode");
    const unitInput = document.getElementById("newUnit");
    const supplierInput = document.getElementById("newSupplierId");

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const category = catInput.value.trim() || state.t("categoryOtherDefault");
    const min = Number(minInput.value) || 0;
    const qty = Number(qtyInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    const costPrice = Number(costPriceInput.value) || 0;
    const barcode = barcodeInput.value.trim();
    const unit = unitInput.value;

    const newProduct = mkProduct(name, category, qty, min, price, barcode, unit, costPrice);
    newProduct.supplierId = supplierInput.value || null;
    if (state.pendingProductImage) newProduct.image = state.pendingProductImage;
    const scaleCodeInput = document.getElementById("newScaleCode");
    if (scaleCodeInput && scaleCodeInput.value.trim()) newProduct.teraziKodu = scaleCodeInput.value.trim();
    newProduct.catalogNew = document.getElementById("newCatalogNew").checked;
    newProduct.catalogDiscount = document.getElementById("newCatalogDiscount").checked;
    if (newProduct.catalogDiscount) {
      const discountedPrice = Number(document.getElementById("newDiscountedPrice").value) || 0;
      if (discountedPrice > 0) newProduct.discountedPrice = discountedPrice;
    }
    if (state.pendingExtraBarcodes.length) newProduct.extraBarcodes = [...state.pendingExtraBarcodes];
    if (state.pendingCaseBarcodes.length) newProduct.caseBarcodes = [...state.pendingCaseBarcodes];

    state.products.push(newProduct);
    logAudit("Ürün eklendi", `${name} (${qty} adet, ${formatTL(price)})`);
    nameInput.value = "";
    catInput.value = "";
    minInput.value = "5";
    qtyInput.value = "0";
    priceInput.value = "0";
    costPriceInput.value = "0";
    barcodeInput.value = "";
    unitInput.value = "adet";
    supplierInput.value = "";
    if (scaleCodeInput) scaleCodeInput.value = "";
    document.getElementById("newCatalogNew").checked = false;
    document.getElementById("newCatalogDiscount").checked = false;
    document.getElementById("newDiscountedPrice").value = "";
    document.getElementById("newDiscountedPrice").style.display = "none";
    state.pendingProductImage = "";
    document.getElementById("newProductPhotoInput").value = "";
    document.getElementById("newProductPhotoPreview").style.display = "none";
    document.getElementById("newProductPhotoPlaceholder").style.display = "flex";
    state.pendingExtraBarcodes = [];
    state.pendingCaseBarcodes = [];
    renderPendingExtraBarcodesList();
    renderPendingCaseBarcodesList();
    save();
    renderAll();
    nameInput.focus();
  }

export function deleteProduct(id) {
    const p = state.products.find((x) => x.id === id);
    state.products = state.products.filter((x) => x.id !== id);
    if (p) logAudit("Ürün silindi", p.name);
    save();
    closeModal();
    renderAll();
  }

export function updateOutOfStockTracking(p) {
    if (p.qty <= 0) {
      if (!p.wentOutOfStockAt) p.wentOutOfStockAt = new Date().toISOString();
    } else {
      p.wentOutOfStockAt = null;
    }
  }

export function adjustQty(id, delta) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    p.qty = Math.max(0, Math.round((p.qty + delta) * 1000) / 1000);
    updateOutOfStockTracking(p);
    logAudit("Stok güncellendi", `${p.name}: ${delta > 0 ? "+" : ""}${delta} → ${p.qty}`);
    save();
    renderAll();
    if (state.activeProductId === id) updateModalContent(p);
  }

export function setQtyManually(id, newQty) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    if (isNaN(newQty) || newQty < 0) {
      showToast(state.t("alertInvalidAmount"), "error");
      updateModalContent(p);
      return;
    }
    const oldQty = p.qty;
    p.qty = Math.round(newQty * 1000) / 1000;
    updateOutOfStockTracking(p);
    logAudit("Stok elle güncellendi", `${p.name}: ${oldQty} → ${p.qty}`);
    save();
    renderAll();
    if (state.activeProductId === id) updateModalContent(p);
  }

export function populateEditSupplierSelect(currentSupplierId) {
    const selectEl = document.getElementById("editSupplierId");
    selectEl.innerHTML =
      `<option value="">${state.t("editSupplierNone")}</option>` +
      state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    selectEl.value = currentSupplierId || "";
  }

export function populateNewProductSupplierSelect() {
    const selectEl = document.getElementById("newSupplierId");
    if (!selectEl) return;
    const currentValue = selectEl.value;
    selectEl.innerHTML =
      `<option value="">${state.t("editSupplierNone")}</option>` +
      state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    selectEl.value = currentValue;
  }

export function saveEdit() {
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    const name = document.getElementById("editName").value.trim();
    if (!name) return;
    p.name = name;
    p.category = document.getElementById("editCategory").value.trim() || state.t("categoryOtherDefault");
    p.min = Number(document.getElementById("editMin").value) || 0;
    p.price = Number(document.getElementById("editPrice").value) || 0;
    p.costPrice = Number(document.getElementById("editCostPrice").value) || 0;
    p.barcode = document.getElementById("editBarcode").value.trim();
    p.unit = document.getElementById("editUnit").value;
    p.expiryDate = document.getElementById("editExpiryDate").value || null;
    p.bulkDiscountQty = Number(document.getElementById("editBulkQty").value) || 0;
    p.bulkDiscountType = document.getElementById("editBulkType").value;
    p.bulkDiscountValue = Number(document.getElementById("editBulkValue").value) || 0;
    p.supplierId = document.getElementById("editSupplierId").value || null;
    p.teraziKodu = document.getElementById("editScaleCode").value.trim() || null;
    p.catalogNew = document.getElementById("editCatalogNew").checked;
    p.catalogDiscount = document.getElementById("editCatalogDiscount").checked;
    if (p.catalogDiscount) {
      const discountedPrice = Number(document.getElementById("editDiscountedPrice").value) || 0;
      p.discountedPrice = discountedPrice > 0 ? discountedPrice : null;
    } else {
      p.discountedPrice = null;
    }
    // Not: koli barkodları artık "Koli Barkodu Ekle" butonuyla doğrudan
    // p.caseBarcodes listesine ekleniyor/çıkarılıyor, burada ayrıca
    // kaydetmeye gerek yok.
    logAudit("Ürün düzenlendi", `${name} (${formatTL(p.price)})`);
    save();
    renderAll();
    updateModalContent(p);
  }

/**
 * Fiziksel Stok Sayımı — dükkanı gezip her ürünü sayarken kullanılır.
 * Her ürün için bir giriş kutusu gösterir (mevcut sistem sayısıyla
 * doldurulmuş), kullanıcı gerçek sayıyı girer/düzeltir. "Uygula"
 * dendiğinde SADECE farklı olan ürünler güncellenir ve loglanır.
 */
export function openPhysicalCountModal() {
    document.getElementById("physicalCountSearch").value = "";
    renderPhysicalCountList("");
    document.getElementById("physicalCountModal").style.display = "flex";
  }

export function closePhysicalCountModal() {
    document.getElementById("physicalCountModal").style.display = "none";
  }

export function renderPhysicalCountList(filter) {
    const listEl = document.getElementById("physicalCountList");
    if (!listEl) return;
    const normalized = (filter || "").toLowerCase().trim();
    const filtered = normalized ? state.products.filter((p) => p.name.toLowerCase().includes(normalized)) : state.products;

    listEl.innerHTML = filtered
      .map(
        (p) => `
        <div class="reminder-row">
          <p class="reminder-name">${escapeHtml(p.name)}</p>
          <input type="number" min="0" step="0.001" class="physical-count-input" data-id="${p.id}" value="${p.qty}" style="width:90px;text-align:right;" />
        </div>`
      )
      .join("");
  }

export function applyPhysicalCount() {
    const inputs = document.querySelectorAll(".physical-count-input");
    let changedCount = 0;
    const changeDetails = [];

    inputs.forEach((input) => {
      const p = state.products.find((x) => x.id === input.dataset.id);
      if (!p) return;
      const newQty = Number(input.value);
      if (isNaN(newQty) || newQty === p.qty) return;
      changeDetails.push(`${p.name}: ${p.qty} → ${newQty}`);
      p.qty = newQty;
      updateOutOfStockTracking(p);
      changedCount++;
    });

    if (changedCount === 0) {
      showToast(state.t("physicalCountNoChanges"), "info");
      closePhysicalCountModal();
      return;
    }

    logAudit("Fiziksel stok sayımı uygulandı", `${changedCount} ${state.t("physicalCountChangedSuffix")}: ${changeDetails.slice(0, 5).join("; ")}${changeDetails.length > 5 ? "…" : ""}`);
    save();
    renderAll();
    closePhysicalCountModal();
    showToast(state.t("physicalCountApplied").replace("{n}", changedCount), "success");
  }

export function resetAll() {
    state.products.forEach((p) => {
      p.qty = Math.max(p.min, 1);
    });
    save();
    renderAll();
  }

export function getDisplayName(p) {
    const lang = window.i18n.getLang();
    if ((lang === "en" || lang === "ar") && p.nameTranslations && p.nameTranslations[lang]) {
      return p.nameTranslations[lang];
    }
    return p.name;
  }

export function translateMissingProductNames() {
    const lang = window.i18n.getLang();
    if (lang !== "en" && lang !== "ar") return;
    if (state.translationInFlight) return;

    const missing = state.products.filter((p) => !p.nameTranslations || !p.nameTranslations[lang]).slice(0, 60);
    if (!missing.length) return;

    state.translationInFlight = true;

    const langLabel = lang === "en" ? "İngilizce" : "Arapça";
    const prompt = [
      `Aşağıdaki market/bakkal ürün adlarının her birini ${langLabel}'ye çevir.`,
      "Ürün adındaki marka isimlerini olduğu gibi bırak, sadece genel kelimeleri çevir (örn. 'kepekli ekmek' -> 'whole wheat bread').",
      "SADECE geçerli bir JSON nesnesi döndür, başka hiçbir açıklama ekleme.",
      'Format: {"orijinal ad 1":"çeviri 1","orijinal ad 2":"çeviri 2"}',
      "",
      "Ürün adları:",
      JSON.stringify(missing.map((p) => p.name))
    ].join("\n");

    callGeminiWithRetry(null, prompt)
      .then((data) => {
        const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
        if (!rawText) return;
        const cleaned = rawText.replace(/```json|```/g, "").trim();
        const translations = JSON.parse(cleaned);
        let changed = false;
        missing.forEach((p) => {
          const translated = translations[p.name];
          if (translated) {
            p.nameTranslations = p.nameTranslations || {};
            p.nameTranslations[lang] = translated;
            changed = true;
          }
        });
        if (changed) {
          save();
          renderAll();
        }
      })
      .catch((e) => console.error("Ürün adı çevirisi başarısız:", e))
      .finally(() => {
        state.translationInFlight = false;
      });
  }

export function selfSourceRowHtml(p) {
    const status = getStatus(p);
    const priceLabel = p.unit === "kg" ? formatTL(p.price) + state.t("perKgSuffix") : formatTL(p.price);
    const reasonNote = p.needsAlternativeSource
      ? state.t("altSourceBadge")
      : state.t("noSupplierGetYourselfNote");
    return `
      <div class="product-row" data-id="${p.id}">
        <div class="product-info">
          <p class="product-name">${escapeHtml(getDisplayName(p))}</p>
          <p class="product-meta">${escapeHtml(p.category)} · ${state.t("stockShortLabel")}: ${formatQty(p)} · ${priceLabel}</p>
          <p class="alt-source-note">🛒 ${reasonNote}</p>
        </div>
        <span class="status-badge ${state.STATUS_CLASS[status]}">${getStatusLabel(status)}</span>
      </div>`;
  }

export function printSelfSourceList() {
    const items = state.products
      .filter((p) => getStatus(p) !== "yeterli")
      .filter((p) => !p.supplierId || p.needsAlternativeSource)
      .map((p) => ({ name: getDisplayName(p), suggestedOrder: p.min || 1, unit: p.unit }));
    if (!items.length) return;
    printOrderListAsPdf(state.t("selfSourceListTitle"), items);
  }

export function orderListRowHtml(p) {
    const status = getStatus(p);
    const priceLabel = p.unit === "kg" ? formatTL(p.price) + state.t("perKgSuffix") : formatTL(p.price);
    const altBadge = p.needsAlternativeSource
      ? `<p class="alt-source-note">⚠️ ${state.t("altSourceBadge")}</p>`
      : "";
    // "Başka Yerden Bulunmalı" butonu SADECE bir tedarikçisi olan ürünlerde
    // anlamlı ("bu tedarikçide yoktu" demek). Tedarikçisi olmayan ürünler
    // zaten örtük olarak "işletme sahibi kendisi hal/gatemden getirmeli"
    // demektir — bunlarda bu buton kafa karıştırır, göstermiyoruz.
    const altBtnLabel = p.needsAlternativeSource ? state.t("altSourceUndoBtn") : state.t("altSourceBtn");
    const altBtnHtml = p.supplierId
      ? `<button class="alt-source-toggle-btn" data-id="${p.id}">${altBtnLabel}</button>`
      : `<span class="no-supplier-note">${state.t("noSupplierGetYourselfNote")}</span>`;
    return `
      <div class="product-row" data-id="${p.id}">
        <div class="product-info">
          <p class="product-name">${escapeHtml(getDisplayName(p))}</p>
          <p class="product-meta">${escapeHtml(p.category)} · ${state.t("stockShortLabel")}: ${formatQty(p)} · ${priceLabel}</p>
          ${altBadge}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <span class="status-badge ${state.STATUS_CLASS[status]}">${getStatusLabel(status)}</span>
          ${altBtnHtml}
        </div>
      </div>`;
  }

export function toggleNeedsAlternativeSource(productId) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    p.needsAlternativeSource = !p.needsAlternativeSource;
    save();
    renderAll();
  }

export function productRowHtml(p) {
    const status = getStatus(p);
    const priceLabel = p.unit === "kg" ? formatTL(p.price) + state.t("perKgSuffix") : formatTL(p.price);
    const thumbHtml = p.image
      ? `<img src="${escapeHtml(p.image)}" alt="" class="product-thumb" />`
      : `<div class="product-thumb product-thumb-placeholder"><i class="fa-solid fa-image" aria-hidden="true"></i></div>`;
    return `
      <div class="product-row" data-id="${p.id}">
        ${thumbHtml}
        <div class="product-info">
          <p class="product-name">${escapeHtml(getDisplayName(p))}</p>
          <p class="product-meta">${escapeHtml(p.category)} · ${state.t("stockShortLabel")}: ${formatQty(p)} · ${priceLabel}</p>
        </div>
        <span class="status-badge ${state.STATUS_CLASS[status]}">${getStatusLabel(status)}</span>
      </div>`;
  }

export function openModal(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    state.activeProductId = id;
    document.getElementById("editName").value = p.name;
    document.getElementById("editCategory").value = p.category;
    document.getElementById("editMin").value = p.min;
    document.getElementById("editPrice").value = p.price;
    document.getElementById("editCostPrice").value = p.costPrice || 0;
    document.getElementById("editBarcode").value = p.barcode || "";
    document.getElementById("editUnit").value = p.unit || "adet";
    document.getElementById("editExpiryDate").value = p.expiryDate || "";
    document.getElementById("editBulkQty").value = p.bulkDiscountQty || "";
    document.getElementById("editBulkType").value = p.bulkDiscountType || "percent";
    document.getElementById("editBulkValue").value = p.bulkDiscountValue || "";
    populateEditSupplierSelect(p.supplierId);
    document.getElementById("editScaleCode").value = p.teraziKodu || "";
    document.getElementById("editCatalogNew").checked = !!p.catalogNew;
    document.getElementById("editCatalogDiscount").checked = !!p.catalogDiscount;
    const editDiscountInput = document.getElementById("editDiscountedPrice");
    editDiscountInput.value = p.discountedPrice || "";
    editDiscountInput.style.display = p.catalogDiscount ? "block" : "none";
    const editPhotoPreview = document.getElementById("editProductPhotoPreview");
    const editPhotoPlaceholder = document.getElementById("editProductPhotoPlaceholder");
    document.getElementById("editProductPhotoInput").value = "";
    if (p.image) {
      editPhotoPreview.src = p.image;
      editPhotoPreview.style.display = "block";
      editPhotoPlaceholder.style.display = "none";
    } else {
      editPhotoPreview.style.display = "none";
      editPhotoPlaceholder.style.display = "flex";
    }
    document.getElementById("editCaseBarcode").value = "";
    document.getElementById("editCaseQty").value = "";
    renderExtraBarcodesList();
    renderCaseBarcodesList();
    updateModalContent(p);
    document.getElementById("detailModal").style.display = "flex";
    renderQrCode(p.id);
  }

export function renderExtraBarcodesList() {
    const listEl = document.getElementById("extraBarcodesList");
    if (!listEl) return;
    const p = state.products.find((x) => x.id === state.activeProductId);
    const codes = (p && p.extraBarcodes) || [];
    if (!codes.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = codes
      .map(
        (code, i) => `
        <div class="extra-barcode-row">
          <span class="extra-barcode-value">${escapeHtml(code)}</span>
          <button class="extra-barcode-remove-btn" data-index="${i}" aria-label="Sil"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".extra-barcode-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeExtraBarcode(Number(btn.dataset.index)));
    });
  }

export function addExtraBarcode() {
    const input = document.getElementById("newExtraBarcode");
    const code = input.value.trim();
    if (!code) return;
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    if (!Array.isArray(p.extraBarcodes)) p.extraBarcodes = [];
    if (p.extraBarcodes.includes(code) || p.barcode === code) {
      showToast(state.t("extraBarcodeDuplicate"), "error");
      return;
    }
    p.extraBarcodes.push(code);
    input.value = "";
    renderExtraBarcodesList();
  }

export function removeExtraBarcode(index) {
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p || !Array.isArray(p.extraBarcodes)) return;
    p.extraBarcodes.splice(index, 1);
    renderExtraBarcodesList();
  }

export function renderCaseBarcodesList() {
    const listEl = document.getElementById("caseBarcodesList");
    if (!listEl) return;
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    migrateProductCaseBarcode(p);
    const entries = p.caseBarcodes || [];
    if (!entries.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = entries
      .map(
        (entry, i) => `
        <div class="extra-barcode-row">
          <span class="extra-barcode-value">${escapeHtml(entry.barcode)} — ${entry.qty} ${state.t("unitAdetShort")}</span>
          <button class="case-barcode-remove-btn" data-index="${i}" aria-label="Sil"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".case-barcode-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeCaseBarcodeEntry(Number(btn.dataset.index)));
    });
  }

export function addCaseBarcodeEntry() {
    const barcodeInput = document.getElementById("editCaseBarcode");
    const qtyInput = document.getElementById("editCaseQty");
    const barcode = barcodeInput.value.trim();
    const qty = Number(qtyInput.value);
    if (!barcode || !qty || qty <= 0) {
      showToast(state.t("caseBarcodeInvalid"), "error");
      return;
    }
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    migrateProductCaseBarcode(p);
    if (p.caseBarcodes.some((cb) => cb.barcode === barcode)) {
      showToast(state.t("extraBarcodeDuplicate"), "error");
      return;
    }
    p.caseBarcodes.push({ barcode, qty });
    barcodeInput.value = "";
    qtyInput.value = "";
    renderCaseBarcodesList();
  }

export function removeCaseBarcodeEntry(index) {
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p || !Array.isArray(p.caseBarcodes)) return;
    p.caseBarcodes.splice(index, 1);
    renderCaseBarcodesList();
  }

export function updateModalContent(p) {
    document.getElementById("modalProductName").textContent = p.name;
    const qtyInput = document.getElementById("modalQtyInput");
    if (document.activeElement !== qtyInput) {
      qtyInput.value = p.qty;
    }
    const status = getStatus(p);
    const pill = document.getElementById("modalStatus");
    pill.textContent = getStatusLabel(status);
    pill.className = "status-pill " + state.STATUS_CLASS[status];
    const warehouseEl = document.getElementById("modalWarehouseQty");
    if (warehouseEl) warehouseEl.textContent = formatQty({ unit: p.unit, qty: p.warehouseQty || 0 });
  }

export function closeModal() {
    document.getElementById("detailModal").style.display = "none";
    state.activeProductId = null;
  }

export function addWarehouseStock() {
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    const promptText = `${state.t("addWarehouseStockPrompt")} (${p.unit === "kg" ? state.t("unitKgShort") : state.t("unitAdetShort")})`;
    showPrompt(promptText, "").then((value) => {
      if (value === null) return;
      const amount = Number(value);
      if (!amount || amount <= 0) {
        showToast(state.t("alertInvalidAmount"), "error");
        return;
      }
      p.warehouseQty = (p.warehouseQty || 0) + amount;
      logAudit("Depo stoku eklendi", `${p.name}: +${amount}`);
      save();
      updateModalContent(p);
    });
  }

export function transferToShelf() {
    const p = state.products.find((x) => x.id === state.activeProductId);
    if (!p) return;
    const available = p.warehouseQty || 0;
    if (available <= 0) {
      showToast(state.t("warehouseEmpty"), "error");
      return;
    }
    const promptText = `${state.t("transferToShelfPrompt")} (${state.t("warehouseAvailable")}: ${available})`;
    showPrompt(promptText, String(available)).then((value) => {
      if (value === null) return;
      const amount = Number(value);
      if (!amount || amount <= 0) {
        showToast(state.t("alertInvalidAmount"), "error");
        return;
      }
      if (amount > available) {
        showToast(state.t("warehouseNotEnough"), "error");
        return;
      }
      p.warehouseQty = available - amount;
      p.qty = Number(p.qty) + amount;
      updateOutOfStockTracking(p);
      logAudit("Rafa aktarıldı", `${p.name}: ${amount}`);
      save();
      updateModalContent(p);
    });
  }

export function renderQrCode(productId) {
    const box = document.getElementById("modalQrCode");
    box.innerHTML = "";
    if (typeof QRCode !== "undefined") {
      new QRCode(box, {
        text: productId,
        width: 160,
        height: 160,
        colorDark: "#1F3864",
        colorLight: "#ffffff"
      });
    } else {
      box.textContent = state.t("qrLibError");
    }
  }

export function printQr() {
    const box = document.getElementById("modalQrCode");
    const p = state.products.find((x) => x.id === state.activeProductId);
    const win = window.open("", "_blank");
    win.document.write(`
      <html><head><title>${state.t("printWindowTitle")}</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:40px;">
        <h3>${escapeHtml(p ? p.name : "")}</h3>
        ${box.innerHTML}
        <script>window.onload = function(){ window.print(); }<\/script>
      </body></html>
    `);
    win.document.close();
  }

export function printAllQrCodes() {
    if (!state.products.length) {
      showToast(state.t("emptyProducts"), "info");
      return;
    }

    // Her ürün için geçici, ekranda görünmeyen bir QR kodu üret
    const tempContainer = document.createElement("div");
    tempContainer.style.display = "none";
    document.body.appendChild(tempContainer);

    const blocksHtml = state.products
      .map((p) => {
        const box = document.createElement("div");
        tempContainer.appendChild(box);
        new QRCode(box, {
          text: p.id,
          width: 56,
          height: 56,
          colorDark: "#1F3864",
          colorLight: "#ffffff"
        });

        const priceValue = Number(p.price) || 0;
        const [wholePart, decimalPart] = priceValue.toFixed(2).split(".");
        const unitSuffix = p.unit === "kg" ? `<span class="price-tag-unit">/${state.t("unitKgShort")}</span>` : "";

        return `
          <div class="price-tag">
            <p class="price-tag-header">${escapeHtml(state.t("appName"))}</p>
            <p class="price-tag-name">${escapeHtml(p.name)}</p>
            <div class="price-tag-price">
              <span class="price-tag-currency">₺</span><span class="price-tag-amount">${wholePart}</span><span class="price-tag-decimals">,${decimalPart}</span>${unitSuffix}
            </div>
            <div class="price-tag-qr">${box.innerHTML}</div>
          </div>`;
      })
      .join("");

    document.body.removeChild(tempContainer);

    const win = window.open("", "_blank");
    win.document.write(`
      <html>
        <head>
          <title>${state.t("printAllQrBtn")}</title>
          <style>
            @page { margin: 12mm; }
            body{font-family:'Segoe UI',Arial,sans-serif;padding:16px;background:#fff;}
            .price-tag-grid{display:flex;flex-wrap:wrap;gap:14px;}
            .price-tag{
              width:190px;
              text-align:center;
              border:1.5px solid #1F3864;
              border-radius:12px;
              padding:12px 10px 10px;
              page-break-inside:avoid;
              position:relative;
              background:#fff;
            }
            .price-tag-header{
              font-size:8px;
              letter-spacing:1.5px;
              text-transform:uppercase;
              color:#8B96A8;
              font-weight:700;
              margin:0 0 8px;
            }
            .price-tag-name{
              font-size:14px;
              font-weight:700;
              color:#1F3864;
              margin:0 0 10px;
              min-height:36px;
              line-height:1.25;
              display:flex;
              align-items:center;
              justify-content:center;
              word-break:break-word;
            }
            .price-tag-price{
              display:flex;
              align-items:baseline;
              justify-content:center;
              gap:1px;
              margin-bottom:6px;
            }
            .price-tag-currency{font-size:20px;font-weight:700;color:#C0872E;}
            .price-tag-amount{font-size:36px;font-weight:800;color:#C0872E;line-height:1;}
            .price-tag-decimals{font-size:17px;font-weight:700;color:#C0872E;}
            .price-tag-unit{font-size:12px;font-weight:600;color:#8B96A8;margin-left:3px;}
            .price-tag-qr{
              position:absolute;
              bottom:8px;
              right:8px;
              width:42px;
              height:42px;
              opacity:0.9;
            }
            .price-tag-qr img,.price-tag-qr canvas,.price-tag-qr table{width:100% !important;height:100% !important;}
          </style>
        </head>
        <body>
          <div class="price-tag-grid">${blocksHtml}</div>
          <script>window.onload = function(){ window.print(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
  }

export function findProductByScan(code) {
    return state.products.find(
      (p) => p.id === code || (p.barcode && p.barcode === code) || (Array.isArray(p.extraBarcodes) && p.extraBarcodes.includes(code))
    );
  }

/**
 * Terazi barkodunu çözer. Ayarlarda belirlenen (ön ek, ürün kodu uzunluğu,
 * ağırlık alanı uzunluğu) yapılandırmaya göre barkodu parçalara ayırır,
 * ürün kodunu bizim ürünlerimizden birinin "teraziKodu" alanıyla eşleştirir,
 * ağırlığı (gram) kg'ye çevirir.
 *
 * NOT: Terazi markaları arasında format farklılık gösterebilir — bu yüzden
 * ayarlardan değiştirilebilir yaptık. Varsayılan: "20" ön eki + 5 haneli
 * ürün kodu + 5 haneli gram ağırlığı + 1 haneli kontrol rakamı = 13 hane.
 */
export function parseScaleBarcode(code) {
    if (!state.scaleBarcodeEnabled) return null;
    const prefix = state.scaleBarcodePrefix || "20";
    const codeLength = state.scaleBarcodeCodeLength || 5;
    const weightLength = state.scaleBarcodeWeightLength || 5;
    const expectedLength = prefix.length + codeLength + weightLength + 1;

    if (!code || code.length !== expectedLength) return null;
    if (!code.startsWith(prefix)) return null;

    const productCode = code.slice(prefix.length, prefix.length + codeLength);
    const weightStr = code.slice(prefix.length + codeLength, prefix.length + codeLength + weightLength);
    const weightGrams = parseInt(weightStr, 10);
    if (isNaN(weightGrams) || weightGrams <= 0) return null;

    const product = state.products.find((p) => p.teraziKodu && p.teraziKodu === productCode);
    if (!product) return null;

    return { product, weightKg: Math.round((weightGrams / 1000) * 1000) / 1000 };
  }

export function findProductByCaseScan(code) {
    for (const p of state.products) {
      // Eski (tekli) alan hâlâ varsa onu da kontrol et (geriye dönük uyumluluk).
      if (p.caseBarcode && p.caseBarcode === code && p.caseQty) {
        return { product: p, caseQty: p.caseQty };
      }
      if (Array.isArray(p.caseBarcodes)) {
        const match = p.caseBarcodes.find((cb) => cb.barcode === code);
        if (match) return { product: p, caseQty: match.qty };
      }
    }
    return null;
  }

/**
 * Bir ürünün eski (tekli) koli barkodu alanlarını yeni (çoklu) listeye taşır.
 * Ürün her açıldığında/görüntülendiğinde çağrılır — böylece veri zamanla
 * kendiliğinden yeni formata geçer, ayrı bir toplu göçe gerek kalmaz.
 */
export function migrateProductCaseBarcode(p) {
    if (!Array.isArray(p.caseBarcodes)) p.caseBarcodes = [];
    if (p.caseBarcode && p.caseQty) {
      const alreadyThere = p.caseBarcodes.some((cb) => cb.barcode === p.caseBarcode);
      if (!alreadyThere) p.caseBarcodes.push({ barcode: p.caseBarcode, qty: p.caseQty });
      delete p.caseBarcode;
      delete p.caseQty;
    }
  }

export function productAlreadyExists(name) {
    const normalized = name.trim().toLowerCase();
    return state.products.some((p) => p.name.trim().toLowerCase() === normalized);
  }

export function importProductsFromRows(rows) {
    if (!rows.length) return;

    const firstCells = rows[0].map((c) => String(c || "").trim().toLowerCase());
    const hasHeader = firstCells.includes("name") || firstCells.includes("ürün adı") || firstCells.includes("urun adi");
    const dataRows = hasHeader ? rows.slice(1) : rows;

    let addedCount = 0;
    dataRows.forEach((cols) => {
      const name = String(cols[0] || "").trim();
      if (!name) return;
      const category = String(cols[1] || "").trim() || state.t("categoryOtherDefault");
      const qty = Number(cols[2]) || 0;
      const price = Number(cols[3]) || 0;
      if (productAlreadyExists(name)) return;
      state.products.push(mkProduct(name, category, qty, 5, price, "", "adet", 0));
      addedCount++;
    });

    if (addedCount > 0) {
      save();
      renderAll();
      showToast(state.t("bulkAddedAlert").replace("{n}", addedCount), "success");
    } else {
      showToast(state.t("invoiceScanNoItems"), "info");
    }
  }

export function importProductsFromCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const rows = lines.map((line) => line.split(",").map((c) => c.trim()));
    importProductsFromRows(rows);
  }

export function handleCsvImportFile(file) {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        importProductsFromRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      file.text().then((text) => importProductsFromCsv(text));
    }
  }

export function findExistingProductByName(name) {
    const normalized = (name || "").trim().toLowerCase();
    if (!normalized) return null;
    let match = state.products.find((p) => p.name.trim().toLowerCase() === normalized);
    if (match) return match;
    // Tam eşleşme yoksa, birbirini içeren isimlerle gevşek eşleştirme dene
    match = state.products.find(
      (p) => p.name.trim().toLowerCase().includes(normalized) || normalized.includes(p.name.trim().toLowerCase())
    );
    return match || null;
  }