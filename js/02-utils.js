import { state } from './00-state.js';
import { locale } from './01-firebase-core.js';

export function mkProduct(name, category, qty, min, price, barcode, unit, costPrice) {
    return {
      id: genId(),
      name,
      category,
      qty: Number(qty) || 0,
      min: Number(min) || 0,
      price: Number(price) || 0,
      costPrice: Number(costPrice) || 0,
      barcode: (barcode || "").trim(),
      unit: unit === "kg" ? "kg" : "adet"
    };
  }

export function genId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

export function isPushConfigured() {
    return typeof pushConfig !== "undefined" && pushConfig.vapidKey && pushConfig.vapidKey.indexOf("BURAYA") !== 0;
  }

export function isAdminConfigured() {
    return typeof adminConfig !== "undefined" && adminConfig.workerUrl && adminConfig.workerUrl.indexOf("BURAYA") !== 0;
  }

export function isChainConfigured() {
    return typeof chainConfig !== "undefined" && chainConfig.workerUrl && chainConfig.workerUrl.indexOf("BURAYA") !== 0;
  }

export function getStatus(p) {
    if (p.qty <= 0) return "tukendi";
    if (p.qty < p.min) return "kritik";
    return "yeterli";
  }

export function getStatusLabel(status) {
    if (status === "tukendi") return state.t("statusTukendi");
    if (status === "kritik") return state.t("statusKritik");
    return state.t("statusYeterli");
  }

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

export function showToast(message, type) {
    type = type || "info";
    const container = document.getElementById("toastContainer");
    if (!container) {
      // Toast container yoksa (beklenmedik durum), en azından bilgi kaybolmasın
      window.alert(message);
      return;
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="${state.TOAST_ICONS[type] || state.TOAST_ICONS.info}" aria-hidden="true"></i>
      <span class="toast-message"></span>
      <button class="toast-close" aria-label="Kapat"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    `;
    toast.querySelector(".toast-message").textContent = message;

    function removeToast() {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 250);
    }

    toast.querySelector(".toast-close").addEventListener("click", removeToast);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(removeToast, 4000);
  }

export function showPrompt(title, defaultValue, isPassword) {
    return new Promise((resolve) => {
      const modal = document.getElementById("promptModal");
      const titleEl = document.getElementById("promptModalTitle");
      const input = document.getElementById("promptModalInput");
      const okBtn = document.getElementById("promptModalOkBtn");
      const cancelBtn = document.getElementById("promptModalCancelBtn");

      input.type = isPassword ? "password" : "text";
      input.inputMode = isPassword ? "numeric" : "decimal";
      titleEl.textContent = title;
      input.value = defaultValue != null ? defaultValue : "";
      modal.style.display = "flex";
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);

      function cleanup(result) {
        modal.style.display = "none";
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        input.removeEventListener("keydown", onKeydown);
        modal.removeEventListener("click", onOverlayClick);
        resolve(result);
      }
      function onOk() {
        cleanup(input.value);
      }
      function onCancel() {
        cleanup(null);
      }
      function onKeydown(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          onOk();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }
      function onOverlayClick(e) {
        if (e.target === modal) onCancel();
      }

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      input.addEventListener("keydown", onKeydown);
      modal.addEventListener("click", onOverlayClick);
    });
  }

export function formatQty(p) {
    if (p.unit === "kg") {
      return (Math.round(p.qty * 1000) / 1000).toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + " " + state.t("unitKgShort");
    }
    return p.qty + " " + state.t("unitAdetShort");
  }

// Desteklenen para birimleri: simge ve ondalık sayısı (SYP'de kuruş kullanılmaz).
export const CURRENCIES = {
    TRY: { symbol: "₺", decimals: 2 },
    SYP: { symbol: "ل.س", decimals: 0 },
    USD: { symbol: "$", decimals: 2 }
  };

export function formatMoney(n, code) {
    const c = CURRENCIES[code] || CURRENCIES.TRY;
    return (Number(n) || 0).toLocaleString(locale(), { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals }) + " " + c.symbol;
  }

// Adı eski kaldı (89 yerde kullanılıyor); artık işletmenin seçtiği para birimini kullanır.
export function formatTL(n) {
    return formatMoney(n, state.currency);
  }

export function isBulkScanConfigured() {
    return typeof bulkScanConfig !== "undefined" && bulkScanConfig.workerUrl && bulkScanConfig.workerUrl.indexOf("BURAYA") !== 0;
  }

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

export function sleep_(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

export function roundUpTo5(n) {
    // 10 TL ve üzeri fiyatlarda, "güzel" bir rakam olsun diye en yakın 5'in
    // katına YUKARI yuvarlıyoruz (örn. 12.23 -> 15). Daha ucuz ürünlerde bu
    // kuralı uygulamıyoruz çünkü orantısız bir zam olurdu (örn. 1.20 TL'lik
    // bir ürünü 5 TL yapmak gibi).
    if (n >= 10) {
      return Math.ceil(n / 5) * 5;
    }
    return Math.round(n * 100) / 100;
  }

export function calcSellingPrice(costPrice, percent) {
    const p = percent != null ? percent : 20;
    return roundUpTo5(costPrice * (1 + p / 100));
  }

// ---------- Yazdırılabilir / PDF Olarak Kaydedilebilir Sipariş Listesi ----------
// Not: WhatsApp'a otomatik PDF EKİ göndermek mümkün değil (WhatsApp bunu API
// üzerinden desteklemiyor). Bunun yerine tarayıcının yazdırma penceresini
// açıyoruz — kullanıcı burada gerçek bir yazıcı seçebilir YA DA "PDF olarak
// kaydet" seçeneğiyle bir PDF dosyası indirip, onu telefonun paylaş menüsünden
// WhatsApp'a elle ekleyebilir.
export function printOrderListAsPdf(title, items) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const dateStr = new Date().toLocaleDateString(locale());
  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td style="text-align:right;">${item.suggestedOrder ?? item.qty} ${item.unit === "kg" ? "kg" : "adet"}</td>
        </tr>`
    )
    .join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #222; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          p.date { color: #777; font-size: 13px; margin-top: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 14px; }
          th { background: #f2f2f2; text-align: left; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p class="date">${dateStr}</p>
        <table>
          <thead><tr><th>Ürün</th><th style="text-align:right;">Miktar</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}