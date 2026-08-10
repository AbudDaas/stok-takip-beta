import { state } from './00-state.js';
import { forgotPassword, importLocalBackup, load, logout, registerPeriodicSync, save, submitAuth } from './01-firebase-core.js';
import { showToast } from './02-utils.js';
import { addStaffMember, enterAsOwner, saveOwnerPin, staffPickerGoBack, submitStaffPickerPin, switchUser } from './03-staff-roles.js';
import { saveFiscalSettings, toggleFiscalEnabled } from './04-fiscal.js';
import { addCaseBarcodeEntry, addExtraBarcode, addPendingCaseBarcode, addPendingExtraBarcode, addProduct, addWarehouseStock, adjustQty, applyPhysicalCount, closeModal, closePhysicalCountModal, deleteProduct, handleCsvImportFile, handleEditProductPhotoUpload, handleNewProductPhotoUpload, openPhysicalCountModal, printAllQrCodes, printQr, printSelfSourceList, renderPhysicalCountList, resetAll, saveEdit, setQtyManually, transferToShelf, translateMissingProductNames } from './05-products.js';
import { addCustomer, closeCustomerModal, deleteCustomer, recordPayment, renderVeresiyeCustomerResults, saveCustomerEdit } from './06-veresiye.js';
import { checkGiftCardBalance, clearCart, closeQuickBarcodeScan, completeSale, openQuickBarcodeScan, renderCart, renderManualAddResults, setPaymentType, setScanMode, startScan, startScanKasa, stopScan, stopScanKasa } from './07-kasa-checkout.js';
import { closeReturnModal, confirmReturn, renderSales, submitZReport } from './08-sales-returns.js';
import { addSuggestedSuppliers, addSupplier, addSupplierDebt, addSupplierPayment, addTemplateBuilderItem, assignSelectedProductsToSupplier, closeSupplierModal, deleteSupplier, printSupplierOrderList, renderSupplierProductPicker, saveOrderTemplate, sendSupplierOrderWhatsApp, submitSupplierReturn } from './09-suppliers.js';
import { addExpense } from './21-expenses.js';
import { createGiftCard } from './23-giftcards.js';
import { addBreadConfig, sendBreadWhatsApp } from './11-bread-orders.js';
import { enableNotifications } from './12-push-notifications.js';
import { addCatalogItem, closeBranchEditModal, createBranch, exitBranchView, saveBranchEdit } from './13-branches-chain.js';
import { createAdminBusiness } from './14-admin-panel.js';
import { confirmVoiceAction, hideVoiceCommandConfirm, setVoiceLang, startVoiceCommand, startVoiceInput } from './15-voice-commands.js';
import { addAllBulkScanProducts, applyInvoiceScan, checkForLaunchedFile, checkForNoteTakingLaunch, checkForProtocolLaunch, checkForSharedPhoto, closeBulkScanModal, closeInvoiceScanModal, handleInvoicePhotos, handleShelfPhotos, setInvoiceScanDestination } from './16-bulk-scan-ai.js';
import { askAiAdvisor, createOrderFromEngine, printOrderEngineList, renderOrderEngine, renderProfitRanking } from './17-ai-panel.js';
import { applyFontSize, applyNavPosition, applyScanCooldown, applyScanFps, applySimpleMode, applyTheme, closeBusinessLocationModal, confirmBusinessLocation, copyPublicCatalogLink, downloadBackup, handleLogoUpload, initSettings, openBusinessLocationPicker, resetBrandIdentity, saveBrandIdentity, saveDeliverySettings, saveLoyaltySettings, savePublicCatalogSettings, saveScaleBarcodeSettings, sendFeedback, toggleLoyalty, togglePublicCatalog, toggleScaleBarcodeEnabled } from './18-settings-backup.js';
import { finishOnboarding, onboardingNext } from './19-onboarding.js';
import { renderAll, switchTab } from './20-navigation.js';

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "BAKKAL_SYNC_RECONNECTED") {
        showToast(state.t("syncReconnected"), "success");
      }
    });
  }

document.getElementById("addBtn").addEventListener("click", addProduct);

document.querySelectorAll(".voice-mic-btn").forEach((btn) => {
    btn.addEventListener("click", () => startVoiceInput(btn.dataset.target, btn));
  });

document.querySelectorAll(".voice-lang-toggle").forEach((container) => {
    container.querySelectorAll(".voice-lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => setVoiceLang(container, btn.dataset.lang));
    });
  });

document.getElementById("newQty").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addProduct();
  });

document.getElementById("searchBox").addEventListener("input", renderAll);

document.getElementById("orderListSupplierFilter").addEventListener("change", renderAll);
document.getElementById("selfSourcePrintBtn").addEventListener("click", printSelfSourceList);

document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm(state.t("confirmResetAll"))) resetAll();
  });

document.getElementById("breadWhatsAppBtn").addEventListener("click", sendBreadWhatsApp);

document.getElementById("notifEnableBtn").addEventListener("click", enableNotifications);

document.getElementById("breadConfigAddBtn").addEventListener("click", addBreadConfig);

document.getElementById("breadWhatsAppNumber").addEventListener("change", (e) => {
    state.breadWhatsAppNumber = e.target.value.trim();
    save();
  });

document.getElementById("closeModalBtn").addEventListener("click", closeModal);

document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") closeModal();
  });

document.getElementById("qtyPlusBtn").addEventListener("click", () => {
    const p = state.products.find((x) => x.id === state.activeProductId);
    adjustQty(state.activeProductId, p && p.unit === "kg" ? 0.1 : 1);
  });

document.getElementById("qtyMinusBtn").addEventListener("click", () => {
    const p = state.products.find((x) => x.id === state.activeProductId);
    adjustQty(state.activeProductId, p && p.unit === "kg" ? -0.1 : -1);
  });

document.getElementById("modalQtyInput").addEventListener("change", (e) => {
    const newQty = parseFloat(String(e.target.value).replace(",", "."));
    setQtyManually(state.activeProductId, newQty);
  });

document.getElementById("saveEditBtn").addEventListener("click", saveEdit);

document.getElementById("deleteProductBtn").addEventListener("click", () => {
    if (confirm(state.t("confirmDeleteProduct"))) deleteProduct(state.activeProductId);
  });

document.getElementById("printQrBtn").addEventListener("click", printQr);
document.getElementById("addWarehouseStockBtn").addEventListener("click", addWarehouseStock);
document.getElementById("transferToShelfBtn").addEventListener("click", transferToShelf);

document.getElementById("printAllQrBtn").addEventListener("click", printAllQrCodes);

document.getElementById("scanNewBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("newBarcode"));
document.getElementById("newCatalogDiscount").addEventListener("change", (e) => {
  document.getElementById("newDiscountedPrice").style.display = e.target.checked ? "block" : "none";
});
document.getElementById("editCatalogDiscount").addEventListener("change", (e) => {
  document.getElementById("editDiscountedPrice").style.display = e.target.checked ? "block" : "none";
});
document.getElementById("newProductPhotoInput").addEventListener("change", (e) => handleNewProductPhotoUpload(e.target.files[0]));
document.getElementById("editProductPhotoInput").addEventListener("change", (e) => handleEditProductPhotoUpload(e.target.files[0]));
document.getElementById("scanNewExtraBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("newExtraBarcodeSingle"));
document.getElementById("scanNewCaseBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("newCaseBarcode"));
document.getElementById("addPendingExtraBarcodeBtn").addEventListener("click", addPendingExtraBarcode);
document.getElementById("addPendingCaseBarcodeBtn").addEventListener("click", addPendingCaseBarcode);

document.getElementById("scanEditBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("editBarcode"));
document.getElementById("scanExtraBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("newExtraBarcode"));
document.getElementById("scanCaseBarcodeBtn").addEventListener("click", () => openQuickBarcodeScan("editCaseBarcode"));
document.getElementById("addExtraBarcodeBtn").addEventListener("click", addExtraBarcode);
document.getElementById("addCaseBarcodeBtn").addEventListener("click", addCaseBarcodeEntry);
document.getElementById("newExtraBarcode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addExtraBarcode();
});

document.getElementById("closeBarcodeModalBtn").addEventListener("click", closeQuickBarcodeScan);

document.getElementById("shelfPhotoBtn").addEventListener("click", () => {
    document.getElementById("shelfPhotoInput").click();
  });

document.getElementById("shelfPhotoInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) handleShelfPhotos(files);
    e.target.value = "";
  });

document.getElementById("closeBulkScanModalBtn").addEventListener("click", closeBulkScanModal);

document.getElementById("bulkScanModal").addEventListener("click", (e) => {
    if (e.target.id === "bulkScanModal") closeBulkScanModal();
  });

document.getElementById("bulkAddAllBtn").addEventListener("click", addAllBulkScanProducts);

document.getElementById("invoicePhotoBtn").addEventListener("click", () => {
    document.getElementById("invoicePhotoInput").click();
  });

document.getElementById("csvImportBtn").addEventListener("click", () => {
    document.getElementById("csvImportInput").click();
  });

document.getElementById("openPhysicalCountBtn").addEventListener("click", openPhysicalCountModal);
document.getElementById("closePhysicalCountModalBtn").addEventListener("click", closePhysicalCountModal);
document.getElementById("applyPhysicalCountBtn").addEventListener("click", applyPhysicalCount);
document.getElementById("physicalCountSearch").addEventListener("input", (e) => renderPhysicalCountList(e.target.value));

document.getElementById("csvImportInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleCsvImportFile(file);
    e.target.value = "";
  });

document.getElementById("invoicePhotoInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) handleInvoicePhotos(files);
    e.target.value = "";
  });

document.getElementById("closeInvoiceScanModalBtn").addEventListener("click", closeInvoiceScanModal);

document.getElementById("invoiceScanModal").addEventListener("click", (e) => {
    if (e.target.id === "invoiceScanModal") closeInvoiceScanModal();
  });

document.getElementById("invoiceApplyBtn").addEventListener("click", applyInvoiceScan);
document.getElementById("invoiceDestShelfBtn").addEventListener("click", () => setInvoiceScanDestination("raf"));
document.getElementById("invoiceDestWarehouseBtn").addEventListener("click", () => setInvoiceScanDestination("depo"));

document.getElementById("barcodeScanModal").addEventListener("click", (e) => {
    if (e.target.id === "barcodeScanModal") closeQuickBarcodeScan();
  });

document.getElementById("startScanBtn").addEventListener("click", startScan);
document.getElementById("scanModeStockBtn").addEventListener("click", () => setScanMode("stok"));
document.getElementById("scanModeShelfBtn").addEventListener("click", () => setScanMode("rafaAktar"));

document.getElementById("stopScanBtn").addEventListener("click", stopScan);

document.getElementById("manualAddSearch").addEventListener("input", renderManualAddResults);

document.getElementById("startKasaScanBtn").addEventListener("click", startScanKasa);

document.getElementById("stopKasaScanBtn").addEventListener("click", stopScanKasa);

document.getElementById("clearCartBtn").addEventListener("click", () => {
    if (!state.cart.length || confirm(state.t("confirmClearCart"))) clearCart();
  });

document.getElementById("completeSaleBtn").addEventListener("click", completeSale);

document.getElementById("cartDiscount").addEventListener("input", renderCart);

document.getElementById("payNakitBtn").addEventListener("click", () => setPaymentType("nakit"));

document.getElementById("payKartBtn").addEventListener("click", () => setPaymentType("kart"));

document.getElementById("payVeresiyeBtn").addEventListener("click", () => setPaymentType("veresiye"));
document.getElementById("payGiftCardBtn").addEventListener("click", () => setPaymentType("hediye"));
document.getElementById("giftCardCodeInput").addEventListener("input", checkGiftCardBalance);

document.getElementById("veresiyeCustomerSearch").addEventListener("input", (e) => {
    state.selectedVeresiyeCustomerId = null;
    document.getElementById("veresiyeCustomerSelectedId").value = "";
    renderVeresiyeCustomerResults(e.target.value);
  });

document.getElementById("veresiyeCustomerSearch").addEventListener("focus", (e) => {
    renderVeresiyeCustomerResults(e.target.value);
  });

document.addEventListener("click", (e) => {
    const wrapper = document.getElementById("veresiyeCustomerRow");
    if (wrapper && !wrapper.contains(e.target)) {
      document.getElementById("veresiyeCustomerResults").classList.remove("show");
    }
  });

document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentSalesPeriod = btn.dataset.period;
      document.querySelectorAll(".period-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderSales();
    });
  });

document.getElementById("addCustomerBtn").addEventListener("click", addCustomer);

document.getElementById("closeCustomerModalBtn").addEventListener("click", closeCustomerModal);

document.getElementById("customerModal").addEventListener("click", (e) => {
    if (e.target.id === "customerModal") closeCustomerModal();
  });

document.getElementById("recordPaymentBtn").addEventListener("click", recordPayment);

document.getElementById("saveCustomerEditBtn").addEventListener("click", saveCustomerEdit);

document.getElementById("deleteCustomerBtn").addEventListener("click", () => {
    if (confirm(state.t("confirmDeleteCustomer"))) deleteCustomer(state.activeCustomerId);
  });

document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

document.getElementById("authSubmitBtn").addEventListener("click", submitAuth);

document.getElementById("authPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });

document.getElementById("forgotPasswordBtn").addEventListener("click", forgotPassword);

document.getElementById("logoutBtn").addEventListener("click", logout);

document.getElementById("switchUserBtn").addEventListener("click", switchUser);

document.getElementById("adminCreateBtn").addEventListener("click", createAdminBusiness);

document.getElementById("importBackupBtn").addEventListener("click", importLocalBackup);

document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => window.i18n.setLang(btn.dataset.lang));
  });

window.onLangChanged = function () {
    renderAll();
    translateMissingProductNames();
  };

window.i18n.applyLang(window.i18n.getLang());

document.getElementById("themeLightBtn").addEventListener("click", () => applyTheme("light"));

document.getElementById("themeDarkBtn").addEventListener("click", () => applyTheme("dark"));

document.getElementById("navBottomBtn").addEventListener("click", () => applyNavPosition("bottom"));

document.getElementById("navSideBtn").addEventListener("click", () => applyNavPosition("side"));

document.getElementById("fontNormalBtn").addEventListener("click", () => applyFontSize("normal"));

document.getElementById("fontLargeBtn").addEventListener("click", () => applyFontSize("large"));
document.getElementById("scanFpsLowBtn").addEventListener("click", () => applyScanFps(5));
document.getElementById("scanFpsNormalBtn").addEventListener("click", () => applyScanFps(10));
document.getElementById("scanFpsHighBtn").addEventListener("click", () => applyScanFps(20));
document.getElementById("scanCooldownFastBtn").addEventListener("click", () => applyScanCooldown(1000));
document.getElementById("scanCooldownNormalBtn").addEventListener("click", () => applyScanCooldown(3000));
document.getElementById("scanCooldownSlowBtn").addEventListener("click", () => applyScanCooldown(5000));

document.getElementById("simpleModeBtn").addEventListener("click", () => applySimpleMode("simple"));

document.getElementById("advancedModeBtn").addEventListener("click", () => applySimpleMode("advanced"));

document.getElementById("onboardingNextBtn").addEventListener("click", onboardingNext);

document.getElementById("onboardingSkipBtn").addEventListener("click", finishOnboarding);

document.getElementById("downloadBackupBtn").addEventListener("click", downloadBackup);

document.getElementById("staffAddBtn").addEventListener("click", addStaffMember);

document.getElementById("ownerPinSaveBtn").addEventListener("click", saveOwnerPin);

document.getElementById("fiscalEnabledToggle").addEventListener("change", (e) => toggleFiscalEnabled(e.target.checked));

document.getElementById("fiscalSaveBtn").addEventListener("click", saveFiscalSettings);

document.getElementById("feedbackSendBtn").addEventListener("click", sendFeedback);

document.getElementById("staffOwnerBtn").addEventListener("click", enterAsOwner);

document.getElementById("staffPickerBackBtn").addEventListener("click", staffPickerGoBack);

document.getElementById("staffPickerPinSubmitBtn").addEventListener("click", submitStaffPickerPin);

document.getElementById("staffPickerPinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitStaffPickerPin();
  });

document.getElementById("advisorAskBtn").addEventListener("click", askAiAdvisor);

document.getElementById("branchCreateBtn").addEventListener("click", createBranch);

document.getElementById("catalogAddBtn").addEventListener("click", addCatalogItem);

document.getElementById("exitBranchViewBtn").addEventListener("click", exitBranchView);

document.getElementById("closeBranchEditModalBtn").addEventListener("click", closeBranchEditModal);

document.getElementById("supplierAddBtn").addEventListener("click", addSupplier);
document.getElementById("expenseAddBtn").addEventListener("click", addExpense);
document.getElementById("createGiftCardBtn").addEventListener("click", createGiftCard);
document.getElementById("publicCatalogToggle").addEventListener("change", (e) => togglePublicCatalog(e.target.checked));
document.getElementById("savePublicCatalogBtn").addEventListener("click", savePublicCatalogSettings);
document.getElementById("copyPublicCatalogLinkBtn").addEventListener("click", copyPublicCatalogLink);
document.getElementById("loyaltyToggle").addEventListener("change", (e) => toggleLoyalty(e.target.checked));
document.getElementById("saveLoyaltySettingsBtn").addEventListener("click", saveLoyaltySettings);
document.getElementById("scaleBarcodeToggle").addEventListener("change", (e) => toggleScaleBarcodeEnabled(e.target.checked));
document.getElementById("saveScaleBarcodeSettingsBtn").addEventListener("click", saveScaleBarcodeSettings);
document.getElementById("setBusinessLocationBtn").addEventListener("click", openBusinessLocationPicker);
document.getElementById("closeBusinessLocationModalBtn").addEventListener("click", closeBusinessLocationModal);
document.getElementById("confirmBusinessLocationBtn").addEventListener("click", confirmBusinessLocation);
document.getElementById("saveDeliverySettingsBtn").addEventListener("click", saveDeliverySettings);
document.getElementById("saveBrandIdentityBtn").addEventListener("click", saveBrandIdentity);
document.getElementById("resetBrandIdentityBtn").addEventListener("click", resetBrandIdentity);
document.getElementById("businessLogoInput").addEventListener("change", (e) => handleLogoUpload(e.target.files[0]));

document.getElementById("addSuggestedSuppliersBtn").addEventListener("click", addSuggestedSuppliers);

document.getElementById("closeSupplierModalBtn").addEventListener("click", closeSupplierModal);

document.getElementById("supplierModal").addEventListener("click", (e) => {
    if (e.target.id === "supplierModal") closeSupplierModal();
  });

document.getElementById("supplierAddDebtBtn").addEventListener("click", addSupplierDebt);

document.getElementById("supplierAddPaymentBtn").addEventListener("click", addSupplierPayment);

document.getElementById("supplierOrderSendBtn").addEventListener("click", sendSupplierOrderWhatsApp);
document.getElementById("supplierOrderPrintBtn").addEventListener("click", printSupplierOrderList);

document.getElementById("supplierProductSearch").addEventListener("input", renderSupplierProductPicker);

document.getElementById("supplierAssignProductsBtn").addEventListener("click", assignSelectedProductsToSupplier);

document.getElementById("submitSupplierReturnBtn").addEventListener("click", submitSupplierReturn);
document.getElementById("addTemplateItemBtn").addEventListener("click", addTemplateBuilderItem);
document.getElementById("saveTemplateBtn").addEventListener("click", saveOrderTemplate);
document.getElementById("deleteSupplierBtn").addEventListener("click", deleteSupplier);

document.getElementById("closeReturnModalBtn").addEventListener("click", closeReturnModal);

document.getElementById("returnModal").addEventListener("click", (e) => {
    if (e.target.id === "returnModal") closeReturnModal();
  });

document.getElementById("confirmReturnBtn").addEventListener("click", confirmReturn);
document.getElementById("submitZReportBtn").addEventListener("click", submitZReport);

document.getElementById("voiceCommandBtn").addEventListener("click", startVoiceCommand);

document.getElementById("voiceCommandConfirmYes").addEventListener("click", confirmVoiceAction);

document.getElementById("voiceCommandConfirmNo").addEventListener("click", hideVoiceCommandConfirm);

document.getElementById("orderEngineCreateBtn").addEventListener("click", createOrderFromEngine);
document.getElementById("orderEnginePrintBtn").addEventListener("click", printOrderEngineList);
document.getElementById("profitRankTopBtn").addEventListener("click", () => renderProfitRanking("top"));
document.getElementById("profitRankBottomBtn").addEventListener("click", () => renderProfitRanking("bottom"));

document.getElementById("orderEngineFilterSelect").addEventListener("change", renderOrderEngine);

document.getElementById("branchEditModal").addEventListener("click", (e) => {
    if (e.target.id === "branchEditModal") closeBranchEditModal();
  });

document.getElementById("branchEditSaveBtn").addEventListener("click", saveBranchEdit);

initSettings();

if (state.requestedTab && document.getElementById(state.requestedTab)) {
    switchTab(state.requestedTab);
  }

checkForSharedPhoto();

checkForLaunchedFile();

checkForProtocolLaunch();

checkForNoteTakingLaunch();

registerPeriodicSync();

load();