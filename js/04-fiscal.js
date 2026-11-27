import { state } from './00-state.js';
import { isChainConfigured, showToast } from './02-utils.js';
import { logAudit } from './03-staff-roles.js';

export function toggleFiscalEnabled(checked) {
    state.fiscalEnabled = checked;
    document.getElementById("fiscalConfigFields").style.display = checked ? "block" : "none";
    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef.set({ fiscalEnabled: checked }, { merge: true }).catch((e) => console.error("Mali kayıt ayarı kaydedilemedi", e));
    }
  }

function fiscalSecretRef() {
    const base = state.originalDocRef || state.docRef;
    return base ? base.collection("gizli").doc("fiscal") : null;
  }

// Anahtarı gizli alt belgeden yükler; eski ana-belge anahtarını oraya taşır ve ana belgeden siler.
export async function ensureFiscalKey() {
    const base = state.originalDocRef || state.docRef;
    const ref = fiscalSecretRef();
    if (!base || !ref || state.viewingBranchUid) return state.fiscalApiKey;
    try {
      if (state.fiscalKeyLegacy && state.fiscalApiKey) {
        await ref.set({ apiKey: state.fiscalApiKey }, { merge: true });
        await base.update({ fiscalApiKey: firebase.firestore.FieldValue.delete() });
        state.fiscalKeyLegacy = false;
        state._fiscalKeyFor = base.path;
      } else if (!state.fiscalApiKey && state._fiscalKeyFor !== base.path) {
        const doc = await ref.get();
        state.fiscalApiKey = doc.exists ? doc.data().apiKey || "" : "";
        state._fiscalKeyFor = base.path;
      }
    } catch (e) {
      console.error("Mali kayıt anahtarı yüklenemedi", e);
    }
    return state.fiscalApiKey;
  }

export function saveFiscalSettings() {
    state.fiscalProvider = document.getElementById("fiscalProvider").value;
    state.fiscalApiKey = document.getElementById("fiscalApiKey").value.trim();
    state.fiscalEndpoint = document.getElementById("fiscalEndpoint").value.trim();
    state.fiscalVkn = document.getElementById("fiscalVkn").value.trim();

    const targetRef = state.originalDocRef || state.docRef;
    if (targetRef) {
      targetRef
        .set({ fiscalProvider: state.fiscalProvider, fiscalEndpoint: state.fiscalEndpoint, fiscalVkn: state.fiscalVkn, fiscalApiKey: firebase.firestore.FieldValue.delete() }, { merge: true })
        .catch((e) => console.error("Mali kayıt ayarları kaydedilemedi", e));
      fiscalSecretRef()
        .set({ apiKey: state.fiscalApiKey }, { merge: true })
        .then(() => {
          state._fiscalKeyFor = targetRef.path;
          state.fiscalKeyLegacy = false;
        })
        .catch((e) => console.error("Mali kayıt anahtarı kaydedilemedi", e));
    }

    const statusEl = document.getElementById("fiscalStatus");
    if (state.fiscalApiKey && state.fiscalEndpoint) {
      statusEl.textContent = state.t("fiscalReadyToTry");
      statusEl.style.color = "var(--green-text)";
    } else if (state.fiscalApiKey || state.fiscalEndpoint) {
      statusEl.textContent = state.t("fiscalNotConnectedYet");
      statusEl.style.color = "var(--amber-text)";
    } else {
      statusEl.textContent = "";
    }
    showToast(state.t("fiscalSettingsSaved"), "success");
  }

export function renderFiscalSettings() {
    const toggle = document.getElementById("fiscalEnabledToggle");
    if (!toggle) return;
    toggle.checked = state.fiscalEnabled;
    document.getElementById("fiscalConfigFields").style.display = state.fiscalEnabled ? "block" : "none";
    document.getElementById("fiscalProvider").value = state.fiscalProvider;
    const keyInput = document.getElementById("fiscalApiKey");
    keyInput.type = "password";
    keyInput.autocomplete = "off";
    keyInput.value = state.fiscalApiKey;
    ensureFiscalKey().then((k) => {
      if (document.activeElement !== keyInput) keyInput.value = k || "";
    });
    document.getElementById("fiscalEndpoint").value = state.fiscalEndpoint;
    document.getElementById("fiscalVkn").value = state.fiscalVkn;
  }

export async function attemptSendToFiscalProvider(sale) {
    if (!state.fiscalEnabled || !state.fiscalEndpoint) return;
    if (!isChainConfigured() || !state.currentUser) return;
    await ensureFiscalKey();
    if (!state.fiscalApiKey) return;

    const invoicePayload = {
      vkn: state.fiscalVkn,
      faturaTarihi: sale.timestamp,
      faturaNo: sale.id,
      kalemler: sale.items.map((item) => ({
        urunAdi: item.name,
        miktar: item.qty,
        birimFiyat: item.price,
        toplam: Math.round(item.qty * item.price * 100) / 100
      })),
      araToplam: sale.subtotal,
      indirim: sale.discount || 0,
      genelToplam: sale.total,
      odemeTuru: sale.paymentType
    };

    state.currentUser
      .getIdToken()
      .then((idToken) =>
        fetch(`${chainConfig.workerUrl}/relay-fiscal-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, fiscalEndpoint: state.fiscalEndpoint, fiscalApiKey: state.fiscalApiKey, invoicePayload })
        })
      )
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          logAudit("Mali kayıt gönderildi", `Satış #${sale.id}`);
        } else {
          console.error("Mali kayıt gönderimi başarısız:", data);
          logAudit("Mali kayıt gönderimi BAŞARISIZ", `Satış #${sale.id} — ${data.error || "entegratör " + data.providerStatus + " döndürdü"}`);
        }
      })
      .catch((e) => {
        console.error("Mali kayıt gönderim hatası:", e);
        logAudit("Mali kayıt gönderimi BAŞARISIZ", `Satış #${sale.id} (bağlantı hatası)`);
      });
  }
