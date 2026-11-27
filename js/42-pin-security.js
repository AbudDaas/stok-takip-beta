// PIN güvenliği: PIN'ler düz metin yerine PBKDF2-SHA256 (tuzlu) özet olarak saklanır,
// deneme sınırı sayfa yenilense de sıfırlanmaz (localStorage, artan bekleme).
//
// DÜRÜST NOT: 4-6 haneli PIN'in olası değeri azdır; özet, belgeyi ÇIPLAK görmeyi engeller
// ama kararlı bir saldırganın çevrimdışı denemesini engellemez. Gerçek çözüm doğrulamayı sunucuya taşımaktır.

const PREFIX = "p1";
const ITERATIONS = 100000;
const LOCK_KEY = "bakkal_pin_lock";

function toB64(bytes) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export function isHashedPin(stored) {
  return typeof stored === "string" && stored.startsWith(PREFIX + "$");
}

export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

// stored: "p1$iter$salt$hash" veya eski düz metin PIN.
export async function verifyPin(pin, stored) {
  if (!stored) return false;
  if (!isHashedPin(stored)) return String(pin) === String(stored);
  const [, iter, saltB64, hashB64] = stored.split("$");
  const expected = fromB64(hashB64);
  const actual = await derive(pin, fromB64(saltB64), Number(iter) || ITERATIONS);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// ---- Kalıcı deneme sınırı ----
export function lockDelayFor(totalFails) {
  if (totalFails < 5) return 0;
  const steps = Math.floor(totalFails / 5) - 1; // 5→30sn, 10→60sn, 15→120sn ...
  return Math.min(30000 * Math.pow(2, steps), 15 * 60000);
}

function readLock(scope) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCK_KEY) || "{}");
    return all[scope] || { fails: 0, until: 0 };
  } catch (e) {
    return { fails: 0, until: 0 };
  }
}
function writeLock(scope, value) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCK_KEY) || "{}");
    if (value) all[scope] = value;
    else delete all[scope];
    localStorage.setItem(LOCK_KEY, JSON.stringify(all));
  } catch (e) {}
}

export function lockRemainingMs(scope, now = Date.now()) {
  return Math.max(0, readLock(scope).until - now);
}
export function registerPinFailure(scope, now = Date.now()) {
  const cur = readLock(scope);
  const fails = cur.fails + 1;
  const delay = lockDelayFor(fails);
  writeLock(scope, { fails, until: delay ? now + delay : cur.until });
  return delay;
}
export function clearPinFailures(scope) {
  writeLock(scope, null);
}
