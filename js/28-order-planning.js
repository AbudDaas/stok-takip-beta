/**
 * Akıllı sipariş planlaması.
 *
 * Mantık (saf fonksiyonlar, test edilebilir):
 *  - Satış hızı: son 7 ve son 30 günlük satışın karışımı. 7 günlük, son
 *    değişimi yakalar; 30 günlük, dalgalanmayı yumuşatır.
 *  - Stok: raftaki + depodaki miktar.
 *  - Sipariş noktası = hız × (tedarik süresi + güvenlik günü).
 *    Stok bu noktanın altına inince sipariş önerilir.
 *  - Sipariş miktarı = hız × (tedarik + güvenlik + kapsama günü) − mevcut stok.
 *    Ürünün "koli içi adet" bilgisi varsa miktar koli katına yukarı yuvarlanır.
 *
 * Örnek: günde 5 adet satış, teslimat 3 gün, güvenlik 2 gün, kapsama 7 gün →
 * sipariş noktası 25, hedef stok 60. Stok 20 ise 40 adet önerilir.
 *
 * Sınırlar: mevsimsellik hesaba katılmaz. Satış kayıtları eski satışlarda ürün
 * adıyla, yeni satışlarda ürün kimliğiyle eşleşir (ürün yeniden adlandırılırsa
 * eski satışlar o ürüne sayılmaz).
 */

export const ORDER_DEFAULTS = { leadDays: 3, safetyDays: 2, coverDays: 7 };

const DAY_MS = 86400000;

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Satışlardan hızlı arama için bir dizin üretir: anahtar → { d7, d30 }.
 * Anahtar: "id:<ürünKimliği>" (yeni satışlar) ya da "name:<ürünAdı>" (eski satışlar).
 */
export function buildSalesIndex(sales, now = Date.now()) {
  const index = new Map();
  const add = (key, qty, ageDays) => {
    const entry = index.get(key) || { d7: 0, d30: 0 };
    if (ageDays <= 7) entry.d7 += qty;
    if (ageDays <= 30) entry.d30 += qty;
    index.set(key, entry);
  };
  (sales || []).forEach((sale) => {
    const t = new Date(sale.timestamp).getTime();
    if (!Number.isFinite(t)) return;
    const ageDays = (now - t) / DAY_MS;
    if (ageDays < 0 || ageDays > 30) return;
    (sale.items || []).forEach((item) => {
      const qty = num(item.qty);
      if (qty <= 0) return;
      add(item.productId ? "id:" + item.productId : "name:" + item.name, qty, ageDays);
    });
  });
  return index;
}

/** Bir ürünün son 7 / 30 günlük satış miktarı. */
export function soldQuantities(index, product) {
  const byId = index.get("id:" + product.id) || { d7: 0, d30: 0 };
  const byName = index.get("name:" + product.name) || { d7: 0, d30: 0 };
  return { d7: byId.d7 + byName.d7, d30: byId.d30 + byName.d30 };
}

/**
 * Günlük satış hızı ve eğilim.
 * trend > 1: son hafta, aylık ortalamadan hızlı satıyor (artıyor).
 */
export function velocityFrom(d7, d30) {
  const avg7 = num(d7) / 7;
  const avg30 = num(d30) / 30;
  if (avg7 <= 0 && avg30 <= 0) return { avgDaily: 0, trend: null };
  const avgDaily = Math.round((avg7 * 0.5 + avg30 * 0.5) * 1000) / 1000;
  return { avgDaily, trend: avg30 > 0 ? Math.round((avg7 / avg30) * 100) / 100 : null };
}

/** Miktarı birime göre yukarı yuvarlar; koli bilgisi varsa koli katına. */
export function roundOrderQty(qty, unit, caseSize) {
  const q = Math.max(0, num(qty));
  if (!q) return { qty: 0, cases: 0 };
  if (unit !== "kg" && num(caseSize) > 1) {
    const cases = Math.ceil(q / caseSize);
    return { qty: cases * caseSize, cases };
  }
  if (unit === "kg") return { qty: Math.ceil(q * 10) / 10, cases: 0 };
  return { qty: Math.ceil(q), cases: 0 };
}

/**
 * Tek ürün için sipariş planı.
 * Dönüş: { reorderPoint, targetStock, daysLeft, needsOrder, orderQty, cases }
 */
export function planOrder({ stock, avgDaily, leadDays, safetyDays, coverDays, unit, caseSize }) {
  const velocity = Math.max(0, num(avgDaily));
  const lead = Math.max(0, num(leadDays));
  const safety = Math.max(0, num(safetyDays));
  const cover = Math.max(0, num(coverDays));
  const available = Math.max(0, num(stock));

  const reorderPoint = velocity * (lead + safety);
  const targetStock = velocity * (lead + safety + cover);
  const daysLeft = velocity > 0 ? available / velocity : Number.POSITIVE_INFINITY;
  const needsOrder = velocity > 0 && available <= reorderPoint;
  const rounded = needsOrder ? roundOrderQty(targetStock - available, unit, caseSize) : { qty: 0, cases: 0 };

  return { reorderPoint, targetStock, daysLeft, needsOrder, orderQty: rounded.qty, cases: rounded.cases };
}

/**
 * Stokta bekleyen, son 30 günde HİÇ satılmamış ürünler (stok değeri yüksek olan önce).
 */
export function findSlowMovers(products, index) {
  return (products || [])
    .map((p) => {
      const stock = num(p.qty) + num(p.warehouseQty);
      const sold = soldQuantities(index, p);
      return { product: p, stock, sold30: sold.d30, stockValue: stock * num(p.costPrice) };
    })
    .filter((x) => x.stock > 0 && x.sold30 === 0)
    .sort((a, b) => b.stockValue - a.stockValue || b.stock - a.stock);
}
