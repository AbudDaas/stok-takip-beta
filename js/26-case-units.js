/**
 * Koli / adet dönüşümü.
 *
 * Toptancıdan koliyle alınan ürün tek tek (adet) satılır: "1 koli = 12 adet".
 * Bu dosyadaki fonksiyonlar saf (yan etkisiz) olduğu için kolayca test edilir.
 */

function positive(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Bir ürünün "koli içi adet" sayısı.
 * Önce ürüne elle girilen değer (caseSize), yoksa ilk koli barkodunun içindeki
 * adet kullanılır (eski veriyle uyum). Tanım yoksa 0 döner.
 */
export function getCaseSize(product) {
  if (!product) return 0;
  const explicit = positive(product.caseSize);
  if (explicit) return explicit;
  if (Array.isArray(product.caseBarcodes) && product.caseBarcodes.length) {
    return positive(product.caseBarcodes[0].qty);
  }
  return positive(product.caseQty);
}

/** Koli sayısını adede çevirir. 3 koli × 12 = 36 adet. */
export function casesToUnits(cases, caseSize) {
  const size = positive(caseSize);
  const count = Number(cases);
  if (!size || !Number.isFinite(count)) return 0;
  return Math.round(count * size * 1000) / 1000;
}

/** Koli alış fiyatından adet maliyetini hesaplar (2 ondalık). */
export function caseCostToUnitCost(caseCost, caseSize) {
  const cost = positive(caseCost);
  const size = positive(caseSize);
  if (!cost || !size) return 0;
  return Math.round((cost / size) * 100) / 100;
}
