import {launchImageLibrary, launchCamera, ImageLibraryOptions} from 'react-native-image-picker';
import {markExternal} from '@/services/appLifecycle';

/**
 * Profile-picture picking. Uses the OS photo picker (no storage permission on
 * modern Android). Images are downscaled so they store compactly on-device.
 */
// Small enough to ride the presence broadcast (peers see your photo) yet still
// crisp at avatar sizes. includeBase64 gives us the thumbnail to share.
const opts: ImageLibraryOptions = {
  mediaType: 'photo',
  quality: 0.6,
  maxWidth: 256,
  maxHeight: 256,
  includeBase64: true,
  selectionLimit: 1,
};

// Cap so the avatar stays well under the mesh frame limit when broadcast.
const MAX_AVATAR_THUMB = 14000;

export type ProfilePhoto = {uri: string; thumb: string | null};

function toProfilePhoto(res: Awaited<ReturnType<typeof launchImageLibrary>>): ProfilePhoto | null {
  if (res.didCancel || res.errorCode) {
    return null;
  }
  const asset = res.assets?.[0];
  if (!asset?.uri) {
    return null;
  }
  const b64 = asset.base64;
  const thumb = b64 && b64.length <= MAX_AVATAR_THUMB ? b64 : null;
  return {uri: asset.uri, thumb};
}

export async function pickProfilePhoto(): Promise<ProfilePhoto | null> {
  markExternal();
  return toProfilePhoto(await launchImageLibrary(opts));
}

export async function takeProfilePhoto(): Promise<ProfilePhoto | null> {
  markExternal();
  return toProfilePhoto(await launchCamera({...opts, saveToPhotos: false}));
}

// Generous ceiling — media is streamed in chunks over the mesh (Nearby upgrades
// to Wi-Fi for bandwidth), so full photos are fine; this just avoids absurd
// multi-MB sends that would take too long.
const MAX_PHOTO_BYTES = 2_500_000;

const chatPhotoOpts: ImageLibraryOptions = {
  mediaType: 'photo',
  quality: 0.7,
  maxWidth: 1280,
  maxHeight: 1280,
  includeBase64: true,
  selectionLimit: 1,
};

/**
 * Outcome of picking a chat photo, so the UI can tell the difference between
 * "user cancelled" (do nothing) and "too large" (show a message) — instead of
 * both silently returning null.
 */
export type ChatPhotoResult =
  | {ok: true; base64: string}
  | {ok: false; reason: 'cancelled' | 'too-large' | 'error'};

async function toChatPhoto(
  res: Awaited<ReturnType<typeof launchImageLibrary>>,
): Promise<ChatPhotoResult> {
  if (res.didCancel) {
    return {ok: false, reason: 'cancelled'};
  }
  if (res.errorCode) {
    return {ok: false, reason: 'error'};
  }
  const b64 = res.assets?.[0]?.base64;
  if (!b64) {
    return {ok: false, reason: 'error'};
  }
  if (b64.length > MAX_PHOTO_BYTES) {
    return {ok: false, reason: 'too-large'};
  }
  return {ok: true, base64: b64};
}

/** Pick a full-quality chat photo from the library, streamed in chunks. */
export async function pickChatPhoto(): Promise<ChatPhotoResult> {
  markExternal();
  return toChatPhoto(await launchImageLibrary(chatPhotoOpts));
}

/** Take a chat photo with the camera. */
export async function takeChatPhoto(): Promise<ChatPhotoResult> {
  markExternal();
  return toChatPhoto(await launchCamera({...chatPhotoOpts, saveToPhotos: false}));
}
