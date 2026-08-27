import { state } from './00-state.js';
import { escapeHtml, getStatus } from './02-utils.js';
import { renderAuditLog, renderOwnerPinStatus, renderStaffList } from './03-staff-roles.js';
import { renderFiscalSettings } from './04-fiscal.js';
import { openModal, orderListRowHtml, populateNewProductSupplierSelect, productRowHtml, selfSourceRowHtml, toggleNeedsAlternativeSource, translateMissingProductNames } from './05-products.js';
import { renderCustomers } from './06-veresiye.js';
import { renderGiftCards } from './23-giftcards.js';
import { renderCart, stopScan, stopScanKasa } from './07-kasa-checkout.js';
import { renderSales } from './08-sales-returns.js';
import { renderSuppliers } from './09-suppliers.js';
import { renderExpenses } from './21-expenses.js';
import { renderIncomingOrders, renderPendingCustomers } from './24-incoming-orders.js';
import { renderReminders } from './10-reminders.js';
import { renderBreadStatus, renderPriceChanges } from './11-bread-orders.js';
import { loadBranches, renderCatalogList } from './13-branches-chain.js';
import { renderAiPanel } from './17-ai-panel.js';
import { loadAutoBackups, renderBrandIdentitySettings, renderDataSize, renderDeliverySettings, renderLoyaltySettings, renderPublicCatalogSettings, renderScaleBarcodeSettings } from './18-settings-backup.js';

export function renderAll() {
    const searchEl = document.getElementById("searchBox");
    const search = (searchEl ? searchEl.value : "").toLowerCase().trim();
    const list = document.getElementById("productList");
    const empty = document.getElementById("emptyState");

    const filtered = state.products.filter((p) => p.name.toLowerCase().includes(search) || p.category.toLowerCase().includes(search));

    if (!filtered.length) {
      list.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      list.innerHTML = filtered.map(productRowHtml).join("");
    }

    list.querySelectorAll(".product-row").forEach((row) => {
      row.addEventListener("click", () => openModal(row.dataset.id));
    });

    // Order list
    const orderList = document.getElementById("orderList");
    const orderEmpty = document.getElementById("orderEmptyState");
    const supplierFilterEl = document.getElementById("orderListSupplierFilter");
    if (supplierFilterEl) {
      const currentFilterValue = supplierFilterEl.value;
      supplierFilterEl.innerHTML =
        `<option value="">${state.t("orderFilterAll")}</option>` +
        state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
      supplierFilterEl.value = currentFilterValue;
    }
    const selectedSupplierFilter = supplierFilterEl ? supplierFilterEl.value : "";

    const needsOrder = state.products
      .filter((p) => getStatus(p) !== "yeterli")
      .filter((p) => !selectedSupplierFilter || p.supplierId === selectedSupplierFilter)
      .sort((a, b) => (getStatus(a) === "tukendi" ? 0 : 1) - (getStatus(b) === "tukendi" ? 0 : 1));

    if (!needsOrder.length) {
      orderList.innerHTML = "";
      orderEmpty.style.display = "block";
    } else {
      orderEmpty.style.display = "none";
      orderList.innerHTML = needsOrder.map(orderListRowHtml).join("");
      orderList.querySelectorAll(".product-row").forEach((row) => {
        row.addEventListener("click", () => openModal(row.dataset.id));
      });
      orderList.querySelectorAll(".alt-source-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleNeedsAlternativeSource(btn.dataset.id);
        });
      });
    }

    // "Kendim Temin Edeceğim Ürünler" — tedarikçisi olmayan VEYA
    // "Başka Yerden Bulunmalı" işaretlenmiş, sipariş gereken ürünler.
    const selfSourceList = document.getElementById("selfSourceList");
    const selfSourceEmpty = document.getElementById("selfSourceEmptyState");
    const selfSourcePrintBtn = document.getElementById("selfSourcePrintBtn");
    if (selfSourceList) {
      const selfSourceItems = state.products
        .filter((p) => getStatus(p) !== "yeterli")
        .filter((p) => !p.supplierId || p.needsAlternativeSource)
        .sort((a, b) => (getStatus(a) === "tukendi" ? 0 : 1) - (getStatus(b) === "tukendi" ? 0 : 1));

      if (!selfSourceItems.length) {
        selfSourceList.innerHTML = "";
        selfSourceEmpty.style.display = "block";
        if (selfSourcePrintBtn) selfSourcePrintBtn.style.display = "none";
      } else {
        selfSourceEmpty.style.display = "none";
        if (selfSourcePrintBtn) selfSourcePrintBtn.style.display = "block";
        selfSourceList.innerHTML = selfSourceItems.map(selfSourceRowHtml).join("");
        selfSourceList.querySelectorAll(".product-row").forEach((row) => {
          row.addEventListener("click", () => openModal(row.dataset.id));
        });
      }
    }

    document.getElementById("statTotal").textContent = state.products.length;
    document.getElementById("statOrder").textContent = needsOrder.length;

    renderCart();
    renderSales();
    renderCustomers();
    renderGiftCards();
    renderReminders();
    renderSuppliers();
    populateNewProductSupplierSelect();
    renderExpenses();
    renderIncomingOrders();
    renderPendingCustomers();
    renderPublicCatalogSettings();
    renderLoyaltySettings();
    renderScaleBarcodeSettings();
    renderDeliverySettings();
    renderBrandIdentitySettings();
    renderBreadStatus();
    renderPriceChanges();
    renderAuditLog();
    renderStaffList();
    renderOwnerPinStatus();
    renderDataSize();
    renderFiscalSettings();
    renderAiPanel();
    translateMissingProductNames();
  }

export function switchTab(tabId) {
    document.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    if (tabId !== "tab-scan" && state.scanning) stopScan();
    if (tabId !== "tab-kasa" && state.scanningKasa) stopScanKasa();
    if (tabId === "tab-branches" && !state.viewingBranchUid) {
      loadBranches();
      renderCatalogList();
    }
    if (tabId === "tab-settings") {
      loadAutoBackups();
    }
  }