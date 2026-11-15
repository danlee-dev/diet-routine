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
  const preview = canvas.toDataURL('image/jpeg', 0.85);
  return { type: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview };
}
