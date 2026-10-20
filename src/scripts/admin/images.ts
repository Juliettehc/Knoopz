// Verkleint een foto in de browser tot maximaal `maxWidth` pixels breed (verhouding blijft gelijk)
// en levert een JPEG op. Zo hoeven jullie zelf geen kleine versies te maken.

export async function resizeImage(file: File, maxWidth: number, quality = 0.84): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // transparante PNG's krijgen een witte achtergrond
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Foto verkleinen mislukt'))), 'image/jpeg', quality),
  );
}
