/**
 * Veresiye ekstresi: müşterinin borç/ödeme hareketlerini yürüyen bakiyeyle
 * metne döker ve WhatsApp ile paylaşır.
 *
 * Her hareket kendi para biriminde yazılır (satışlar `currency` taşır; ödeme
 * kayıtlarında birim yoksa işletme birimi varsayılır). Bakiye, yalnızca
 * hepsi aynı birimdeyse yürüyen toplam olarak gösterilir.
 */

import { state } from './00-state.js';
import { formatMoney, showToast } from './02-utils.js';
import { getCustomerDebt } from './06-veresiye.js';

/** Saf: hareketleri tarihe göre dizip yürüyen bakiyeyi hesaplar (eskiden yeniye). */
export function buildStatementEntries(sales, payments, customerId, fallbackCurrency) {
  const debts = (sales || [])
    .filter((s) => s.paymentType === "veresiye" && s.customerId === customerId)
    .map((s) => ({ type: "debt", timestamp: s.timestamp, amount: Number(s.total) || 0, currency: s.currency || fallbackCurrency }));
  const pays = (payments || [])
    .filter((p) => p.customerId === customerId)
    .map((p) => ({ type: "payment", timestamp: p.timestamp, amount: Number(p.amount) || 0, currency: p.currency || fallbackCurrency }));
  const all = [...debts, ...pays].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const single = new Set(all.map((e) => e.currency)).size <= 1;
  let balance = 0;
  return all.map((e) => {
    balance += e.type === "debt" ? e.amount : -e.amount;
    return { ...e, balance: single ? balance : null };
  });
}

/** Saf: WhatsApp'a gidecek ekstre metni (son `limit` hareket). */
export function buildStatementText({ name, entries, debt, currency, labels, dateFmt, limit = 15 }) {
  const lines = [`${labels.title} - ${name}`, ""];
  entries.slice(-limit).forEach((e) => {
    const sign = e.type === "debt" ? "+" : "-";
    const kind = e.type === "debt" ? labels.debt : labels.payment;
    const bal = e.balance === null ? "" : ` → ${formatMoney(Math.max(0, e.balance), e.currency)}`;
    lines.push(`${dateFmt(e.timestamp)} ${kind} ${sign}${formatMoney(e.amount, e.currency)}${bal}`);
  });
  lines.push("", `${labels.balance}: ${formatMoney(debt, currency)}`);
  return lines.join("\n");
}

export function sendCustomerStatement() {
  const c = state.customers.find((x) => x.id === state.activeCustomerId);
  if (!c) return;
  const cleanPhone = String(c.phone || "").replace(/[^\d]/g, "");
  if (!cleanPhone) {
    showToast(state.t("statementNoPhone"), "error");
    return;
  }
  const text = buildStatementText({
    name: c.name,
    entries: buildStatementEntries(state.sales, state.payments, c.id, state.currency),
    debt: getCustomerDebt(c.id),
    currency: state.currency,
    labels: { title: state.t("statementTitle"), debt: state.t("statementDebt"), payment: state.t("statementPayment"), balance: state.t("currentBalance") },
    dateFmt: (ts) => new Date(ts).toLocaleDateString()
  });
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, "_blank");
}
