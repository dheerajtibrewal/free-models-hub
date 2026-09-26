/**
 * Client-side image normalization.
 *
 * Vision models gain nothing from more than ~1024px on the long edge, and
 * Vercel caps request bodies at 4.5MB, so downscaling here is both a quality
 * no-op and the thing that keeps uploads well inside the limit. A 12MP phone
 * photo lands around 150-250KB after this.
 */

export const MAX_EDGE = 1024;
export const JPEG_QUALITY = 0.82;
/** Bytes, before base64 inflation (~4/3). */
const BYTE_BUDGET = 1_800_000;

export interface NormalizedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  /** Bytes after normalization, for the X-Ray input summary. */
  bytes: number;
  previewUrl: string;
}

export async function normalizeImage(file: File): Promise<NormalizedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process this image.');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ('close' in bitmap) bitmap.close();

  // Step quality down only if the first pass is still too heavy -- most images
  // never need a second encode.
  let quality = JPEG_QUALITY;
  let blob = await encode(canvas, quality);
  while (blob.size > BYTE_BUDGET && quality > 0.4) {
    quality -= 0.12;
    blob = await encode(canvas, quality);
  }

  if (blob.size > BYTE_BUDGET) {
    throw new Error('This image is too detailed to send. Try a smaller crop.');
  }

  return {
    base64: await blobToBase64(blob),
    mimeType: 'image/jpeg',
    width,
    height,
    bytes: blob.size,
    previewUrl: URL.createObjectURL(blob),
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari has historically refused some formats here; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
      'image/jpeg',
      quality,
    );
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // strip the "data:<mime>;base64," prefix
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(blob);
  });
}
