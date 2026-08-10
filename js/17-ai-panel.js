import { state } from './00-state.js';
import { locale, save } from './01-firebase-core.js';
import { escapeHtml, formatTL, getStatus, printOrderListAsPdf, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { renderShelfCheckAlert } from './12-push-notifications.js';
import { callGeminiWithRetry } from './16-bulk-scan-ai.js';

export function renderDailyReportAndHealth() {
    const reportSoldOutEl = document.getElementById("reportSoldOutCount");
    if (!reportSoldOutEl) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = state.sales.filter((s) => new Date(s.timestamp) >= today);

    const soldOutCount = state.products.filter((p) => p.qty <= 0).length;
    const criticalCount = state.products.filter((p) => p.qty > 0 && p.qty < p.min).length;
    const orderNeededCount = state.products.filter((p) => p.qty <= p.min).length;
    const todayProfit = todaySales.reduce((sum, s) => sum + (s.profit || 0), 0);

    document.getElementById("reportSoldOutCount").textContent = soldOutCount;
    document.getElementById("reportCriticalCount").textContent = criticalCount;
    document.getElementById("reportEstProfit").textContent = formatTL(todayProfit);
    document.getElementById("reportOrderCount").textContent = orderNeededCount;

    // Sağlık skoru: 100'den başla, sorunlara göre düş
    let score = 100;
    const reasons = [];

    if (criticalCount > 0) {
      score -= Math.min(criticalCount * 3, 30);
      reasons.push({ ok: false, text: `${criticalCount} ${state.t("healthReasonCritical")}` });
    } else {
      reasons.push({ ok: true, text: state.t("healthReasonNoCritical") });
    }

    if (soldOutCount > 0) {
      score -= Math.min(soldOutCount * 5, 25);
      reasons.push({ ok: false, text: `${soldOutCount} ${state.t("healthReasonSoldOut")}` });
    }

    const last7 = state.sales.filter((s) => new Date(s.timestamp) >= new Date(Date.now() - 7 * 86400000));
    const prev7 = state.sales.filter((s) => {
      const d = new Date(s.timestamp);
      return d >= new Date(Date.now() - 14 * 86400000) && d < new Date(Date.now() - 7 * 86400000);
    });
    const last7Total = last7.reduce((sum, s) => sum + s.total, 0);
    const prev7Total = prev7.reduce((sum, s) => sum + s.total, 0);
    if (prev7Total > 0 && last7Total < prev7Total) {
      score -= 10;
      reasons.push({ ok: false, text: state.t("healthReasonSalesDown") });
    } else if (last7Total > 0) {
      reasons.push({ ok: true, text: state.t("healthReasonSalesUp") });
    }

    const expiringSoon = state.products.filter((p) => p.expiryDate && daysUntil(p.expiryDate) <= 7 && daysUntil(p.expiryDate) >= 0);
    if (expiringSoon.length > 0) {
      score -= Math.min(expiringSoon.length * 3, 15);
      reasons.push({ ok: false, text: `${expiringSoon.length} ${state.t("healthReasonExpiring")}` });
    }

    reasons.push({ ok: true, text: state.t("healthReasonOrdersRegular") });

    score = Math.max(0, Math.min(100, Math.round(score)));
    const circle = document.getElementById("healthScoreCircle");
    document.getElementById("healthScoreValue").textContent = score;
    circle.className = "health-score-circle " + (score >= 80 ? "health-good" : score >= 50 ? "health-medium" : "health-bad");

    document.getElementById("healthScoreReasons").innerHTML = reasons
      .map((r) => `<p class="health-reason ${r.ok ? "health-reason-ok" : "health-reason-bad"}"><i class="fa-solid ${r.ok ? "fa-check" : "fa-triangle-exclamation"}" aria-hidden="true"></i> ${escapeHtml(r.text)}</p>`)
      .join("");
  }

export function daysUntil(dateStr) {
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

export function renderLostSales() {
    const listEl = document.getElementById("lostSalesList");
    const emptyEl = document.getElementById("lostSalesEmptyState");
    const totalEl = document.getElementById("lostSalesTotalValue");
    if (!listEl) return;

    const cutoff = new Date(Date.now() - 14 * 86400000);
    const recentSales = state.sales.filter((s) => new Date(s.timestamp) >= cutoff);
    const salesByProduct = {};
    recentSales.forEach((s) => {
      s.items.forEach((item) => {
        salesByProduct[item.name] = (salesByProduct[item.name] || 0) + item.qty;
      });
    });

    const outOfStock = state.products
      .filter((p) => p.qty <= 0 && p.wentOutOfStockAt)
      .map((p) => {
        const daysOut = Math.max(0, (Date.now() - new Date(p.wentOutOfStockAt).getTime()) / 86400000);
        const avgDaily = (salesByProduct[p.name] || 0) / 14;
        const lostRevenue = avgDaily * p.price * daysOut;
        return { name: p.name, daysOut, lostRevenue };
      })
      .filter((x) => x.lostRevenue > 0)
      .sort((a, b) => b.lostRevenue - a.lostRevenue);

    const totalLost = outOfStock.reduce((sum, x) => sum + x.lostRevenue, 0);
    totalEl.textContent = formatTL(totalLost);

    if (!outOfStock.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = outOfStock
      .map((x) => {
        const daysLabel = Math.round(x.daysOut * 10) / 10;
        return `
          <div class="lost-sales-row">
            <div>
              <p class="lost-sales-name">${escapeHtml(x.name)}</p>
              <p class="lost-sales-meta">${daysLabel} ${state.t("lostSalesDaysOut")}</p>
            </div>
            <span class="lost-sales-amount">${formatTL(x.lostRevenue)}</span>
          </div>`;
      })
      .join("");
  }

export function calcOrderSuggestions(productFilter) {
    const cutoff = new Date(Date.now() - 14 * 86400000);
    const recentSales = state.sales.filter((s) => new Date(s.timestamp) >= cutoff);

    const salesByProduct = {};
    recentSales.forEach((s) => {
      s.items.forEach((item) => {
        salesByProduct[item.name] = (salesByProduct[item.name] || 0) + item.qty;
      });
    });

    return state.products
      .filter(productFilter)
      .map((p) => {
        const totalSold = salesByProduct[p.name] || 0;
        const avgDaily = totalSold / 14;

        if (avgDaily <= 0) {
          // Son 14 günde hiç satılmamış (belki zaten stokta yoktu, satılamadı).
          // Satış hızına dayalı öneri yapamayız ama basit stok durumuna göre
          // yine de listeye eklemeliyiz — yoksa "eksik" bir ürün, sırf yakın
          // zamanda satılmadı diye bu listeden tamamen kaybolur.
          const status = getStatus(p);
          if (status === "yeterli") return null;
          const suggestedOrder = Math.max(1, (p.min || 5) * 2 - p.qty);
          return {
            productId: p.id,
            name: p.name,
            daysLeft: 0,
            avgDaily: 0,
            suggestedOrder,
            unit: p.unit,
            supplierId: p.supplierId || null,
            needsAlternativeSource: !!p.needsAlternativeSource
          };
        }

        const daysLeft = p.qty / avgDaily;
        if (daysLeft > 7) return null;
        const suggestedOrder = Math.max(0, Math.ceil(avgDaily * 14 - p.qty));
        if (suggestedOrder <= 0) return null;
        return {
          productId: p.id,
          name: p.name,
          daysLeft,
          avgDaily,
          suggestedOrder,
          unit: p.unit,
          supplierId: p.supplierId || null,
          needsAlternativeSource: !!p.needsAlternativeSource
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

export function renderOrderEngine() {
    const listEl = document.getElementById("orderEngineList");
    const emptyEl = document.getElementById("orderEngineEmptyState");
    if (!listEl) return;

    renderOrderEngineFilterSelect();
    const filterValue = document.getElementById("orderEngineFilterSelect").value;

    const allSuggestions = calcOrderSuggestions(() => true);
    const suggestions = filterValue ? allSuggestions.filter((s) => s.supplierId === filterValue) : allSuggestions;

    if (!suggestions.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = suggestions
      .map((s, i) => {
        const daysLabel = s.daysLeft <= 0 ? state.t("orderEngineToday") : `${Math.ceil(s.daysLeft)} ${state.t("orderEngineDaysLeft")}`;
        const showTransferBtn = !!filterValue; // sadece belirli bir tedarikçi seçiliyken anlamlı
        const transferBtnHtml = showTransferBtn
          ? `<button type="button" class="order-engine-transfer-btn" data-product-id="${s.productId}">${state.t("orderEngineTransferBtn")}</button>`
          : "";
        const altBadgeHtml =
          !filterValue && s.needsAlternativeSource ? `<span class="order-engine-alt-badge">${state.t("orderEngineAltBadge")}</span>` : "";
        return `
          <label class="order-engine-row">
            <input type="checkbox" class="order-engine-check" data-index="${i}" checked />
            <div class="order-engine-info">
              <p class="order-engine-name">${escapeHtml(s.name)}</p>
              <p class="order-engine-meta">${state.t("orderEngineRunsOut")}: ${daysLabel}</p>
              ${altBadgeHtml}
            </div>
            <div class="order-engine-suggestion">
              <span class="order-engine-qty">${s.suggestedOrder}</span>
              <span class="order-engine-unit">${s.unit === "kg" ? state.t("unitKgShort") : state.t("unitAdetShort")}</span>
            </div>
            ${transferBtnHtml}
          </label>`;
      })
      .join("");

    listEl.querySelectorAll(".order-engine-transfer-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        markNeedsAlternativeSource(btn.dataset.productId);
      });
    });

    state.orderEngineSuggestionsCache = suggestions;
    renderOrderEngineSupplierSelect();
  }

export function renderOrderEngineFilterSelect() {
    const selectEl = document.getElementById("orderEngineFilterSelect");
    if (!selectEl) return;
    const currentValue = selectEl.value;
    selectEl.innerHTML =
      `<option value="">${state.t("orderEngineFilterAll")}</option>` +
      state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    selectEl.value = currentValue;
  }

export function markNeedsAlternativeSource(productId) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    p.needsAlternativeSource = true;
    logAudit("Ana sipariş listesine aktarıldı", p.name);
    save();
    renderOrderEngine();
    showToast(state.t("orderEngineTransferDone"), "success");
  }

export function renderOrderEngineSupplierSelect() {
    const selectEl = document.getElementById("orderEngineSupplierSelect");
    if (!selectEl) return;
    selectEl.innerHTML =
      `<option value="">${state.t("orderEngineNoSupplier")}</option>` +
      state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  }

export function createOrderFromEngine() {
    const checks = document.querySelectorAll(".order-engine-check");
    const selected = [];
    checks.forEach((chk) => {
      if (chk.checked) selected.push(state.orderEngineSuggestionsCache[Number(chk.dataset.index)]);
    });
    if (!selected.length) {
      showToast(state.t("orderEngineNoneSelected"), "error");
      return;
    }

    const lines = selected.map((s) => `- ${s.name}: ${s.suggestedOrder} ${s.unit === "kg" ? state.t("unitKgShort") : state.t("unitAdetShort")}`);
    const message = `${state.t("orderEngineMessageTitle")}\n\n${lines.join("\n")}`;

    const supplierId = document.getElementById("orderEngineSupplierSelect").value;
    const supplier = state.suppliers.find((s) => s.id === supplierId);

    if (supplier && supplier.phone) {
      const cleanPhone = supplier.phone.replace(/[^\d]/g, "");
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    } else {
      navigator.clipboard
        .writeText(message)
        .then(() => showToast(state.t("orderEngineCopied"), "success"))
        .catch(() => showToast(message, "info"));
    }
    logAudit("Sipariş oluşturuldu", `${selected.length} ürün${supplier ? " · " + supplier.name : ""}`);
  }

export function printOrderEngineList() {
    const checks = document.querySelectorAll(".order-engine-check");
    const selected = [];
    checks.forEach((chk) => {
      if (chk.checked) selected.push(state.orderEngineSuggestionsCache[Number(chk.dataset.index)]);
    });
    if (!selected.length) {
      showToast(state.t("orderEngineNoneSelected"), "error");
      return;
    }
    printOrderListAsPdf(state.t("orderEngineMessageTitle"), selected);
  }

const PRICE_SUGGEST_CHUNK_SIZE = 500;

export function renderPriceSuggestions() {
    const listEl = document.getElementById("priceSuggestList");
    const emptyEl = document.getElementById("priceSuggestEmptyState");
    if (!listEl) return;

    const now = Date.now();
    const recentCutoff = new Date(now - 14 * 86400000);
    const olderCutoff = new Date(now - 28 * 86400000);

    const recentSalesByProduct = {};
    const olderSalesByProduct = {};

    // Satış geçmişi büyüdükçe (1-2 yıl sonra binlerce kayıt), bunu TEK
    // seferde taramak arayüzü kısa süreliğine kilitleyebiliyor. Bunun yerine
    // küçük parçalara (chunk) bölüp, her parça arasında tarayıcıya "nefes
    // aldırarak" (setTimeout ile) işliyoruz.
    const salesSnapshot = state.sales;
    let index = 0;

    function processChunk() {
      const end = Math.min(index + PRICE_SUGGEST_CHUNK_SIZE, salesSnapshot.length);
      for (; index < end; index++) {
        const s = salesSnapshot[index];
        const d = new Date(s.timestamp);
        s.items.forEach((item) => {
          if (d >= recentCutoff) {
            recentSalesByProduct[item.name] = (recentSalesByProduct[item.name] || 0) + item.qty;
          } else if (d >= olderCutoff) {
            olderSalesByProduct[item.name] = (olderSalesByProduct[item.name] || 0) + item.qty;
          }
        });
      }

      if (index < salesSnapshot.length) {
        setTimeout(processChunk, 0);
      } else {
        finalizeSuggestions();
      }
    }

    function finalizeSuggestions() {
      const suggestions = [];
      state.products.forEach((p) => {
        if (!p.price || !p.costPrice) return;
        const recentQty = recentSalesByProduct[p.name] || 0;
        const olderQty = olderSalesByProduct[p.name] || 0;
        const margin = (p.price - p.costPrice) / p.price;

        // Talep düşüyor + marj iyi → küçük bir indirim öner (satış hızını artırmak için)
        if (olderQty >= 4 && recentQty > 0 && recentQty < olderQty * 0.6 && margin > 0.15) {
          const newPrice = Math.round(p.price * 0.96 * 100) / 100;
          suggestions.push({
            name: p.name, oldPrice: p.price, newPrice, direction: "down",
            reason: state.t("priceSuggestReasonSlow")
          });
          return;
        }

        // Talep yüksek + stok az → küçük bir zam öner (marjı artırmak için)
        if (recentQty >= 8 && p.qty > 0 && p.qty <= p.min * 1.5) {
          const newPrice = Math.round(p.price * 1.04 * 100) / 100;
          suggestions.push({
            name: p.name, oldPrice: p.price, newPrice, direction: "up",
            reason: state.t("priceSuggestReasonHighDemand")
          });
        }
      });

      if (!suggestions.length) {
        listEl.innerHTML = "";
        emptyEl.style.display = "block";
        return;
      }
      emptyEl.style.display = "none";

      listEl.innerHTML = suggestions
        .slice(0, 15)
        .map((s) => {
          const dirClass = s.direction === "up" ? "price-suggest-up" : "price-suggest-down";
          return `
            <div class="price-suggest-row">
              <div>
                <p class="price-suggest-name">${escapeHtml(s.name)}</p>
                <p class="price-suggest-reason">${escapeHtml(s.reason)}</p>
              </div>
              <div class="price-suggest-prices">
                <span class="price-suggest-old">${formatTL(s.oldPrice)}</span>
                <span class="price-suggest-new ${dirClass}">${formatTL(s.newPrice)}</span>
              </div>
            </div>`;
        })
        .join("");
    }

    if (!salesSnapshot.length) {
      finalizeSuggestions();
      return;
    }
    processChunk();
  }

export function renderExpiryTracking() {
    const listEl = document.getElementById("expiryList");
    const emptyEl = document.getElementById("expiryEmptyState");
    if (!listEl) return;

    const withExpiry = state.products
      .filter((p) => p.expiryDate)
      .map((p) => ({ ...p, daysLeft: daysUntil(p.expiryDate) }))
      .filter((p) => p.daysLeft <= 14)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    if (!withExpiry.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = withExpiry
      .map((p) => {
        const urgentClass = p.daysLeft < 0 ? "expiry-expired" : p.daysLeft <= 3 ? "expiry-urgent" : "expiry-soon";
        const daysLabel = p.daysLeft < 0 ? state.t("expiryPassed") : p.daysLeft === 0 ? state.t("expiryToday") : `${p.daysLeft} ${state.t("expiryDaysLeft")}`;
        return `
          <div class="expiry-row ${urgentClass}">
            <span class="expiry-name">${escapeHtml(p.name)}</span>
            <span class="expiry-days">${daysLabel}</span>
          </div>`;
      })
      .join("");
  }

export function renderProfitRanking(mode) {
    mode = mode || state.profitRankMode || "top";
    state.profitRankMode = mode;
    document.getElementById("profitRankTopBtn").classList.toggle("active", mode === "top");
    document.getElementById("profitRankBottomBtn").classList.toggle("active", mode === "bottom");

    const listEl = document.getElementById("profitRankList");
    const emptyEl = document.getElementById("profitRankEmptyState");
    if (!listEl) return;

    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const profitByProduct = {};
    state.sales
      .filter((s) => new Date(s.timestamp).getTime() >= thirtyDaysAgo)
      .forEach((s) => {
        (s.items || []).forEach((item) => {
          const lineProfit = (item.price - (item.costPrice || 0)) * item.qty;
          profitByProduct[item.name] = (profitByProduct[item.name] || 0) + lineProfit;
        });
      });

    let ranked = Object.entries(profitByProduct).map(([name, profit]) => ({ name, profit }));
    if (!ranked.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    ranked.sort((a, b) => (mode === "top" ? b.profit - a.profit : a.profit - b.profit));
    ranked = ranked.slice(0, 10);

    listEl.innerHTML = ranked
      .map((r, i) => {
        const color = r.profit >= 0 ? "var(--green-text)" : "var(--red-text)";
        return `
          <div class="reminder-row">
            <p class="reminder-name">${i + 1}. ${escapeHtml(r.name)}</p>
            <span style="font-weight:700;color:${color};">${formatTL(r.profit)}</span>
          </div>`;
      })
      .join("");
  }

export function renderAnomalyDetection() {
    const listEl = document.getElementById("anomalyList");
    const emptyEl = document.getElementById("anomalyEmptyState");
    if (!listEl) return;

    const cutoff = new Date(Date.now() - 7 * 86400000);
    const suspicious = state.auditLog.filter((entry) => {
      if (new Date(entry.timestamp) < cutoff) return false;

      let decrease = 0;
      if (entry.action === "Stok güncellendi") {
        // Format: "Ürün: -5 → 10" ya da "Ürün: +3 → 13" — işaretli fark doğrudan yazılı
        const deltaMatch = entry.details.match(/:\s*([+-]\d+(\.\d+)?)\s*→/);
        if (deltaMatch) decrease = -Number(deltaMatch[1]);
      } else if (entry.action === "Stok elle güncellendi") {
        // Format: "Ürün: 15 → 10" — eski ve yeni miktarın farkını hesapla
        const rangeMatch = entry.details.match(/:\s*(\d+(\.\d+)?)\s*→\s*(\d+(\.\d+)?)/);
        if (rangeMatch) decrease = Number(rangeMatch[1]) - Number(rangeMatch[3]);
      } else {
        return false;
      }

      return decrease >= 5;
    });

    if (!suspicious.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = suspicious
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map((entry) => {
        const d = new Date(entry.timestamp);
        const dateStr = d.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `
          <div class="anomaly-row">
            <p class="anomaly-detail">${escapeHtml(entry.details)}</p>
            <p class="anomaly-meta">${dateStr} · ${escapeHtml(entry.actor)}</p>
          </div>`;
      })
      .join("");
  }

export function askAiAdvisor() {
    const question = document.getElementById("advisorQuestion").value.trim();
    if (!question) return;

    const answerEl = document.getElementById("advisorAnswer");
    const loadingEl = document.getElementById("advisorLoading");
    answerEl.style.display = "none";
    loadingEl.style.display = "flex";

    const last30 = state.sales.filter((s) => new Date(s.timestamp) >= new Date(Date.now() - 30 * 86400000));
    const totalRevenue = last30.reduce((sum, s) => sum + s.total, 0);
    const totalProfit = last30.reduce((sum, s) => sum + (s.profit || 0), 0);
    const productSales = {};
    last30.forEach((s) => s.items.forEach((i) => (productSales[i.name] = (productSales[i.name] || 0) + i.qty)));
    const topProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const criticalList = state.products.filter((p) => p.qty <= p.min).map((p) => p.name);

    const dataSummary = [
      `Son 30 günkü toplam ciro: ${totalRevenue.toFixed(2)} TL`,
      `Son 30 günkü toplam kâr: ${totalProfit.toFixed(2)} TL`,
      `En çok satan 10 ürün (adet): ${topProducts.map(([n, q]) => `${n}: ${q}`).join(", ") || "veri yok"}`,
      `Kritik/tükenmiş ürünler: ${criticalList.join(", ") || "yok"}`,
      `Toplam ürün sayısı: ${state.products.length}`
    ].join("\n");

    const prompt = [
      "Sen bir bakkal/market için AI danışmanısın. Aşağıdaki gerçek verilere dayanarak kullanıcının sorusunu kısa, net ve Türkçe cevapla.",
      "Sadece verilen veriye dayan, uydurma sayı verme. Veri yetersizse bunu açıkça söyle.",
      "",
      "VERİLER:",
      dataSummary,
      "",
      `SORU: ${question}`
    ].join("\n");

    callGeminiWithRetry(null, prompt)
      .then((data) => {
        const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
        loadingEl.style.display = "none";
        answerEl.style.display = "block";
        answerEl.textContent = rawText || state.t("advisorError");
      })
      .catch((e) => {
        console.error("AI danışman hatası", e);
        loadingEl.style.display = "none";
        answerEl.style.display = "block";
        answerEl.textContent = state.t("advisorError");
      });
  }

export function renderAiPanel() {
    if (!document.getElementById("tab-ai")) return;
    renderDailyReportAndHealth();
    renderOrderEngine();
    renderLostSales();
    renderExpiryTracking();
    renderPriceSuggestions();
    renderProfitRanking();
    renderAnomalyDetection();
    renderShelfCheckAlert();
  }