/**
 * Akıllı Ticaret ve Şube Asistanı (patron paneli).
 *
 * Tüm şubelerin satış ve stok verisinden şunları çıkarır:
 *  1. Hızlı tükenenler: şube bazında günlük satış hızı ve eğilim (son 7 gün / 30 gün).
 *  2. Yakında bitecekler: stok ÷ günlük hız ile kalan gün ve tahmini bitiş tarihi.
 *  3. Fazla / ölü stok: gereğinden çok bekleyen miktar ve bağlı sermaye (maliyet);
 *     bir şubede fazla, başka şubede az olan ürünler için TRANSFER önerisi.
 *  4. Tedarikçi / maliyet karşılaştırma: aynı ürünü şubelerin hangi tedarikçiden,
 *     hangi maliyetle aldığı; en ucuza göre aylık tasarruf potansiyeli.
 *  5. Maliyet değişiminin kâra etkisi: satış kayıtlarındaki alış maliyetinden
 *     (satış anında kaydedilir) son 30 gün ile önceki 30 gün karşılaştırılır.
 *
 * Sınırlar (dürüstçe): tahminler geçmiş satış hızına dayanır, mevsimsellik ve kampanya
 * hesaba katılmaz. Tedarikçi karşılaştırması, her şubenin ürüne tedarikçi atamış ve
 * maliyet girmiş olmasına bağlıdır; tedarikçilerin kendi fiyat listeleri sistemde yoktur.
 * Maliyet etkisi, satış kaydında alış maliyeti bulunan ürünler için hesaplanır.
 */

import { state } from './00-state.js';
import { escapeHtml, formatMoney } from './02-utils.js';
import { buildSalesIndex, soldQuantities, velocityFrom } from './28-order-planning.js';
import { formatCashTotals } from './29-mixed-payment.js';

const DAY_MS = 86400000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function keyOf(p) {
  return p.barcode ? "b:" + p.barcode : "n:" + String(p.name || "").trim().toLowerCase();
}

function round(n, d = 1) {
  const f = Math.pow(10, d);
  return Math.round(num(n) * f) / f;
}

/** Saf: şubenin ürün satırları (stok = raf + depo, hız, kalan gün). */
export function analyzeBranch(branch, now = Date.now()) {
  const index = buildSalesIndex(branch.sales || [], now);
  const supplierName = new Map((branch.suppliers || []).map((s) => [s.id, s.name]));
  return (branch.products || []).map((p) => {
    const stock = num(p.qty) + num(p.warehouseQty);
    const sold = soldQuantities(index, p);
    const { avgDaily, trend } = velocityFrom(sold.d7, sold.d30);
    return {
      branchUid: branch.uid,
      branchName: branch.branchName,
      currency: branch.currency || "TRY",
      productId: p.id,
      key: keyOf(p),
      name: p.name,
      unit: p.unit || "adet",
      stock,
      min: num(p.min),
      sold7: round(sold.d7, 3),
      sold30: round(sold.d30, 3),
      avgDaily,
      trend,
      daysLeft: avgDaily > 0 ? stock / avgDaily : Number.POSITIVE_INFINITY,
      costPrice: num(p.costPrice),
      price: num(p.price),
      supplier: p.supplierId ? supplierName.get(p.supplierId) || "" : ""
    };
  });
}

/** Saf: şube bazında en hızlı satanlar (günlük hız). */
export function fastMovers(rows, perBranch = 5) {
  const by = new Map();
  rows.filter((r) => r.avgDaily > 0).forEach((r) => {
    if (!by.has(r.branchUid)) by.set(r.branchUid, []);
    by.get(r.branchUid).push(r);
  });
  const out = [];
  by.forEach((list) => out.push(...list.sort((a, b) => b.avgDaily - a.avgDaily).slice(0, perBranch)));
  return out;
}

/** Saf: horizonDays içinde bitmesi beklenenler (talebi olan ürünler). Tahmini bitiş tarihi eklenir. */
export function runningOutSoon(rows, horizonDays = 7, now = Date.now()) {
  return rows
    .filter((r) => r.avgDaily > 0 && r.daysLeft <= horizonDays)
    .map((r) => ({ ...r, runOutDate: new Date(now + Math.max(0, r.daysLeft) * DAY_MS).toISOString() }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Saf: fazla stok. Hızı olan ürün için kalan gün > coverDays ise fazla = stok − hız×coverDays.
 * Son 30 günde hiç satılmayan, stoğu olan ürün "ölü stok" (tamamı fazla sayılır).
 */
export function overstock(rows, coverDays = 60) {
  const out = [];
  rows.forEach((r) => {
    if (r.stock <= 0) return;
    if (r.avgDaily > 0 && r.daysLeft > coverDays) {
      const excess = round(r.stock - r.avgDaily * coverDays, 3);
      out.push({ ...r, excess, dead: false, excessValue: excess * r.costPrice });
    } else if (r.avgDaily === 0 && r.sold30 === 0) {
      out.push({ ...r, excess: r.stock, dead: true, excessValue: r.stock * r.costPrice });
    }
  });
  return out.sort((a, b) => b.excessValue - a.excessValue || b.excess - a.excess);
}

/**
 * Saf: bir şubede fazla, başka şubede az olan aynı ürün için transfer önerisi.
 * Alıcı: kalan gün <= horizonDays (talebi var). İhtiyaç = hız × (horizonDays + 7) − stok.
 * Miktar = min(vericinin fazlası, alıcının ihtiyacı); adet ürünlerde yukarı değil AŞAĞI yuvarlanır.
 */
export function transferSuggestions(rows, { horizonDays = 7, coverDays = 60 } = {}) {
  const excessRows = overstock(rows, coverDays).filter((r) => r.excess > 0);
  const needy = rows.filter((r) => r.avgDaily > 0 && r.daysLeft <= horizonDays);
  const out = [];
  needy.forEach((to) => {
    const need = to.avgDaily * (horizonDays + 7) - to.stock;
    if (need <= 0) return;
    excessRows
      .filter((from) => from.key === to.key && from.branchUid !== to.branchUid)
      .forEach((from) => {
        let qty = Math.min(from.excess, need);
        qty = to.unit === "kg" ? Math.floor(qty * 10) / 10 : Math.floor(qty);
        if (qty > 0) out.push({ key: to.key, name: to.name, unit: to.unit, qty, from, to });
      });
  });
  return out.sort((a, b) => a.to.daysLeft - b.to.daysLeft);
}

/**
 * Saf: tedarikçi/maliyet karşılaştırma (aynı ürün, farklı şubelerde farklı maliyet).
 * Dönüş: [{name, best:{branchName,supplier,cost}, others:[{branchName,supplier,cost,extraPct,saving,currency}], totalSaving, currency}]
 * Yalnızca aynı para birimindeki şubeler karşılaştırılır.
 */
export function supplierComparison(rows) {
  const groups = new Map();
  rows
    .filter((r) => r.costPrice > 0)
    .forEach((r) => {
      const k = r.key + "|" + r.currency;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
  const out = [];
  groups.forEach((list) => {
    if (list.length < 2) return;
    const best = list.reduce((m, r) => (r.costPrice < m.costPrice ? r : m), list[0]);
    const others = list
      .filter((r) => r.costPrice > best.costPrice * 1.0001)
      .map((r) => ({
        branchName: r.branchName,
        supplier: r.supplier,
        cost: r.costPrice,
        extraPct: round(((r.costPrice - best.costPrice) / best.costPrice) * 100, 1),
        saving: round((r.costPrice - best.costPrice) * r.sold30, 2),
        currency: r.currency
      }));
    if (!others.length) return;
    out.push({
      name: best.name,
      currency: best.currency,
      best: { branchName: best.branchName, supplier: best.supplier, cost: best.costPrice },
      others,
      totalSaving: round(others.reduce((s, o) => s + o.saving, 0), 2)
    });
  });
  return out.sort((a, b) => b.totalSaving - a.totalSaving);
}

/**
 * Saf: maliyet değişiminin kâra etkisi (şube bazında).
 * Satış kalemlerindeki costPrice kullanılır: son 30 gün ve önceki 30 gün karşılaştırılır.
 * profitEffect = −(yeniMaliyet − eskiMaliyet) × son 30 gün satış adedi  (artış → negatif).
 * priceStale: maliyet arttı ama satış fiyatı aynı kaldı (marj düştü).
 */
export function costImpact(branch, now = Date.now(), minChangePct = 2) {
  const acc = new Map();
  (branch.sales || []).forEach((sale) => {
    const age = (now - new Date(sale.timestamp).getTime()) / DAY_MS;
    if (!(age >= 0) || age > 60) return;
    const period = age <= 30 ? "recent" : "prev";
    (sale.items || []).forEach((it) => {
      const qty = num(it.qty);
      const cost = num(it.costPrice);
      if (qty <= 0 || cost <= 0) return;
      const k = it.productId ? "id:" + it.productId : "n:" + String(it.name).trim().toLowerCase();
      if (!acc.has(k)) acc.set(k, { name: it.name, recent: { q: 0, c: 0, p: 0 }, prev: { q: 0, c: 0, p: 0 } });
      const e = acc.get(k)[period];
      e.q += qty;
      e.c += cost * qty;
      e.p += num(it.price) * qty;
    });
  });
  const out = [];
  acc.forEach((e) => {
    if (!e.recent.q || !e.prev.q) return;
    const prevCost = e.prev.c / e.prev.q;
    const newCost = e.recent.c / e.recent.q;
    const changePct = ((newCost - prevCost) / prevCost) * 100;
    if (Math.abs(changePct) < minChangePct) return;
    const prevPrice = e.prev.p / e.prev.q;
    const newPrice = e.recent.p / e.recent.q;
    out.push({
      branchUid: branch.uid,
      branchName: branch.branchName,
      currency: branch.currency || "TRY",
      name: e.name,
      prevCost: round(prevCost, 2),
      newCost: round(newCost, 2),
      changePct: round(changePct, 1),
      soldRecent: round(e.recent.q, 3),
      profitEffect: round(-(newCost - prevCost) * e.recent.q, 2),
      marginBefore: prevPrice > 0 ? round(((prevPrice - prevCost) / prevPrice) * 100, 1) : null,
      marginAfter: newPrice > 0 ? round(((newPrice - newCost) / newPrice) * 100, 1) : null,
      priceStale: changePct > 0 && newPrice <= prevPrice * 1.005
    });
  });
  return out.sort((a, b) => a.profitEffect - b.profitEffect);
}

// ---------------- Arayüz ----------------

const opts = { horizon: 7, cover: 60 };

function el(id) {
  return document.getElementById(id);
}

function t(key) {
  return state.t(key);
}

function fmtQty(r, v) {
  return `${round(v, 2)}${r.unit === "kg" ? " " + t("unitKgShort") : ""}`;
}

function line(left, right, sub) {
  return `<div class="owner-line"><span>${left}${sub ? `<small> · ${sub}</small>` : ""}</span><b>${right}</b></div>`;
}

function empty(key) {
  return `<p class="empty-state" style="display:block;margin:6px 0;">${escapeHtml(t(key))}</p>`;
}

function fill(tpl, vars) {
  return Object.keys(vars).reduce((s, k) => s.split("{" + k + "}").join(vars[k]), tpl);
}

export function renderAssistant(allBranches) {
  if (!el("assistantSummary")) return;
  const filter = state.ownerBranchFilter;
  const branches = !filter || filter === "all" ? allBranches : allBranches.filter((b) => b.uid === filter);
  const now = Date.now();
  // Karşılaştırmalar için tüm şubeler gerekir; diğer analizler filtreye uyar.
  const rowsAll = allBranches.flatMap((b) => analyzeBranch(b, now));
  const rows = branches.flatMap((b) => analyzeBranch(b, now));
  const inFilter = (r) => branches.some((b) => b.uid === r.branchUid);

  const soon = runningOutSoon(rows, opts.horizon, now);
  const over = overstock(rows, opts.cover);
  const transfers = transferSuggestions(rowsAll, { horizonDays: opts.horizon, coverDays: opts.cover }).filter((x) => inFilter(x.to) || inFilter(x.from));
  const compare = supplierComparison(rowsAll).filter((c) => c.others.length);
  const impacts = branches.flatMap((b) => costImpact(b, now));
  const fast = fastMovers(rows);

  // 1. Öneri özeti (en önemli 8 eylem)
  const actions = [];
  transfers.slice(0, 3).forEach((x) =>
    actions.push(fill(t("asstActTransfer"), { qty: fmtQty(x.to, x.qty), name: x.name, from: x.from.branchName, to: x.to.branchName }))
  );
  soon.slice(0, 3).forEach((r) =>
    actions.push(fill(t("asstActSoon"), { name: r.name, branch: r.branchName, days: Math.max(0, Math.ceil(r.daysLeft)) }))
  );
  impacts
    .filter((x) => x.priceStale)
    .slice(0, 2)
    .forEach((x) => actions.push(fill(t("asstActPrice"), { name: x.name, branch: x.branchName, pct: x.changePct })));
  if (compare[0]) {
    actions.push(fill(t("asstActSupplier"), { name: compare[0].name, branch: compare[0].best.branchName, saving: formatMoney(compare[0].totalSaving, compare[0].currency) }));
  }
  if (over[0]) actions.push(fill(t("asstActOverstock"), { name: over[0].name, branch: over[0].branchName, value: formatMoney(over[0].excessValue, over[0].currency) }));
  el("assistantSummary").innerHTML = actions.length
    ? actions.slice(0, 8).map((a) => `<p class="owner-alert">💡 ${escapeHtml(a)}</p>`).join("")
    : empty("asstNoActions");

  // 2. Hızlı tükenenler
  el("assistantFast").innerHTML = fast.length
    ? fast
        .map((r) => {
          const trendTxt = r.trend && r.trend >= 1.3 ? ` ▲ ${t("asstAccelerating")}` : r.trend && r.trend <= 0.7 ? ` ▼ ${t("asstSlowing")}` : "";
          return line(escapeHtml(r.name), `${fmtQty(r, r.avgDaily)}/${t("asstPerDay")}`, `${escapeHtml(r.branchName)}${escapeHtml(trendTxt)}`);
        })
        .join("")
    : empty("asstNoData");

  // 3. Yakında bitecekler
  el("assistantSoon").innerHTML = soon.length
    ? soon
        .slice(0, 15)
        .map((r) => {
          const days = Math.max(0, Math.ceil(r.daysLeft));
          const date = new Date(r.runOutDate).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
          const color = days <= 2 ? "var(--red-text)" : "var(--amber-text)";
          return line(escapeHtml(r.name), `<span style="color:${color}">${days} ${t("asstDays")}</span>`, `${escapeHtml(r.branchName)} · ${fmtQty(r, r.stock)} · ~${escapeHtml(date)}`);
        })
        .join("")
    : empty("asstNoneSoon");

  // 4. Fazla stok + transfer önerileri
  const overTotals = {};
  over.forEach((r) => (overTotals[r.currency] = (overTotals[r.currency] || 0) + r.excessValue));
  el("assistantOver").innerHTML =
    (over.length ? `<p class="card-subtitle">${escapeHtml(t("asstOverCapital"))}: <b>${escapeHtml(formatCashTotals(overTotals))}</b></p>` : "") +
    (over.length
      ? over
          .slice(0, 15)
          .map((r) =>
            line(
              escapeHtml(r.name) + (r.dead ? ` <span class="owner-chip owner-chip-attention">${escapeHtml(t("asstDead"))}</span>` : ""),
              escapeHtml(formatMoney(r.excessValue, r.currency)),
              `${escapeHtml(r.branchName)} · ${t("asstStock")} ${fmtQty(r, r.stock)} · ${t("asstExcess")} ${fmtQty(r, r.excess)}`
            )
          )
          .join("")
      : empty("asstNoneOver"));
  el("assistantTransfers").innerHTML = transfers.length
    ? transfers
        .slice(0, 12)
        .map((x) => line(escapeHtml(x.name), fmtQty(x.to, x.qty), `${escapeHtml(x.from.branchName)} → ${escapeHtml(x.to.branchName)} · ${t("asstLeftDays").replace("{d}", Math.ceil(x.to.daysLeft))}`))
        .join("")
    : empty("asstNoneTransfer");

  // 5. Tedarikçi / maliyet karşılaştırma
  el("assistantSupplier").innerHTML = compare.length
    ? compare
        .slice(0, 12)
        .map((c) => {
          const bestTxt = `${c.best.branchName}${c.best.supplier ? " (" + c.best.supplier + ")" : ""}: ${formatMoney(c.best.cost, c.currency)}`;
          const rest = c.others
            .map((o) => `${o.branchName}${o.supplier ? " (" + o.supplier + ")" : ""}: ${formatMoney(o.cost, c.currency)} (+%${o.extraPct})`)
            .join(" · ");
          return line(escapeHtml(c.name), `${escapeHtml(t("asstSaving"))} ${escapeHtml(formatMoney(c.totalSaving, c.currency))}`, `${t("asstCheapest")}: ${escapeHtml(bestTxt)} · ${escapeHtml(rest)}`);
        })
        .join("")
    : empty("asstNoneSupplier");

  // 6. Maliyet değişimi etkisi
  const profitTotals = {};
  impacts.forEach((x) => (profitTotals[x.currency] = (profitTotals[x.currency] || 0) + x.profitEffect));
  el("assistantCost").innerHTML = impacts.length
    ? `<p class="card-subtitle">${escapeHtml(t("asstProfitEffect"))}: <b>${escapeHtml(formatCashTotals(profitTotals))}</b></p>` +
      impacts
        .slice(0, 15)
        .map((x) => {
          const color = x.profitEffect < 0 ? "var(--red-text)" : "var(--green-text)";
          const margin = x.marginBefore !== null && x.marginAfter !== null ? ` · ${t("asstMargin")} %${x.marginBefore} → %${x.marginAfter}` : "";
          const stale = x.priceStale ? ` · ⚠️ ${t("asstPriceStale")}` : "";
          return line(
            escapeHtml(x.name),
            `<span style="color:${color}">${escapeHtml(formatMoney(x.profitEffect, x.currency))}</span>`,
            `${escapeHtml(x.branchName)} · ${escapeHtml(formatMoney(x.prevCost, x.currency))} → ${escapeHtml(formatMoney(x.newCost, x.currency))} (${x.changePct > 0 ? "+" : ""}${x.changePct}%)${escapeHtml(margin)}${escapeHtml(stale)}`
          );
        })
        .join("")
    : empty("asstNoneCost");
}

export function initAssistant() {
  const rerender = () => {
    opts.horizon = Number(el("assistantHorizon").value) || 7;
    opts.cover = Number(el("assistantCover").value) || 60;
    renderAssistant(state.loadedBranches || []);
  };
  el("assistantHorizon").addEventListener("change", rerender);
  el("assistantCover").addEventListener("change", rerender);
}
