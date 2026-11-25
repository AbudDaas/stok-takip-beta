/**
 * Merkez (patron) ana ekranı: tüm şubelerin genel durumu.
 *
 *  - Şube özeti: ürün çeşidi, toplam stok, azalan, tükenen, bugünkü satış.
 *  - İsteğe bağlı finans: stok değeri (maliyet/satış), bu ay kâr, gider, satın alma, net.
 *    (Ayar patron belgesinde saklanır: chainShowFinance.)
 *  - Kritik uyarılar: tükenen/azalan ürünü olan şubeler, öğleden sonra hâlâ satışı olmayan şube.
 *  - Şubeler arası stok karşılaştırma tablosu (ürün × şube).
 * Para tutarları şubenin kendi para biriminde tutulur; farklı birimler karıştırılmaz,
 * toplamlar para birimi bazında yazılır (örn. "1.200 $ + 3.500.000 ل.س").
 */

import { state } from './00-state.js';
import { escapeHtml, formatMoney } from './02-utils.js';
import { formatCashTotals } from './29-mixed-payment.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function inMonth(ts, now) {
  const d = new Date(ts);
  const n = new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

/** Saf: tek şubenin özeti. */
export function summarizeBranch(branch, fallbackCurrency = "TRY", now = Date.now()) {
  const products = branch.products || [];
  const sales = branch.sales || [];
  const s = {
    uid: branch.uid,
    name: branch.branchName,
    currency: branch.currency || fallbackCurrency,
    productCount: products.length,
    totalQty: 0,
    lowCount: 0,
    outCount: 0,
    lowItems: [],
    outItems: [],
    stockCost: 0,
    stockRetail: 0,
    todaySales: 0,
    monthSales: 0,
    monthProfit: 0,
    monthExpenses: 0,
    monthPurchases: 0
  };
  products.forEach((p) => {
    const qty = num(p.qty);
    const min = num(p.min);
    s.totalQty += Math.max(0, qty);
    if (qty <= 0) {
      s.outCount++;
      s.outItems.push(p.name);
    } else if (qty <= min) {
      s.lowCount++;
      s.lowItems.push(p.name);
    }
    s.stockCost += Math.max(0, qty) * num(p.costPrice);
    s.stockRetail += Math.max(0, qty) * num(p.price);
  });
  const dayStart = startOfDay(now).getTime();
  sales.forEach((x) => {
    const t = new Date(x.timestamp).getTime();
    if (t >= dayStart) s.todaySales += num(x.total);
    if (inMonth(x.timestamp, now)) {
      s.monthSales += num(x.total);
      s.monthProfit += x.profit != null ? num(x.profit) : num(x.total);
    }
  });
  (branch.expenses || []).forEach((e) => {
    if (inMonth(e.timestamp, now)) s.monthExpenses += num(e.amount);
  });
  (branch.supplierTransactions || []).forEach((t) => {
    if (t.type === "debt" && inMonth(t.timestamp, now)) s.monthPurchases += num(t.amount);
  });
  s.totalQty = Math.round(s.totalQty * 1000) / 1000;
  return s;
}

/** Saf: para alanını para birimi bazında toplar → { TRY: 100, USD: 5 } */
export function moneyTotals(summaries, key) {
  const out = {};
  summaries.forEach((s) => {
    out[s.currency] = (out[s.currency] || 0) + num(s[key]);
  });
  return out;
}

/** Saf: tüm şubelerin sayısal toplamları. */
export function chainTotals(summaries) {
  const sum = (k) => summaries.reduce((a, s) => a + num(s[k]), 0);
  return {
    branches: summaries.length,
    productCount: sum("productCount"),
    totalQty: Math.round(sum("totalQty") * 1000) / 1000,
    lowCount: sum("lowCount"),
    outCount: sum("outCount")
  };
}

/**
 * Saf: kritik uyarılar. type: "out" | "low" | "nosales"; severity: "high" | "normal"
 * Tükenen oranı %20 ve üzeriyse "high". Öğleden sonra (>=14:00) hiç satışı olmayan,
 * ürünü bulunan şube için "nosales".
 */
export function criticalAlerts(summaries, now = Date.now()) {
  const alerts = [];
  const hour = new Date(now).getHours();
  summaries.forEach((s) => {
    if (s.outCount > 0) {
      alerts.push({ type: "out", severity: s.productCount && s.outCount / s.productCount >= 0.2 ? "high" : "normal", branch: s.name, n: s.outCount });
    }
    if (s.lowCount > 0) alerts.push({ type: "low", severity: "normal", branch: s.name, n: s.lowCount });
    if (hour >= 14 && s.productCount > 0 && s.todaySales === 0) alerts.push({ type: "nosales", severity: "normal", branch: s.name, n: 0 });
  });
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

function normName(n) {
  return String(n || "").trim().toLowerCase();
}

/**
 * Saf: ürün × şube stok tablosu.
 * Anahtar: barkod (varsa), yoksa küçük harfli ad. Dönüş satırları:
 *  { key, name, perBranch: {uid: {qty, min}}, total, problem }
 * Sorunlu (herhangi bir şubede tükenen/azalan) satırlar önce gelir.
 */
export function compareStock(branches, { query = "", onlyProblem = false } = {}) {
  const rows = new Map();
  branches.forEach((b) => {
    (b.products || []).forEach((p) => {
      const key = p.barcode ? "b:" + p.barcode : "n:" + normName(p.name);
      if (!rows.has(key)) rows.set(key, { key, name: p.name, perBranch: {}, total: 0, problem: false });
      const r = rows.get(key);
      const qty = num(p.qty);
      const min = num(p.min);
      r.perBranch[b.uid] = { qty, min };
      r.total += Math.max(0, qty);
      if (qty <= min) r.problem = true;
    });
  });
  const q = normName(query);
  let list = [...rows.values()].filter((r) => !q || normName(r.name).includes(q));
  if (onlyProblem) list = list.filter((r) => r.problem);
  list.forEach((r) => (r.total = Math.round(r.total * 1000) / 1000));
  return list.sort((a, b) => (a.problem === b.problem ? a.name.localeCompare(b.name) : a.problem ? -1 : 1));
}

// ---------------- Arayüz ----------------

function el(id) {
  return document.getElementById(id);
}

function tile(label, value) {
  return `<div class="stat-card"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(String(value))}</p></div>`;
}

function persistFinance() {
  const ref = state.originalDocRef || state.docRef;
  if (ref) ref.set({ chainShowFinance: Boolean(state.chainShowFinance) }, { merge: true }).catch((e) => console.error("Merkez ayarı kaydedilemedi", e));
}

export function toggleChainFinance() {
  state.chainShowFinance = el("chainFinanceCheck").checked;
  persistFinance();
  renderChainDashboard(state.loadedBranches || []);
}

function summaries(branches) {
  return branches.map((b) => summarizeBranch(b, state.currency));
}

export function renderChainDashboard(branches) {
  const card = el("chainDashCard");
  if (!card) return;
  const list = summaries(branches);
  const finance = Boolean(state.chainShowFinance);
  el("chainFinanceCheck").checked = finance;
  const t = chainTotals(list);
  const money = (key) => formatCashTotals(moneyTotals(list, key));
  let tiles =
    tile(state.t("chainTotalProducts"), t.productCount) +
    tile(state.t("chainTotalQty"), t.totalQty.toLocaleString("en-US")) +
    tile(state.t("chainLowCount"), t.lowCount) +
    tile(state.t("chainOutCount"), t.outCount) +
    tile(state.t("chainTodaySales"), money("todaySales"));
  if (finance) {
    const profit = moneyTotals(list, "monthProfit");
    const expenses = moneyTotals(list, "monthExpenses");
    const net = {};
    Object.keys({ ...profit, ...expenses }).forEach((c) => (net[c] = (profit[c] || 0) - (expenses[c] || 0)));
    tiles +=
      tile(state.t("chainStockCost"), money("stockCost")) +
      tile(state.t("chainStockRetail"), money("stockRetail")) +
      tile(state.t("chainMonthProfit"), money("monthProfit")) +
      tile(state.t("chainMonthExpenses"), money("monthExpenses")) +
      tile(state.t("chainMonthPurchases"), money("monthPurchases")) +
      tile(state.t("chainMonthNet"), formatCashTotals(net));
  }
  el("chainTotals").innerHTML = tiles;

  const alerts = criticalAlerts(list);
  const alertKey = { out: "chainAlertOut", low: "chainAlertLow", nosales: "chainAlertNoSales" };
  el("chainAlerts").innerHTML = alerts.length
    ? alerts
        .map((a) => {
          const text = state.t(alertKey[a.type]).replace("{branch}", a.branch).replace("{n}", a.n);
          const color = a.severity === "high" ? "var(--red-text)" : "var(--amber-text)";
          return `<p class="card-subtitle" style="color:${color};font-weight:600;">⚠️ ${escapeHtml(text)}</p>`;
        })
        .join("")
    : `<p class="card-subtitle">${escapeHtml(state.t("chainNoAlerts"))}</p>`;

  el("chainBranchCards").innerHTML = list.length
    ? list
        .map((s) => {
          const line = state.t("chainBranchLine").replace("{p}", s.productCount).replace("{q}", s.totalQty).replace("{low}", s.lowCount).replace("{out}", s.outCount);
          const fin = finance
            ? `<p class="branch-meta">${escapeHtml(state.t("chainStockCost"))}: ${formatMoney(s.stockCost, s.currency)} · ${escapeHtml(state.t("chainMonthProfit"))}: ${formatMoney(s.monthProfit, s.currency)}</p>`
            : "";
          return `<div class="branch-row"><div class="branch-info"><p class="branch-name">${escapeHtml(s.name)}</p><p class="branch-meta">${escapeHtml(line)}</p><p class="branch-meta">${escapeHtml(state.t("chainBranchToday"))}: ${formatMoney(s.todaySales, s.currency)}</p>${fin}</div></div>`;
        })
        .join("")
    : `<p class="empty-state">${escapeHtml(state.t("chainNoBranches"))}</p>`;

  renderStockCompare(branches);
}

export function renderStockCompare(branches = state.loadedBranches || []) {
  const holder = el("chainCompareTable");
  if (!holder) return;
  const rows = compareStock(branches, { query: el("chainCompareSearch").value, onlyProblem: el("chainCompareFilter").value === "problem" });
  if (!rows.length) {
    holder.innerHTML = `<p class="empty-state">${escapeHtml(state.t("chainCompareEmpty"))}</p>`;
    return;
  }
  const head = branches.map((b) => `<th style="padding:6px 8px;text-align:center;white-space:nowrap;">${escapeHtml(b.branchName)}</th>`).join("");
  const body = rows
    .slice(0, 200)
    .map((r) => {
      const cells = branches
        .map((b) => {
          const c = r.perBranch[b.uid];
          if (!c) return `<td style="padding:6px 8px;text-align:center;color:var(--text-muted);">—</td>`;
          const color = c.qty <= 0 ? "var(--red-text)" : c.qty <= c.min ? "var(--amber-text)" : "";
          return `<td style="padding:6px 8px;text-align:center;font-weight:600;${color ? "color:" + color + ";" : ""}">${c.qty}</td>`;
        })
        .join("");
      return `<tr><td style="padding:6px 8px;">${escapeHtml(r.name)}</td>${cells}<td style="padding:6px 8px;text-align:center;font-weight:700;">${r.total}</td></tr>`;
    })
    .join("");
  holder.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="padding:6px 8px;text-align:start;">${escapeHtml(state.t("chainCompareProduct"))}</th>${head}<th style="padding:6px 8px;">${escapeHtml(state.t("chainCompareTotal"))}</th></tr></thead><tbody>${body}</tbody></table>`;
}
