import { state } from './00-state.js';
import { save } from './01-firebase-core.js';
import { calcSellingPrice, escapeHtml, fileToBase64, formatTL, isBulkScanConfigured, mkProduct, showToast, sleep_ } from './02-utils.js';
import { findExistingProductByName, importProductsFromCsv, productAlreadyExists, updateOutOfStockTracking } from './05-products.js';
import { findBarcodesOnlineForCandidates } from './07-kasa-checkout.js';
import { cleanOldPriceChanges } from './11-bread-orders.js';
import { recordStockMovement } from './25-stock-movements.js';
import { renderAll, switchTab } from './20-navigation.js';

export function callGeminiWithRetry(base64, prompt, maxRetries) {
    maxRetries = maxRetries || 3;
    let attempt = 0;

    if (!state.currentUser) {
      return Promise.resolve({ error: { message: "Giriş yapmadan bu özellik kullanılamaz." } });
    }

    return state.currentUser.getIdToken().then((idToken) => {
      function attemptCall() {
        attempt++;
        return fetch(bulkScanConfig.workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ prompt, image: base64, idToken })
        }).then((r) => {
          if ((r.status === 503 || r.status === 429) && attempt < maxRetries) {
            const delay = attempt * 3000;
            console.log(`Gemini ${r.status}, ${delay}ms sonra tekrar denenecek (deneme ${attempt}/${maxRetries})`);
            return sleep_(delay).then(attemptCall);
          }
          return r.json();
        });
      }

      return attemptCall();
    });
  }

export function analyzeOnePhoto(file) {
    const prompt = [
      "Bu bir market/bakkal rafının fotoğrafı.",
      "Fotoğrafta görünen HER FARKLI ürünü tek tek tespit et.",
      "Her ürün için şu alanları çıkar:",
      '- name: ürün adı ve varsa hacmi/boyutu (örn. "Pepsi 1 Lt")',
      "- brand: marka adı",
      "- category: genel kategori (örn. içecekler, atıştırmalık, temizlik)",
      "- price: fiyat etiketinde açıkça görünüyorsa sayı olarak, görünmüyorsa null",
      "- qty: RAFTA GÖRÜNEN bu üründen kaç adet olduğunu dikkatlice SAY (üst üste/yan yana duran aynı ürünleri tek tek say). Kısmen görünen ya da arkada gizlenmiş olabilecekleri de makul şekilde tahmin et. Sayamıyorsan 1 yaz, ASLA 0 yazma.",
      "- barcode: Ürünün üzerinde bir barkod (çizgili kod, altında rakamlar) ya da QR kod NET olarak görünüyor ve okunabiliyorsa, altındaki rakamları oku ve buraya yaz. Net görünmüyorsa ya da emin değilsen boş string (\"\") bırak — ASLA rakam uydurma.",
      "",
      "SADECE geçerli bir JSON dizisi döndür, başka hiçbir açıklama veya metin ekleme.",
      'Format: [{"name":"...","brand":"...","category":"...","price":12.5,"qty":5,"barcode":""}]',
      "Aynı üründen birden fazla varsa listede BİR KEZ yaz, gördüğün toplam adedi qty alanına yaz (ayrı ayrı satırlar olarak tekrarlama)."
    ].join("\n");

    return fileToBase64(file)
      .then((base64) => callGeminiWithRetry(base64, prompt))
      .then((data) => {
        const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
        if (!rawText) {
          console.error("Gemini yanıtı beklenmedik formatta:", data);
          return [];
        }
        try {
          const cleaned = rawText.replace(/```json|```/g, "").trim();
          return JSON.parse(cleaned);
        } catch (e) {
          console.error("JSON ayrıştırma hatası:", e, rawText);
          return [];
        }
      })
      .catch((e) => {
        console.error(e);
        return [];
      });
  }

export function checkForLaunchedFile() {
    if (!("launchQueue" in window)) return;
    window.launchQueue.setConsumer((launchParams) => {
      if (!launchParams.files || !launchParams.files.length) return;
      launchParams.files[0].getFile().then((file) => {
        file.text().then((text) => importProductsFromCsv(text));
      });
    });
  }

export function checkForNoteTakingLaunch() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("newnote") !== "1") return;
    window.history.replaceState({}, "", window.location.pathname);
    switchTab("tab-products");
    setTimeout(() => {
      const input = document.getElementById("newName");
      if (input) input.focus();
    }, 200);
  }

export function checkForProtocolLaunch() {
    const params = new URLSearchParams(window.location.search);
    const weblink = params.get("weblink");
    if (!weblink) return;
    window.history.replaceState({}, "", window.location.pathname);

    try {
      const decoded = decodeURIComponent(weblink);
      const afterScheme = decoded.split("://")[1] || "";
      const tabMap = {
        kasa: "tab-kasa",
        urunler: "tab-products",
        satislar: "tab-sales",
        veresiye: "tab-veresiye",
        siparis: "tab-orders",
        tara: "tab-scan"
      };
      const targetTab = tabMap[afterScheme.toLowerCase()];
      if (targetTab) switchTab(targetTab);
    } catch (e) {
      // yoksay
    }
  }

export function checkForSharedPhoto() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shared") !== "1") return;

    // URL'yi temizle, tekrar tekrar tetiklenmesin
    window.history.replaceState({}, "", window.location.pathname);

    if (!("caches" in window)) return;
    caches
      .open("shared-photo-cache")
      .then((cache) => cache.match("/shared-photo"))
      .then((response) => {
        if (!response) return;
        return response.blob().then((blob) => {
          const file = new File([blob], "paylasilan-fotograf.jpg", { type: blob.type || "image/jpeg" });
          caches.open("shared-photo-cache").then((cache) => cache.delete("/shared-photo"));
          askSharedPhotoDestination(file);
        });
      })
      .catch(() => {});
  }

export function askSharedPhotoDestination(file) {
    if (confirm(state.t("sharedPhotoPrompt"))) {
      handleShelfPhotos([file]);
    } else {
      handleInvoicePhotos([file]);
    }
  }

export function handleShelfPhotos(files) {
    if (!isBulkScanConfigured()) {
      showToast(state.t("bulkScanNotConfigured"), "error");
      return;
    }
    const loadingEl = document.getElementById("bulkScanLoading");
    const loadingText = loadingEl.querySelector("span");
    loadingEl.style.display = "flex";

    let allDetected = [];
    let index = 0;

    function processNext() {
      if (index >= files.length) {
        loadingEl.style.display = "none";
        if (loadingText) loadingText.textContent = state.t("bulkScanAnalyzing");

        // Aynı isimli ürünleri (farklı fotoğraflarda tekrar görünenleri) tekilleştir
        const seen = new Set();
        const deduped = [];
        allDetected.forEach((p) => {
          const key = (p.name || "").trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            deduped.push(p);
          }
        });

        state.bulkScanCandidates = deduped.filter((p) => p.name && !productAlreadyExists(p.name));

        if (!state.bulkScanCandidates.length) {
          showToast(state.t("bulkScanNoNew"), "info");
          return;
        }
        renderBulkScanModal();
        findBarcodesOnlineForCandidates(state.bulkScanCandidates, renderBulkScanModal);
        return;
      }

      if (loadingText && files.length > 1) {
        loadingText.textContent = `${state.t("bulkScanAnalyzing")} (${index + 1}/${files.length})`;
      }

      analyzeOnePhoto(files[index]).then((detected) => {
        if (Array.isArray(detected)) allDetected = allDetected.concat(detected);
        index++;
        processNext();
      });
    }

    processNext();
  }

export function renderBulkScanModal() {
    const titleEl = document.getElementById("bulkScanModalTitle");
    titleEl.textContent = state.t("bulkScanFoundTitle").replace("{n}", state.bulkScanCandidates.length);

    const listEl = document.getElementById("bulkScanResultsList");
    // Yeniden çizerken kullanıcının işaretlerini koru (arka planda barkod arama tekrar çizdirebiliyor)
    const previousChecks = {};
    listEl.querySelectorAll(".bulk-result-check").forEach((chk) => {
      previousChecks[chk.dataset.index] = chk.checked;
    });

    listEl.innerHTML = state.bulkScanCandidates
      .map((p, i) => {
        const metaParts = [p.brand, p.category].filter(Boolean).join(" · ");
        const priceStr = p.price ? formatTL(p.price) : "";
        const qtyStr = `${p.qty || 1} ${state.t("unitAdetShort")}`;
        const barcodeLabel = p.barcodeFromWeb ? state.t("barcodeFoundOnlineLabel") : state.t("barcodeDetectedLabel");
        const barcodeStr = p.barcode ? ` · ${barcodeLabel}: ${escapeHtml(p.barcode)}` : "";
        const isChecked = i in previousChecks ? previousChecks[i] : true;
        return `
          <label class="bulk-result-row">
            <input type="checkbox" class="bulk-result-check" data-index="${i}" ${isChecked ? "checked" : ""} />
            <div class="bulk-result-info">
              <p class="bulk-result-name">${escapeHtml(p.name)}</p>
              <p class="bulk-result-meta">${escapeHtml(metaParts)}${priceStr ? " · " + priceStr : ""} · ${qtyStr}${barcodeStr}</p>
            </div>
          </label>`;
      })
      .join("");

    document.getElementById("bulkScanModal").style.display = "flex";
  }

export function closeBulkScanModal() {
    document.getElementById("bulkScanModal").style.display = "none";
    state.bulkScanCandidates = [];
  }

export function addAllBulkScanProducts() {
    const checks = document.querySelectorAll(".bulk-result-check");
    let addedCount = 0;
    checks.forEach((chk) => {
      if (!chk.checked) return;
      const candidate = state.bulkScanCandidates[Number(chk.dataset.index)];
      if (!candidate) return;
      state.products.push(
        mkProduct(
          candidate.name,
          candidate.category || state.t("categoryOtherDefault"),
          candidate.qty || 1,
          5,
          candidate.price || 0,
          candidate.barcode || "",
          "adet"
        )
      );
      addedCount++;
    });
    save();
    renderAll();
    closeBulkScanModal();
    showToast(state.t("bulkAddedAlert").replace("{n}", addedCount), "success");
  }

export function analyzeOneInvoicePhoto(file) {
    const prompt = [
      "Bu bir tedarikçi/toptancı faturasının fotoğrafı. Faturadaki HER ÜRÜN SATIRINI tek tek çıkar.",
      "",
      "ÇOK ÖNEMLİ - GERÇEK ADET HESABI:",
      "Faturalarda miktar sütunu genellikle 'Kutu', 'Koli', 'Paket' gibi bir toplu satış birimiyle yazılır,",
      "ama kutunun/kolinin İÇİNDE birden fazla tekil ürün (adet) olabilir. Senin görevin, GERÇEKTE kaç",
      "TEKİL ADET satın alındığını bulmak, sadece faturadaki ham sayıyı kopyalamak değil. Bunun için:",
      "1. Ürün adı/açıklamasında geçen paket bilgisini oku (örn. '24'lü', '(4*6)', '1*12', 'x24', '12 Adet/Koli' gibi ifadeler kutu başına kaç tekil ürün olduğunu gösterir).",
      "2. Eğer ürün adında/açıklamasında böyle bir bilgi YOKSA ama marka ve ürün tipini tanıyorsan (örn. Eti, Ülker, Dimes gibi bilinen Türk gıda markalarının standart koli/kutu içerikleri), kendi bilgine dayanarak o markanın o tür ürünü için YAYGIN OLARAK bilinen koli/kutu içeriğini tahmin et.",
      "3. Birim 'Adet' olarak yazılmışsa ve tekil bir ürün olduğu açıksa (paket/koli değilse), olduğu gibi bırak.",
      "4. Hiçbir şekilde emin olamıyorsan, faturadaki ham sayıyı olduğu gibi kullan ama unitNote alanında 'kutu miktarı belirsiz, kontrol et' gibi bir uyarı ekle.",
      "Sakın kör bir formülle (sadece parantez içindeki sayıları çarparak) hareket etme — gerçekten faturayı ve ürünü anlamaya çalış, mantıklı bir sonuca var.",
      "",
      "İSKONTO (İNDİRİM) — ÇOK ÖNEMLİ:",
      "Bazı faturalarda her ürün satırının yanında ayrı bir 'İskonto' veya 'İsk.' sütunu olur",
      "(yüzde olarak, örn. '%10', ya da tutar olarak). Bu satıra özel bir iskonto varsa,",
      "unitCost hesabını YAPARKEN bu iskontoyu MUTLAKA düş — yani unitCost, iskonto",
      "SONRASI gerçek birim maliyeti yansıtmalı, faturadaki brüt (iskontosuz) birim",
      "fiyat değil. İskonto satır bazında değil de faturanın en altında GENEL bir",
      "iskonto olarak yazıyorsa, bunu TÜM satırlara oranlı şekilde dağıt.",
      "",
      "KDV — ÖNEMLİ:",
      "unitCost alanı KDV HARİÇ (mal bedeli) olmalı — faturadaki 'KDV Hariç Birim",
      "Fiyat' ya da 'Matrah' sütununu esas al, KDV dahil tutarı DEĞİL. Faturada",
      "görünen KDV oranını da (varsa, örn. %10, %20) ayrı bir alanda bildir.",
      "",
      "ÜRÜN ADI EŞLEŞTİRME — ÇOK ÖNEMLİ:",
      "Bazı tedarikçiler faturada ürünün TAM adı yerine KISALTMA kullanır",
      '(örn. "CC" = Coca-Cola, "FT" = Fanta, "SPR" = Sprite gibi). Aşağıda,',
      "sistemde ZATEN KAYITLI olan ürünlerin listesi var. Faturadaki bir isim",
      "kısaltma/farklı yazılmış görünüyorsa ama anlam olarak bu listedeki bir",
      "ürüne AÇIKÇA karşılık geliyorsa, name alanına faturadaki kısaltmayı DEĞİL,",
      "sistemde KAYITLI OLAN TAM ADI yaz — böylece aynı ürün için ikinci bir",
      "kayıt oluşmasın. Gerçekten hangi ürüne karşılık geldiğinden emin",
      "değilsen, faturada yazdığı gibi bırak (yeni bir ürün olabilir).",
      "",
      "Sistemde kayıtlı ürünler:",
      state.products.map((p) => p.name).join(", ") || "(henüz kayıtlı ürün yok)",
      "",
      "Her satır için şu alanları çıkar:",
      '- name: SADECE ürünün gerçek adı (faturada yazdığı gibi, örn. "Pepsi 1 Lt"). Faturada ürün adından ÖNCE gelen sıra numarası, stok kodu, satır numarası gibi rakamları/kodları KESİNLİKLE dahil etme — sadece ürünü tanımlayan gerçek ismi al.',
      "- qty: yukarıdaki mantığa göre hesapladığın GERÇEK TEKİL ADET sayısı (sayı olarak)",
      "- unitCost: TEKİL ADET başına, İSKONTO DÜŞÜLMÜŞ ve KDV HARİÇ alış fiyatı (sayı olarak). Faturada kutu/koli fiyatı yazıyorsa, bunu senin hesapladığın gerçek adet sayısına bölerek adet başı fiyatı bul.",
      "",
      "BİRİM (unit) — ÇOK ÖNEMLİ:",
      'Ürün TANE/PAKET olarak mı satılıyor yoksa AĞIRLIK (kilogram) olarak mı satılıyor tespit et. unit alanına SADECE "adet" ya da "kg" yaz.',
      'Faturada ağırlık birimini gösteren KISALTMALARA dikkat et — bunlar farklı dillerde farklı görünebilir:',
      '- Türkçe: "kg", "kilogram", "KG"',
      '- Arapça: "كغ" (kilogram kısaltması), "كيلو", "كجم" — bunların HEPSİ "kg" demektir, "adet" DEĞİL.',
      '- İngilizce: "kg", "kgs"',
      'Örneğin faturada "5 كغ" yazıyorsa, bu ürünün 5 KİLOGRAM olduğu anlamına gelir — bunu "1 adet" gibi YANLIŞ yorumlama. Böyle bir durumda qty alanına 5 (kilogram miktarı), unit alanına "kg" yaz.',
      'Birim belirtilmemişse veya net değilse, varsayılan olarak "adet" kullan.',
      "",
      "- kdvRate: bu satır/fatura için geçerli KDV oranı (sayı olarak, örn. 10 ya da 20). Faturada belirtilmiyorsa null bırak.",
      "- discountApplied: bu satıra bir iskonto uygulandıysa true, uygulanmadıysa false.",
      "- unitNote: emin olamadığın durumlar için kısa bir not (varsa), yoksa boş bırak",
      "- barcode: Bu ürün satırının yanında bir barkod (çizgili kod ya da altındaki rakamlar) ya da QR kod NET olarak basılıysa oku ve buraya yaz. Görünmüyorsa ya da emin değilsen boş string (\"\") bırak — ASLA rakam uydurma.",
      "",
      "SADECE geçerli bir JSON dizisi döndür, başka hiçbir açıklama veya metin ekleme.",
      'Format: [{"name":"...","qty":24,"unit":"adet","unitCost":16.5,"kdvRate":10,"discountApplied":true,"unitNote":"","barcode":""}]',
      "Ürün satırı olmayan (fatura toplamı, tarih, firma bilgisi gibi) satırları dahil etme — ama KDV oranı ve iskonto bilgisini, ait olduğu ürün satırına yukarıdaki gibi işleyerek kullan."
    ].join("\n");

    return fileToBase64(file)
      .then((base64) => callGeminiWithRetry(base64, prompt))
      .then((data) => {
        const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
        if (!rawText) {
          console.error("Gemini yanıtı beklenmedik formatta:", data);
          return [];
        }
        try {
          const cleaned = rawText.replace(/```json|```/g, "").trim();
          return JSON.parse(cleaned);
        } catch (e) {
          console.error("JSON ayrıştırma hatası:", e, rawText);
          return [];
        }
      })
      .catch((e) => {
        console.error(e);
        return [];
      });
  }

export function handleInvoicePhotos(files) {
    if (!isBulkScanConfigured()) {
      showToast(state.t("invoiceScanNotConfigured"), "error");
      return;
    }
    const loadingEl = document.getElementById("invoiceScanLoading");
    const loadingText = loadingEl.querySelector("span");
    loadingEl.style.display = "flex";

    let allLines = [];
    let index = 0;

    function processNext() {
      if (index >= files.length) {
        loadingEl.style.display = "none";
        if (loadingText) loadingText.textContent = state.t("invoiceScanAnalyzing");

        // Aynı isimli satırları birleştir (miktarları topla, son okunan birim fiyatı al)
        const merged = {};
        allLines.forEach((line) => {
          if (!line.name) return;
          const key = line.name.trim().toLowerCase();
          if (!merged[key]) {
            merged[key] = { name: line.name, qty: 0, unit: line.unit === "kg" ? "kg" : "adet", unitCost: line.unitCost || 0, unitNote: line.unitNote || "", barcode: line.barcode || "", kdvRate: line.kdvRate || null, discountApplied: !!line.discountApplied };
          }
          merged[key].qty += Number(line.qty) || 0;
          if (line.unit === "kg") merged[key].unit = "kg";
          if (line.unitCost) merged[key].unitCost = line.unitCost;
          if (line.unitNote) merged[key].unitNote = line.unitNote;
          if (line.barcode) merged[key].barcode = line.barcode;
          if (line.kdvRate) merged[key].kdvRate = line.kdvRate;
          if (line.discountApplied) merged[key].discountApplied = true;
        });

        // Not: Gerçek adet hesabı artık yapay zekanın kendisi tarafından
        // (fatura görselini yorumlayarak) yapılıyor — burada ayrıca sabit bir
        // formülle çarpma işlemi YAPILMIYOR, AI'ın kendi hesapladığı adet
        // sayısına güveniliyor.
        state.invoiceScanCandidates = Object.values(merged).map((line) => {
          const existing = findExistingProductByName(line.name);
          return {
            name: line.name,
            qty: line.qty,
            unit: line.unit,
            unitCost: line.unitCost,
            unitNote: line.unitNote,
            barcode: line.barcode,
            kdvRate: line.kdvRate,
            discountApplied: line.discountApplied,
            matchedProductId: existing ? existing.id : null,
            matchedProductName: existing ? existing.name : null,
            markupPercent: 20
          };
        });

        if (!state.invoiceScanCandidates.length) {
          showToast(state.t("invoiceScanNoItems"), "info");
          return;
        }
        renderInvoiceScanModal();
        findBarcodesOnlineForCandidates(state.invoiceScanCandidates, renderInvoiceScanModal);
        return;
      }

      if (loadingText && files.length > 1) {
        loadingText.textContent = `${state.t("invoiceScanAnalyzing")} (${index + 1}/${files.length})`;
      }

      analyzeOneInvoicePhoto(files[index]).then((lines) => {
        if (Array.isArray(lines)) allLines = allLines.concat(lines);
        index++;
        processNext();
      });
    }

    processNext();
  }

export function renderInvoiceScanModal() {
    const titleEl = document.getElementById("invoiceScanModalTitle");
    titleEl.textContent = state.t("invoiceScanFoundTitle").replace("{n}", state.invoiceScanCandidates.length);

    const listEl = document.getElementById("invoiceScanResultsList");
    // Yeniden çizerken kullanıcının işaretlerini ve girdiği kâr oranlarını koru
    const previousChecks = {};
    const previousMarkups = {};
    listEl.querySelectorAll(".invoice-result-check").forEach((chk) => {
      previousChecks[chk.dataset.index] = chk.checked;
    });
    listEl.querySelectorAll(".invoice-markup-input").forEach((inp) => {
      previousMarkups[inp.dataset.index] = inp.value;
    });

    listEl.innerHTML = state.invoiceScanCandidates
      .map((item, i) => {
        if (i in previousMarkups) item.markupPercent = Number(previousMarkups[i]) || item.markupPercent;
        const statusHtml = item.matchedProductId
          ? `<span class="invoice-status-badge invoice-status-existing">${state.t("invoiceExistingLabel").replace("{qty}", item.qty)}</span>`
          : `<span class="invoice-status-badge invoice-status-new">${state.t("invoiceNewLabel")}</span>`;
        const costStr = item.unitCost ? formatTL(item.unitCost) : "";
        const priceStr = item.unitCost ? formatTL(calcSellingPrice(item.unitCost, item.markupPercent)) : "";
        const markupHtml = item.unitCost
          ? `
            <div class="invoice-markup-inline">
              <label data-i18n="invoiceMarkupLabel">Kâr oranı (%)</label>
              <input type="number" min="0" step="1" class="invoice-markup-input" data-index="${i}" value="${item.markupPercent}" />
            </div>`
          : "";
        const noteHtml = item.unitNote ? `<p class="invoice-uncertainty-note">⚠️ ${escapeHtml(item.unitNote)}</p>` : "";
        const barcodeLabel = item.barcodeFromWeb ? state.t("barcodeFoundOnlineLabel") : state.t("barcodeDetectedLabel");
        const barcodeHtml = item.barcode ? `<p class="invoice-uncertainty-note" style="color:var(--green-text);">✓ ${barcodeLabel}: ${escapeHtml(item.barcode)}</p>` : "";
        const isChecked = i in previousChecks ? previousChecks[i] : true;
        const kdvHtml = item.kdvRate ? `<p class="invoice-uncertainty-note" style="color:var(--text-muted);">KDV: %${item.kdvRate}${item.discountApplied ? " · " + state.t("invoiceDiscountAppliedLabel") : ""}</p>` : "";
        return `
          <label class="bulk-result-row">
            <input type="checkbox" class="invoice-result-check" data-index="${i}" ${isChecked ? "checked" : ""} />
            <div class="bulk-result-info">
              <p class="bulk-result-name">${escapeHtml(item.name)}</p>
              <p class="bulk-result-meta">${item.qty} ${item.unit === "kg" ? state.t("unitKgShort") : "adet"}${costStr ? " · Geliş: " + costStr : ""}${priceStr ? " · Satış: <span class=\"invoice-price-preview\" data-index=\"" + i + "\">" + priceStr + "</span>" : ""}</p>
              ${noteHtml}
              ${barcodeHtml}
              ${kdvHtml}
              ${markupHtml}
              ${statusHtml}
            </div>
          </label>`;
      })
      .join("");

    listEl.querySelectorAll(".invoice-markup-input").forEach((input) => {
      input.addEventListener("input", (e) => {
        e.stopPropagation();
        const index = Number(input.dataset.index);
        const item = state.invoiceScanCandidates[index];
        if (!item) return;
        const percent = Number(input.value);
        item.markupPercent = isNaN(percent) || percent < 0 ? 0 : percent;
        const priceEl = listEl.querySelector(`.invoice-price-preview[data-index="${index}"]`);
        if (priceEl) priceEl.textContent = formatTL(calcSellingPrice(item.unitCost, item.markupPercent));
      });
      input.addEventListener("click", (e) => e.stopPropagation());
    });

    document.getElementById("invoiceScanModal").style.display = "flex";
  }

export function closeInvoiceScanModal() {
    document.getElementById("invoiceScanModal").style.display = "none";
    state.invoiceScanCandidates = [];
  }

export function setInvoiceScanDestination(dest) {
    state.invoiceScanDestination = dest;
    const shelfBtn = document.getElementById("invoiceDestShelfBtn");
    const warehouseBtn = document.getElementById("invoiceDestWarehouseBtn");
    if (shelfBtn) shelfBtn.classList.toggle("active", dest === "raf");
    if (warehouseBtn) warehouseBtn.classList.toggle("active", dest === "depo");
  }

export function applyInvoiceScan() {
    const destination = state.invoiceScanDestination || "raf";
    const checks = document.querySelectorAll(".invoice-result-check");
    let appliedCount = 0;
    checks.forEach((chk) => {
      if (!chk.checked) return;
      const item = state.invoiceScanCandidates[Number(chk.dataset.index)];
      if (!item) return;

      if (item.matchedProductId) {
        const p = state.products.find((x) => x.id === item.matchedProductId);
        if (p) {
          if (destination === "depo") {
            const whBefore = p.warehouseQty || 0;
            p.warehouseQty = Math.round((whBefore + item.qty) * 1000) / 1000;
            recordStockMovement({ product: p, type: "purchase", location: "depo", before: whBefore, after: p.warehouseQty });
          } else {
            const qtyBefore = p.qty;
            p.qty = Math.round((p.qty + item.qty) * 1000) / 1000;
            recordStockMovement({ product: p, type: "purchase", before: qtyBefore, after: p.qty });
            updateOutOfStockTracking(p);
          }
          if (item.barcode && !p.barcode) p.barcode = item.barcode;
          if (item.unitCost) {
            const oldPrice = p.price;
            const newPrice = calcSellingPrice(item.unitCost, item.markupPercent);
            if (oldPrice && Math.abs(newPrice - oldPrice) >= 0.01) {
              state.priceChangeLog.push({
                productName: p.name,
                oldPrice,
                newPrice,
                direction: newPrice > oldPrice ? "up" : "down",
                timestamp: new Date().toISOString()
              });
            }
            p.costPrice = item.unitCost;
            p.price = newPrice;
          }
        }
      } else {
        const costPrice = item.unitCost || 0;
        const price = costPrice ? calcSellingPrice(costPrice, item.markupPercent) : 0;
        const shelfQty = destination === "depo" ? 0 : item.qty;
        const newProduct = mkProduct(item.name, state.t("categoryOtherDefault"), shelfQty, 5, price, item.barcode || "", item.unit === "kg" ? "kg" : "adet", costPrice);
        if (destination === "depo") newProduct.warehouseQty = item.qty;
        state.products.push(newProduct);
        if (destination === "depo") recordStockMovement({ product: newProduct, type: "purchase", location: "depo", before: 0, after: item.qty });
        else recordStockMovement({ product: newProduct, type: "purchase", before: 0, after: newProduct.qty });
      }
      appliedCount++;
    });
    cleanOldPriceChanges();
    save();
    renderAll();
    closeInvoiceScanModal();
    showToast(state.t("invoiceAppliedAlert").replace("{n}", appliedCount), "success");
  }