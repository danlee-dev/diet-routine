// Photos for the coach: take one or pick up to three, shrink to at most 1568 px on the long side (what the model
// reads best) and encode as JPEG base64 under the server's size limit.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface CoachPhoto {
  /** local file for the preview */
  uri: string;
  media_type: 'image/jpeg';
  /** base64 without the data: prefix */
  data: string;
}

const MAX_SIDE = 1568;
const MAX_B64 = 1_350_000; // the server accepts up to 1.4M characters

async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<CoachPhoto | null> {
  const long = Math.max(asset.width || MAX_SIDE, asset.height || MAX_SIDE);
  const ratio = Math.min(1, MAX_SIDE / long);
  for (const compress of [0.8, 0.6, 0.45]) {
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (ratio < 1) ctx.resize(asset.width >= asset.height ? { width: Math.round(asset.width * ratio) } : { height: Math.round(asset.height * ratio) });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });
    if (out.base64 && out.base64.length <= MAX_B64) return { uri: out.uri, media_type: 'image/jpeg', data: out.base64 };
  }
  return null;
}

/** Returns prepared photos, or [] when cancelled or permission was denied. */
export async function pickPhotos(source: 'camera' | 'library', limit: number): Promise<{ photos: CoachPhoto[]; denied?: boolean }> {
  if (limit <= 0) return { photos: [] };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { photos: [], denied: true };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const res = source === 'camera'
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: limit > 1, selectionLimit: limit });
  if (res.canceled) return { photos: [] };
  const out: CoachPhoto[] = [];
  for (const a of res.assets.slice(0, limit)) {
    const p = await prepare(a);
    if (p) out.push(p);
  }
  return { photos: out };
}

/** A pasted image (data URI from the system paste button), shrunk and encoded like a picked photo. */
export async function preparePasted(dataUri: string, width: number, height: number): Promise<CoachPhoto | null> {
  return prepare({ uri: dataUri, width, height } as ImagePicker.ImagePickerAsset);
}
