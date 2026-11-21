import {create} from 'zustand';
import {storage, StorageKeys, updateActiveAccount, numberUsedByOtherAccount} from '@/services/storage';
import {rememberSim} from '@/services/simWatch';

type SessionState = {
  hydrated: boolean;
  onboarded: boolean;
  /** True once the user has a usable (local) profile — no server required. */
  isReady: boolean;
  /** Optional cloud account (OTP) for backup/recovery; not required to use Pulse. */
  hasCloudAccount: boolean;
  /** The phone number passed an SMS check. */
  phoneVerified: boolean;
  /** Signed proof of that (checkable offline by anyone). */
  attestation: string | null;
  userId: number | null;
  profileName: string | null;
  phone: string | null;
  avatarUri: string | null;
  /** Small base64 thumbnail of the avatar, broadcast so peers see your photo. */
  avatarThumb: string | null;
  /** Short "about me" line shown on your profile to people you meet. */
  bio: string;

  hydrate: () => void;
  /** Finish onboarding by creating a fully local profile — works offline. */
  setupLocalProfile: (name: string, phone: string, avatar?: {uri: string; thumb: string | null} | null) => void;
  setProfile: (patch: {name?: string; phone?: string; bio?: string; avatarUri?: string | null; avatarThumb?: string | null}) => void;
  /** Attach an optional cloud account (from Settings, when online). */
  linkCloudAccount: (token: string, userId: number, phone: string) => void;
  unlinkCloudAccount: () => void;
  /** The phone texted its own number and the text arrived: remember the number as confirmed (no server). */
  /** Returns false (and saves nothing) if another account on this phone already uses the number. */
  markPhoneVerified: (v: {phone: string}) => boolean;
  resetProfile: () => void;
};

/**
 * First-run + profile state, persisted locally so the app opens straight into
 * Home on relaunch (critical for a safety app) with NO network dependency.
 *
 * Pulse is offline-first: a local profile is all you need. A cloud account
 * (phone-OTP) is an optional extra for backup + letting the server address
 * push confirmations — never required to open or use the app.
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  onboarded: false,
  isReady: false,
  hasCloudAccount: false,
  phoneVerified: false,
  attestation: null,
  userId: null,
  profileName: null,
  phone: null,
  avatarUri: null,
  avatarThumb: null,
  bio: '',

  hydrate: () => {
    const onboarded = storage.getBoolean(StorageKeys.onboarded) ?? false;
    const phone = storage.getString(StorageKeys.phone) ?? null;
    const token = storage.getString(StorageKeys.jwt);
    set({
      hydrated: true,
      onboarded,
      // Ready as soon as onboarding is done — a local profile is enough.
      isReady: onboarded,
      hasCloudAccount: !!token,
      phoneVerified: (storage.getBoolean(StorageKeys.phoneVerified) ?? false) && !!phone,
      attestation: storage.getString(StorageKeys.attestation) ?? null,
      userId: storage.getNumber(StorageKeys.userId) ?? null,
      profileName: storage.getString(StorageKeys.profileName) ?? null,
      phone,
      avatarUri: storage.getString(StorageKeys.avatarUri) ?? null,
      avatarThumb: storage.getString(StorageKeys.avatarThumb) ?? null,
      bio: storage.getString(StorageKeys.bio) ?? '',
    });
  },

  setupLocalProfile: (name, phone, avatar) => {
    storage.set(StorageKeys.onboarded, true);
    storage.set(StorageKeys.profileName, name);
    storage.set(StorageKeys.phone, phone);
    if (avatar?.uri) {
      storage.set(StorageKeys.avatarUri, avatar.uri);
    }
    if (avatar?.thumb) {
      storage.set(StorageKeys.avatarThumb, avatar.thumb);
    }
    updateActiveAccount({name, thumb: avatar?.thumb ?? undefined});
    set({
      onboarded: true,
      isReady: true,
      profileName: name,
      phone,
      avatarUri: avatar?.uri ?? null,
      avatarThumb: avatar?.thumb ?? null,
    });
  },

  setProfile: patch => {
    if (patch.name !== undefined) {
      storage.set(StorageKeys.profileName, patch.name);
      updateActiveAccount({name: patch.name});
    }
    if (patch.phone !== undefined) {
      // A different number is not the one that was verified.
      if (patch.phone !== get().phone && get().phoneVerified) {
        storage.delete(StorageKeys.phoneVerified);
        storage.delete(StorageKeys.attestation);
        updateActiveAccount({phoneVerified: false});
        set({phoneVerified: false, attestation: null});
      }
      storage.set(StorageKeys.phone, patch.phone);
    }
    if (patch.bio !== undefined) {
      storage.set(StorageKeys.bio, patch.bio);
    }
    if (patch.avatarUri !== undefined) {
      if (patch.avatarUri) {
        storage.set(StorageKeys.avatarUri, patch.avatarUri);
      } else {
        storage.delete(StorageKeys.avatarUri);
      }
    }
    if (patch.avatarThumb !== undefined) {
      if (patch.avatarThumb) {
        storage.set(StorageKeys.avatarThumb, patch.avatarThumb);
        updateActiveAccount({thumb: patch.avatarThumb});
      } else {
        storage.delete(StorageKeys.avatarThumb);
        updateActiveAccount({thumb: undefined});
      }
    }
    set(state => ({
      profileName: patch.name ?? state.profileName,
      phone: patch.phone ?? state.phone,
      bio: patch.bio ?? state.bio,
      avatarUri: patch.avatarUri !== undefined ? patch.avatarUri : state.avatarUri,
      avatarThumb: patch.avatarThumb !== undefined ? patch.avatarThumb : state.avatarThumb,
    }));
  },

  linkCloudAccount: (token, userId, phone) => {
    storage.set(StorageKeys.jwt, token);
    storage.set(StorageKeys.userId, userId);
    storage.set(StorageKeys.phone, phone);
    set({hasCloudAccount: true, userId, phone});
  },

  markPhoneVerified: ({phone}) => {
    if (numberUsedByOtherAccount(phone)) {
      return false;
    }
    storage.set(StorageKeys.phone, phone);
    storage.set(StorageKeys.phoneVerified, true);
    storage.delete(StorageKeys.attestation);
    updateActiveAccount({phoneVerified: true, phone: phone.replace(/\D/g, '')});
    set({phone, phoneVerified: true, attestation: null});
    void rememberSim(); // so a later SIM change can be noticed
    return true;
  },

  unlinkCloudAccount: () => {
    storage.delete(StorageKeys.jwt);
    storage.delete(StorageKeys.userId);
    set({hasCloudAccount: false, userId: null});
  },

  resetProfile: () => {
    storage.delete(StorageKeys.jwt);
    storage.delete(StorageKeys.userId);
    storage.delete(StorageKeys.profileName);
    storage.delete(StorageKeys.phone);
    storage.delete(StorageKeys.bio);
    storage.delete(StorageKeys.onboarded);
    set({
      onboarded: false,
      isReady: false,
      hasCloudAccount: false,
      userId: null,
      profileName: null,
      phone: null,
    });
  },
}));
