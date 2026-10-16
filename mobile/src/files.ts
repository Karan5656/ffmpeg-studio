import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

import { MIME } from './core/formats.ts';
import { fileAt, uriToPath } from './ffmpeg.ts';

export interface Picked {
  path: string; // plain filesystem path ffmpeg can open
  name: string; // name to show and to base the output name on
}

/** Scratch folder for picked inputs and conversion results. */
export function workDir(): Directory {
  const dir = new Directory(Paths.cache, 'studio');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Remove everything from earlier runs except the files still in use. */
export function cleanWorkDir(keep: string[] = []) {
  for (const entry of workDir().list()) {
    const path = uriToPath(entry.uri).replace(/\/$/, '');
    if (!keep.includes(path)) entry.delete();
  }
}

/** Make sure we have a local file:// copy ffmpeg can read, then return its path. */
async function toLocal(uri: string, name: string): Promise<Picked> {
  if (uri.startsWith('file://')) return { path: uriToPath(uri), name };
  const dest = new File(workDir(), `${Date.now()}-${name}`);
  await new File(uri).copy(dest);
  return { path: uriToPath(dest.uri), name };
}

/** Pick a photo or video from the gallery / Photos app. */
export async function pickFromGallery(): Promise<Picked | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    quality: 1,
    // Keep the original video instead of letting iOS re-encode it first.
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    // iPhone photos are HEIC; ask for a JPEG copy, which ffmpeg reads everywhere.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const fallback = a.type === 'video' ? 'video.mp4' : 'image.jpg';
  return toLocal(a.uri, a.fileName || a.uri.split('/').pop() || fallback);
}

/** Pick any video, audio or image file from Files / the file manager. */
export async function pickFromFiles(): Promise<Picked | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['video/*', 'audio/*', 'image/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return toLocal(a.uri, a.name || 'file');
}

const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Open the share sheet for a result (also how iPhone saves to Files or Photos). */
export async function shareFile(path: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const ext = extOf(path);
  await Sharing.shareAsync(fileAt(path).uri, {
    mimeType: MIME[ext],
    dialogTitle: 'Save or share',
  });
}

let lastFolder: string | undefined;

/**
 * Android: let the user pick a folder (Downloads, Movies, ...) and copy the result there.
 * iPhone: the share sheet has "Save to Files" and "Save Video/Image", so use that.
 * Returns a short description of where it went, or null if the user backed out.
 */
export async function saveFile(path: string): Promise<string | null> {
  if (Platform.OS !== 'android') {
    await shareFile(path);
    return null;
  }
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync(lastFolder);
  } catch {
    return null; // picker dismissed
  }
  lastFolder = folder.uri;
  await fileAt(path).copy(folder);
  return decodeURIComponent(folder.uri.split('%3A').pop() || folder.uri.split('/').pop() || 'the folder');
}
