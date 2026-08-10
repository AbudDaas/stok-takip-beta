export const state = {};

state.t = (key) => window.i18n.t(key);
state.STORAGE_KEY = "bakkal_urunler_v2";
state.products = [];
state.sales = [];
state.customers = [];
state.payments = [];
state.breadLog = [];
state.dailyResetConfig = [];
state.breadWhatsAppNumber = "";
state.priceChangeLog = [];
state.fiscalEnabled = false;
state.fiscalProvider = "foriba";
state.fiscalApiKey = "";
state.fiscalEndpoint = "";
state.fiscalVkn = "";
state.suppliers = [];
state.supplierTransactions = [];
state.returns = [];
state.expenses = [];
state.pendingExtraBarcodes = [];
state.pendingCaseBarcodes = [];
state.scanFps = 10;
state.scanCooldownMs = 3000;
state.publicCatalogEnabled = false;
state.publicCatalogPhone = "";
state.businessName = "";
state.scanMode = "stok";
state.invoiceScanDestination = "raf";
state.loyaltyEnabled = false;
state.loyaltyEarnRate = 10;
state.loyaltyRedeemRate = 10;
state.giftCards = [];
state.scaleBarcodeEnabled = false;
state.scaleBarcodePrefix = "20";
state.scaleBarcodeCodeLength = 5;
state.scaleBarcodeWeightLength = 5;
state.businessLat = null;
state.businessLng = null;
state.perKmDeliveryFee = 0;
state.businessLogo = "";
state.brandColor = "#1F3864";
state.incomingOrders = [];
state.blockedPhones = [];
state.blockedIPs = [];
state.zReports = [];
state.profitRankMode = "top";
state.orderTemplates = [];
state.pendingTemplateItems = [];
state.pendingProductImage = "";
state._rev = 0;
state._hasLoadedOnce = false;
state.activeReturnSaleId = null;
state.activeSupplierId = null;
state.accountType = "standalone";
state.auditLog = [];
state.staffMembers = [];
state.currentStaff = null;
state.ownerPin = "";
state.masterCatalog = [];
state.cart = [];
state.activeProductId = null;
state.activeCustomerId = null;
state.selectedPaymentType = "nakit";
state.currentSalesPeriod = "today";
state.html5QrCode = null;
state.scanning = false;
state.html5QrCodeKasa = null;
state.scanningKasa = false;
state.stokScanCooldown = false;
state.kasaScanCooldown = false;
state.db = null;
state.auth = null;
state.docRef = null;
state.cloudEnabled = false;
state.suppressNextSnapshot = false;
state.firestoreUnsubscribe = null;
state.currentUser = null;
state.ADMIN_UID = "NaVl26qq6kXas90Qm9e2kCZDaIp2";
state.staffPickerPendingSelection = null;
state.SUGGESTED_SUPPLIERS = ["Coca-Cola", "Pepsi", "Eti", "Ülker", "Dimes", "Lay's", "Algida", "Sütaş"];
state.supplierOrderSuggestionsCache = [];
state.selectedVeresiyeCustomerId = null;
state.originalDocRef = null;
state.viewingBranchUid = null;
state.loadedBranches = [];
state.editingBranchUid = null;
state.STATUS_CLASS = { tukendi: "status-tukendi", kritik: "status-kritik", yeterli: "status-yeterli" };
state.TOAST_ICONS = {
    success: "fa-solid fa-circle-check",
    error: "fa-solid fa-circle-exclamation",
    info: "fa-solid fa-circle-info"
  };
state.activeRecognition = null;
state.pendingVoiceAction = null;
state.TURKISH_NUMBER_WORDS = {
    bir: 1, iki: 2, üç: 3, uc: 3, dört: 4, dort: 4, beş: 5, bes: 5,
    altı: 6, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10
  };
state.VOICE_STOPWORDS = [
    "sat", "satıyorum", "satiyorum", "sattım", "sattim", "ekle", "ekliyorum", "ekledim",
    "al", "alıyorum", "aliyorum", "tane", "adet", "lütfen", "lutfen"
  ];
state.translationInFlight = false;
state.beepAudioCtx = null;
state.quickScanCode = null;
state.quickScanTargetInputId = null;
state.bulkScanCandidates = [];
state.invoiceScanCandidates = [];
state.orderEngineSuggestionsCache = [];
state.onboardingSlideIndex = 0;
state.ONBOARDING_SLIDE_COUNT = 4;
state.requestedTab = new URLSearchParams(window.location.search).get("tab");