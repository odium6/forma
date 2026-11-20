/** Image intake: validation by actual decoding, and a separate downscaled thumbnail. Originals are stored untouched. */

export const MAX_PHOTO_BYTES = 200 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMime = (typeof ALLOWED)[number];

export interface PreparedPhoto {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: AllowedMime;
}

async function sniffMime(file: Blob): Promise<AllowedMime | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function canvasToBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));
}

/** Validates by magic bytes and by decoding; rejects anything that is not a real JPEG/PNG/WebP. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Файл больше 200 МБ');
  const mime = await sniffMime(file);
  if (!mime) throw new Error('Поддерживаются JPEG, PNG и WebP. На iPhone выбери «Наиболее совместимый» формат камеры или загрузи фото через «Фото».');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Не удалось прочитать изображение');
  }
  const max = 480;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const thumb = await canvasToBlob(c, 'image/jpeg', 0.82);
  const out = { blob: file.type === mime ? file : new Blob([file], { type: mime }), thumb, width: bmp.width, height: bmp.height, mime };
  bmp.close();
  return out;
}

/** Captures a still from a <video> stream as JPEG. */
export async function captureFrame(video: HTMLVideoElement, mirror: boolean): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext('2d')!;
  if (mirror) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0);
  return canvasToBlob(c, 'image/jpeg', 0.92);
}
