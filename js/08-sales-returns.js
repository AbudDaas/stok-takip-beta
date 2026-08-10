import { state } from './00-state.js';
import { locale, save } from './01-firebase-core.js';
import { escapeHtml, formatTL, genId, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';
import { renderAll } from './20-navigation.js';

export function getReturnedQtyForItem(saleId, itemName) {
    return state.returns
      .filter((r) => r.saleId === saleId)
      .reduce((sum, r) => {
        const item = r.items.find((i) => i.name === itemName);
        return sum + (item ? item.qty : 0);
      }, 0);
  }

export function openReturnModal(saleId) {
    const sale = state.sales.find((s) => s.id === saleId);
    if (!sale) return;
    state.activeReturnSaleId = saleId;

    const listEl = document.getElementById("returnItemsList");
    listEl.innerHTML = sale.items
      .map((item, i) => {
        const alreadyReturned = getReturnedQtyForItem(saleId, item.name);
        const maxQty = Math.max(0, item.qty - alreadyReturned);
        return `
          <div class="return-item-row">
            <div class="return-item-info">
              <p class="return-item-name">${escapeHtml(item.name)}</p>
              <p class="return-item-meta">${state.t("returnMaxLabel")}: ${maxQty} ${item.unit === "kg" ? state.t("unitKgShort") : state.t("unitAdetShort")}</p>
            </div>
            <input type="number" class="return-qty-input" data-index="${i}" min="0" max="${maxQty}" step="${item.unit === "kg" ? "0.001" : "1"}" value="0" ${maxQty <= 0 ? "disabled" : ""} />
          </div>`;
      })
      .join("");

    document.getElementById("returnModal").style.display = "flex";
  }

export function closeReturnModal() {
    document.getElementById("returnModal").style.display = "none";
    state.activeReturnSaleId = null;
  }

export function confirmReturn() {
    const sale = state.sales.find((s) => s.id === state.activeReturnSaleId);
    if (!sale) return;

    const inputs = document.querySelectorAll(".return-qty-input");
    const returnItems = [];
    let totalRefund = 0;

    inputs.forEach((input) => {
      const qty = Number(input.value) || 0;
      if (qty <= 0) return;
      const item = sale.items[Number(input.dataset.index)];
      if (!item) return;
      returnItems.push({ name: item.name, qty, price: item.price });
      totalRefund += qty * item.price;

      const p = state.products.find((x) => x.name === item.name);
      if (p) p.qty = Math.round((p.qty + qty) * 1000) / 1000;
    });

    if (!returnItems.length) {
      showToast(state.t("returnNoneSelected"), "error");
      return;
    }

    state.returns.push({
      id: genId(),
      saleId: sale.id,
      timestamp: new Date().toISOString(),
      items: returnItems,
      totalRefund
    });

    logAudit("İade alındı", `${formatTL(totalRefund)} (${returnItems.length} ürün)`);
    save();
    renderAll();
    closeReturnModal();
    showToast(state.t("returnSuccess"), "success");
  }

export function cancelSale(saleId) {
    const sale = state.sales.find((s) => s.id === saleId);
    if (!sale) return;
    if (!confirm(`${state.t("confirmCancelSale")}\n${formatTL(sale.total)} ${state.t("confirmCancelSaleDetail")}`)) {
      return;
    }
    sale.items.forEach((item) => {
      const p = state.products.find((x) => x.name === item.name);
      if (p) p.qty += item.qty;
    });
    state.sales = state.sales.filter((s) => s.id !== saleId);
    logAudit("Satış iptal edildi", formatTL(sale.total));
    save();
    renderAll();
  }

export function isInPeriod(isoString, period) {
    const d = new Date(isoString);
    const now = new Date();
    if (period === "today") {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }
    if (period === "week") {
      const dayOfWeek = (now.getDay() + 6) % 7; // Pazartesi=0
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(now.getDate() - dayOfWeek);
      return d >= monday;
    }
    if (period === "month") {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true; // 'all'
  }

export function saleRowHtml(sale) {
    const d = new Date(sale.timestamp);
    const timeStr = d.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const itemsSummary = sale.items
      .map((i) => `${escapeHtml(i.name)} x${i.unit === "kg" ? i.qty + state.t("unitKgShort") : i.qty}`)
      .join(", ");
    const saleReturns = state.returns.filter((r) => r.saleId === sale.id);
    const totalReturned = saleReturns.reduce((sum, r) => sum + r.totalRefund, 0);
    const returnedNote = totalReturned > 0 ? `<p class="sale-returned-note">${state.t("returnedLabel")}: -${formatTL(totalReturned)}</p>` : "";
    const paymentBadge =
      sale.paymentType === "veresiye"
        ? `<span class="sale-payment-badge sale-payment-veresiye">${state.t("veresiyeLabel")}${sale.customerName ? ": " + escapeHtml(sale.customerName) : ""}</span>`
        : sale.paymentType === "kart"
        ? `<span class="sale-payment-badge sale-payment-kart">${state.t("payKart")}</span>`
        : "";
    const profitValue = sale.profit != null ? sale.profit : sale.total;
    return `
      <div class="sale-row">
        <div class="sale-row-top">
          <span class="sale-time">${timeStr}</span>
          <span class="sale-amount">${formatTL(sale.total)}</span>
        </div>
        <p class="sale-items">${itemsSummary}</p>
        <p class="sale-profit">${state.t("profitLabel")}: ${formatTL(profitValue)}</p>
        ${returnedNote}
        <div class="sale-row-bottom">
          ${paymentBadge}
          <button class="sale-return-btn" data-id="${sale.id}">
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ${state.t("returnBtn")}
          </button>
          <button class="sale-cancel-btn" data-id="${sale.id}">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i> ${state.t("cancelSaleBtn")}
          </button>
        </div>
      </div>`;
  }

export function topProductRowHtml(item, rank) {
    return `
      <div class="product-row">
        <div class="product-info">
          <p class="product-name">${rank}. ${escapeHtml(item.name)}</p>
          <p class="product-meta">${item.qty} ${state.t("soldQtyLabel")}</p>
        </div>
        <span class="sale-amount">${formatTL(item.revenue)}</span>
      </div>`;
  }

/**
 * Gün Sonu Kasa Sayımı (Z-Raporu).
 * Bugünkü NAKİT satışların toplamını (kasada olması gereken tutarı)
 * hesaplayıp, kullanıcının gerçekte saydığı tutarla karşılaştırır.
 */
function getExpectedCashToday() {
  return state.sales
    .filter((s) => isInPeriod(s.timestamp, "today") && s.paymentType === "nakit")
    .reduce((sum, s) => sum + s.total, 0);
}

export function submitZReport() {
  const actualInput = document.getElementById("zReportActual");
  const actual = Number(actualInput.value);
  if (!actual && actual !== 0) {
    showToast(state.t("alertInvalidAmount"), "error");
    return;
  }
  const expected = getExpectedCashToday();
  const difference = Math.round((actual - expected) * 100) / 100;

  state.zReports.push({
    id: genId(),
    expected,
    actual,
    difference,
    createdAt: new Date().toISOString()
  });

  logAudit("Gün sonu kasa sayımı yapıldı", `Beklenen: ${formatTL(expected)}, Sayılan: ${formatTL(actual)}, Fark: ${formatTL(difference)}`);
  save();
  actualInput.value = "";
  renderZReport();
  showToast(state.t("zReportSaved"), "success");
}

export function deleteZReport(id) {
  state.zReports = state.zReports.filter((z) => z.id !== id);
  save();
  renderZReport();
}

export function renderZReport() {
  const expectedEl = document.getElementById("zReportExpected");
  const historyEl = document.getElementById("zReportHistoryList");
  if (!expectedEl) return;

  expectedEl.textContent = formatTL(getExpectedCashToday());

  const sorted = [...(state.zReports || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  if (!sorted.length) {
    historyEl.innerHTML = "";
    return;
  }
  historyEl.innerHTML = sorted
    .map((z) => {
      const dateStr = new Date(z.createdAt).toLocaleString(locale());
      const diffColor = Math.abs(z.difference) < 0.01 ? "var(--green-text)" : "var(--red-text)";
      const diffLabel = z.difference > 0 ? "+" + formatTL(z.difference) : formatTL(z.difference);
      return `
        <div class="reminder-row">
          <div>
            <p class="reminder-name">${dateStr}</p>
            <p class="reminder-meta">${state.t("zReportExpectedShort")}: ${formatTL(z.expected)} · ${state.t("zReportActualShort")}: ${formatTL(z.actual)}</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-weight:700;color:${diffColor};">${diffLabel}</span>
            <button class="z-report-delete-btn" data-id="${z.id}" aria-label="Sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
          </div>
        </div>`;
    })
    .join("");

  historyEl.querySelectorAll(".z-report-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteZReport(btn.dataset.id));
  });
}

export function renderSales() {
    const list = document.getElementById("salesList");
    const empty = document.getElementById("salesEmptyState");
    const topList = document.getElementById("topProductsList");
    const topEmpty = document.getElementById("topProductsEmptyState");
    if (!list) return;
    renderZReport();

    const periodSales = state.sales.filter((s) => isInPeriod(s.timestamp, state.currentSalesPeriod));
    const sorted = [...periodSales].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (!sorted.length) {
      list.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      list.innerHTML = sorted.map(saleRowHtml).join("");
      list.querySelectorAll(".sale-cancel-btn").forEach((btn) => {
        btn.addEventListener("click", () => cancelSale(btn.dataset.id));
      });
      list.querySelectorAll(".sale-return-btn").forEach((btn) => {
        btn.addEventListener("click", () => openReturnModal(btn.dataset.id));
      });
    }

    // En çok satan ürünler
    const productTotals = {};
    periodSales.forEach((s) => {
      s.items.forEach((i) => {
        if (!productTotals[i.name]) productTotals[i.name] = { name: i.name, qty: 0, revenue: 0 };
        productTotals[i.name].qty += i.qty;
        productTotals[i.name].revenue += i.qty * i.price;
      });
    });
    const topProducts = Object.values(productTotals)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    if (!topProducts.length) {
      topList.innerHTML = "";
      topEmpty.style.display = "block";
    } else {
      topEmpty.style.display = "none";
      topList.innerHTML = topProducts.map((item, i) => topProductRowHtml(item, i + 1)).join("");
    }

    const periodTotal = periodSales.reduce((sum, s) => sum + s.total, 0);
    const periodProfit = periodSales.reduce((sum, s) => sum + (s.profit != null ? s.profit : s.total), 0);
    document.getElementById("statPeriodTotal").textContent = formatTL(periodTotal);
    document.getElementById("statPeriodCount").textContent = periodSales.length;
    const profitEl = document.getElementById("statNetProfit");
    if (profitEl) {
      profitEl.textContent = formatTL(periodProfit);
      const profitCard = profitEl.closest(".profit-highlight-card");
      if (profitCard) profitCard.classList.toggle("negative", periodProfit < 0);
    }

    const nakitTotal = periodSales.filter((s) => s.paymentType === "nakit" || !s.paymentType).reduce((sum, s) => sum + s.total, 0);
    const kartTotal = periodSales.filter((s) => s.paymentType === "kart").reduce((sum, s) => sum + s.total, 0);
    const veresiyeTotal = periodSales.filter((s) => s.paymentType === "veresiye").reduce((sum, s) => sum + s.total, 0);
    const breakdownNakitEl = document.getElementById("breakdownNakit");
    const breakdownKartEl = document.getElementById("breakdownKart");
    const breakdownVeresiyeEl = document.getElementById("breakdownVeresiye");
    if (breakdownNakitEl) breakdownNakitEl.textContent = formatTL(nakitTotal);
    if (breakdownKartEl) breakdownKartEl.textContent = formatTL(kartTotal);
    if (breakdownVeresiyeEl) breakdownVeresiyeEl.textContent = formatTL(veresiyeTotal);
  }