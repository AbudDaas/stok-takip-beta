// Ürün fotoğrafları ve logo için Cloudflare R2 Worker adresi (r2-worker/KURULUM.md).
// Sonunda "/" olmasın. Boş bırakırsan eski yol (Firebase Storage) kullanılır.
// Bu adresin görünmesi güvenlik riski oluşturmaz; yükleme için Firebase girişi gerekir.

const imageConfig = {
  workerUrl: "green-sea-b462.abdulrazakdaas0.workers.dev"
};
