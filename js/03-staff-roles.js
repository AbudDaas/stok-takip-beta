import { state } from './00-state.js';
import { locale, save } from './01-firebase-core.js';
import { escapeHtml, genId, showToast } from './02-utils.js';
import { reapplySimpleModeIfSet } from './18-settings-backup.js';
import { switchTab } from './20-navigation.js';

export function applyAccountTypeUI() {
    const isAdminUser = state.currentUser && state.currentUser.uid === state.ADMIN_UID;
    const isPatron = state.accountType === "patron";
    const operationalTabs = ["tab-products", "tab-kasa", "tab-scan", "tab-sales", "tab-veresiye", "tab-orders", "tab-pricechanges"];

    // Yönetici (sen) her zaman her şeyi görür.
    if (isAdminUser) {
      operationalTabs.forEach((tabId) => {
        const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
        if (btn) btn.style.display = "flex";
      });
      const branchesBtn = document.getElementById("branchesNavBtn");
      if (branchesBtn) branchesBtn.style.display = "flex";
      return;
    }

    // Bir şubeyi görüntülerken, o şubenin tam ekranını göster (kısıtlama uygulama).
    if (state.viewingBranchUid) {
      operationalTabs.forEach((tabId) => {
        const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
        if (btn) btn.style.display = "flex";
      });
      return;
    }

    // Patron hesabı: sadece Ayarlar + Şubelerim görünür.
    if (isPatron) {
      operationalTabs.forEach((tabId) => {
        const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
        if (btn) btn.style.display = "none";
      });
      const branchesBtn = document.getElementById("branchesNavBtn");
      if (branchesBtn) branchesBtn.style.display = "flex";
      switchTab("tab-branches");
      return;
    }

    // Şube ya da tekil bakkal/market hesabı: normal sekmeler görünür, Şubelerim gizli.
    operationalTabs.forEach((tabId) => {
      const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
      if (btn) btn.style.display = "flex";
    });
    const branchesBtn = document.getElementById("branchesNavBtn");
    if (branchesBtn) branchesBtn.style.display = "none";
  }

export function getActorName() {
    return state.currentStaff ? `${state.currentStaff.name} (${state.currentStaff.role === "manager" ? state.t("staffRoleManager") : state.t("staffRoleCashier")})` : (state.currentUser && state.currentUser.email) || "?";
  }

export function logAudit(action, details) {
    const actorName = getActorName();
    state.auditLog.push({
      timestamp: new Date().toISOString(),
      actor: actorName,
      action,
      details: details || ""
    });
    if (state.auditLog.length > 300) {
      state.auditLog = state.auditLog.slice(state.auditLog.length - 300);
    }
  }

export function renderAuditLog() {
    const listEl = document.getElementById("auditLogList");
    const emptyEl = document.getElementById("auditLogEmptyState");
    if (!listEl) return;

    const sorted = [...state.auditLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 100);
    if (!sorted.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = sorted
      .map((entry) => {
        const d = new Date(entry.timestamp);
        const dateStr = d.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `
          <div class="audit-log-row">
            <p class="audit-log-action">${escapeHtml(entry.action)}</p>
            <p class="audit-log-meta">${dateStr} · ${escapeHtml(entry.actor)}${entry.details ? " · " + escapeHtml(entry.details) : ""}</p>
          </div>`;
      })
      .join("");
  }

export function saveOwnerPin() {
    const value = document.getElementById("ownerPinInput").value.trim();
    if (!/^\d{4,6}$/.test(value)) {
      showToast(state.t("ownerPinInvalid"), "error");
      return;
    }
    state.ownerPin = value;
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ ownerPin: value }, { merge: true }).catch((e) => console.error("Sahip PIN'i kaydedilemedi", e));
    }
    document.getElementById("ownerPinInput").value = "";
    renderOwnerPinStatus();
    showToast(state.t("ownerPinSaved"), "success");
  }

export function renderOwnerPinStatus() {
    const statusEl = document.getElementById("ownerPinStatus");
    if (!statusEl) return;
    statusEl.textContent = state.ownerPin ? state.t("ownerPinIsSet") : state.t("ownerPinNotSet");
    statusEl.style.color = state.ownerPin ? "var(--green-text)" : "var(--red-text)";
  }

export function renderStaffList() {
    const listEl = document.getElementById("staffList");
    const emptyEl = document.getElementById("staffEmptyState");
    if (!listEl) return;

    if (!state.staffMembers.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    listEl.innerHTML = state.staffMembers
      .map((s, i) => {
        const roleLabel = s.role === "manager" ? state.t("staffRoleManager") : state.t("staffRoleCashier");
        return `
          <div class="staff-row">
            <div>
              <p class="staff-row-name">${escapeHtml(s.name)}</p>
              <p class="staff-row-role">${roleLabel}</p>
            </div>
            <button class="staff-remove-btn" data-index="${i}" aria-label="Kaldır"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
          </div>`;
      })
      .join("");

    listEl.querySelectorAll(".staff-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.staffMembers.splice(Number(btn.dataset.index), 1);
        save();
        renderStaffList();
        showToast(state.t("staffRemoved"), "success");
      });
    });
  }

export function addStaffMember() {
    const name = document.getElementById("staffName").value.trim();
    const pin = document.getElementById("staffPin").value.trim();
    const role = document.getElementById("staffRole").value;

    if (!name || !pin) {
      showToast(state.t("staffFieldsRequired"), "error");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      showToast(state.t("staffPinInvalid"), "error");
      return;
    }

    state.staffMembers.push({ id: genId(), name, pin, role });
    save();
    renderStaffList();
    document.getElementById("staffName").value = "";
    document.getElementById("staffPin").value = "";
    showToast(state.t("staffAdded"), "success");
  }

export function checkStaffSelection() {
    if (!state.staffMembers.length) {
      state.currentStaff = null;
      applyRoleRestrictionsUI();
      return;
    }
    let savedStaffId = null;
    try {
      savedStaffId = sessionStorage.getItem("bakkal_current_staff_id");
    } catch (e) {}
    if (savedStaffId === "__owner__") {
      state.currentStaff = null;
      applyRoleRestrictionsUI();
      return;
    }
    const savedStaff = state.staffMembers.find((s) => s.id === savedStaffId);
    if (savedStaff) {
      state.currentStaff = savedStaff;
      applyRoleRestrictionsUI();
      return;
    }
    showStaffPicker();
  }

export function showStaffPicker() {
    const listEl = document.getElementById("staffPickerList");
    listEl.innerHTML = state.staffMembers
      .map((s) => {
        const roleLabel = s.role === "manager" ? state.t("staffRoleManager") : state.t("staffRoleCashier");
        return `
          <button class="staff-picker-btn" data-id="${s.id}">
            <span>${escapeHtml(s.name)}</span>
            <span class="staff-picker-role">${roleLabel}</span>
          </button>`;
      })
      .join("");

    listEl.querySelectorAll(".staff-picker-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const staff = state.staffMembers.find((s) => s.id === btn.dataset.id);
        if (!staff) return;
        openStaffPinView({ type: "staff", staff });
      });
    });

    document.getElementById("staffPickerListView").style.display = "block";
    document.getElementById("staffPickerPinView").style.display = "none";
    document.getElementById("staffPickerScreen").style.display = "flex";
  }

export function openStaffPinView(selection) {
    state.staffPickerPendingSelection = selection;
    document.getElementById("staffPickerListView").style.display = "none";
    document.getElementById("staffPickerPinView").style.display = "block";

    const nameEl = document.getElementById("staffPickerSelectedName");
    if (selection.type === "owner") {
      nameEl.textContent = state.t("staffOwnerSelectedLabel");
    } else {
      const roleLabel = selection.staff.role === "manager" ? state.t("staffRoleManager") : state.t("staffRoleCashier");
      nameEl.textContent = `${selection.staff.name} (${roleLabel})`;
    }

    const pinInput = document.getElementById("staffPickerPinInput");
    const errorEl = document.getElementById("staffPickerPinError");
    pinInput.value = "";
    errorEl.style.display = "none";
    setTimeout(() => pinInput.focus(), 50);
  }

export function staffPickerGoBack() {
    state.staffPickerPendingSelection = null;
    document.getElementById("staffPickerListView").style.display = "block";
    document.getElementById("staffPickerPinView").style.display = "none";
  }

export function submitStaffPickerPin() {
    if (!state.staffPickerPendingSelection) return;
    const entered = document.getElementById("staffPickerPinInput").value.trim();
    const errorEl = document.getElementById("staffPickerPinError");

    if (state.staffPickerPendingSelection.type === "owner") {
      if (state.ownerPin && entered !== state.ownerPin) {
        errorEl.textContent = state.t("ownerPinWrong");
        errorEl.style.display = "block";
        return;
      }
      grantOwnerAccess();
      return;
    }

    const staff = state.staffPickerPendingSelection.staff;
    if (entered !== staff.pin) {
      errorEl.textContent = state.t("staffPinWrong");
      errorEl.style.display = "block";
      return;
    }
    state.currentStaff = staff;
    try {
      sessionStorage.setItem("bakkal_current_staff_id", staff.id);
    } catch (e) {}
    document.getElementById("staffPickerScreen").style.display = "none";
    applyRoleRestrictionsUI();
  }

export function enterAsOwner() {
    if (state.ownerPin) {
      openStaffPinView({ type: "owner" });
      return;
    }
    grantOwnerAccess();
  }

export function grantOwnerAccess() {
    state.currentStaff = null;
    try {
      sessionStorage.setItem("bakkal_current_staff_id", "__owner__");
    } catch (e) {}
    applyRoleRestrictionsUI();
  }

export function applyRoleRestrictionsUI() {
    document.getElementById("staffPickerScreen").style.display = "none";

    if (!state.currentStaff || state.currentStaff.role === "manager") {
      // Sahip ya da müdür: önceki kasiyer kısıtlamasından kalmış olabilecek
      // gizli sekmeleri, hesap türü/basit mod kurallarına göre doğru şekilde geri getir.
      applyAccountTypeUI();
      reapplySimpleModeIfSet();
      updateSwitchUserButtonVisibility();
      const totalCard = document.getElementById("statPeriodTotalCard");
      const profitCard = document.getElementById("netProfitCard");
      const breakdownCard = document.getElementById("paymentBreakdownCard");
      if (totalCard) totalCard.style.display = "";
      if (profitCard) profitCard.style.display = "";
      if (breakdownCard) breakdownCard.style.display = "";
      const staffReportCard = document.getElementById("staffReportCard");
      if (staffReportCard) staffReportCard.style.display = "";
      return;
    }

    // Kasiyer: sadece Kasa, Satışlar, Veresiye görünür.
    const cashierBlockedTabs = ["tab-products", "tab-scan", "tab-orders", "tab-pricechanges", "tab-settings", "tab-branches", "tab-suppliers", "tab-expenses", "tab-incoming-orders"];
    cashierBlockedTabs.forEach((tabId) => {
      const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
      if (btn) btn.style.display = "none";
    });
    const adminBtn = document.getElementById("adminNavBtn");
    if (adminBtn) adminBtn.style.display = "none";

    // Satışlar sekmesine girebilsin ama ciro/net kâr rakamlarını görmesin —
    // satış geçmişi, işlem sayısı gibi diğer bilgiler görünmeye devam eder.
    const totalCard = document.getElementById("statPeriodTotalCard");
    const profitCard = document.getElementById("netProfitCard");
    const breakdownCard = document.getElementById("paymentBreakdownCard");
    if (totalCard) totalCard.style.display = "none";
    if (profitCard) profitCard.style.display = "none";
    if (breakdownCard) breakdownCard.style.display = "none";
    const staffReportCardHidden = document.getElementById("staffReportCard");
    if (staffReportCardHidden) staffReportCardHidden.style.display = "none";

    updateSwitchUserButtonVisibility();
    switchTab("tab-kasa");
  }

export function updateSwitchUserButtonVisibility() {
    const btn = document.getElementById("switchUserBtn");
    if (!btn) return;
    btn.style.display = state.staffMembers.length > 0 ? "inline-flex" : "none";
  }

export function switchUser() {
    state.currentStaff = null;
    try {
      sessionStorage.removeItem("bakkal_current_staff_id");
    } catch (e) {}
    showStaffPicker();
  }