import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { formatQty, formatTL, genId, isBulkScanConfigured, mkProduct, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { findProductByFuzzyName } from './05-products.js';
import { recordStockMovement } from './25-stock-movements.js';
import { getCustomerDebt } from './06-veresiye.js';
import { addToCart, calcLineTotal, clearCart, completeSale, renderCart } from './07-kasa-checkout.js';
import { callGeminiWithRetry } from './16-bulk-scan-ai.js';
import { renderAll, switchTab } from './20-navigation.js';

export function getSpeechRecognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

export function getVoiceLangForTarget(targetInputId) {
    const container = document.querySelector(`.voice-lang-toggle[data-for="${targetInputId}"]`);
    const activeBtn = container ? container.querySelector(".voice-lang-btn.active") : null;
    return activeBtn ? activeBtn.dataset.lang : "tr-TR";
  }

export function getVoiceCommandLang() {
    const container = document.getElementById("voiceCommandLangToggle");
    const activeBtn = container ? container.querySelector(".voice-lang-btn.active") : null;
    return activeBtn ? activeBtn.dataset.lang : "tr-TR";
  }

export function startVoiceCommand() {
    const SpeechRecognitionClass = getSpeechRecognitionClass();
    const btn = document.getElementById("voiceCommandBtn");
    if (!SpeechRecognitionClass) {
      showToast(state.t("voiceNotSupported"), "error");
      return;
    }
    if (state.activeRecognition) {
      state.activeRecognition.stop();
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = getVoiceCommandLang();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    btn.classList.add("listening");
    state.activeRecognition = recognition;
    hideVoiceCommandConfirm();
    const transcriptEl = document.getElementById("voiceCommandTranscript");
    transcriptEl.style.display = "none";

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      transcriptEl.textContent = `🎤 "${transcript}"`;
      transcriptEl.style.display = "block";
      processVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        showToast(state.t("voiceNoSpeech"), "info");
      } else if (event.error === "not-allowed" || event.error === "permission-denied") {
        showToast(state.t("voiceNoPermission"), "error");
      } else {
        showToast(state.t("voiceError"), "error");
      }
    };

    recognition.onend = () => {
      btn.classList.remove("listening");
      state.activeRecognition = null;
    };

    recognition.start();
  }

export function speakFeedback(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getVoiceCommandLang();
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }

export function tryLocalVoiceParse(transcript) {
    const lower = transcript.trim().toLowerCase();

    // Karmaşık/başka türde bir komuma benziyorsa, yerelde çözmeye çalışma — AI'a bırak.
    const complexHints = [
      "veresiye", "borç", "borc", "tamamla", "temizle", "boşalt", "bosalt",
      "indirim", "yeni ürün", "yeni urun", "stok var", "kaç tane", "kac tane", "ne kadar var"
    ];
    if (complexHints.some((hint) => lower.includes(hint))) return false;

    let working = lower;
    state.VOICE_STOPWORDS.forEach((w) => {
      working = working.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
    });

    // Baştaki sayıyı (rakam ya da Türkçe sayı kelimesi) çıkar
    let qty = 1;
    const trimmed = working.trim();
    const digitMatch = trimmed.match(/^(\d+)\s*(.*)$/);
    const wordMatch = trimmed.match(/^(\p{L}+)\s+(.*)$/u);

    let remainder = trimmed;
    if (digitMatch) {
      qty = Number(digitMatch[1]) || 1;
      remainder = digitMatch[2];
    } else if (wordMatch && state.TURKISH_NUMBER_WORDS[wordMatch[1]]) {
      qty = state.TURKISH_NUMBER_WORDS[wordMatch[1]];
      remainder = wordMatch[2];
    }

    remainder = remainder.trim();
    if (!remainder) return false;

    const product = findProductByFuzzyName(remainder);
    if (!product) return false;

    // Net bir ürün eşleşmesi bulundu — AI'a hiç gitmeden anında sepete ekle.
    addToCart(product, qty);
    switchTab("tab-kasa");
    const msg = `${qty} ${product.name} ${state.t("voiceAddedToCart")}`;
    showToast(msg, "success");
    speakFeedback(msg);
    return true;
  }

export function processVoiceCommand(transcript) {
    if (tryLocalVoiceParse(transcript)) return;

    if (!isBulkScanConfigured()) {
      showToast(state.t("voiceCommandNotConfigured"), "error");
      return;
    }

    const productNames = state.products.map((p) => p.name).join(", ");
    const customerNames = state.customers.map((c) => c.name).join(", ");

    const prompt = [
      "Sen bir bakkal/market uygulamasının sesli komut yorumlayıcısısın.",
      "Kullanıcının cümlesi Türkçe, İngilizce ya da Arapça olabilir — hangi dilde olursa olsun anla ve aşağıdaki İngilizce alan adlarıyla JSON döndür.",
      "Kullanıcının söylediği cümleyi analiz et ve hangi işlemi yapmak istediğini belirle.",
      "",
      "Mevcut işlemler ve parametreleri:",
      '1. "add_to_cart" - Kasaya ürün ekleme. params: {productName, qty (belirtilmemişse 1)}',
      '2. "complete_sale" - Kasadaki mevcut satışı tamamlama/onaylama.',
      '3. "add_veresiye" - Bir müşteriye veresiye (borç) ekleme. params: {customerName, amount}',
      '4. "add_product" - Yeni ürün ekleme. params: {name, price, qty (belirtilmemişse 0), category (belirtilmemişse "Diğer")}',
      '5. "check_stock" - Bir ürünün stok durumunu sorma. params: {productName}',
      '6. "clear_cart" - Kasadaki sepeti tamamen boşaltma/temizleme.',
      '7. "apply_discount" - Mevcut sepete belirli bir TL indirim uygulama. params: {amount}',
      '8. "check_customer_debt" - Bir müşterinin güncel veresiye borcunu sorma. params: {customerName}',
      '9. "unknown" - Yukarıdakilerden hiçbiri net değilse.',
      "",
      "Sistemdeki gerçek ürün adları (productName için bunlardan EN YAKIN eşleşeni seç, yoksa kullanıcının söylediği gibi bırak):",
      productNames || "(henüz ürün yok)",
      "",
      "Sistemdeki gerçek müşteri adları (customerName için bunlardan en yakın eşleşeni seç):",
      customerNames || "(henüz müşteri yok)",
      "",
      `Kullanıcının cümlesi: "${transcript}"`,
      "",
      "SADECE geçerli bir JSON nesnesi döndür, başka hiçbir açıklama ekleme.",
      'Format: {"action":"add_to_cart","params":{"productName":"Pepsi 1 Lt","qty":2}}'
    ].join("\n");

    callGeminiWithRetry(null, prompt)
      .then((data) => {
        const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
        if (!rawText) {
          showToast(state.t("voiceCommandError"), "error");
          return;
        }
        let parsed;
        try {
          const cleaned = rawText.replace(/```json|```/g, "").trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          showToast(state.t("voiceCommandError"), "error");
          return;
        }
        handleVoiceCommandAction(parsed);
      })
      .catch((e) => {
        console.error("Sesli komut hatası", e);
        showToast(state.t("voiceCommandError"), "error");
      });
  }

export function handleVoiceCommandAction(parsed) {
    const action = parsed.action;
    const params = parsed.params || {};

    if (action === "clear_cart") {
      if (!state.cart.length) {
        showToast(state.t("voiceCartEmpty"), "info");
        return;
      }
      showVoiceCommandConfirm(state.t("voiceConfirmClearCart"), () => {
        clearCart();
        speakFeedback(state.t("voiceCartClearedDone"));
      });
      return;
    }

    if (action === "apply_discount") {
      const amount = Number(params.amount) || 0;
      if (!state.cart.length) {
        showToast(state.t("voiceCartEmpty"), "error");
        return;
      }
      if (!amount || amount <= 0) {
        showToast(state.t("alertInvalidAmount"), "error");
        return;
      }
      showVoiceCommandConfirm(`${state.t("voiceConfirmDiscount")}: ${formatTL(amount)}`, () => {
        document.getElementById("cartDiscount").value = amount;
        renderCart();
        speakFeedback(state.t("voiceDiscountDone"));
      });
      return;
    }

    if (action === "check_customer_debt") {
      const customer = state.customers.find((c) => c.name.toLowerCase() === String(params.customerName || "").toLowerCase());
      if (!customer) {
        const msg = `${state.t("voiceCustomerNotFound")}: ${params.customerName}`;
        showToast(msg, "error");
        speakFeedback(msg);
        return;
      }
      const debt = getCustomerDebt(customer.id);
      const msg = `${customer.name}: ${formatTL(debt)}`;
      showToast(msg, "info");
      speakFeedback(msg);
      return;
    }

    if (action === "add_to_cart") {
      const product = findProductByFuzzyName(params.productName);
      if (!product) {
        const msg = `${state.t("voiceProductNotFound")}: ${params.productName}`;
        showToast(msg, "error");
        speakFeedback(msg);
        return;
      }
      const qty = Number(params.qty) || 1;
      addToCart(product, qty);
      switchTab("tab-kasa");
      const msg = `${qty} ${product.name} ${state.t("voiceAddedToCart")}`;
      showToast(msg, "success");
      speakFeedback(msg);
      return;
    }

    if (action === "check_stock") {
      const product = findProductByFuzzyName(params.productName);
      if (!product) {
        const msg = `${state.t("voiceProductNotFound")}: ${params.productName}`;
        showToast(msg, "error");
        speakFeedback(msg);
        return;
      }
      const msg = `${product.name}: ${formatQty(product)}`;
      showToast(msg, "info");
      speakFeedback(msg);
      return;
    }

    if (action === "complete_sale") {
      if (!state.cart.length) {
        const msg = state.t("voiceCartEmpty");
        showToast(msg, "error");
        speakFeedback(msg);
        return;
      }
      const subtotal = state.cart.reduce((sum, c) => sum + calcLineTotal(c), 0);
      showVoiceCommandConfirm(`${state.t("voiceConfirmSale")}: ${formatTL(subtotal)}`, () => {
        completeSale();
        speakFeedback(state.t("voiceSaleDone"));
      });
      return;
    }

    if (action === "add_veresiye") {
      const customer = state.customers.find((c) => c.name.toLowerCase() === String(params.customerName || "").toLowerCase());
      const amount = Number(params.amount) || 0;
      if (!customer) {
        const msg = `${state.t("voiceCustomerNotFound")}: ${params.customerName}`;
        showToast(msg, "error");
        speakFeedback(msg);
        return;
      }
      if (!amount || amount <= 0) {
        showToast(state.t("alertInvalidAmount"), "error");
        return;
      }
      showVoiceCommandConfirm(`${customer.name} ${state.t("voiceConfirmVeresiye")}: ${formatTL(amount)}`, () => {
        state.sales.push({
          id: genId(),
          timestamp: new Date().toISOString(),
          items: [{ name: state.t("voiceManualDebtLabel"), qty: 1, price: amount, unit: "adet", costPrice: 0 }],
          subtotal: amount,
          discount: 0,
          total: amount,
          cost: 0,
          profit: 0,
          paymentType: "veresiye",
          customerId: customer.id,
          customerName: customer.name
        });
        logAudit("Sesli komutla veresiye eklendi", `${customer.name}: ${formatTL(amount)}`);
        save();
        renderAll();
        speakFeedback(state.t("voiceVeresiyeDone"));
      });
      return;
    }

    if (action === "add_product") {
      const name = params.name;
      const price = Number(params.price) || 0;
      if (!name) {
        showToast(state.t("voiceCommandError"), "error");
        return;
      }
      showVoiceCommandConfirm(`${state.t("voiceConfirmAddProduct")}: ${name} (${formatTL(price)})`, () => {
        const voiceProduct = mkProduct(name, params.category || state.t("categoryOtherDefault"), Number(params.qty) || 0, 5, price, "", "adet", 0);
        state.products.push(voiceProduct);
        recordStockMovement({ product: voiceProduct, type: "initial", before: 0, after: voiceProduct.qty });
        logAudit("Sesli komutla ürün eklendi", name);
        save();
        renderAll();
        speakFeedback(state.t("voiceProductAddedDone"));
      });
      return;
    }

    const msg = state.t("voiceCommandUnknown");
    showToast(msg, "error");
    speakFeedback(msg);
  }

export function showVoiceCommandConfirm(text, onConfirm) {
    state.pendingVoiceAction = onConfirm;
    document.getElementById("voiceCommandConfirmText").textContent = text;
    document.getElementById("voiceCommandConfirm").style.display = "block";
  }

export function hideVoiceCommandConfirm() {
    state.pendingVoiceAction = null;
    document.getElementById("voiceCommandConfirm").style.display = "none";
  }

export function confirmVoiceAction() {
    if (state.pendingVoiceAction) state.pendingVoiceAction();
    hideVoiceCommandConfirm();
  }

export function startVoiceInput(targetInputId, micBtn) {
    const SpeechRecognitionClass = getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      showToast(state.t("voiceNotSupported"), "error");
      return;
    }

    if (state.activeRecognition) {
      state.activeRecognition.stop();
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = getVoiceLangForTarget(targetInputId);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    micBtn.classList.add("listening");
    state.activeRecognition = recognition;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const input = document.getElementById(targetInputId);
      if (input) input.value = transcript.trim();
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        showToast(state.t("voiceNoSpeech"), "info");
      } else if (event.error === "not-allowed" || event.error === "permission-denied") {
        showToast(state.t("voiceNoPermission"), "error");
      } else {
        showToast(state.t("voiceError"), "error");
      }
    };

    recognition.onend = () => {
      micBtn.classList.remove("listening");
      state.activeRecognition = null;
    };

    recognition.start();
  }

export function setVoiceLang(container, lang) {
    container.querySelectorAll(".voice-lang-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === lang);
    });
  }
