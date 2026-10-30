import {AppState, NativeModules, Platform} from 'react-native';
import {useSettingsStore, inQuietHours} from '@/store/settingsStore';
import {usePrefsStore} from '@/store/prefsStore';

/**
 * Real Android notifications — heads-up banners, the notification shade and the
 * lock screen. Everything the user needs to notice goes through here; there are
 * no pop-ups drawn inside the app.
 *
 * The native side (NotifyModule.kt) owns channels, styles and buttons; this
 * file decides WHAT to show and respects the user's Settings: master switches,
 * per-chat mute, block, quiet hours, "show message text".
 */
type NativeNotify = {
  show(opts: Record<string, unknown>): void;
  cancel(id: number): void;
  cancelAll(): void;
  ready(): Promise<Record<string, string>[]>;
  areEnabled(): Promise<boolean>;
  openChannelSettings(channelKey: string | null): void;
  setSecure(on: boolean): void;
  isBatteryUnrestricted(): Promise<boolean>;
  requestBatteryUnrestricted(): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

export const NativeNotifyModule = NativeModules.PulseNotify as NativeNotify | undefined;

const MAX_LINES = 6;

/** Stable positive id for a notification, so a newer one replaces the older. */
export function idFor(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return 10000 + (Math.abs(h) % 2_000_000);
}

export const isForeground = () => AppState.currentState === 'active';

type Line = {sender: string; text: string; at: number};
const lines = new Map<string, Line[]>();

export type MessageNote = {
  conversationId: string;
  kind: 'direct' | 'group';
  title: string; // person or group name (nickname applied)
  sender: string;
  text: string;
  avatar?: string; // data: URI
  /** The chat that is open on screen right now, if any. */
  activeConversation?: string | null;
};

export const notifier = {
  get available(): boolean {
    return Platform.OS === 'android' && !!NativeNotifyModule;
  },

  message(m: MessageNote): void {
    if (!NativeNotifyModule) {
      return;
    }
    const prefs = usePrefsStore.getState();
    const app = useSettingsStore.getState().app;
    if (!app.notifyMessages || prefs.isMuted(m.conversationId) || prefs.isBlocked(m.conversationId)) {
      return;
    }
    // Looking straight at that chat: no banner for it.
    if (isForeground() && m.activeConversation === m.conversationId) {
      return;
    }
    const locked = !!prefs.prefs[m.conversationId]?.locked;
    const at = Date.now();
    const history = locked ? [] : [...(lines.get(m.conversationId) ?? []), {sender: m.sender, text: m.text, at}].slice(-MAX_LINES);
    lines.set(m.conversationId, history);
    NativeNotifyModule.show({
      id: idFor(`msg:${m.conversationId}`),
      channel: 'messages',
      title: locked ? 'Pulse' : m.title,
      text: locked ? 'New message' : m.text,
      sender: locked ? 'Someone' : m.sender,
      isGroup: !locked && m.kind === 'group',
      lines: history,
      avatar: locked ? undefined : m.avatar,
      when: at,
      silent: !app.notifyAlert || inQuietHours(app),
      hideText: locked || !app.notifyPreview,
      convId: m.conversationId,
      kind: m.kind,
      group: 'pulse_messages',
      actions: [
        {id: 'reply', label: 'Reply', input: true},
        {id: 'read', label: 'Mark as read'},
      ],
    });
  },

  /** The user opened that chat (or read it elsewhere): take its banner away. */
  clearConversation(conversationId: string): void {
    lines.delete(conversationId);
    NativeNotifyModule?.cancel(idFor(`msg:${conversationId}`));
  },

  /** Somebody nearby pressed SOS. Always loud; quiet hours never silence it. */
  sos(a: {id: string; name?: string; note?: string; lat?: number; lng?: number}): void {
    if (!NativeNotifyModule) {
      return;
    }
    const hasLoc = a.lat != null && a.lng != null;
    NativeNotifyModule.show({
      id: idFor(`sos:${a.id}`),
      channel: 'sos',
      title: `${a.name?.trim() || 'Someone nearby'} needs help`,
      text: a.note?.trim() || (hasLoc ? 'Tap to see where they are' : 'SOS received · no location shared'),
      convId: hasLoc ? `${a.lat},${a.lng}` : '',
      kind: 'sos',
      actions: [
        {id: 'dismiss', label: 'Dismiss'},
        ...(hasLoc ? [{id: 'map', label: 'Show location', opens: true}] : []),
      ],
    });
  },

  pair(req: {publicKey: string; name: string; avatar?: string}): void {
    const app = useSettingsStore.getState().app;
    if (!NativeNotifyModule || !app.notifyRequests || usePrefsStore.getState().isBlocked(req.publicKey)) {
      return;
    }
    NativeNotifyModule.show({
      id: idFor(`pair:${req.publicKey}`),
      channel: 'requests',
      title: req.name,
      text: 'wants to connect with you',
      avatar: req.avatar,
      silent: !app.notifyAlert || inQuietHours(app),
      convId: req.publicKey,
      kind: 'pair',
      actions: [
        {id: 'ignore', label: 'Ignore'},
        {id: 'accept', label: 'Accept'},
      ],
    });
  },

  cancelPair(publicKey: string): void {
    NativeNotifyModule?.cancel(idFor(`pair:${publicKey}`));
  },

  groupInvite(inv: {id: string; name: string; byName: string}): void {
    const app = useSettingsStore.getState().app;
    if (!NativeNotifyModule || !app.notifyRequests) {
      return;
    }
    NativeNotifyModule.show({
      id: idFor(`ginv:${inv.id}`),
      channel: 'requests',
      title: inv.name,
      text: `${inv.byName} invited you to a group`,
      silent: !app.notifyAlert || inQuietHours(app),
      convId: inv.id,
      kind: 'group-invite',
      actions: [
        {id: 'decline', label: 'Decline'},
        {id: 'accept', label: 'Join'},
      ],
    });
  },

  cancelGroupInvite(id: string): void {
    NativeNotifyModule?.cancel(idFor(`ginv:${id}`));
  },

  /** A photo going out or coming in: a quiet progress bar in the shade. */
  transfer(key: string, title: string, progress: number | null): void {
    if (!NativeNotifyModule) {
      return;
    }
    const id = idFor(`xfer:${key}`);
    if (progress === null) {
      NativeNotifyModule.cancel(id);
      return;
    }
    NativeNotifyModule.show({
      id,
      channel: 'transfers',
      title,
      text: `${Math.round(progress * 100)}%`,
      progress,
      ongoing: true,
      silent: true,
      onlyAlertOnce: true,
      kind: 'transfer',
    });
  },

  /** For the "Send a test notification" buttons in Settings. */
  test(kind: 'message' | 'sos' | 'request'): void {
    if (!NativeNotifyModule) {
      return;
    }
    if (kind === 'message') {
      const app = useSettingsStore.getState().app;
      NativeNotifyModule.show({
        id: idFor('test:msg'),
        channel: 'messages',
        title: 'Jo Chen',
        text: 'Made it to the trailhead — see you soon',
        sender: 'Jo Chen',
        lines: [{sender: 'Jo Chen', text: 'Made it to the trailhead — see you soon', at: Date.now()}],
        silent: !app.notifyAlert || inQuietHours(app),
        hideText: !app.notifyPreview,
        convId: 'test',
        kind: 'test',
        actions: [{id: 'read', label: 'Mark as read'}],
      });
    } else if (kind === 'sos') {
      NativeNotifyModule.show({
        id: idFor('test:sos'),
        channel: 'sos',
        title: 'Priya needs help',
        text: 'This is a test SOS alert',
        convId: '',
        kind: 'sos',
        actions: [{id: 'dismiss', label: 'Dismiss'}],
      });
    } else {
      NativeNotifyModule.show({
        id: idFor('test:req'),
        channel: 'requests',
        title: 'Sam Rivera',
        text: 'wants to connect with you',
        convId: 'test',
        kind: 'pair',
        actions: [{id: 'dismiss', label: 'Ignore'}],
      });
    }
  },

  async enabled(): Promise<boolean> {
    try {
      return NativeNotifyModule ? await NativeNotifyModule.areEnabled() : true;
    } catch {
      return true;
    }
  },

  openSystemSettings(channelKey: 'messages' | 'sos' | 'calls' | 'requests' | null = null): void {
    NativeNotifyModule?.openChannelSettings(channelKey);
  },

  setSecure(on: boolean): void {
    NativeNotifyModule?.setSecure(on);
  },

  async batteryUnrestricted(): Promise<boolean> {
    try {
      return NativeNotifyModule ? await NativeNotifyModule.isBatteryUnrestricted() : true;
    } catch {
      return true;
    }
  },

  requestBatteryUnrestricted(): void {
    NativeNotifyModule?.requestBatteryUnrestricted();
  },
};

export default notifier;
