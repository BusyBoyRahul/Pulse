import {AppState, Linking, NativeEventEmitter} from 'react-native';
import {navigationRef} from '@/navigation/ref';
import {notifier, NativeNotifyModule, isForeground} from '@/services/notifier';
import {useCallStore} from '@/store/callStore';
import {useChatStore} from '@/store/chatStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSessionStore} from '@/store/sessionStore';
import {useSettingsStore} from '@/store/settingsStore';

type Nav = {navigate: (name: string, params?: unknown) => void};
const nav = navigationRef as unknown as Nav;

/** Run once the app has finished starting (a tap can arrive before the screens exist). */
function whenReady(fn: () => void, tries = 40): void {
  if (navigationRef.isReady() && useSessionStore.getState().isReady) {
    fn();
  } else if (tries > 0) {
    setTimeout(() => whenReady(fn, tries - 1), 250);
  }
}

const goTab = (tab: 'ChatsTab' | 'NearbyTab') => whenReady(() => nav.navigate('Main', {screen: tab}));
const goCall = () =>
  whenReady(() => {
    if (navigationRef.getCurrentRoute()?.name !== 'Call') {
      nav.navigate('Call');
    }
  });

type Ev = Record<string, string | undefined>;

/** A tap or button press on one of our Android notifications. */
export function handleAction(ev: Ev): void {
  const conv = ev.conv ?? '';
  const kind = ev.kind ?? '';
  const chat = useChatStore.getState();
  const prefs = usePrefsStore.getState();

  switch (ev.action) {
    case 'open':
      if (kind === 'direct' || kind === 'group') {
        const title =
          kind === 'group'
            ? useGroupsStore.getState().get(conv)?.name ?? ev.title ?? 'Group'
            : prefs.nameFor(conv, ev.title ?? 'Chat');
        whenReady(() => nav.navigate('Conversation', {conversationId: conv, kind, title}));
      } else if (kind === 'sos' || kind === 'pair') {
        goTab('NearbyTab');
      } else if (kind === 'group-invite' || kind === 'transfer') {
        goTab('ChatsTab');
      } else if (kind === 'call') {
        goCall();
      }
      break;
    case 'openCall':
      goCall();
      break;
    case 'openNearby':
      goTab('NearbyTab');
      break;
    case 'answer':
      void useCallStore.getState().accept();
      goCall();
      break;
    case 'decline':
      if (kind === 'group-invite') {
        useGroupsStore.getState().decline(conv);
      } else {
        useCallStore.getState().decline();
      }
      break;
    case 'hangup':
      useCallStore.getState().hangup();
      break;
    case 'reply':
      if (ev.text?.trim() && (kind === 'direct' || kind === 'group')) {
        void chat.sendText(conv, kind, ev.text);
        chat.markSeen(conv, kind);
        prefs.markRead(conv);
        notifier.clearConversation(conv);
      }
      break;
    case 'read':
      if (kind === 'direct' || kind === 'group') {
        chat.markSeen(conv, kind);
        prefs.markRead(conv);
        notifier.clearConversation(conv);
      }
      break;
    case 'accept':
      if (kind === 'pair') {
        const req = usePairingStore.getState().incoming.find(r => r.publicKey === conv);
        if (req) {
          usePairingStore.getState().accept(req);
        }
      } else if (kind === 'group-invite') {
        useGroupsStore.getState().accept(conv);
      }
      break;
    case 'ignore':
      usePairingStore.getState().dismiss(conv);
      break;
    case 'dismiss':
      useSettingsStore.getState().dismissResponderAlert();
      break;
    case 'map':
      if (/^-?[\d.]+,-?[\d.]+$/.test(conv)) {
        Linking.openURL(`https://maps.google.com/?q=${conv}`).catch(() => undefined);
      }
      break;
  }
}

let started = false;

/**
 * Connects the app's live events to Android notifications: nearby SOS alerts,
 * connect requests, group invites, photo progress and incoming calls — and
 * listens for taps and buttons on them. Display only: no state of its own.
 */
export function startNotificationBridge(): void {
  if (started) {
    return;
  }
  started = true;

  // Taps and buttons (including ones that happened before JS was running).
  if (NativeNotifyModule) {
    new NativeEventEmitter(NativeNotifyModule as never).addListener('PulseNotifAction', (ev: Ev) => handleAction(ev));
    NativeNotifyModule.ready()
      .then(queued => queued.forEach(ev => handleAction(ev)))
      .catch(() => undefined);
  }

  // Privacy: hide Pulse from screenshots / the recent-apps list.
  notifier.setSecure(useSettingsStore.getState().app.secureScreen);
  let secure = useSettingsStore.getState().app.secureScreen;
  useSettingsStore.subscribe(s => {
    if (s.app.secureScreen !== secure) {
      secure = s.app.secureScreen;
      notifier.setSecure(secure);
    }
  });

  // ---- nearby SOS ----------------------------------------------------------
  let lastSos = '';
  useSettingsStore.subscribe(s => {
    const a = s.responderAlert;
    if (a && a.id !== lastSos) {
      lastSos = a.id;
      notifier.sos(a);
    }
  });

  // ---- connect requests ----------------------------------------------------
  let shownPairs = new Set<string>();
  usePairingStore.subscribe(s => {
    const now = new Set(s.incoming.map(r => r.publicKey));
    for (const gone of shownPairs) {
      if (!now.has(gone)) {
        notifier.cancelPair(gone);
      }
    }
    for (const req of s.incoming) {
      if (!shownPairs.has(req.publicKey)) {
        notifier.pair({
          publicKey: req.publicKey,
          name: req.name,
          avatar: usePeersStore.getState().peers[req.publicKey]?.avatar,
        });
      }
    }
    shownPairs = now;
  });

  // ---- group invites -------------------------------------------------------
  let shownInvites = new Set<string>();
  useGroupsStore.subscribe(s => {
    const now = new Set(s.pendingInvites.map(i => i.id));
    for (const gone of shownInvites) {
      if (!now.has(gone)) {
        notifier.cancelGroupInvite(gone);
      }
    }
    for (const inv of s.pendingInvites) {
      if (!shownInvites.has(inv.id)) {
        notifier.groupInvite(inv);
      }
    }
    shownInvites = now;
  });

  // ---- photo transfers -----------------------------------------------------
  let lastXfer = 0;
  let showingXfer = false;
  useChatStore.subscribe(s => {
    let best: {mine: boolean; progress: number} | null = null;
    for (const list of Object.values(s.byConversation)) {
      for (const m of list) {
        if (m.progress !== undefined && m.type === 'image') {
          best = {mine: m.mine, progress: m.progress};
        }
      }
    }
    if (!best) {
      if (showingXfer) {
        showingXfer = false;
        notifier.transfer('photo', '', null);
      }
      return;
    }
    const now = Date.now();
    if (now - lastXfer < 700) {
      return;
    }
    lastXfer = now;
    showingXfer = true;
    notifier.transfer('photo', best.mine ? 'Sending photo' : 'Receiving photo', best.progress);
  });

  // ---- incoming call while the app is open ---------------------------------
  // (When the app is closed or in the background, the ringing notification does the job.)
  let lastPhase = '';
  useCallStore.subscribe(s => {
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      if (s.phase === 'incoming' && isForeground()) {
        goCall();
      }
    }
  });

  // ---- coming back to the app ----------------------------------------------
  AppState.addEventListener('change', state => {
    if (state === 'active') {
      const open = useChatStore.getState().active;
      if (open) {
        notifier.clearConversation(open);
        usePrefsStore.getState().markRead(open);
      }
    }
  });
}
