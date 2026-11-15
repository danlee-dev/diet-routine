'use client';
// Photos are downscaled on the device before upload: longest side <= 1568 px (the size Claude reads
// without resizing), JPEG 0.85, EXIF orientation applied. Keeps a request to a few hundred KB.

export interface PreparedImage {
  type: 'image/jpeg';
  /** base64 without the data: prefix */
  data: string;
  /** data URL for the thumbnail */
  preview: string;
}

const MAX_SIDE = 1568;
const MAX_BASE64 = 1_300_000;

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('사진 파일만 올릴 수 있습니다');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진을 읽지 못했습니다');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  // keep each photo under the server's 1.4 MB base64 cap (three photos stay under the request limit)
  let preview = '';
  for (const q of [0.85, 0.72, 0.6, 0.48]) {
    preview = canvas.toDataURL('image/jpeg', q);
    if (preview.length - preview.indexOf(',') - 1 <= MAX_BASE64) break;
  }
  if (preview.length - preview.indexOf(',') - 1 > MAX_BASE64) throw new Error('사진이 너무 큽니다');
  return { type: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview };
}
