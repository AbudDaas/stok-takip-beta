import { state } from './00-state.js';
import { locale, save } from './01-firebase-core.js';
import { escapeHtml, formatTL, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';

/**
 * Katalogdan hesap oluşturan ama henüz onaylanmamış müşterileri listeler.
 * Bu müşteriler, onaylanana kadar kataloğu hiç göremiyor/sipariş veremiyor.
 */
export async function renderPendingCustomers() {
  const listEl = document.getElementById("pendingCustomersList");
  const emptyEl = document.getElementById("pendingCustomersEmptyState");
  if (!listEl || !state.db || !state.docRef) return;

  try {
    const snapshot = await state.db
      .collection("customerAccounts")
      .where("businessId", "==", state.docRef.id)
      .where("approved", "==", false)
      .get();

    if (snapshot.empty) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = snapshot.docs
      .map((doc) => {
        const c = doc.data();
        return `
          <div class="reminder-row">
            <div>
              <p class="reminder-name">${escapeHtml(c.name || c.email)}</p>
              <p class="reminder-meta">${escapeHtml(c.email)}</p>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm btn-primary approve-customer-btn" data-id="${doc.id}">${state.t("approveBtn")}</button>
              <button class="btn btn-sm btn-danger reject-customer-btn" data-id="${doc.id}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
          </div>`;
      })
      .join("");

    listEl.querySelectorAll(".approve-customer-btn").forEach((btn) => {
      btn.addEventListener("click", () => approveCustomer(btn.dataset.id));
    });
    listEl.querySelectorAll(".reject-customer-btn").forEach((btn) => {
      btn.addEventListener("click", () => rejectCustomer(btn.dataset.id));
    });
  } catch (err) {
    console.error("Bekleyen müşteriler yüklenemedi", err);
  }
}

export async function approveCustomer(customerId) {
  try {
    await state.db.collection("customerAccounts").doc(customerId).update({ approved: true });
    logAudit("Müşteri hesabı onaylandı", customerId);
    showToast(state.t("customerApproved"), "success");
    renderPendingCustomers();
  } catch (err) {
    console.error("Onaylanamadı", err);
    showToast(state.t("approvalFailed"), "error");
  }
}

export async function rejectCustomer(customerId) {
  if (!confirm(state.t("rejectCustomerConfirm"))) return;
  try {
    await state.db.collection("customerAccounts").doc(customerId).delete();
    logAudit("Müşteri hesabı reddedildi", customerId);
    renderPendingCustomers();
  } catch (err) {
    console.error("Reddedilemedi", err);
    showToast(state.t("approvalFailed"), "error");
  }
}

export function renderIncomingOrders() {
  const listEl = document.getElementById("incomingOrdersList");
  const emptyEl = document.getElementById("incomingOrdersEmptyState");
  if (!listEl) return;

  const orders = state.incomingOrders || [];

  const badgeEl = document.getElementById("incomingOrdersBadge");
  if (badgeEl) {
    const pendingCount = orders.filter((o) => o.status !== "tamamlandi").length;
    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount > 99 ? "99+" : String(pendingCount);
      badgeEl.style.display = "block";
    } else {
      badgeEl.style.display = "none";
    }
  }

  renderBlockedList();

  if (!orders.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  listEl.innerHTML = sorted
    .map((order) => {
      const dateStr = new Date(order.createdAt).toLocaleString(locale());
      const itemsStr = (order.items || []).map((it) => `${escapeHtml(it.name)} — ${it.qty} ${it.unit === "kg" ? "kg" : "adet"}`).join("<br>");
      const grandTotal = (order.productTotal || 0) + (order.deliveryFee || 0);
      const deliveryHtml =
        order.deliveryMode === "courier"
          ? `<p class="reminder-meta">🚚 ${state.t("incomingOrderCourier")}${order.distanceKm != null ? ` (~${order.distanceKm.toFixed(1)} km)` : ""} · ${formatTL(order.deliveryFee)}</p>` +
            (order.mapLink ? `<p class="reminder-meta"><a href="${escapeHtml(order.mapLink)}" target="_blank" rel="noopener">${state.t("incomingOrderMapLink")}</a></p>` : "") +
            (order.address ? `<p class="reminder-meta">${escapeHtml(order.address)}</p>` : "")
          : `<p class="reminder-meta">🏪 ${state.t("incomingOrderPickup")}</p>`;
      const statusBadgeClass = order.status === "tamamlandi" ? "status-yeterli" : "status-kritik";
      const statusLabel = order.status === "tamamlandi" ? state.t("incomingOrderDone") : state.t("incomingOrderNew");

      // Bu telefon numarasından daha önce kaç sipariş geldiğini göster —
      // "sürekli sipariş edip gelmeyen" birini fark edebilmen için.
      const sameNumberCount = orders.filter((o) => o.customerPhone === order.customerPhone).length;
      const repeatNote =
        sameNumberCount > 1 ? `<p class="reminder-meta" style="color:var(--amber-text);">⚠️ ${state.t("incomingOrderRepeatCount").replace("{n}", sameNumberCount)}</p>` : "";

      return `
        <div class="reminder-row" style="align-items:flex-start;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;width:100%;">
            <div>
              <p class="reminder-name">${escapeHtml(order.customerName)} · ${escapeHtml(order.customerPhone)}</p>
              <p class="reminder-meta">${dateStr}</p>
            </div>
            <span class="status-badge ${statusBadgeClass}">${statusLabel}</span>
          </div>
          ${repeatNote}
          <p class="reminder-meta">${itemsStr}</p>
          ${deliveryHtml}
          <p class="reminder-name" style="margin-top:4px;">${state.t("incomingOrderTotal")}: ${formatTL(grandTotal)}</p>
          <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">
            <button class="btn btn-sm order-whatsapp-btn" data-phone="${escapeHtml(order.customerPhone)}" style="flex:1;">
              <i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp
            </button>
            ${
              order.status !== "tamamlandi"
                ? `<button class="btn btn-sm btn-primary order-complete-btn" data-id="${order.id}" style="flex:1;">${state.t("incomingOrderMarkDone")}</button>`
                : ""
            }
            <button class="btn btn-sm btn-danger order-delete-btn" data-id="${order.id}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
          </div>
          <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">
            <button class="btn btn-sm order-block-phone-btn" data-phone="${escapeHtml(order.customerPhone)}" style="flex:1;color:var(--red-text);">
              <i class="fa-solid fa-ban" aria-hidden="true"></i> ${state.t("blockPhoneBtn")}
            </button>
            ${
              order.ip
                ? `<button class="btn btn-sm order-block-ip-btn" data-ip="${escapeHtml(order.ip)}" style="flex:1;color:var(--red-text);">
                     <i class="fa-solid fa-ban" aria-hidden="true"></i> ${state.t("blockIpBtn")}
                   </button>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".order-whatsapp-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cleanPhone = btn.dataset.phone.replace(/[^\d]/g, "");
      window.open(`https://wa.me/${cleanPhone}`, "_blank");
    });
  });
  listEl.querySelectorAll(".order-complete-btn").forEach((btn) => {
    btn.addEventListener("click", () => markOrderComplete(btn.dataset.id));
  });
  listEl.querySelectorAll(".order-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteIncomingOrder(btn.dataset.id));
  });
  listEl.querySelectorAll(".order-block-phone-btn").forEach((btn) => {
    btn.addEventListener("click", () => blockPhone(btn.dataset.phone));
  });
  listEl.querySelectorAll(".order-block-ip-btn").forEach((btn) => {
    btn.addEventListener("click", () => blockIp(btn.dataset.ip));
  });
}

export function markOrderComplete(orderId) {
  const order = (state.incomingOrders || []).find((o) => o.id === orderId);
  if (!order) return;
  order.status = "tamamlandi";
  logAudit("Sipariş tamamlandı olarak işaretlendi", order.customerName);
  save();
  renderIncomingOrders();

  // Müşteriye siparişinin hazır/tamamlandığını WhatsApp'tan bildir.
  const shouldNotify = confirm(state.t("notifyCustomerConfirm").replace("{name}", order.customerName));
  if (shouldNotify) {
    const cleanPhone = order.customerPhone.replace(/[^\d]/g, "");
    const message =
      order.deliveryMode === "courier"
        ? state.t("notifyCustomerCourierMsg")
        : state.t("notifyCustomerPickupMsg");
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, "_blank");
  }
}

export function deleteIncomingOrder(orderId) {
  state.incomingOrders = (state.incomingOrders || []).filter((o) => o.id !== orderId);
  save();
  renderIncomingOrders();
}

// ---------- Engelleme (telefon / IP) ----------

export function blockPhone(phone) {
  const normalized = (phone || "").replace(/[^\d]/g, "");
  if (!normalized) return;
  if (!confirm(state.t("blockPhoneConfirm").replace("{phone}", phone))) return;
  if (!state.blockedPhones.includes(normalized)) {
    state.blockedPhones.push(normalized);
    logAudit("Telefon numarası engellendi", phone);
    save();
  }
  renderBlockedList();
  showToast(state.t("blockedSuccess"), "success");
}

export function blockIp(ip) {
  if (!ip) return;
  if (!confirm(state.t("blockIpConfirm").replace("{ip}", ip))) return;
  if (!state.blockedIPs.includes(ip)) {
    state.blockedIPs.push(ip);
    logAudit("IP adresi engellendi", ip);
    save();
  }
  renderBlockedList();
  showToast(state.t("blockedSuccess"), "success");
}

export function unblockPhone(phone) {
  state.blockedPhones = state.blockedPhones.filter((p) => p !== phone);
  save();
  renderBlockedList();
}

export function unblockIp(ip) {
  state.blockedIPs = state.blockedIPs.filter((x) => x !== ip);
  save();
  renderBlockedList();
}

function renderBlockedList() {
  const container = document.getElementById("blockedListContainer");
  if (!container) return;

  const phones = state.blockedPhones || [];
  const ips = state.blockedIPs || [];

  if (!phones.length && !ips.length) {
    container.innerHTML = `<p class="card-subtitle" style="margin:0;">${state.t("noBlockedYet")}</p>`;
    return;
  }

  let html = "";
  phones.forEach((phone) => {
    html += `
      <div class="reminder-row">
        <p class="reminder-name">📵 ${escapeHtml(phone)}</p>
        <button class="btn btn-sm unblock-phone-btn" data-phone="${escapeHtml(phone)}">${state.t("unblockBtn")}</button>
      </div>`;
  });
  ips.forEach((ip) => {
    html += `
      <div class="reminder-row">
        <p class="reminder-name">🚫 ${escapeHtml(ip)}</p>
        <button class="btn btn-sm unblock-ip-btn" data-ip="${escapeHtml(ip)}">${state.t("unblockBtn")}</button>
      </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll(".unblock-phone-btn").forEach((btn) => {
    btn.addEventListener("click", () => unblockPhone(btn.dataset.phone));
  });
  container.querySelectorAll(".unblock-ip-btn").forEach((btn) => {
    btn.addEventListener("click", () => unblockIp(btn.dataset.ip));
  });
}