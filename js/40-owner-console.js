/**
 * İşletme sahibi (patron) yönetim paneli: yan menü, üst çubuk, Genel Bakış.
 *
 * Bu hesap yalnızca yönetmek ve şubeleri izlemek içindir: kasa, QR tara, sipariş
 * gibi günlük işlem sekmeleri yoktur. Şube filtresi ("Tüm şubeler" ya da tek şube)
 * Genel Bakış'taki kartları, grafikleri ve listeleri süzer.
 *
 * Grafikler saf HTML/CSS çubuklarıdır (kütüphane yok, çevrimdışı çalışır).
 * Farklı para birimindeki şubelerin tutarları karıştırılmaz: çubuklar para birimi
 * grubu içinde ölçeklenir.
 */

import { state } from './00-state.js';
import { logout } from './01-firebase-core.js';
import { escapeHtml, formatMoney, showPrompt, showToast } from './02-utils.js';
import { viewBranch } from './13-branches-chain.js';
import { switchTab } from './20-navigation.js';
import { chainTotals, criticalAlerts, moneyTotals, summarizeBranch } from './39-chain-dashboard.js';
import { formatCashTotals } from './29-mixed-payment.js';

export const OWNER_NAV = [
  { tab: "tab-owner-overview", icon: "fa-gauge-high", key: "ownerNavOverview" },
  { tab: "tab-branches", icon: "fa-code-branch", key: "ownerNavBranches" },
  { tab: "tab-owner-products", icon: "fa-box-open", key: "ownerNavProducts" },
  { tab: "tab-owner-stock", icon: "fa-warehouse", key: "ownerNavStock" },
  { tab: "tab-settings", icon: "fa-gear", key: "ownerNavSettings" }
];
export const OWNER_TABS = OWNER_NAV.map((n) => n.tab);

// ---------------- Saf fonksiyonlar ----------------

/** Şube filtresi: "all" ya da tek şube uid'si. */
export function filterBranches(branches, filter) {
  return !filter || filter === "all" ? branches : branches.filter((b) => b.uid === filter);
}

/** Saf: şube durumu. critical: tükenen oranı >= %20; attention: azalan/tükenen var; ok. */
export function branchStatus(s) {
  if (s.productCount && s.outCount / s.productCount >= 0.2) return "critical";
  if (s.outCount > 0 || s.lowCount > 0) return "attention";
  return "ok";
}

/** Saf: en çok azalan ürünler (qty/min oranı en düşük, tükenenler hariç). */
export function topLowProducts(branches, limit = 8) {
  const rows = [];
  branches.forEach((b) => {
    (b.products || []).forEach((p) => {
      const qty = Number(p.qty) || 0;
      const min = Number(p.min) || 0;
      if (qty > 0 && qty <= min) rows.push({ name: p.name, branch: b.branchName, qty, min, ratio: min ? qty / min : 1 });
    });
  });
  return rows.sort((a, b) => a.ratio - b.ratio || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Saf: tükenen ürünler, ürün adına göre gruplu → [{name, branches:[...]}]; en çok şubede tükenen önce. */
export function outOfStockProducts(branches, limit = 8) {
  const map = new Map();
  branches.forEach((b) => {
    (b.products || []).forEach((p) => {
      if ((Number(p.qty) || 0) <= 0) {
        const key = String(p.name).trim().toLowerCase();
        if (!map.has(key)) map.set(key, { name: p.name, branches: [] });
        map.get(key).branches.push(b.branchName);
      }
    });
  });
  return [...map.values()].sort((a, b) => b.branches.length - a.branches.length || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Saf: kaç farklı ürün en az bir şubede sipariş gerektiriyor (azalan/tükenen). */
export function needOrderCount(branches) {
  const names = new Set();
  branches.forEach((b) => {
    (b.products || []).forEach((p) => {
      if ((Number(p.qty) || 0) <= (Number(p.min) || 0)) names.add(String(p.name).trim().toLowerCase());
    });
  });
  return names.size;
}

/** Saf: şubelerin işlem günlüklerini birleştirir (en yeni önce). */
export function recentOperations(branches, limit = 8) {
  const rows = [];
  branches.forEach((b) => {
    (b.auditLog || []).forEach((e) => rows.push({ branch: b.branchName, ...e }));
  });
  return rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}

/**
 * Saf: çubuk uzunlukları. Para birimi grubu içinde en büyük değer %100 olur.
 * Dönüş: Map uid → yüzde (0-100)
 */
export function scaleBars(summaries, key) {
  const maxBy = {};
  summaries.forEach((s) => {
    maxBy[s.currency] = Math.max(maxBy[s.currency] || 0, Number(s[key]) || 0);
  });
  const out = new Map();
  summaries.forEach((s) => {
    const max = maxBy[s.currency];
    out.set(s.uid, max > 0 ? Math.round(((Number(s[key]) || 0) / max) * 100) : 0);
  });
  return out;
}

// ---------------- Kabuk (yan menü, üst çubuk) ----------------

function el(id) {
  return document.getElementById(id);
}

export function enterOwnerMode() {
  document.body.classList.add("owner-mode");
  el("ownerShell").style.display = "block";
  renderOwnerNav();
  const biz = state.businessName || state.t("ownerDefaultName");
  el("ownerBizName").textContent = biz;
  el("ownerBrandName").textContent = biz;
  el("ownerProfileEmail").textContent = (state.currentUser && state.currentUser.email) || "";
}

export function leaveOwnerMode() {
  document.body.classList.remove("owner-mode", "owner-menu-open");
  const shell = el("ownerShell");
  if (shell) shell.style.display = "none";
}

export function renderOwnerNav() {
  const nav = el("ownerNav");
  if (!nav) return;
  nav.innerHTML = OWNER_NAV.map(
    (n) => `<button type="button" class="owner-nav-btn" data-tab="${n.tab}"><i class="fa-solid ${n.icon}" aria-hidden="true"></i> <span>${escapeHtml(state.t(n.key))}</span></button>`
  ).join("");
  const active = document.querySelector(".tab-panel.active");
  markOwnerNav(active ? active.id : "");
}

export function markOwnerNav(tabId) {
  document.querySelectorAll(".owner-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
}

function closeDropdowns() {
  el("ownerBellMenu").style.display = "none";
  el("ownerProfileMenu").style.display = "none";
}

export function initOwnerConsole() {
  el("ownerNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".owner-nav-btn");
    if (!btn) return;
    document.body.classList.remove("owner-menu-open");
    switchTab(btn.dataset.tab);
  });
  el("ownerMenuBtn").addEventListener("click", () => document.body.classList.toggle("owner-menu-open"));
  el("ownerScrim").addEventListener("click", () => document.body.classList.remove("owner-menu-open"));
  el("ownerBell").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = el("ownerBellMenu").style.display === "none";
    closeDropdowns();
    el("ownerBellMenu").style.display = open ? "block" : "none";
  });
  el("ownerProfileBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = el("ownerProfileMenu").style.display === "none";
    closeDropdowns();
    el("ownerProfileMenu").style.display = open ? "block" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".owner-menu-wrap")) closeDropdowns();
  });
  el("ownerLogoutBtn").addEventListener("click", logout);
  el("ownerBranchFilter").addEventListener("change", () => {
    state.ownerBranchFilter = el("ownerBranchFilter").value;
    renderOwnerOverview(state.loadedBranches || []);
  });
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) switchTab(go.dataset.goto);
  });
  el("ownerBranchCards").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const branch = (state.loadedBranches || []).find((b) => b.uid === btn.dataset.uid);
    if (!branch) return;
    if (btn.dataset.act === "view") viewBranch(branch.uid, branch.branchName);
    if (btn.dataset.act === "loc") editBranchLocation(branch);
  });
}

// ---------------- Konum (şehir/semt) ----------------

export function getBranchLocation(uid) {
  const m = (state.branchMeta || {})[uid];
  return m && m.city ? m.city : "";
}

export function editBranchLocation(branch) {
  showPrompt(`${state.t("ownerLocationPrompt")} — ${branch.branchName}`, getBranchLocation(branch.uid)).then((value) => {
    if (value === null || value === undefined) return;
    const city = String(value).trim().slice(0, 60);
    state.branchMeta = { ...(state.branchMeta || {}), [branch.uid]: { ...((state.branchMeta || {})[branch.uid] || {}), city } };
    const ref = state.originalDocRef || state.docRef;
    if (ref) ref.set({ branchMeta: state.branchMeta }, { merge: true }).catch((e) => console.error("Konum kaydedilemedi", e));
    showToast(state.t("ownerLocationSaved"), "success");
    renderOwnerOverview(state.loadedBranches || []);
  });
}

// ---------------- Genel Bakış ----------------

function statCard(label, value, tone) {
  const color = tone === "red" ? "var(--red-text)" : tone === "amber" ? "var(--amber-text)" : "";
  return `<div class="owner-stat"><p class="owner-stat-label">${escapeHtml(label)}</p><p class="owner-stat-value" ${color ? `style="color:${color}"` : ""}>${escapeHtml(String(value))}</p></div>`;
}

function statusChip(status) {
  const key = { ok: "ownerStatusOk", attention: "ownerStatusAttention", critical: "ownerStatusCritical" }[status];
  return `<span class="owner-chip owner-chip-${status}">${escapeHtml(state.t(key))}</span>`;
}

function emptyLine(text) {
  return `<p class="empty-state" style="display:block;margin:6px 0;">${escapeHtml(text)}</p>`;
}

function fillBranchFilter(branches) {
  const sel = el("ownerBranchFilter");
  const current = state.ownerBranchFilter || "all";
  sel.innerHTML =
    `<option value="all">${escapeHtml(state.t("ownerAllBranches"))}</option>` +
    branches.map((b) => `<option value="${escapeHtml(b.uid)}">${escapeHtml(b.branchName)}</option>`).join("");
  sel.value = branches.some((b) => b.uid === current) ? current : "all";
  state.ownerBranchFilter = sel.value;
}

function renderBell(branches) {
  const alerts = criticalAlerts(branches.map((b) => summarizeBranch(b, state.currency)));
  const badge = el("ownerBellBadge");
  badge.style.display = alerts.length ? "flex" : "none";
  badge.textContent = alerts.length;
  const key = { out: "chainAlertOut", low: "chainAlertLow", nosales: "chainAlertNoSales" };
  el("ownerBellMenu").innerHTML = alerts.length
    ? alerts
        .map((a) => `<p class="owner-alert owner-alert-${a.severity}">${escapeHtml(state.t(key[a.type]).replace("{branch}", a.branch).replace("{n}", a.n))}</p>`)
        .join("")
    : `<p class="owner-alert">${escapeHtml(state.t("chainNoAlerts"))}</p>`;
}

export function renderOwnerOverview(allBranches) {
  if (!el("ownerStats")) return;
  fillBranchFilter(allBranches);
  renderBell(allBranches);
  const branches = filterBranches(allBranches, state.ownerBranchFilter);
  const list = branches.map((b) => summarizeBranch(b, state.currency));
  const t = chainTotals(list);

  // Stat kartları
  const pendingTransfers = (state.transfers || []).filter((x) => x.status === "pending").length;
  el("ownerStats").innerHTML =
    statCard(state.t("ownerStatBranches"), t.branches) +
    statCard(state.t("ownerStatProducts"), t.productCount) +
    statCard(state.t("ownerStatStockValue"), formatCashTotals(moneyTotals(list, "stockCost"))) +
    statCard(state.t("ownerStatCritical"), t.lowCount + t.outCount, t.outCount ? "red" : t.lowCount ? "amber" : "") +
    statCard(state.t("ownerStatPendingOrders"), needOrderCount(branches) + (pendingTransfers ? ` · ${pendingTransfers} ${state.t("ownerTransferShort")}` : ""));

  // Şube kartları
  el("ownerNoBranches").style.display = list.length ? "none" : "block";
  el("ownerBranchCards").innerHTML = list
    .map((s) => {
      const st = branchStatus(s);
      const loc = getBranchLocation(s.uid);
      return `<div class="owner-branch owner-branch-${st}">
        <div class="owner-branch-top"><p class="owner-branch-name">${escapeHtml(s.name)}</p>${statusChip(st)}</div>
        <p class="owner-branch-loc"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${loc ? escapeHtml(loc) : `<em>${escapeHtml(state.t("ownerNoLocation"))}</em>`}
          <button type="button" class="owner-link" data-act="loc" data-uid="${escapeHtml(s.uid)}" aria-label="${escapeHtml(state.t("ownerLocationPrompt"))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button></p>
        <div class="owner-branch-nums">
          <span><b>${s.productCount}</b> ${escapeHtml(state.t("ownerBranchProducts"))}</span>
          <span><b>${s.totalQty}</b> ${escapeHtml(state.t("ownerBranchStock"))}</span>
          <span style="color:var(--amber-text)"><b>${s.lowCount}</b> ${escapeHtml(state.t("ownerBranchLow"))}</span>
          <span style="color:var(--red-text)"><b>${s.outCount}</b> ${escapeHtml(state.t("ownerBranchOut"))}</span>
        </div>
        <p class="owner-branch-today">${escapeHtml(state.t("chainBranchToday"))}: ${formatMoney(s.todaySales, s.currency)}</p>
        <button type="button" class="btn btn-sm" data-act="view" data-uid="${escapeHtml(s.uid)}"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${escapeHtml(state.t("branchViewBtn"))}</button>
      </div>`;
    })
    .join("");

  // Grafik 1: stok durumu (normal / azalan / tükenen)
  el("ownerStockChart").innerHTML = list.length
    ? list
        .map((s) => {
          const total = s.productCount || 1;
          const ok = Math.max(0, s.productCount - s.lowCount - s.outCount);
          const pct = (n) => ((n / total) * 100).toFixed(1);
          return `<div class="owner-bar-row"><span class="owner-bar-label">${escapeHtml(s.name)}</span>
            <div class="owner-stack" title="${ok} / ${s.lowCount} / ${s.outCount}"><i class="owner-seg-ok" style="width:${pct(ok)}%"></i><i class="owner-seg-low" style="width:${pct(s.lowCount)}%"></i><i class="owner-seg-out" style="width:${pct(s.outCount)}%"></i></div></div>`;
        })
        .join("") +
      `<p class="owner-legend"><i class="owner-seg-ok"></i> ${escapeHtml(state.t("ownerLegendOk"))} <i class="owner-seg-low"></i> ${escapeHtml(state.t("chainLowCount"))} <i class="owner-seg-out"></i> ${escapeHtml(state.t("chainOutCount"))}</p>`
    : emptyLine(state.t("chainNoBranches"));

  // Grafik 2: performans (bu ay satış)
  const scale = scaleBars(list, "monthSales");
  el("ownerPerfChart").innerHTML = list.length
    ? list
        .map(
          (s) => `<div class="owner-bar-row"><span class="owner-bar-label">${escapeHtml(s.name)}</span>
            <div class="owner-track"><i class="owner-seg-perf" style="width:${scale.get(s.uid)}%"></i></div>
            <span class="owner-bar-value">${formatMoney(s.monthSales, s.currency)}</span></div>`
        )
        .join("")
    : emptyLine(state.t("chainNoBranches"));

  // Listeler
  const low = topLowProducts(branches);
  el("ownerLowList").innerHTML = low.length
    ? low
        .map((r) => `<div class="owner-line"><span>${escapeHtml(r.name)}<small> · ${escapeHtml(r.branch)}</small></span><b style="color:var(--amber-text)">${r.qty} / ${r.min}</b></div>`)
        .join("")
    : emptyLine(state.t("ownerNoneLow"));
  const out = outOfStockProducts(branches);
  el("ownerOutList").innerHTML = out.length
    ? out
        .map((r) => `<div class="owner-line"><span>${escapeHtml(r.name)}<small> · ${escapeHtml(r.branches.join(", "))}</small></span><b style="color:var(--red-text)">${r.branches.length}</b></div>`)
        .join("")
    : emptyLine(state.t("ownerNoneOut"));

  const pending = (state.transfers || []).filter((x) => x.status === "pending");
  el("ownerPendingTransfers").innerHTML = pending.length
    ? pending
        .slice(0, 8)
        .map((x) => `<div class="owner-line"><span>${escapeHtml(x.productName)}<small> · ${escapeHtml(x.fromName)} → ${escapeHtml(x.toName)}</small></span><b>${x.qty}</b></div>`)
        .join("")
    : emptyLine(state.t("ownerNoPendingTransfers"));

  const ops = recentOperations(branches);
  el("ownerRecentOps").innerHTML = ops.length
    ? ops
        .map((o) => {
          const when = new Date(o.timestamp).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          return `<div class="owner-line"><span>${escapeHtml(o.action)}<small> · ${escapeHtml(o.branch)} · ${escapeHtml(o.actor || "")}${o.details ? " · " + escapeHtml(o.details) : ""}</small></span><small>${escapeHtml(when)}</small></div>`;
        })
        .join("")
    : emptyLine(state.t("ownerNoRecent"));
}
