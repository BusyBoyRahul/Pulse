import {themedStyles} from '@/theme/themed';
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  ViewStyle,
  ToastAndroid,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useHeaderHeight} from '@react-navigation/elements';
import {Screen, Txt, Icon, IconName, IconButton, Sheet, Avatar, GroupAvatar, ImageViewer, RichText, DisappearSheet, ChatUnlock, useChatLock, Wallpaper, PopoverItem, Popover, Pressy, IconTile, Rim, AttachPanel, MediaComposer, PollCreator, PollView, PhotoEditor, AlbumGrid, HeaderSearchField} from '@/components';
import {alpha, colors, elevation, radius, spacing, typography, shadowTone} from '@/theme/theme';
import {useChatStore} from '@/store/chatStore';
import {useSettingsStore} from '@/store/settingsStore';
import {stripFormatting} from '@/services/richText';
import {BIT, Mark, fromMarked, serialize, shiftMasks, toRuns, toggleMark} from '@/services/composerFormat';
import {useCallStore} from '@/store/callStore';
import {useMeshStore} from '@/mesh/meshStore';
import {usePeersStore} from '@/store/peersStore';
import {useGroupsStore, canSendIn, canEditInfoOf, pinsOf} from '@/store/groupsStore';
import {useSessionStore} from '@/store/sessionStore';
import {usePairingStore} from '@/store/pairingStore';
import {useSecretStore, SECRET_TIMERS, secretTimerText} from '@/store/secretStore';
import {useNetStore} from '@/net/netStore';
import {placeCall} from '@/net/callRouter';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {useCallLogStore, CallEntry} from '@/store/callLogStore';
import {pickChatPhotos, takeChatPhoto, MAX_PHOTO_BYTES} from '@/services/imagePicker';
import {notifier} from '@/services/notifier';
import {mediaFiles, formatBytes, formatDuration, kindOfMime, PickedFile, GalleryItem} from '@/services/mediaFiles';
import {activeMention, applyMention, firstWord} from '@/services/mentions';
import {markExternal} from '@/services/appLifecycle';
import {loadBlob, saveBlob} from '@/services/storage';
import {requestMicrophone, askGalleryOnce} from '@/services/permissions';
import {getIdentity} from '@/services/identity';
import {useLockStore} from '@/store/lockStore';
import type {RootStackParamList} from '@/navigation/types';
import type {ChatMessage, GroupNote, ReplyPreview} from '@/types';
import {alertDialog} from '@/components/Dialog';

type ConvRoute = RouteProp<RootStackParamList, 'Conversation'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJIS = [
  '😀', '😁', '😅', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡',
  '🥳', '🤯', '😬', '🙄', '👏', '🙌', '👌', '✌️', '🤝', '💪', '🔥', '✨',
  '🎉', '💯', '❤️‍🔥', '💔', '👀', '✅', '❌', '⚠️', '🆘', '🏥', '📍', '🚗',
];
const GROUP_WINDOW = 4 * 60 * 1000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Most things that can be sent in one go. */
const MAX_OUT = 10;

/** Something chosen to send, waiting in the tray. */
type Outgoing = {key: string; kind: 'photo'; base64: string} | {key: string; kind: 'file'; file: PickedFile};
let outKey = 0;

type Row =
  | {kind: 'date'; id: string; label: string}
  | {kind: 'call'; id: string; entry: CallEntry}
  /** Something that happened in a group: “Maya added Rahul”, “Sam left”… */
  | {kind: 'note'; id: string; text: string}
  | {kind: 'msg'; id: string; msg: ChatMessage; grouped: boolean; showSender: boolean; /** Photos sent together, first to last (the row stands for all of them). */ album?: ChatMessage[]};

/** What a photo / file inside a bubble must do so it behaves like the rest of the bubble: long-press opens the menu, and a tap selects it while selecting. */
type Press = {selecting: boolean; toggle: () => void; longPress: () => void};

/** Which album a photo belongs to (same sender, same group id). */
const albumKey = (m: ChatMessage) => `${m.from}|${m.album?.g}`;

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const formatTime = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export function dayLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
function aggregate(emojis: string[]): [string, number][] {
  const m: Record<string, number> = {};
  emojis.forEach(e => (m[e] = (m[e] ?? 0) + 1));
  return Object.entries(m);
}
export function previewOf(m: ChatMessage): string {
  if (m.type === 'file') {
    return m.file?.kind === 'voice' ? 'Voice message' : m.file?.kind === 'video' ? 'Video' : m.file?.name ?? 'File';
  }
  return m.type === 'image' ? (m.viewOnce ? 'View-once photo' : 'Photo') : m.type === 'poll' ? 'Poll' : m.type === 'contact' ? 'Contact' : stripFormatting(m.text ?? '');
}
const disappearLabel = (ms?: number) =>
  !ms ? 'Off' : ms <= 24 * 3600_000 ? '24 hours' : ms <= 7 * 24 * 3600_000 ? '7 days' : '90 days';
// Message ticks on my (blue) bubbles.
const TICK_SOFT = 'rgba(255,255,255,0.78)';
const TICK_SEEN = '#4ADE80';
const TICK_FAILED = '#FFB4B4';
export const relayWord = (n: number) => `${n} relay${n === 1 ? '' : 's'}`;
const toast = (msg: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  }
};

type FileCtxValue = {
  player: {path: string; state: string; pos: number; dur: number};
  onPlay: (m: ChatMessage) => void;
  onOpen: (m: ChatMessage) => void;
  /** Notes to self have no delivery ticks. */
  hideTicks: boolean;
};
const FileCtx = React.createContext<FileCtxValue>({player: {path: '', state: 'stopped', pos: 0, dur: 0}, onPlay: () => {}, onOpen: () => {}, hideTicks: false});

export default function ConversationScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<ConvRoute>();
  const {conversationId, kind} = params;
  const {width: screenW, height: windowH} = useWindowDimensions();

  const messages = useChatStore(s => s.byConversation[conversationId] ?? []);
  const reactions = useChatStore(s => s.reactions);
  const votes = useChatStore(s => s.votes);
  const {sendText, sendImage, sendPoll, sendContact, sendFile, sendVoice, react, vote, markSeen} = useChatStore.getState();
  const devices = useMeshStore(s => s.devices);
  // A secret chat is its own conversation, but it is with one person: that person's key is what the radio sees.
  const secret = useSecretStore(s => s.chats[conversationId]);
  const peerKey = secret?.peerKey ?? conversationId;
  const viaInternet = useNetStore(s => kind === 'direct' && s.linked.includes(peerKey));
  const online = usePeersStore(s => (kind === 'direct' ? s.isOnline(peerKey) : false));
  const hops = usePeersStore(s => (kind === 'direct' ? s.hopsTo(peerKey) : null));
  const peerAvatar = usePeersStore(s => (kind === 'direct' ? s.peers[peerKey]?.avatar : undefined));
  const knownAvatar = usePrefsStore(s => (kind === 'direct' ? s.profiles[peerKey]?.avatar : undefined));
  const prefs = usePrefsStore(s => s.prefs[conversationId]);
  const group = useGroupsStore(s => (kind === 'group' ? s.groups.find(g => g.id === conversationId) : undefined));
  const paired = usePairingStore(s => s.paired);
  const groups = useGroupsStore(s => s.groups);
  const title = kind === 'direct' ? prefs?.nickname?.trim() || params.title : kind === 'group' ? group?.name ?? params.title : params.title;
  const blocked = !!prefs?.blocked;
  // Notes to self: a chat with yourself that never leaves this phone.
  const isSelf = kind === 'direct' && conversationId === getIdentity().publicKey;
  // No chat without a connection: a direct chat needs you to have paired with them.
  const connected = kind !== 'direct' || isSelf || paired.some(p => p.publicKey === peerKey);
  const muted = usePrefsStore.getState().isMuted(conversationId);
  const typingNow = useChatStore(s => kind === 'direct' && (s.typing[conversationId] ?? 0) > Date.now());
  /** Who is typing in this group right now (their keys, joined with "|"). */
  const groupTypers = useChatStore(s => (kind === 'group' && group ? group.members.filter(k => (s.typing[`${conversationId}:${k}`] ?? 0) > Date.now()).join('|') : ''));
  const wallpaper = useSettingsStore(s => s.app.wallpaper);
  const wpOpacity = useSettingsStore(s => s.app.wallpaperOpacity);
  const wpBlur = useSettingsStore(s => s.app.wallpaperBlur);
  const chatLocked = usePrefsStore(s => !!s.prefs[conversationId]?.locked);
  const unlocked = useLockStore(s => s.chatsUnlocked || !s.saved.chat);
  // A locked chat shows only the code screen until the locked chats are opened (one code opens them all).
  const lockedOut = chatLocked && !unlocked;
  // Locking the chat you're in sends you back to the list: it has just moved into "Locked chats".
  const lockCtl = useChatLock(conversationId, now => now === 'locked' && nav.goBack());

  const [text, setText] = useState('');
  /** One style number per character of `text` (bold, italic …) — shown live, turned into marks on send. */
  const [masks, setMasks] = useState<number[]>([]);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  /**
   * Where the attach panel sits. Normally it FLOATS over the bottom of the chat and takes no room, so the chat never moves.
   * If the keyboard was up when it was opened, it takes the keyboard's place instead (same spot, so nothing moves either).
   */
  const [attachInFlow, setAttachInFlow] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pinIdx, setPinIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [forwardOf, setForwardOf] = useState<ChatMessage[] | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewingOnce, setViewingOnce] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [outCaption, setOutCaption] = useState('');
  // Height of the floating message box, so the last message is never hidden behind it.
  const [dockH, setDockH] = useState(0);
  const [photoSpoiler, setPhotoSpoiler] = useState(false);
  /** Photo timer for the next send: 0 = none, -1 = one look, otherwise seconds after they open it. */
  const [photoTimer, setPhotoTimer] = useState(0);
  const [editKey, setEditKey] = useState<string | null>(null);
  /** The preview steps aside while more things are being picked in the attach panel. */
  const [composerAside, setComposerAside] = useState(false);
  /** The attach panel pulled up to nearly full height (the message box steps out of the way). */
  const [attachExpanded, setAttachExpanded] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const tapAt = useRef({x: 0, y: 0, t: 0});
  /** The keyboard's height the last time it was open, so the attach panel takes the same space. */
  const [kbHeight, setKbHeight] = useState(300);
  const [viewSecs, setViewSecs] = useState(0);
  const [viewLeft, setViewLeft] = useState(0);
  const [viewCap, setViewCap] = useState('');
  /** An album open in the swipeable viewer: its photos (as they were when opened) and which one is showing. */
  const [gallery, setGallery] = useState<{images: string[]; index: number} | null>(null);
  const [disOpen, setDisOpen] = useState(false);
  const [sel, setSel] = useState({start: 0, end: 0});
  const [forcedSel, setForcedSel] = useState<{start: number; end: number} | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [wpPhoto, setWpPhoto] = useState<string | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [recMs, setRecMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const pausedTotal = useRef(0);
  const pausedAt = useRef(0);
  const [player, setPlayer] = useState<FileCtxValue['player']>({path: '', state: 'stopped', pos: 0, dur: 0});
  const listRef = useRef<FlatList<Row>>(null);
  const headerHeight = useHeaderHeight();

  const secretStatus = secret
    ? secret.status === 'waiting'
      ? 'waiting…'
      : secret.status === 'securing'
      ? 'securing…'
      : `secret · ${secretTimerText(prefs?.disappear ?? 0)}`
    : '';
  // Under a group's name: who is in it, "You, Rahul, Sam".
  const groupLine = group
    ? [
        'You',
        ...group.members
          .filter(k => k !== getIdentity().publicKey)
          .map(k => usePrefsStore.getState().nameFor(k, paired.find(p => p.publicKey === k)?.name || 'Pulse user')),
      ].join(', ')
    : '';
  // "Rahul is typing…", "Rahul, Sam are typing…", "3 people are typing…"
  const typerNames = groupTypers
    ? groupTypers.split('|').map(k => usePrefsStore.getState().nameFor(k, paired.find(p => p.publicKey === k)?.name || 'Someone').split(' ')[0])
    : [];
  const typersText = typerNames.length === 1 ? `${typerNames[0]} is typing…` : typerNames.length === 2 ? `${typerNames[0]}, ${typerNames[1]} are typing…` : `${typerNames.length} people are typing…`;
  const statusText =
    secret
      ? secretStatus
      : isSelf
      ? 'just you'
      : typingNow
      ? 'typing…'
      : kind === 'nearby'
      ? `${devices.length} in range`
      : kind === 'group'
      ? groupTypers
        ? typersText
        : groupLine
      : blocked
      ? 'blocked'
      : online || viaInternet
      ? 'online'
      : 'offline';
  // A tiny icon says how they are reached, so the words can stay one word long.
  const statusIcon: IconName | null =
    secret ? 'lock' : isSelf || typingNow || !!groupTypers || blocked ? null : kind === 'nearby' ? 'radar' : kind === 'group' ? 'users' : online ? 'radar' : viaInternet ? 'globe' : kind === 'direct' ? 'clock' : null;
  const rightButtons = kind === 'direct' && !blocked && connected && !isSelf ? 3 : 1;
  // Keep the name and status clear of the back arrow and the buttons on the right.
  const headerMaxW = Math.max(120, screenW - 56 - rightButtons * 44 - 28);

  const openInfo = () =>
    kind === 'group' ? nav.navigate('GroupInfo', {groupId: conversationId}) : isSelf ? nav.navigate('EditProfile') : nav.navigate('Contact', {publicKey: peerKey});
  const exitSelecting = () => {
    setSelecting(false);
    setSelected([]);
  };
  /** Everything that moves with this message: the whole album for a photo in one, otherwise just the message. */
  const albumMembers = (m: ChatMessage): ChatMessage[] =>
    m.type === 'image' && m.album && !m.viewOnce
      ? messages.filter(x => x.type === 'image' && x.album && albumKey(x) === albumKey(m)).sort((a, b) => (a.album?.i ?? 0) - (b.album?.i ?? 0))
      : [m];
  const selectedMsgs = messages.filter(m => selected.includes(m.id));
  /** The one message (or one album) that is selected, if it is exactly one: reply, react, edit, info work on it. */
  const singleMsg: ChatMessage | null =
    selectedMsgs.length === 1
      ? selectedMsgs[0]
      : selectedMsgs.length > 1 && selectedMsgs.every(m => m.type === 'image' && !!m.album && albumKey(m) === albumKey(selectedMsgs[0]))
      ? selectedMsgs[0]
      : null;
  const [selMoreOpen, setSelMoreOpen] = useState(false);

  // ---- header ---------------------------------------------------------------
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searching || !q) {
      return messages;
    }
    return messages.filter(
      m =>
        previewOf(m).toLowerCase().includes(q) ||
        (m.caption ?? '').toLowerCase().includes(q) ||
        (m.poll?.question ?? '').toLowerCase().includes(q) ||
        (m.poll?.options ?? []).some(o => o.toLowerCase().includes(q)) ||
        (m.contact?.name ?? '').toLowerCase().includes(q),
    );
  }, [messages, query, searching]);

  useLayoutEffect(() => {
    if (lockedOut) {
      nav.setOptions({
        headerBackVisible: undefined,
        headerLeft: undefined,
        headerRight: undefined,
        headerTitle: () => <Txt variant="subtitle">Locked chat</Txt>,
      });
      return;
    }
    if (selecting) {
      nav.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <Pressable onPress={exitSelecting} hitSlop={10} style={styles.hdrBtn} accessibilityLabel="Cancel selection">
            <Icon name="x" size={20} color={colors.text} />
          </Pressable>
        ),
        // Just the number (no words to read): how many are selected.
        headerTitle: () => (
          <View style={{marginLeft: spacing.md}}>
            <Txt variant="title">{selected.length === 0 ? '·' : String(selected.length)}</Txt>
          </View>
        ),
        headerRight: () => (
          <View style={styles.hdrRow}>
            {singleMsg ? (
              <Pressable
                onPress={() => {
                  startReply(singleMsg);
                  exitSelecting();
                }}
                hitSlop={8}
                style={styles.hdrBtn}
                accessibilityLabel="Reply">
                <Icon name="reply" size={19} color={colors.text} />
              </Pressable>
            ) : null}
            {secret ? null : (
              <Pressable onPress={copySelected} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Copy">
                <Icon name="copy" size={19} color={colors.text} />
              </Pressable>
            )}
            {secret ? null : (
              <Pressable onPress={() => setForwardOf(selectedMsgs)} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Forward">
                <Icon name="forward" size={19} color={colors.text} />
              </Pressable>
            )}
            <Pressable onPress={() => askDelete(selectedMsgs)} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Delete">
              <Icon name="trash" size={19} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => setSelMoreOpen(true)} hitSlop={8} style={styles.hdrBtn} accessibilityLabel="More">
              <Icon name="more" size={19} color={colors.text} />
            </Pressable>
          </View>
        ),
      });
      return;
    }
    if (searching) {
      // Search lives in the header, like on every page: the title becomes the search box.
      nav.setOptions({
        headerBackVisible: undefined,
        headerLeft: undefined,
        headerTitle: () => <HeaderSearchField value={query} onChange={setQuery} placeholder="Search in this chat" note={query.trim() ? `${visible.length} found` : undefined} />,
        headerRight: () => (
          <IconButton
            icon="x"
            label="Close search"
            onPress={() => {
              setSearching(false);
              setQuery('');
            }}
          />
        ),
      });
      return;
    }
    nav.setOptions({
      headerBackVisible: undefined,
      headerLeft: undefined,
      headerRight: () => (
        <View style={styles.hdrRow}>
          {kind === 'direct' && !blocked && connected && !isSelf ? (
            <Pressable
              onPress={() => placeCall(peerKey, title, false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Call ${title}`}
              style={styles.hdrBtn}>
              <Icon name="phone" size={18} color={colors.text} />
            </Pressable>
          ) : null}
          {kind === 'direct' && !blocked && connected && !isSelf ? (
            <Pressable onPress={() => placeCall(peerKey, title, true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Video call ${title}`} style={styles.hdrBtn}>
              <Icon name="video" size={18} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options" style={styles.hdrBtn}>
            <Icon name="more" size={20} color={colors.text} />
          </Pressable>
        </View>
      ),
      headerTitle: () => (
        <Pressable onPress={openInfo} style={[styles.headerWrap, {maxWidth: headerMaxW}]} accessibilityRole="button" accessibilityLabel={`${title} profile`}>
          {kind === 'nearby' ? (
            <IconTile icon="radar" size={38} color={colors.primary} />
          ) : kind === 'group' ? (
            <GroupAvatar pic={group?.pic} size={38} />
          ) : (
            <Avatar name={title} seed={peerKey} uri={peerAvatar ?? knownAvatar} size={38} dot={secret ? colors.primary : undefined} />
          )}
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Txt variant="subtitle" numberOfLines={1} style={{flexShrink: 1}}>
                {title}
              </Txt>
              {muted ? <Icon name="bellOff" size={12} color={colors.textMuted} /> : null}
            </View>
            <View style={styles.statusRow}>
              {statusIcon ? <Icon name={statusIcon} size={12} color={kind === 'direct' && online ? colors.primaryBright : colors.textMuted} /> : null}
              <Txt variant="caption" tone={kind === 'direct' && (online || viaInternet) ? 'secondary' : 'muted'} numberOfLines={1} style={{flexShrink: 1}}>
                {statusText}
              </Txt>
            </View>
          </View>
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, title, kind, group?.pic, statusText, statusIcon, headerMaxW, online, conversationId, peerAvatar, knownAvatar, selecting, selected, blocked, muted, messages, connected, lockedOut, isSelf, searching, query, visible.length]);

  // Tell the app which chat is on screen (no notification for it) and load its photos.
  useFocusEffect(
    React.useCallback(() => {
      if (lockedOut) {
        return undefined; // nothing is read, cleared or acknowledged while the chat is locked
      }
      useChatStore.getState().setActive(conversationId);
      void useChatStore.getState().hydrateMedia(conversationId);
      notifier.clearConversation(conversationId);
      usePrefsStore.getState().markRead(conversationId);
      return () => useChatStore.getState().setActive(null);
    }, [conversationId, lockedOut]),
  );

  useEffect(() => {
    if (lockedOut) {
      return;
    }
    if (!searching) {
      listRef.current?.scrollToOffset({offset: 0, animated: true});
    }
    markSeen(conversationId, kind);
    if (AppState.currentState === 'active') {
      usePrefsStore.getState().markRead(conversationId);
    }
  }, [messages.length, conversationId, kind, markSeen, searching, lockedOut]);

  // Photo wallpaper, voice-note playback progress, recording timer — and tidy up on the way out.
  useEffect(() => {
    if (wallpaper === 'photo') {
      void loadBlob('wallpaper').then(setWpPhoto);
    }
  }, [wallpaper]);

  useEffect(() => mediaFiles.onPlayer(e => setPlayer(e)), []);

  useEffect(() => {
    if (recording === null) {
      return;
    }
    const t = setInterval(() => {
      const now = Date.now();
      const ms = now - recording - pausedTotal.current - (pausedAt.current ? now - pausedAt.current : 0);
      setRecMs(ms);
      if (ms > 5 * 60 * 1000) {
        void finishRecording();
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  useEffect(
    () => () => {
      void mediaFiles.voice.cancel();
      void mediaFiles.play.stop();
      useChatStore.getState().setTyping(conversationId, false);
    },
    [conversationId],
  );

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', e => setKbHeight(Math.max(260, Math.round(e.endCoordinates.height))));
    return () => sub.remove();
  }, []);

  // Anything else taking over the screen closes the attach panel first, so those actions work in one go.
  useEffect(() => {
    if (selecting || searching) {
      setAttachOpen(false);
    }
  }, [selecting, searching]);

  useEffect(() => {
    if (!attachOpen) {
      setAttachExpanded(false);
    }
  }, [attachOpen]);

  // Back from the attach panel (added something, or closed it): the preview comes back.
  useEffect(() => {
    if (!attachOpen && composerAside) {
      setComposerAside(false);
    }
  }, [attachOpen, composerAside]);

  // The keyboard and the attach panel share the same spot: typing closes the panel.
  useEffect(() => {
    if (!attachOpen) {
      return undefined;
    }
    // Only when the message box itself asked for the keyboard (the panel's own search box may open it too).
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (TextInput.State.currentlyFocusedInput?.() === (inputRef.current as unknown)) {
        setAttachOpen(false);
      }
    });
    return () => sub.remove();
  }, [attachOpen]);

  // Android back button leaves selection mode / search first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selecting) {
        exitSelecting();
        return true;
      }
      if (searching) {
        setSearching(false);
        setQuery('');
        return true;
      }
      if (attachOpen) {
        if (attachExpanded) {
          setAttachExpanded(false);
        } else {
          setAttachOpen(false);
        }
        return true;
      }
      if (editing) {
        setEditing(null);
        setText('');
        setMasks([]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selecting, searching, editing, attachOpen, attachExpanded]);

  const allCalls = useCallLogStore(s => s.calls);
  const callsHere = useMemo(() => (kind === 'direct' && !isSelf ? allCalls.filter(c => c.peerKey === conversationId) : []), [allCalls, kind, isSelf, conversationId]);
  const groupNotes = group?.notes;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastTs = 0;
    let lastFrom = '';
    // Photos sent together become ONE row (a grid), anchored where the first of them is.
    const albums = new Map<string, ChatMessage[]>();
    visible.forEach(m => {
      if (m.type === 'image' && m.album && !m.viewOnce) {
        albums.set(albumKey(m), [...(albums.get(albumKey(m)) ?? []), m]);
      }
    });
    const placed = new Set<string>();
    // Calls with this person sit in the timeline between the messages (not while searching).
    type Item = {ts: number; m?: ChatMessage; c?: CallEntry; n?: GroupNote};
    const items: Item[] = [
      ...visible.map(m => ({ts: m.timestamp, m})),
      ...(searching ? [] : callsHere.map(c => ({ts: c.at, c}))),
      // what happened in a group (joined, left, renamed…) sits in the timeline too
      ...(searching ? [] : (groupNotes ?? []).map(n => ({ts: n.at, n}))),
    ].sort((a, b) => a.ts - b.ts);
    items.forEach(it => {
      if (it.n) {
        if (out.length === 0 || !sameDay(lastTs, it.ts)) {
          out.push({kind: 'date', id: `d-${it.n.id}`, label: dayLabel(it.ts)});
        }
        out.push({kind: 'note', id: `n-${it.n.id}`, text: it.n.text});
        lastTs = it.ts;
        lastFrom = '';
        return;
      }
      if (it.c) {
        if (out.length === 0 || !sameDay(lastTs, it.ts)) {
          out.push({kind: 'date', id: `d-${it.c.id}`, label: dayLabel(it.ts)});
        }
        out.push({kind: 'call', id: `c-${it.c.id}`, entry: it.c});
        lastTs = it.ts;
        lastFrom = '';
        return;
      }
      const m = it.m as ChatMessage;
      const members = m.type === 'image' && m.album && !m.viewOnce ? albums.get(albumKey(m)) : undefined;
      if (members) {
        if (placed.has(albumKey(m))) {
          return; // already shown inside the grid
        }
        placed.add(albumKey(m));
      }
      if (out.length === 0 || !sameDay(lastTs, m.timestamp)) {
        out.push({kind: 'date', id: `d-${m.id}`, label: dayLabel(m.timestamp)});
        lastFrom = '';
      }
      const grouped = m.from === lastFrom && m.timestamp - lastTs < GROUP_WINDOW;
      const sorted = members ? [...members].sort((a, b) => (a.album?.i ?? 0) - (b.album?.i ?? 0)) : undefined;
      out.push({kind: 'msg', id: m.id, msg: sorted ? sorted[0] : m, grouped, showSender: !m.mine && kind !== 'direct' && !grouped, album: sorted});
      lastTs = m.timestamp;
      lastFrom = m.from;
    });
    return out;
  }, [visible, kind, callsHere, searching, groupNotes]);

  // The chat list grows upward from the bottom (inverted), so it always opens on the newest message, with no
  // scrolling to measure or get wrong. It therefore wants the newest message first.
  const listRows = useMemo(() => [...rows].reverse(), [rows]);

  // ---- actions --------------------------------------------------------------
  const startReply = (m: ChatMessage) => {
    setReplyTo({name: m.mine ? 'You' : m.fromName, text: previewOf(m)});
  };

  const copyMessages = (list: ChatMessage[]) => {
    const body =
      list.length === 1
        ? list[0].type === 'text'
          ? list[0].text ?? ''
          : previewOf(list[0])
        : list.map(m => `[${formatTime(m.timestamp)}] ${m.mine ? 'You' : m.fromName}: ${previewOf(m)}`).join('\n');
    Clipboard.setString(body);
    toast(list.length === 1 ? 'Message copied' : `${list.length} messages copied`);
  };
  const copySelected = () => {
    copyMessages(selectedMsgs);
    exitSelecting();
  };

  const askDelete = (list: ChatMessage[]) => {
    if (list.length === 0) {
      return;
    }
    const api = useChatStore.getState();
    const allMine = kind !== 'nearby' && list.every(m => m.mine);
    const buttons: {text: string; style?: 'cancel' | 'destructive'; onPress?: () => void}[] = [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete for me',
        onPress: () => {
          api.deleteMany(conversationId, list.map(m => m.id));
          exitSelecting();
        },
      },
    ];
    if (allMine) {
      buttons.push({
        text: 'Delete for everyone',
        style: 'destructive',
        onPress: () => {
          list.forEach(m => api.deleteForEveryone(conversationId, kind, m.id));
          exitSelecting();
        },
      });
    }
    alertDialog(
      list.length > 1 ? `Delete ${list.length} messages?` : 'Delete message?',
      allMine ? '“Delete for everyone” also removes it from their phone.' : 'This removes it from your phone only.',
      buttons,
    );
  };

  const onType = (t: string) => {
    setMasks(m => shiftMasks(text, t, m));
    setText(t);
    if ((kind === 'direct' && connected && !isSelf) || kind === 'group') {
      useChatStore.getState().setTyping(conversationId, t.length > 0);
    }
  };

  const clearComposer = () => {
    setText('');
    setMasks([]);
  };

  const submit = async () => {
    const t = serialize(text, masks);
    useChatStore.getState().setTyping(conversationId, false);
    if (editing) {
      const ok = useChatStore.getState().editMessage(conversationId, kind, editing.id, t);
      if (!ok) {
        toast('Couldn’t edit — messages can only be changed for 15 minutes');
      }
      setEditing(null);
      clearComposer();
      return;
    }
    const r = replyTo ?? undefined;
    clearComposer();
    setReplyTo(null);
    await sendText(conversationId, kind, t, r);
  };

  /** Put chosen things in the tray (up to MAX_OUT) and say so if some were left out. */
  const addToTray = (items: Outgoing[], skipped: number) => {
    const room = MAX_OUT - outbox.length;
    const taken = items.slice(0, Math.max(0, room));
    const left = skipped + (items.length - taken.length);
    if (taken.length) {
      if (outbox.length === 0) {
        setPhotoSpoiler(false);
        setPhotoTimer(0);
      }
      setOutbox(o => [...o, ...taken]);
    }
    if (left > 0) {
      toast(taken.length === 0 && skipped > 0 ? 'Those were too large to send (25 MB for files, 2.5 MB for photos)' : left + ' left out. Up to ' + MAX_OUT + ' at a time, files up to 25 MB');
    }
  };

  const attachPhoto = async () => {
    setAttachOpen(false);
    const room = MAX_OUT - outbox.length;
    if (room <= 0) {
      return toast('Up to ' + MAX_OUT + ' at a time');
    }
    const r = await pickChatPhotos(room);
    if (r.ok) {
      addToTray(r.photos.map(p => ({key: String(outKey++), kind: 'photo' as const, base64: p})), r.skipped);
    } else if (r.reason === 'error') {
      toast('Couldn\u2019t open your photos');
    }
  };

  const capturePhoto = async () => {
    setAttachOpen(false);
    if (outbox.length >= MAX_OUT) {
      return toast('Up to ' + MAX_OUT + ' at a time');
    }
    const r = await takeChatPhoto();
    if (r.ok) {
      addToTray([{key: String(outKey++), kind: 'photo', base64: r.base64}], 0);
    } else if (r.reason === 'too-large') {
      toast('That photo is too large to send');
    }
  };

  const attachFiles = async (mime?: string, startAt?: string) => {
    setAttachOpen(false);
    const room = MAX_OUT - outbox.length;
    if (room <= 0) {
      return toast('Up to ' + MAX_OUT + ' at a time');
    }
    const r = await mediaFiles.pickMany(mime, room, startAt);
    if (r.ok) {
      addToTray(r.files.map(file => ({key: String(outKey++), kind: 'file' as const, file})), r.skipped);
    } else if (r.reason === 'error') {
      toast('Couldn\u2019t open that file');
    }
  };

  /** Photos and videos ticked in the attach panel: photos are made send-ready, videos are copied in, then all go to the preview. */
  const addFromGallery = async (picked: GalleryItem[]) => {
    setAttachOpen(false);
    const room = MAX_OUT - outbox.length;
    if (room <= 0) {
      return toast('Up to ' + MAX_OUT + ' at a time');
    }
    const out: Outgoing[] = [];
    let skipped = 0;
    for (const g of picked.slice(0, room)) {
      if (g.kind === 'image') {
        const b64 = await mediaFiles.galleryPhoto(g.uri);
        if (b64 && b64.length <= MAX_PHOTO_BYTES) {
          out.push({key: String(outKey++), kind: 'photo', base64: b64});
        } else {
          skipped++;
        }
      } else {
        const file = await mediaFiles.importUri(g.uri);
        if (file) {
          out.push({key: String(outKey++), kind: 'file', file});
        } else {
          skipped++;
        }
      }
    }
    addToTray(out, skipped);
  };

  const startRecording = async () => {
    const phase = useCallStore.getState().phase;
    if (phase !== 'idle' && phase !== 'ended') {
      return toast('Finish the call first');
    }
    markExternal();
    // The recording bar shows at once, before the phone has finished opening the microphone: pressing must feel instant.
    pausedTotal.current = 0;
    pausedAt.current = 0;
    setPaused(false);
    setLevels([]);
    setRecMs(0);
    setRecording(Date.now());
    if ((await requestMicrophone()) !== 'granted') {
      setRecording(null);
      return toast('Microphone permission is needed for voice notes');
    }
    try {
      await mediaFiles.voice.start();
    } catch {
      setRecording(null);
      toast('Couldn’t start recording');
    }
  };

  const togglePause = async () => {
    if (paused) {
      await mediaFiles.voice.resume();
      pausedTotal.current += Date.now() - pausedAt.current;
      pausedAt.current = 0;
      setPaused(false);
    } else {
      await mediaFiles.voice.pause();
      pausedAt.current = Date.now();
      setPaused(true);
    }
  };

  // Live loudness for the waveform.
  useEffect(() => {
    if (recording === null || paused) {
      return;
    }
    const t = setInterval(() => {
      void mediaFiles.voice.level().then(v => setLevels(prev => [...prev.slice(-47), v]));
    }, 110);
    return () => clearInterval(t);
  }, [recording, paused]);

  const cancelRecording = async () => {
    setRecording(null);
    await mediaFiles.voice.cancel();
  };

  const finishRecording = async () => {
    setRecording(null);
    try {
      const rec = await mediaFiles.voice.stop();
      const reply = replyTo ?? undefined;
      setReplyTo(null);
      await sendVoice(conversationId, kind, rec, reply);
    } catch (e) {
      if ((e as {code?: string}).code === 'TOO_SHORT') {
        toast('Too short — hold on a little longer');
      }
    }
  };

  // Hold the mic to record, slide left to cancel, slide up to lock hands-free. A quick tap records hands-free.
  const [locked, setLocked] = useState(false);
  const slide = useRef(new Animated.ValueXY()).current;
  const holdScale = useRef(new Animated.Value(1)).current;
  // A quick tap on the mic doesn't record. It shows, in pictures, what to do: the mic grows, the lock capsule appears above it
  // and an arrow to a bin on its left (for people who don't read), plus a short line of words for those who do.
  const [demo, setDemo] = useState(false);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDemo = () => {
    Vibration.vibrate(15);
    setDemo(true);
    Animated.spring(holdScale, {toValue: 1.45, useNativeDriver: false}).start();
    if (demoTimer.current) {
      clearTimeout(demoTimer.current);
    }
    demoTimer.current = setTimeout(() => {
      setDemo(false);
      Animated.spring(holdScale, {toValue: 1, useNativeDriver: false}).start();
    }, 1800);
    toast('Hold to record');
  };
  const recApi = useRef({start: startRecording, finish: finishRecording, cancel: cancelRecording, demo: showDemo});
  recApi.current = {start: startRecording, finish: finishRecording, cancel: cancelRecording, demo: showDemo};
  const hold = useRef({timer: null as ReturnType<typeof setTimeout> | null, begun: false, locked: false, cancelled: false, starting: null as Promise<void> | null, axis: null as 'x' | 'y' | null});
  const micPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const h = hold.current;
        h.begun = false;
        h.locked = false;
        h.cancelled = false;
        h.axis = null;
        setLocked(false);
        h.timer = setTimeout(() => {
          h.begun = true;
          Vibration.vibrate(25); // a buzz under the finger: it has started
          Animated.spring(holdScale, {toValue: 1.45, useNativeDriver: false}).start();
          h.starting = recApi.current.start();
        }, 200);
      },
      onPanResponderMove: (_, g) => {
        const h = hold.current;
        if (!h.begun || h.locked || h.cancelled) {
          return;
        }
        // One direction at a time: whichever way the finger goes first decides it. Left = delete, up = lock.
        // The mic never moves diagonally, so the two can't be mixed up.
        if (!h.axis && (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12)) {
          h.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
        }
        if (h.axis === 'x') {
          slide.setValue({x: Math.min(0, g.dx), y: 0});
          if (g.dx < -100) {
            h.cancelled = true;
            slide.setValue({x: 0, y: 0});
            Animated.spring(holdScale, {toValue: 1, useNativeDriver: false}).start();
            void recApi.current.cancel();
          }
        } else if (h.axis === 'y') {
          slide.setValue({x: 0, y: Math.min(0, g.dy)});
          if (g.dy < -80) {
            h.locked = true;
            slide.setValue({x: 0, y: 0});
            Animated.spring(holdScale, {toValue: 1, useNativeDriver: false}).start();
            setLocked(true);
          }
        }
      },
      onPanResponderRelease: () => {
        const h = hold.current;
        if (h.timer) {
          clearTimeout(h.timer);
        }
        if (!h.begun) {
          // Only a tap: show how it works instead of recording something nobody meant to record.
          recApi.current.demo();
          return;
        }
        slide.setValue({x: 0, y: 0});
        Animated.spring(holdScale, {toValue: 1, useNativeDriver: false}).start();
        if (h.cancelled || h.locked) {
          return;
        }
        void (h.starting ?? Promise.resolve()).then(() => recApi.current.finish());
      },
    }),
  ).current;
  useEffect(() => {
    if (recording === null) {
      setLocked(false);
    }
  }, [recording]);

  // How the hold gesture looks: the "slide to cancel" hint fades and follows the finger left; the lock capsule above the
  // mic appears as the mic grows and shrinks as you slide up; a halo around the mic swells with your voice.
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const v = levels[levels.length - 1] ?? 0;
    Animated.timing(halo, {toValue: recording !== null && !paused ? Math.min(1, Math.sqrt(v / 14000)) : 0, duration: 100, useNativeDriver: false}).start();
  }, [levels, recording, paused, halo]);
  const binColor = slide.x.interpolate({inputRange: [-100, -55, 0], outputRange: [colors.danger, colors.surfaceHover, colors.surfaceHover], extrapolate: 'clamp'});
  const cancelShift = slide.x.interpolate({inputRange: [-100, 0], outputRange: [-70, 0], extrapolate: 'clamp'});
  const lockIn = holdScale.interpolate({inputRange: [1, 1.45], outputRange: [0, 1], extrapolate: 'clamp'});
  const capsuleH = slide.y.interpolate({inputRange: [-80, 0], outputRange: [46, 96], extrapolate: 'clamp'});
  const capsuleChev = slide.y.interpolate({inputRange: [-50, 0], outputRange: [0, 1], extrapolate: 'clamp'});
  const haloScale = halo.interpolate({inputRange: [0, 1], outputRange: [1.55, 2.2]});

  const playVoice = async (m: ChatMessage) => {
    const path = m.file?.path;
    if (!path || !m.file?.done) {
      return;
    }
    if (player.path === path && player.state === 'playing') {
      await mediaFiles.play.stop();
    } else {
      await mediaFiles.play.start(path);
    }
  };

  const openFile = async (m: ChatMessage) => {
    const file = m.file;
    if (!file?.path || !file.done) {
      return toast(m.status === 'failed' ? 'This file didn’t arrive' : 'Still arriving…');
    }
    const err = await mediaFiles.open(file.path, file.mime);
    if (err === 'NO_APP') {
      toast('No app on this phone can open that file');
    } else if (err) {
      toast('This file is no longer on the phone');
    }
  };

  const saveFile = async (m: ChatMessage) => {
    const file = m.file;
    if (file?.path && file.done && (await mediaFiles.saveAs(file.path, file.name, file.mime))) {
      toast('Saved');
    }
  };

  const saveImage = async (b64: string) => {
    toast((await mediaFiles.saveImage(b64, `Pulse-${Date.now()}.jpg`)) ? 'Saved to your photos' : 'Couldn’t save the photo');
  };

  /** Every photo of an album in one go. */
  const saveAll = async (list: string[]) => {
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (await mediaFiles.saveImage(list[i], `Pulse-${Date.now()}-${i + 1}.jpg`)) {
        ok++;
      }
    }
    toast(ok === list.length ? (ok === 1 ? 'Saved to your photos' : `Saved ${ok} photos`) : ok > 0 ? `Saved ${ok} of ${list.length} photos` : 'Couldn’t save the photos');
  };

  /** Send everything in the tray, one after another, in the order it was added. */
  const sendOutbox = async () => {
    const items = outbox;
    if (items.length === 0) {
      return;
    }
    const spoiler = photoSpoiler;
    const timer = kind === 'direct' ? photoTimer : 0;
    const r = replyTo ?? undefined;
    const cap = outCaption.trim();
    setOutbox([]);
    setOutCaption('');
    setReplyTo(null);
    // Two or more photos sent together are one album (not when each carries a timer: those are opened one by one).
    const photoCount = items.filter(x => x.kind === 'photo').length;
    const albumG = photoCount > 1 && timer === 0 ? 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;
    let albumI = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const reply = i === 0 ? r : undefined; // only the first one quotes the message being replied to
      const caption = i === 0 && cap ? cap : undefined; // one caption, on the first item, inside the same message
      if (it.kind === 'photo') {
        await sendImage(conversationId, kind, it.base64, reply, {spoiler, viewOnce: timer !== 0, viewSecs: timer > 0 ? timer : undefined, caption, album: albumG ? {g: albumG, i: albumI++, n: photoCount} : undefined});
      } else {
        await sendFile(conversationId, kind, it.file, {reply, caption});
      }
    }
  };

  /** Turn the photo in the preview a quarter turn. */
  const rotateItem = async (key: string) => {
    const it = outbox.find(o => o.key === key);
    if (!it || it.kind !== 'photo') {
      return;
    }
    const r = await mediaFiles.rotatePhoto(it.base64, 90);
    if (r) {
      setOutbox(o => o.map(x => (x.key === key && x.kind === 'photo' ? {...x, base64: r} : x)));
    } else {
      toast('Couldn’t turn that photo');
    }
  };

  const openPhoto = (m: ChatMessage) => {
    if (!m.image) {
      return;
    }
    setViewCap(m.caption ?? '');
    if (m.viewOnce) {
      if (m.mine || m.opened) {
        return;
      }
      notifier.setSecure(true); // nobody can screenshot a view-once photo
      setViewingOnce(m.id);
      setViewSecs(m.viewSecs ?? 0);
      setViewLeft(m.viewSecs ?? 0);
    }
    setViewing(m.image);
  };

  /** Open the swipeable viewer on one photo of an album (only the photos that have arrived can be opened). */
  const openAlbum = (members: ChatMessage[], index: number) => {
    const have = members.filter(m => m.image);
    const target = members[index];
    const at = Math.max(0, have.findIndex(m => m.id === target?.id));
    if (have.length === 0) {
      return;
    }
    setViewCap(members.find(m => m.caption)?.caption ?? '');
    setGallery({images: have.map(m => m.image as string), index: at});
  };

  const closeViewer = () => {
    setViewing(null);
    setGallery(null);
    if (viewingOnce) {
      useChatStore.getState().markOpened(conversationId, kind, viewingOnce);
      setViewingOnce(null);
      setViewSecs(0);
      notifier.setSecure(useSettingsStore.getState().app.secureScreen);
    }
  };

  const curImage = gallery ? gallery.images[gallery.index] ?? null : viewing;

  // A timed photo counts down while it is open, and closes (and is deleted) at zero.
  useEffect(() => {
    if (!viewingOnce || !viewSecs) {
      return undefined;
    }
    const id = setInterval(() => setViewLeft(l => l - 1), 1000);
    return () => clearInterval(id);
  }, [viewingOnce, viewSecs]);
  useEffect(() => {
    if (viewingOnce && viewSecs > 0 && viewLeft <= 0) {
      closeViewer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLeft]);

  const format = (mark: Mark) => {
    setMasks(m => toggleMark(text, m, sel.start, sel.end, mark));
  };

  // @mentions: while you type "@ra" in a group, the people it could be show above the message box; tap one to finish it.
  const mentionAt = kind === 'group' && group && sel.start === sel.end ? activeMention(text, sel.start) : null;
  const mentionOptions = mentionAt && group
    ? group.members
        .filter(k => k !== getIdentity().publicKey)
        .map(k => ({key: k, name: usePrefsStore.getState().nameFor(k, paired.find(p => p.publicKey === k)?.name || 'Pulse user')}))
        .filter(p => firstWord(p.name).toLowerCase().startsWith(mentionAt.query.toLowerCase()))
        .slice(0, 12)
    : [];
  const pickMention = (name: string) => {
    if (!mentionAt) {
      return;
    }
    const r = applyMention(text, mentionAt.start, sel.start, firstWord(name));
    onType(r.text);
    setForcedSel({start: r.cursor, end: r.cursor});
  };

  const selectedText = () => text.slice(Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
  const copySel = () => Clipboard.setString(selectedText());
  const replaceSel = (insert: string) => {
    const a2 = Math.min(sel.start, sel.end);
    const z2 = Math.max(sel.start, sel.end);
    const next = text.slice(0, a2) + insert + text.slice(z2);
    onType(next);
    setForcedSel({start: a2 + insert.length, end: a2 + insert.length});
  };
  const cutSel = () => {
    copySel();
    replaceSel('');
  };
  const pasteSel = async () => {
    const clip = await Clipboard.getString();
    if (clip) {
      replaceSel(clip.slice(0, Math.max(0, 500 - text.length + Math.abs(sel.end - sel.start))));
    }
  };
  const selectAllText = () => setForcedSel({start: 0, end: text.length});

  /** React to the one selected message (the emoji row at the bottom shows while exactly one is selected). */
  const doReact = (emoji: string) => {
    if (singleMsg) {
      void react(conversationId, kind, singleMsg.id, emoji);
    }
    exitSelecting();
    setEmojiOpen(false);
  };

  /** Tap a message while selecting: add it or take it away. Taking away the last one ends selecting. */
  const toggleSelect = (id: string) => {
    const m = messages.find(x => x.id === id);
    const ids = m ? albumMembers(m).map(x => x.id) : [id];
    const has = ids.every(i => selected.includes(i));
    const next = has ? selected.filter(x => !ids.includes(x)) : [...selected.filter(x => !ids.includes(x)), ...ids];
    if (next.length === 0 && selected.length > 0) {
      exitSelecting();
    } else {
      setSelected(next);
    }
  };

  const jumpToQuote = (quoted: string) => {
    const idx = listRows.findIndex(r => r.kind === 'msg' && previewOf(r.msg) === quoted);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({index: idx, viewPosition: 0.4, animated: true});
    } else {
      toast('That message is no longer here');
    }
  };

  /** Scroll to a message by its id (the pinned message at the top of a group). */
  const jumpToId = (mid: string) => {
    const idx = listRows.findIndex(r => r.kind === 'msg' && (r.msg.id === mid || r.album?.some(a => a.id === mid)));
    if (idx >= 0) {
      listRef.current?.scrollToIndex({index: idx, viewPosition: 0.4, animated: true});
    } else {
      toast('That message is no longer here');
    }
  };

  // The messages pinned to the top of this chat (up to 3, oldest first): a group's (whoever may edit the group can pin and unpin) or a
  // one-to-one chat's (either person can; not in secret chats or chats whose messages vanish).
  const myKey = getIdentity().publicKey;
  const pinList: {mid: string; who: string; text: string}[] =
    kind === 'group' && group
      ? pinsOf(group).map(p => ({mid: p.mid, who: p.from === myKey ? 'You' : p.fromName, text: p.text}))
      : kind === 'direct' && !secret
      ? (prefs?.pinMsgs ?? []).map(p => ({mid: p.mid, who: p.from === myKey ? 'You' : title, text: p.t}))
      : [];
  const canPin = kind === 'group' ? !!group && canEditInfoOf(group, myKey) : kind === 'direct' && !secret && !prefs?.disappear;
  const unpinMsg = (mid: string) =>
    kind === 'group' ? void useGroupsStore.getState().removePin(conversationId, mid) : void useChatStore.getState().unpinMessage(conversationId, kind, mid);
  // The bar shows one pin at a time; tapping it goes to that message and moves on to the next pin.
  const pinNow = pinList.length ? pinList[Math.min(pinIdx, pinList.length - 1)] : null;

  const forwardTo = async (toId: string, toKind: 'direct' | 'group', toTitle: string) => {
    const list = forwardOf ?? [];
    setForwardOf(null);
    exitSelecting();
    const pics = list.filter(m => m.type === 'image' && m.image && !m.viewOnce);
    const fg = pics.length > 1 ? 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;
    let fi = 0;
    for (const m of list) {
      await useChatStore.getState().forwardMessage(toId, toKind, m, fg && pics.includes(m) ? {g: fg, i: fi++, n: pics.length} : undefined);
    }
    toast(`Forwarded to ${toTitle}`);
  };

  const setMute = (ms: number | typeof MUTE_FOREVER | null) => {
    usePrefsStore.getState().mute(conversationId, ms);
    if (ms !== null) {
      notifier.clearConversation(conversationId);
    }
    setMuteOpen(false);
    setMoreOpen(false);
  };

  const confirmClear = () => {
    setMoreOpen(false);
    alertDialog('Clear this chat?', 'Deletes every message here from this phone. The other side keeps theirs.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useChatStore.getState().clearConversation(conversationId)},
    ]);
  };

  const confirmBlock = () => {
    setMoreOpen(false);
    alertDialog(`Block ${title}?`, 'They won’t be able to message or call you. They are not told.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          usePrefsStore.getState().patch(conversationId, {blocked: true});
          notifier.clearConversation(conversationId);
        },
      },
    ]);
  };

  const renderRow = ({item}: {item: Row}) => {
    if (item.kind === 'date') {
      return (
        <View style={styles.dateWrap}>
          <View style={styles.datePill}>
            <Txt variant="label" tone="secondary">
              {item.label}
            </Txt>
          </View>
        </View>
      );
    }
    if (item.kind === 'note') {
      return (
        <View style={styles.dateWrap}>
          <View style={styles.datePill}>
            <Txt variant="label" tone="secondary" center>
              {item.text}
            </Txt>
          </View>
        </View>
      );
    }
    if (item.kind === 'call') {
      return <CallLine entry={item.entry} onCallBack={() => placeCall(item.entry.peerKey, title, item.entry.video)} />;
    }
    return (
      <MessageBubble
        msg={item.msg}
        grouped={item.grouped}
        showSender={item.showSender}
        // In a group everybody's messages show their picture (the first of a run), so two people with the same name are easy to tell apart.
        groupAvatar={
          kind === 'group' && !item.msg.mine
            ? item.showSender
              ? {
                  name: item.msg.fromName,
                  seed: item.msg.from,
                  uri: usePeersStore.getState().peers[item.msg.from]?.avatar ?? usePrefsStore.getState().profiles[item.msg.from]?.avatar,
                }
              : null
            : undefined
        }
        onOpenPerson={key => nav.navigate('Contact', {publicKey: key})}
        selecting={selecting}
        selected={(item.album ?? [item.msg]).every(x => selected.includes(x.id))}
        album={item.album}
        onOpenAlbum={openAlbum}
        reactions={aggregate((reactions[item.msg.id] ?? []).map(r => r.emoji))}
        votes={votes[item.msg.id] ?? {}}
        onVote={i => vote(conversationId, kind, item.msg.id, i)}
        // Long-press selects the message and starts selecting: tap more messages to add them. No pop-up list.
        onLongPress={msg => {
          if (selecting) {
            toggleSelect(msg.id);
          } else {
            Vibration.vibrate(15);
            Keyboard.dismiss();
            setSelecting(true);
            setSelected(albumMembers(msg).map(x => x.id));
          }
        }}
        onToggle={toggleSelect}
        onReply={startReply}
        revealed={revealed.includes(item.msg.id)}
        onReveal={id => setRevealed(prev => [...prev, id])}
        onOpenImage={openPhoto}
        onJump={jumpToQuote}
        onShowReactions={id => setReactionsFor(id)}
      />
    );
  };

  const canEdit = (m: ChatMessage) => m.mine && m.type === 'text' && Date.now() - m.timestamp < EDIT_WINDOW_MS && kind !== 'nearby';

  // The ⋮ menu while selecting: what doesn't fit as a header icon. (A secret chat keeps its messages where they are:
  // no star or saving out.)
  const allStarred = selectedMsgs.length > 0 && selectedMsgs.every(m => m.starred);
  const selActions: {icon: IconName; label: string; onPress: () => void}[] = [
    ...(selectedMsgs.length > 0 && !secret
      ? [
          {
            icon: 'star' as IconName,
            label: allStarred ? 'Remove star' : 'Star',
            onPress: () => {
              selectedMsgs.forEach(m => {
                if (!!m.starred === allStarred) {
                  useChatStore.getState().toggleStar(conversationId, m.id);
                }
              });
              exitSelecting();
            },
          },
        ]
      : []),
    // Pin a message to the top of the chat (up to 3 at once; the earlier ones stay). In a group, whoever may edit the group's info may pin;
    // in a one-to-one chat either person may — but not in secret chats or chats whose messages vanish.
    ...(singleMsg && !singleMsg.viewOnce && (singleMsg.type === 'text' || singleMsg.type === 'image' || singleMsg.type === 'file' || singleMsg.type === 'poll' || singleMsg.type === 'contact') && canPin
      ? [
          {
            icon: 'pin' as IconName,
            label: pinList.some(p => p.mid === singleMsg.id) ? 'Unpin message' : 'Pin message',
            onPress: () => {
              if (pinList.some(p => p.mid === singleMsg.id)) {
                unpinMsg(singleMsg.id);
              } else {
                const text = previewOf(singleMsg).slice(0, 160) || 'Message';
                const done =
                  kind === 'group'
                    ? useGroupsStore.getState().addPin(conversationId, {
                        mid: singleMsg.id,
                        from: singleMsg.mine ? getIdentity().publicKey : singleMsg.from,
                        fromName: singleMsg.mine ? useSessionStore.getState().profileName || 'You' : singleMsg.fromName,
                        text,
                      })
                    : useChatStore.getState().pinMessage(conversationId, kind, {mid: singleMsg.id, mine: singleMsg.mine, text});
                if (done === 'full') {
                  toast('You can pin 3 messages. Unpin one first.');
                }
              }
              exitSelecting();
            },
          },
        ]
      : []),
    ...(singleMsg && canEdit(singleMsg)
      ? [
          {
            icon: 'edit' as IconName,
            label: 'Edit',
            onPress: () => {
              setEditing(singleMsg);
              setReplyTo(null);
              const loaded = fromMarked(singleMsg.text ?? '');
              setText(loaded.text);
              setMasks(loaded.masks);
              exitSelecting();
            },
          },
        ]
      : []),
    ...(singleMsg && !secret && singleMsg.type === 'image' && singleMsg.image && !singleMsg.viewOnce
      ? [
          {
            icon: 'download' as IconName,
            label: albumMembers(singleMsg).length > 1 ? 'Save all to gallery' : 'Save to gallery',
            onPress: () => {
              const imgs = albumMembers(singleMsg).map(x => x.image).filter((s): s is string => !!s);
              void (imgs.length > 1 ? saveAll(imgs) : saveImage(singleMsg.image!));
              exitSelecting();
            },
          },
        ]
      : []),
    ...(singleMsg && singleMsg.type === 'file' && singleMsg.file?.done
      ? [
          ...(secret
            ? []
            : [
                {
                  icon: 'download' as IconName,
                  label: 'Save to phone',
                  onPress: () => {
                    void saveFile(singleMsg);
                    exitSelecting();
                  },
                },
              ]),
          ...(singleMsg.file.kind !== 'voice'
            ? [
                {
                  icon: 'file' as IconName,
                  label: 'Open',
                  onPress: () => {
                    void openFile(singleMsg);
                    exitSelecting();
                  },
                },
              ]
            : []),
        ]
      : []),
    ...(singleMsg
      ? [
          {
            icon: 'info' as IconName,
            label: 'Info',
            onPress: () => {
              exitSelecting();
              nav.navigate('MessageInfo', {conversationId, messageId: singleMsg.id, kind});
            },
          },
        ]
      : []),
    {icon: 'selectAll', label: 'Select all', onPress: () => setSelected(messages.map(m => m.id))},
  ];

  const reactionList = reactionsFor ? reactions[reactionsFor] ?? [] : [];

  // Nobody can screenshot or screen-record a secret chat, and it is hidden in the app switcher.
  useEffect(() => {
    if (!secret) {
      return;
    }
    notifier.setSecure(true);
    return () => notifier.setSecure(useSettingsStore.getState().app.secureScreen);
  }, [secret]);

  const endSecret = () => {
    setMoreOpen(false);
    alertDialog('End this secret chat?', 'Its messages and encryption keys are erased on BOTH phones. This cannot be undone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'End chat',
        style: 'destructive',
        onPress: () => {
          useSecretStore.getState().end(conversationId);
          nav.goBack();
        },
      },
    ]);
  };

  if (lockedOut) {
    return (
      <Screen padded={false} edges={['left', 'right']} bottomClear={false} aurora={false}>
        <ChatUnlock onUnlocked={() => undefined} onCancel={() => nav.goBack()} />
      </Screen>
    );
  }

  const fileCtxValue: FileCtxValue = {player, onPlay: m => void playVoice(m), onOpen: m => void openFile(m), hideTicks: isSelf};

  const attachPanel =
    attachOpen && !editing ? (
      <AttachPanel
        height={kbHeight}
        maxHeight={Math.max(kbHeight + 80, windowH - headerHeight - 8)}
        expanded={attachExpanded}
        onExpandedChange={setAttachExpanded}
        onClose={() => setAttachOpen(false)}
        room={MAX_OUT - outbox.length}
        contacts={paired.filter(p => p.publicKey !== conversationId).map(p => ({key: p.publicKey, name: p.name}))}
        onContacts={people => {
          setAttachOpen(false);
          people.forEach(p => void sendContact(conversationId, kind, p));
        }}
        onCamera={() => void capturePhoto()}
        onGallery={items => void addFromGallery(items)}
        onSystemPicker={() => void attachPhoto()}
        onFiles={start => void attachFiles(undefined, start)}
        onPoll={() => {
          setAttachOpen(false);
          setPollOpen(true);
        }}
        onFull={() => toast('Up to ' + MAX_OUT + ' at a time')}
      />
    ) : null;

  return (
    <FileCtx.Provider value={fileCtxValue}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      <Screen padded={false} edges={['left', 'right']} bottomClear={false} aurora={false}>
        {/* Subtle chat wallpaper */}
        <Wallpaper kind={wallpaper} photo={wpPhoto} opacity={wpOpacity} blur={wpBlur} />

        <FlatList
          ref={listRef}
          data={listRows}
          inverted
          // Tapping the chat puts the attach panel away, like tapping out of the keyboard.
          onTouchStart={e => {
            tapAt.current = {x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now()};
          }}
          onTouchEnd={e => {
            if (attachOpen && Math.abs(e.nativeEvent.pageX - tapAt.current.x) + Math.abs(e.nativeEvent.pageY - tapAt.current.y) < 10 && Date.now() - tapAt.current.t < 300) {
              setAttachOpen(false);
            }
          }}
          keyExtractor={r => r.id}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          // Room for the floating message box (this is the bottom of the chat, because the list is inverted).
          ListHeaderComponent={<View style={{height: dockH}} />}
          // The top of the chat: the encryption note is the very first thing, and scrolls away with it.
          ListFooterComponent={
            searching ? null : (
              <View style={styles.encBar}>
                          <Icon name="lock" size={12} color={kind === 'nearby' ? colors.textMuted : colors.textSecondary} />
                          <Txt variant="label" tone="muted">
                            {kind === 'nearby'
                              ? 'Open room · everyone in range · no internet'
                              : kind === 'group'
                              ? 'Encrypted for members only'
                              : prefs?.disappear
                              ? `End-to-end encrypted · messages vanish after ${disappearLabel(prefs.disappear)}`
                              : hops && hops > 0
                              ? `End-to-end encrypted · relayed by ${relayWord(hops)}`
                              : 'End-to-end encrypted'}
                          </Txt>
                        </View>
            )
          }
          contentContainerStyle={styles.list}
          onScrollToIndexFailed={info => listRef.current?.scrollToOffset({offset: info.averageItemLength * info.index, animated: true})}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name={searching ? 'search' : 'chat'} size={26} color={colors.textMuted} />
              </View>
              <Txt variant="subtitle" tone="secondary" center>
                {searching ? 'No matches' : 'No messages yet'}
              </Txt>
              <Txt variant="caption" tone="muted" center style={styles.emptySub}>
                {searching ? 'Try a different word.' : 'Say hello — it is end-to-end encrypted and travels over Bluetooth, Wi-Fi or the internet.'}
              </Txt>
            </View>
          }
        />

        {/* A message pinned to the top of the chat (a group's, or a one-to-one chat's): tap to go to it. */}
        {pinNow && !selecting ? (
          <Pressable
            onPress={() => {
              jumpToId(pinNow.mid);
              setPinIdx((Math.min(pinIdx, pinList.length - 1) + 1) % pinList.length);
            }}
            style={styles.pinBar}
            accessibilityRole="button"
            accessibilityLabel={pinList.length > 1 ? `Pinned message ${Math.min(pinIdx, pinList.length - 1) + 1} of ${pinList.length}` : 'Pinned message'}>
            <Icon name="pin" size={16} color={colors.primaryBright} />
            <View style={{flex: 1}}>
              <Txt variant="label" tone="accent" numberOfLines={1}>
                {pinNow.who}
              </Txt>
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {pinNow.text}
              </Txt>
            </View>
            {pinList.length > 1 ? (
              <Txt variant="caption" tone="muted">
                {Math.min(pinIdx, pinList.length - 1) + 1}/{pinList.length}
              </Txt>
            ) : null}
            {canPin ? (
              <Pressable onPress={() => unpinMsg(pinNow.mid)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Unpin">
                <Icon name="x" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </Pressable>
        ) : null}

        {/* Everything at the bottom floats over the chat, on no background */}
        <View style={styles.dock} pointerEvents="box-none" onLayout={e => {
          setDockH(Math.round(e.nativeEvent.layout.height));
        }}>
        {blocked ? (
          <View style={styles.blockedBar}>
            <Icon name="ban" size={16} color={colors.dangerBright} />
            <Txt variant="caption" tone="secondary" style={{flex: 1}}>
              You blocked {title}.
            </Txt>
            <Pressable onPress={() => usePrefsStore.getState().patch(conversationId, {blocked: false})} hitSlop={8}>
              <Txt variant="bodyStrong">Unblock</Txt>
            </Pressable>
          </View>
        ) : secret && secret.status !== 'ready' ? (
          <View style={styles.blockedBar}>
            <Icon name="lock" size={16} color={colors.primaryBright} />
            <Txt variant="caption" tone="secondary" style={{flex: 1}}>
              {secret.status === 'waiting'
                ? `Waiting for ${title} to accept. You can write as soon as they do.`
                : 'Setting up end-to-end encryption…'}
            </Txt>
          </View>
        ) : kind === 'group' && group && !canSendIn(group, getIdentity().publicKey) ? (
          // An announcement group: only admins write. Everybody else can still read and react.
          <View style={styles.blockedBar}>
            <Icon name="lock" size={16} color={colors.textSecondary} />
            <Txt variant="caption" tone="secondary" style={{flex: 1}}>
              Only admins can send messages in this group.
            </Txt>
          </View>
        ) : !connected ? (
          <View style={styles.blockedBar}>
            <Icon name="lock" size={16} color={colors.textSecondary} />
            <Txt variant="caption" tone="secondary" style={{flex: 1}}>
              Connect with {title} to start chatting.
            </Txt>
            <Pressable onPress={openInfo} hitSlop={8}>
              <Txt variant="bodyStrong">View profile</Txt>
            </Pressable>
          </View>
        ) : selecting ? (
          // While selecting, the message box gives its place to the emoji row (one message selected) or stays empty. It keeps
          // the message box's height, so nothing in the chat moves when selecting starts or ends.
          <View style={styles.selDock} pointerEvents="box-none">
            {singleMsg ? (
              <View style={styles.reactTray}>
                {EMOJIS.map(e => (
                  <Pressable key={e} onPress={() => doReact(e)} style={styles.emojiBtn} accessibilityRole="button" accessibilityLabel={`React ${e}`}>
                    <Txt style={styles.emoji}>{e}</Txt>
                  </Pressable>
                ))}
                <Pressable onPress={() => setEmojiOpen(true)} style={styles.emojiBtn} accessibilityRole="button" accessibilityLabel="More emoji">
                  <View style={styles.moreEmoji}>
                    <Icon name="plus" size={18} color={colors.text} />
                  </View>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {mentionOptions.length > 0 ? (
              <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={styles.mentionBar} contentContainerStyle={styles.mentionRow}>
                {mentionOptions.map(p => (
                  <Pressable key={p.key} onPress={() => pickMention(p.name)} style={styles.mentionChip} accessibilityRole="button" accessibilityLabel={`Mention ${p.name}`}>
                    <Avatar name={p.name} seed={p.key} uri={usePeersStore.getState().peers[p.key]?.avatar ?? usePrefsStore.getState().profiles[p.key]?.avatar} size={26} />
                    <Txt variant="bodyStrong">{firstWord(p.name)}</Txt>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {sel.end > sel.start ? (
              <View style={styles.fmtBar}>
                <IconButton icon="bold" label="Bold" size="sm" tone="plain" onPress={() => format('bold')} />
                <IconButton icon="italic" label="Italic" size="sm" tone="plain" onPress={() => format('italic')} />
                <IconButton icon="strike" label="Strikethrough" size="sm" tone="plain" onPress={() => format('strike')} />
                <IconButton icon="code" label="Monospace" size="sm" tone="plain" onPress={() => format('mono')} />
                <IconButton icon="spoiler" label="Spoiler" size="sm" tone="plain" onPress={() => format('spoiler')} />
                <View style={styles.fmtDivider} />
                <IconButton icon="scissors" label="Cut" size="sm" tone="plain" onPress={cutSel} />
                <IconButton icon="copy" label="Copy" size="sm" tone="plain" onPress={copySel} />
                <IconButton icon="clipboard" label="Paste" size="sm" tone="plain" onPress={() => void pasteSel()} />
                <IconButton icon="selectAll" label="Select all" size="sm" tone="plain" onPress={selectAllText} />
              </View>
            ) : null}
            {/* Reply / edit composer bar */}
            {editing ? (
              <View style={styles.replyBar}>
                <View style={styles.replyAccent} />
                <View style={styles.replyBarText}>
                  <Txt variant="label" tone="accent">
                    Editing message
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {editing.text}
                  </Txt>
                </View>
                <Pressable
                  onPress={() => {
                    setEditing(null);
                    clearComposer();
                  }}
                  hitSlop={10}>
                  <Icon name="x" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : replyTo ? (
              <View style={styles.replyBar}>
                <View style={styles.replyAccent} />
                <View style={styles.replyBarText}>
                  <Txt variant="label" tone="accent">
                    Replying to {replyTo.name}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {replyTo.text}
                  </Txt>
                </View>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={10}>
                  <Icon name="x" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : null}

            {recording !== null && locked ? (
              <View style={styles.lockPanel}>
                <View style={styles.lockTop}>
                  <RecDot paused={paused} />
                  <Txt variant="title" style={{fontVariant: ['tabular-nums']}}>
                    {formatDuration(recMs)}
                  </Txt>
                  <Txt variant="caption" tone="muted" style={styles.lockState}>
                    {paused ? 'Paused' : 'Recording'}
                  </Txt>
                </View>
                <LevelBars levels={levels} paused={paused} />
                <View style={styles.lockActions}>
                  <IconButton icon="trash" label="Delete recording" tone="danger" size="lg" onPress={() => void cancelRecording()} />
                  <IconButton icon={paused ? 'mic' : 'pause'} label={paused ? 'Resume recording' : 'Pause recording'} size="lg" onPress={() => void togglePause()} />
                  <IconButton icon="send" label="Send voice note" active size="lg" onPress={() => void finishRecording()} />
                </View>
              </View>
            ) : (
              <View style={[styles.inputRow, attachOpen && attachExpanded && {display: 'none'}]} pointerEvents="box-none">
                <View style={styles.composer}>
                  {recording !== null ? (
                    <View style={styles.recPanel}>
                      <RecDot />
                      <Txt variant="bodyStrong" style={{fontVariant: ['tabular-nums']}}>
                        {formatDuration(recMs)}
                      </Txt>
                      {/* Slide LEFT to delete. Only pictures, no words: arrows pointing left to a bin, which follows your finger
                          and turns red as it gets close. (Locking is the capsule above the mic: slide UP.) */}
                      <Animated.View style={[styles.cancelHint, {transform: [{translateX: cancelShift}]}]} accessibilityLabel="Slide left to delete" accessible>
                        <Icon name="chevronLeft" size={16} color={colors.textMuted} />
                        <Icon name="chevronLeft" size={16} color={colors.textSecondary} />
                        <Animated.View style={[styles.binDot, {backgroundColor: binColor}]}>
                          <Icon name="trash" size={16} color={colors.text} />
                        </Animated.View>
                      </Animated.View>
                    </View>
                  ) : (
                    <View style={styles.boxRow}>
                    <TextInput
                      ref={inputRef}
                      style={styles.input}
                      placeholder={editing ? 'Edit message…' : 'Write a message'}
                      placeholderTextColor={colors.textMuted}
                      onChangeText={onType}
                      selection={forcedSel}
                      onSelectionChange={e => {
                        setSel(e.nativeEvent.selection);
                        if (forcedSel) {
                          setForcedSel(undefined);
                        }
                      }}
                      contextMenuHidden={text.length > 0}
                      multiline
                      maxLength={500}>
                      {toRuns(text, masks).map((r, i) => (
                        <Text key={i} style={runStyle(r.mask)}>
                          {r.text}
                        </Text>
                      ))}
                    </TextInput>
                    {editing ? null : (
                      <Pressy
                        onPress={() => {
                          if (attachOpen) {
                            setAttachOpen(false);
                            return;
                          }
                          // Photo access is asked (once) first, while the chat is still; the panel opens after the answer.
                          const keyboardUp = Keyboard.isVisible();
                          void askGalleryOnce().then(() => {
                            setAttachInFlow(keyboardUp);
                            Keyboard.dismiss();
                            setAttachOpen(true);
                          });
                        }}
                        accessibilityRole="button" accessibilityLabel="Add photo, file or poll" scaleTo={0.9} style={styles.clip}>
                        <Icon name="paperclip" size={22} color={colors.textSecondary} />
                      </Pressy>
                    )}
                    </View>
                  )}
                </View>
                {text.trim() || editing ? (
                  <Pressy onPress={submit} accessibilityRole="button" accessibilityLabel={editing ? 'Save edit' : 'Send'} scaleTo={0.92} style={[styles.tile, styles.tileOn, styles.sendRing]}>
                    <Rim size={48} />
                    <Icon name={editing ? 'check' : 'send'} size={21} color={colors.onPrimary} />
                  </Pressy>
                ) : (
                  <View style={styles.micSlot}>
                    {recording !== null ? <Animated.View pointerEvents="none" style={[styles.micHalo, {transform: [{scale: haloScale}]}]} /> : null}
                    {recording !== null || demo ? (
                      <>
                        {/* slide UP into this capsule to lock: it closes in as you go */}
                        <Animated.View pointerEvents="none" style={[styles.lockCapsule, {opacity: lockIn, height: capsuleH}]}>
                          <Icon name="lock" size={16} color={colors.text} />
                          <Animated.View style={{opacity: capsuleChev}}>
                            <Icon name="chevronUp" size={16} color={colors.textMuted} />
                          </Animated.View>
                        </Animated.View>
                      </>
                    ) : null}
                    {/* the same "slide left to delete" picture as in the bar, shown when you only tapped */}
                    {demo && recording === null ? (
                      <View pointerEvents="none" style={styles.demoBin}>
                        <Icon name="chevronLeft" size={16} color={colors.textMuted} />
                        <Icon name="chevronLeft" size={16} color={colors.textSecondary} />
                        <View style={styles.binDot}>
                          <Icon name="trash" size={16} color={colors.text} />
                        </View>
                      </View>
                    ) : null}
                    <Animated.View
                      {...micPan.panHandlers}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="Hold to record a voice note, slide left to cancel, slide up to lock"
                      style={[styles.tile, styles.tileOn, styles.sendRing, recording !== null && styles.tileLive, {transform: [{translateX: slide.x}, {translateY: slide.y}]}]}>
                      <Rim size={48} />
                      <Icon name="mic" size={22} color={colors.onPrimary} />
                    </Animated.View>
                  </View>
                )}
              </View>
            )}
            {/* The keyboard was up: the panel takes its place, in the same spot. */}
            {attachInFlow ? attachPanel : null}
          </>
        )}
        </View>

        {/* Otherwise it floats over the bottom of the chat and takes no room: the chat does not move. */}
        {!attachInFlow && !blocked && connected && !selecting && !(secret && secret.status !== 'ready') ? (
          <View style={styles.attachOverlay} pointerEvents="box-none">
            {attachPanel}
          </View>
        ) : null}
      </Screen>

      {/* ⋮ menu while messages are selected */}
      <Popover visible={selMoreOpen} onClose={() => setSelMoreOpen(false)} align="right">
        {selActions.map(a => (
          <MoreItem
            key={a.label}
            icon={a.icon}
            label={a.label}
            onPress={() => {
              setSelMoreOpen(false);
              a.onPress();
            }}
          />
        ))}
      </Popover>

      {/* All emoji */}
      <Sheet visible={emojiOpen} onClose={() => setEmojiOpen(false)} title="React with…">
        <View style={styles.emojiGrid}>
          {MORE_EMOJIS.map(e => (
            <Pressable key={e} onPress={() => doReact(e)} style={styles.emojiCell}>
              <Txt style={styles.emoji}>{e}</Txt>
            </Pressable>
          ))}
        </View>
      </Sheet>

      {/* Who reacted */}
      <Sheet visible={!!reactionsFor} onClose={() => setReactionsFor(null)} title="Reactions" scroll>
        {reactionList.map((r, i) => (
          <View key={`${r.from}${i}`} style={styles.reactRow}>
            <Txt style={styles.emoji}>{r.emoji}</Txt>
            <Txt variant="body">{r.from}</Txt>
          </View>
        ))}
      </Sheet>

      {/* Forward to… */}
      <Sheet visible={!!forwardOf} onClose={() => setForwardOf(null)} title="Forward to…" scroll>
        {groups.map(g => (
          <Pressable key={g.id} style={styles.pickRow} onPress={() => void forwardTo(g.id, 'group', g.name)}>
            <GroupAvatar pic={g.pic} size={38} />
            <Txt variant="bodyStrong">{g.name}</Txt>
          </Pressable>
        ))}
        {paired
          .filter(p => !usePrefsStore.getState().isBlocked(p.publicKey))
          .map(p => {
            const name = usePrefsStore.getState().nameFor(p.publicKey, p.name);
            return (
              <Pressable key={p.publicKey} style={styles.pickRow} onPress={() => void forwardTo(p.publicKey, 'direct', name)}>
                <Avatar name={name} seed={p.publicKey} uri={usePeersStore.getState().peers[p.publicKey]?.avatar} size={38} />
                <Txt variant="bodyStrong">{name}</Txt>
              </Pressable>
            );
          })}
        {groups.length + paired.length === 0 ? (
          <Txt variant="caption" tone="muted">
            Connect with someone first to forward messages.
          </Txt>
        ) : null}
      </Sheet>

      {/* ⋮ menu */}
      <Popover visible={moreOpen} onClose={() => setMoreOpen(false)} align="right">
        <MoreItem icon="user" label={kind === 'group' ? 'Group info' : 'View profile'} onPress={() => { setMoreOpen(false); openInfo(); }} />
        <MoreItem icon="search" label="Search in chat" onPress={() => { setMoreOpen(false); setSearching(true); }} />
        <MoreItem icon="check" label="Select messages" onPress={() => { setMoreOpen(false); setSelecting(true); setSelected([]); }} />
        <MoreItem icon="star" label="Starred messages" onPress={() => { setMoreOpen(false); nav.navigate('Starred'); }} />
        <MoreItem
          icon={muted ? 'bell' : 'bellOff'}
          label={muted ? `Unmute (${muteLabel(prefs) ?? 'muted'})` : 'Mute notifications'}
          onPress={() => (muted ? setMute(null) : setMuteOpen(true))}
        />
        {secret ? <MoreItem icon="trash" label="End secret chat" danger onPress={endSecret} /> : null}
        {kind !== 'nearby' && connected ? (
          <MoreItem
            icon="clock"
            label={secret ? `Self-destruct timer · ${secretTimerText(prefs?.disappear ?? 0)}` : `Disappearing · ${disappearLabel(prefs?.disappear)}`}
            onPress={() => {
              setMoreOpen(false);
              setDisOpen(true);
            }}
          />
        ) : null}
        <MoreItem icon="trash" label="Clear chat" onPress={confirmClear} />
        <MoreItem
          icon="lock"
          label={lockCtl.locked ? 'Unlock chat' : 'Lock chat'}
          onPress={() => {
            setMoreOpen(false);
            lockCtl.toggle();
          }}
        />
        <MoreItem icon="wallpaper" label="Chat wallpaper" onPress={() => { setMoreOpen(false); nav.navigate('SettingsChats'); }} />
        {kind === 'direct' && !isSelf ? <MoreItem icon="ban" label="Block" danger onPress={confirmBlock} /> : null}
      </Popover>

      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        {[
          {label: 'For 1 hour', ms: 3600_000},
          {label: 'For 8 hours', ms: 8 * 3600_000},
          {label: 'For 1 week', ms: 7 * 24 * 3600_000},
          {label: 'Until I turn it back on', ms: MUTE_FOREVER},
        ].map(c => (
          <Pressable key={c.label} style={styles.pickRow} onPress={() => setMute(c.ms)}>
            <Txt variant="body">{c.label}</Txt>
          </Pressable>
        ))}
      </Sheet>

      <PollCreator
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={(q, o, st) => {
          setPollOpen(false);
          void sendPoll(conversationId, kind, q, o, {multi: st.multi, anon: st.anon, quiz: st.quiz, explain: st.explain, closeInMs: st.closeInMs});
        }}
      />

      <ImageViewer
        image={curImage}
        gallery={gallery ? {images: gallery.images, index: gallery.index, onIndex: i => setGallery(g => (g ? {...g, index: i} : g))} : undefined}
        onClose={closeViewer}
        onSave={gallery ? () => void saveAll(gallery.images) : viewing && !viewingOnce ? () => void saveImage(viewing) : undefined}
        saveLabel={gallery && gallery.images.length > 1 ? `Save all ${gallery.images.length} photos` : undefined}
        actions={
          curImage && !viewingOnce
            ? [
                {
                  icon: 'wallpaper',
                  label: 'Use as chat background',
                  onPress: () => {
                    void saveBlob('wallpaper', curImage).then(() => {
                      useSettingsStore.getState().setApp({wallpaper: 'photo'});
                      toast('Set as your chat background');
                    });
                  },
                },
              ]
            : undefined
        }
        onReply={
          curImage && !viewingOnce && kind !== 'nearby'
            ? t => {
                void sendText(conversationId, kind, t, {name: title, text: 'Photo'});
                toast('Sent');
              }
            : undefined
        }
        caption={
          [viewCap, viewingOnce ? (viewSecs ? `Closes in ${Math.max(0, viewLeft)} s and is then deleted` : 'View once — it disappears when you close it') : '']
            .filter(Boolean)
            .join('\n\n') || undefined
        }
      />
      {lockCtl.modal}

      {/* Everything chosen, as a full-screen preview with a caption, ready to send together */}
      <MediaComposer
        visible={outbox.length > 0 && !composerAside}
        items={outbox}
        title={title}
        maxItems={MAX_OUT}
        spoiler={photoSpoiler}
        onSpoiler={setPhotoSpoiler}
        timer={kind === 'direct' ? photoTimer : undefined}
        onTimer={setPhotoTimer}
        onRotate={key => void rotateItem(key)}
        onEdit={setEditKey}
        caption={outCaption}
        onCaption={setOutCaption}
        onRemove={key => setOutbox(o => o.filter(x => x.key !== key))}
        onAdd={() => {
          setComposerAside(true);
          setAttachInFlow(false);
          setAttachOpen(true);
        }}
        onClose={() => {
          setOutbox([]);
          setOutCaption('');
        }}
        onSend={() => void sendOutbox()}
        sizeLabel={formatBytes}
        fileIcon={mime => (kindOfMime(mime) === 'video' ? 'video' : kindOfMime(mime) === 'audio' ? 'mic' : 'file')}
      />

      <PhotoEditor
        visible={!!editKey}
        base64={(() => {
          const it = outbox.find(o => o.key === editKey);
          return it && it.kind === 'photo' ? it.base64 : null;
        })()}
        onCancel={() => setEditKey(null)}
        onDone={b64 => {
          setOutbox(o => o.map(x => (x.key === editKey && x.kind === 'photo' ? {...x, base64: b64} : x)));
          setEditKey(null);
        }}
      />

      <DisappearSheet
        visible={disOpen}
        onClose={() => setDisOpen(false)}
        value={prefs?.disappear}
        {...(secret
          ? {
              title: 'Self-destruct timer',
              note: 'Every message in this secret chat deletes itself from both phones after this time.',
              choices: SECRET_TIMERS.map(ms => ({ms, label: ms === 0 ? 'Off' : secretTimerText(ms)})),
            }
          : {})}
        onPick={ms => {
          useChatStore.getState().setDisappear(conversationId, kind, ms);
          setDisOpen(false);
        }}
      />
    </KeyboardAvoidingView>
    </FileCtx.Provider>
  );
}

/** The red dot beside the timer: it breathes while recording and goes still and grey when paused. */
function RecDot({paused}: {paused?: boolean}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (paused) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 0.25, duration: 650, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1, duration: 650, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [paused, pulse]);
  return <Animated.View style={[styles.recDot, paused && {backgroundColor: colors.textMuted}, {opacity: pulse}]} />;
}

/** Live loudness bars while recording: each bar is a moment, newest on the right and strongest; older ones fade out. */
function LevelBars({levels, paused}: {levels: number[]; paused?: boolean}) {
  const N = 44;
  const shown = levels.slice(-N);
  const padded = [...new Array(Math.max(0, N - shown.length)).fill(-1), ...shown];
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44}}>
      {padded.map((v, i) => {
        const empty = v < 0;
        const h = empty ? 4 : Math.max(5, Math.min(42, Math.sqrt(v / 14000) * 42));
        const fade = 0.3 + 0.7 * (i / (N - 1));
        return <View key={i} style={{width: 3, height: h, borderRadius: 2, backgroundColor: empty || paused ? colors.border : colors.primary, opacity: empty ? 1 : paused ? 0.6 : fade}} />;
      })}
    </View>
  );
}

/** How a stretch of typed text looks while it is being written. */
function runStyle(mask: number): TextStyle {
  const st: TextStyle = {};
  if (mask & BIT.bold) {
    st.fontWeight = '700';
  }
  if (mask & BIT.italic) {
    st.fontStyle = 'italic';
  }
  if (mask & BIT.strike) {
    st.textDecorationLine = 'line-through';
  }
  if (mask & BIT.mono) {
    st.fontFamily = 'monospace';
  }
  if (mask & BIT.spoiler) {
    st.backgroundColor = colors.glassStrong;
  }
  return st;
}

function MoreItem({icon, label, onPress, danger}: {icon: IconName; label: string; onPress: () => void; danger?: boolean}) {
  return <PopoverItem icon={icon} label={label} onPress={onPress} danger={danger} />;
}

// --- Message bubble: swipe-to-reply + measures for the reaction anchor ------
function MessageBubble({
  msg,
  grouped,
  showSender,
  selecting,
  selected,
  reactions,
  votes,
  onVote,
  onLongPress,
  onToggle,
  onReply,
  onOpenImage,
  onJump,
  onShowReactions,
  revealed,
  onReveal,
  album,
  onOpenAlbum,
  groupAvatar,
  onOpenPerson,
}: {
  /** Group chats: undefined = no picture column; null = column kept but empty (a follow-on message); otherwise whose picture to show. */
  groupAvatar?: {name: string; seed: string; uri?: string} | null;
  onOpenPerson?: (key: string) => void;
  album?: ChatMessage[];
  onOpenAlbum: (members: ChatMessage[], index: number) => void;
  msg: ChatMessage;
  grouped: boolean;
  showSender: boolean;
  selecting: boolean;
  selected: boolean;
  reactions: [string, number][];
  votes: Record<number, string[]>;
  onVote: (i: number) => void;
  onLongPress: (msg: ChatMessage, x: number, y: number, w: number, h: number) => void;
  onToggle: (id: string) => void;
  onReply: (msg: ChatMessage) => void;
  onOpenImage: (m: ChatMessage) => void;
  onJump: (quoted: string) => void;
  onShowReactions: (id: string) => void;
  revealed: boolean;
  onReveal: (id: string) => void;
}) {
  const ref = useRef<View>(null);
  // A new message eases in (fades and rises a little) instead of appearing at once.
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, {toValue: 1, duration: 240, useNativeDriver: true}).start();
  }, [appear]);
  // A fixed pixel limit, not a percentage: a percentage made long messages wrap at the wrong width and leave a tall empty bubble.
  const {width: winW} = useWindowDimensions();
  const tx = useRef(new Animated.Value(0)).current;
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => !selectingRef.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        if (g.dx > 0) {
          tx.setValue(Math.min(g.dx, 72));
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 52) {
          onReply(msg);
        }
        Animated.spring(tx, {toValue: 0, useNativeDriver: true, bounciness: 6}).start();
      },
    }),
  ).current;

  const measure = () => {
    ref.current?.measureInWindow((x, y, w, h) => onLongPress(msg, x, y, w, h));
  };
  // Photos and videos sit almost edge to edge in their bubble (a thin frame, not a thick one).
  const isMedia = (msg.type === 'image' && !msg.viewOnce) || (msg.type === 'file' && msg.file?.kind === 'video');

  return (
    <Animated.View style={[styles.row, msg.mine ? styles.mineRow : styles.theirRow, {marginTop: grouped ? 2 : spacing.sm}, selected && styles.rowSelected, {opacity: appear, transform: [{translateY: appear.interpolate({inputRange: [0, 1], outputRange: [10, 0]})}]}]}>
      {selecting ? (
        <Pressable onPress={() => onToggle(msg.id)} style={[styles.check, msg.mine ? styles.checkLeft : styles.checkRight, selected && styles.checkOn]} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{checked: selected}}>
          {selected ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3} /> : null}
        </Pressable>
      ) : null}
      <Animated.View style={[styles.swipeIcon, groupAvatar !== undefined ? {left: 46} : null, {opacity: tx.interpolate({inputRange: [0, 40], outputRange: [0, 1]})}]}>
        <Icon name="reply" size={16} color={colors.primaryBright} />
      </Animated.View>
      {groupAvatar !== undefined ? (
        <View style={styles.avatarSlot}>
          {groupAvatar ? (
            <Pressable onPress={selecting ? () => onToggle(msg.id) : () => onOpenPerson?.(groupAvatar.seed)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${groupAvatar.name}’s profile`}>
              <Avatar name={groupAvatar.name} seed={groupAvatar.seed} uri={groupAvatar.uri} size={32} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Animated.View style={{transform: [{translateX: tx}], maxWidth: Math.round(winW * 0.8), flexShrink: 1}} {...pan.panHandlers}>
        <Pressable onLongPress={measure} onPress={selecting ? () => onToggle(msg.id) : undefined} delayLongPress={220}>
          <View ref={ref} collapsable={false} style={[styles.bubble, msg.mine ? styles.mine : styles.their, isMedia && styles.bubbleMedia]}>
            <BubbleContent media={isMedia}  msg={msg} votes={votes} onVote={onVote} showSender={showSender} onOpenImage={onOpenImage} onJump={onJump} revealed={revealed} onReveal={onReveal} album={album} onOpenAlbum={onOpenAlbum} press={{selecting, toggle: () => onToggle(msg.id), longPress: measure}} />
          </View>
        </Pressable>
        {reactions.length > 0 ? (
          <Pressable onPress={() => onShowReactions(msg.id)} style={[styles.reactions, msg.mine ? styles.reactionsMine : undefined]}>
            {reactions.map(([emoji, count]) => (
              <View key={emoji} style={styles.reactChip}>
                <Txt style={styles.reactEmoji}>{emoji}</Txt>
                {count > 1 ? (
                  <Txt variant="caption" tone="muted" style={styles.reactCount}>
                    {count}
                  </Txt>
                ) : null}
              </View>
            ))}
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

function BubbleContent({
  msg,
  votes,
  onVote,
  showSender,
  onOpenImage,
  onJump,
  revealed,
  onReveal,
  album,
  onOpenAlbum,
  press,
  media,
}: {
  media?: boolean;
  press?: Press;
  album?: ChatMessage[];
  onOpenAlbum?: (members: ChatMessage[], index: number) => void;
  msg: ChatMessage;
  votes: Record<number, string[]>;
  onVote: (i: number) => void;
  showSender: boolean;
  onOpenImage: (m: ChatMessage) => void;
  onJump: (quoted: string) => void;
  revealed: boolean;
  onReveal: (id: string) => void;
}) {
  const fileCtx = React.useContext(FileCtx);
  // A photo's corners are the bubble's corners minus the thin frame, so the two curves run parallel. Next to text (a reply
  // quote, a name, a caption) the corner is small; at the bubble's pointed corner it is nearly square.
  const hasCaption = !!msg.caption && !msg.viewOnce;
  const corners: ViewStyle | undefined = media
    ? {
        borderRadius: radius.lg - 3,
        ...(msg.replyTo || showSender ? {borderTopLeftRadius: 8, borderTopRightRadius: 8} : {}),
        ...(hasCaption ? {borderBottomLeftRadius: 8, borderBottomRightRadius: 8} : msg.mine ? {borderBottomRightRadius: 3} : {borderBottomLeftRadius: 3}),
      }
    : undefined;
  const tick = album && album.length ? album[album.length - 1] : msg; // an album shows one time and one tick: its last photo's
  return (
    <>
      {msg.replyTo ? (
        <Pressable onPress={() => onJump(msg.replyTo!.text)} style={[styles.quote, msg.mine ? styles.quoteMine : styles.quoteTheir, media && styles.mediaPad]}>
          <Txt variant="label" tone="accent" numberOfLines={1} style={msg.mine ? styles.onMineStrong : undefined}>
            {msg.replyTo.name}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1} style={msg.mine ? styles.onMineSoft : undefined}>
            {msg.replyTo.text}
          </Txt>
        </Pressable>
      ) : null}
      {showSender ? (
        <Txt variant="label" tone="accent" style={[styles.sender, media && styles.mediaPad]}>
          {msg.fromName}
        </Txt>
      ) : null}
      {msg.type === 'text' ? (
        <RichText text={(msg.text ?? '').trim().replace(/\n{3,}/g, '\n\n')} color={msg.mine ? colors.onPrimary : colors.text} />
      ) : null}
      {msg.type === 'image' && album && onOpenAlbum ? (
        <AlbumGrid members={album} total={msg.album?.n ?? album.length} hidden={!!msg.spoiler && !revealed && !msg.mine} onOpen={i => onOpenAlbum(album, i)} onReveal={() => onReveal(msg.id)} selecting={press?.selecting} onToggle={press?.toggle} onLongPress={press?.longPress} corners={corners} />
      ) : msg.type === 'image' ? (
        <ImageBubble msg={msg} onOpen={onOpenImage} revealed={revealed} onReveal={onReveal} press={press} corners={corners} />
      ) : null}
      {msg.type === 'file' && msg.file ? <FileBubble msg={msg} press={press} corners={corners} /> : null}
      {(msg.type === 'image' || msg.type === 'file') && msg.caption && !msg.viewOnce ? (
        <View style={[styles.bubbleCaption, media && styles.mediaPad]}>
          <RichText text={msg.caption} color={msg.mine ? colors.onPrimary : colors.text} />
        </View>
      ) : null}
      {msg.type === 'contact' && msg.contact ? <ContactBubble msg={msg} /> : null}
      {msg.type === 'poll' && msg.poll ? (
        <PollView poll={msg.poll} tally={votes} onVote={onVote} mine={msg.mine} />
      ) : null}
      <View style={[styles.meta, media && !(msg.caption && !msg.viewOnce) && styles.metaOnMedia, media && !!(msg.caption && !msg.viewOnce) && styles.mediaPadMeta]}>
        {/* an album shows one time and one tick, from its last photo */}
        {msg.starred ? <Icon name="star" size={10} color={msg.mine ? alpha(colors.onBubbleMine, 0.7) : colors.textMuted} fill={msg.mine ? alpha(colors.onBubbleMine, 0.7) : colors.textMuted} /> : null}
        {msg.edited ? (
          <Txt variant="label" style={[styles.time, msg.mine ? styles.timeMine : styles.timeTheir]}>
            edited
          </Txt>
        ) : null}
        <Txt variant="label" style={[styles.time, media && !(msg.caption && !msg.viewOnce) ? styles.timeOnMedia : msg.mine ? styles.timeMine : styles.timeTheir]}>
          {formatTime(tick.timestamp)}
        </Txt>
        {msg.mine && msg.convKind === 'direct' && tick.hops && tick.hops > 0 && tick.status !== 'sending' ? (
          <Icon name="relay" size={10} color={alpha(colors.onBubbleMine, 0.7)} />
        ) : null}
        {msg.mine && !fileCtx.hideTicks ? (
          // One icon family for every state: clock = still sending, ✓ = left my phone, ✓✓ = reached them,
          // green ✓✓ = they opened it, ! = failed.
          tick.status === 'failed' ? (
            <Icon name="info" size={13} color={TICK_FAILED} strokeWidth={2.4} />
          ) : tick.status === 'sending' ? (
            <Icon name="clock" size={12} color={TICK_SOFT} strokeWidth={2.4} />
          ) : tick.status === 'seen' ? (
            <Icon name="checkAll" size={15} color={TICK_SEEN} strokeWidth={2.6} />
          ) : tick.status === 'delivered' ? (
            <Icon name="checkAll" size={15} color={TICK_SOFT} strokeWidth={2.4} />
          ) : (
            <Icon name="check" size={15} color={TICK_SOFT} strokeWidth={2.4} />
          )
        ) : null}
      </View>
    </>
  );
}

/**
 * One call in the chat, laid out like a message: on the RIGHT when you called, on the LEFT when they called. It says what
 * kind of call it was, which way it went, how it ended (or how long it lasted) and when, and tapping it calls back.
 */
function CallLine({entry, onCallBack}: {entry: CallEntry; onCallBack: () => void}) {
  const mine = entry.direction === 'outgoing';
  const kindWord = entry.video ? 'Video call' : 'Voice call';
  const missed = entry.outcome === 'missed';
  const bad = missed || entry.outcome === 'failed';
  let title = kindWord;
  let result: string;
  switch (entry.outcome) {
    case 'answered':
      result = 'Duration ' + formatDuration(entry.durationMs);
      break;
    case 'missed':
      title = 'Missed ' + kindWord.toLowerCase();
      result = 'Not answered';
      break;
    case 'declined':
      result = mine ? 'They declined' : 'You declined';
      break;
    case 'busy':
      result = 'They were busy';
      break;
    case 'failed':
      result = 'Didn’t connect';
      break;
    default:
      result = mine ? 'No answer' : 'Not answered';
  }
  const icon: IconName = entry.outcome === 'answered' ? (entry.video ? 'video' : 'phone') : 'phoneOff';
  const tone = bad ? colors.dangerBright : colors.primaryBright;
  return (
    <View style={[styles.callRow, mine ? styles.mineRow : styles.theirRow]}>
      <Pressable
        onPress={onCallBack}
        accessibilityRole="button"
        accessibilityLabel={(mine ? 'Outgoing ' : 'Incoming ') + title + '. ' + result + '. ' + formatTime(entry.at) + '. Tap to call back'}
        style={({pressed}) => [styles.callBubble, mine ? styles.callMine : styles.callTheirs, pressed && {opacity: 0.8}]}>
        <View style={[styles.callBadge, {backgroundColor: bad ? alpha(colors.danger, 0.16) : colors.primaryDim}]}>
          <Icon name={icon} size={18} color={tone} strokeWidth={2.2} />
        </View>
        <View style={styles.callText}>
          <Txt variant="bodyStrong" numberOfLines={1} style={bad ? {color: colors.dangerBright} : undefined}>
            {title}
          </Txt>
          <View style={styles.callSub}>
            <Icon name={mine ? 'arrowUpRight' : 'arrowDownLeft'} size={13} color={bad ? colors.dangerBright : colors.textSecondary} strokeWidth={2.4} />
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {(mine ? 'Outgoing' : 'Incoming') + ' · ' + result}
            </Txt>
          </View>
          <Txt variant="caption" tone="muted" style={{fontVariant: ['tabular-nums']}}>
            {formatTime(entry.at) + ' · Tap to call back'}
          </Txt>
        </View>
      </Pressable>
    </View>
  );
}

/** A shared person: their name, and one button that either opens the chat with them or offers to connect. */
function ContactBubble({msg}: {msg: ChatMessage}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const c = msg.contact!;
  const paired = usePairingStore(s => s.paired.some(p => p.publicKey === c.key));
  const me = getIdentity().publicKey === c.key;
  const fg = msg.mine ? colors.onPrimary : colors.text;
  const soft = msg.mine ? alpha(colors.onBubbleMine, 0.75) : colors.textSecondary;
  return (
    <View style={styles.cardBox}>
      <View style={styles.cardRow}>
        <Avatar name={c.name} seed={c.key} size={44} />
        <View style={styles.cardText}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{color: fg}}>
            {c.name}
          </Txt>
          <Txt variant="caption" style={{color: soft}}>
            Pulse contact
          </Txt>
        </View>
      </View>
      {me ? null : (
        <Pressable
          onPress={() => (paired ? nav.navigate('Conversation', {conversationId: c.key, kind: 'direct', title: c.name}) : nav.navigate('FindPeople', {invite: {key: c.key, name: c.name}}))}
          accessibilityRole="button"
          accessibilityLabel={paired ? `Message ${c.name}` : `Add ${c.name}`}
          style={({pressed}) => [styles.cardBtn, {borderColor: msg.mine ? alpha(colors.onBubbleMine, 0.45) : colors.border}, pressed && {opacity: 0.8}]}>
          <Txt variant="bodyStrong" style={{color: fg}}>
            {paired ? 'Message' : 'Add contact'}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

/** A file, video, audio file or voice note: shows what it is, how far along it is, and opens on tap. */
function FileBubble({msg, press, corners}: {msg: ChatMessage; press?: Press; corners?: ViewStyle}) {
  const ctx = React.useContext(FileCtx);
  const f = msg.file!;
  const transferring = msg.progress !== undefined && msg.progress < 1;
  const pct = Math.round((msg.progress ?? 0) * 100);
  const failed = msg.status === 'failed';
  const fg = msg.mine ? colors.onPrimary : colors.text;
  const soft = msg.mine ? alpha(colors.onBubbleMine, 0.75) : colors.textSecondary;
  const ext = (f.name.split('.').pop() ?? '').toUpperCase().slice(0, 5);

  if (f.kind === 'voice') {
    const mine = ctx.player.path === f.path;
    const playing = mine && ctx.player.state === 'playing';
    const frac = mine && ctx.player.dur ? Math.min(1, ctx.player.pos / ctx.player.dur) : 0;
    return (
      <View style={styles.voice}>
        <Pressable
          onPress={() => ctx.onPlay(msg)}
          disabled={!f.done}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
          style={[styles.playBtn, {backgroundColor: msg.mine ? alpha(colors.onBubbleMine, 0.22) : colors.primary}, !f.done && {opacity: 0.4}]}>
          <Icon name={playing ? 'pause' : 'play'} size={18} color={msg.mine ? colors.onBubbleMine : colors.onPrimary} fill={msg.mine ? colors.onBubbleMine : colors.onPrimary} />
        </Pressable>
        <View style={styles.voiceBody}>
          <View style={[styles.track, {backgroundColor: msg.mine ? alpha(colors.onBubbleMine, 0.25) : colors.surfaceHover}]}>
            <View style={[styles.trackFill, {width: `${(transferring ? msg.progress ?? 0 : frac) * 100}%`, backgroundColor: fg}]} />
          </View>
          <Txt variant="caption" style={{color: soft}}>
            {failed ? 'Didn’t arrive' : transferring ? `${msg.mine ? 'Sending' : 'Receiving'}… ${pct}%` : formatDuration(playing ? ctx.player.pos : f.dur)}
          </Txt>
        </View>
      </View>
    );
  }

  if (f.kind === 'video') {
    return (
      <Pressable onPress={() => (press?.selecting ? press.toggle() : ctx.onOpen(msg))} onLongPress={press?.longPress} delayLongPress={220} style={[styles.videoBox, corners]} accessibilityRole="button" accessibilityLabel={`Play video ${f.name}`}>
        {f.thumb ? <Image source={{uri: `data:image/jpeg;base64,${f.thumb}`}} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.videoVeil}>
          {transferring ? (
            <Txt variant="bodyStrong" style={{color: '#fff'}}>
              {pct}%
            </Txt>
          ) : failed ? (
            <Txt variant="caption" style={{color: '#fff'}}>
              Didn’t arrive
            </Txt>
          ) : (
            <View style={styles.bigPlay}>
              <Icon name="play" size={26} color="#fff" fill="#fff" />
            </View>
          )}
        </View>
        <View style={styles.videoTag}>
          <Txt variant="label" style={{color: '#fff'}}>
            {formatDuration(f.dur)} · {formatBytes(f.size)}
          </Txt>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={() => (press?.selecting ? press.toggle() : ctx.onOpen(msg))} onLongPress={press?.longPress} delayLongPress={220} style={styles.fileRow} accessibilityRole="button" accessibilityLabel={`Open ${f.name}`}>
      <View style={[styles.fileIcon, {backgroundColor: msg.mine ? alpha(colors.onBubbleMine, 0.22) : colors.primary}]}>
        <Icon name={f.kind === 'audio' ? 'mic' : 'file'} size={22} color={msg.mine ? colors.onBubbleMine : colors.onPrimary} />
      </View>
      <View style={styles.fileText}>
        <Txt variant="bodyStrong" numberOfLines={2} style={{color: fg}}>
          {f.name}
        </Txt>
        <Txt variant="caption" style={{color: soft}}>
          {failed ? 'Didn’t arrive' : transferring ? `${msg.mine ? 'Sending' : 'Receiving'}… ${pct}%` : `${formatBytes(f.size)}${ext ? ` · ${ext}` : ''}`}
        </Txt>
        {transferring ? (
          <View style={[styles.track, {backgroundColor: msg.mine ? alpha(colors.onBubbleMine, 0.25) : colors.surfaceHover, marginTop: 4}]}>
            <View style={[styles.trackFill, {width: `${pct}%`, backgroundColor: fg}]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// Image bubble with a real transfer state: shows the photo, a progress overlay
// while it's still streaming (mine) or a filling placeholder (theirs). Tap to open full screen.
function ImageBubble({
  msg,
  onOpen,
  revealed,
  onReveal,
  press,
  corners,
}: {
  corners?: ViewStyle;
  msg: ChatMessage;
  onOpen: (m: ChatMessage) => void;
  revealed: boolean;
  onReveal: (id: string) => void;
  press?: Press;
}) {
  const transferring = msg.progress !== undefined && msg.progress < 1;
  const pct = Math.round((msg.progress ?? 0) * 100);

  // View-once photo: no preview, ever. Opened ones leave only a note behind.
  if (msg.viewOnce && (msg.opened || msg.image || msg.mine)) {
    const what = msg.viewSecs ? `${msg.viewSecs >= 60 ? '1 min' : msg.viewSecs + ' sec'} photo` : 'View-once photo';
    const state = msg.opened ? 'Opened' : msg.mine ? 'Sent · not opened yet' : 'Tap to open';
    const fg = msg.mine ? colors.onBubbleMine : colors.text;
    const soft = msg.mine ? alpha(colors.onBubbleMine, 0.75) : colors.textSecondary;
    return (
      <Pressable
        onPress={() => (press?.selecting ? press.toggle() : onOpen(msg))}
        onLongPress={press?.longPress}
        delayLongPress={220}
        disabled={!press?.selecting && (msg.mine || !!msg.opened)}
        style={styles.onceRow}
        accessibilityLabel={`${what}. ${state}`}>
        {/* a round badge: a dashed ring with a 1 (view once) or a stopwatch (timed) until it is opened, then a crossed eye */}
        <View
          style={[
            styles.onceBadge,
            {backgroundColor: msg.mine ? alpha(colors.onBubbleMine, 0.18) : colors.primaryDim},
            !msg.opened && {borderWidth: 1.5, borderStyle: 'dashed', borderColor: msg.mine ? alpha(colors.onBubbleMine, 0.6) : colors.primary},
          ]}>
          {msg.opened ? (
            <Icon name="eyeOff" size={19} color={soft} />
          ) : msg.viewSecs ? (
            <Icon name="timer" size={19} color={fg} />
          ) : (
            <Txt variant="bodyStrong" style={{color: fg}}>
              1
            </Txt>
          )}
        </View>
        <View style={styles.onceText}>
          <Txt variant="bodyStrong" style={{color: fg}}>
            {msg.opened ? 'Photo' : what}
          </Txt>
          <Txt variant="caption" style={{color: soft}}>
            {msg.opened ? `Opened · ${what.toLowerCase()}` : state}
          </Txt>
        </View>
      </Pressable>
    );
  }

  if (!msg.image) {
    // Incoming photo not fully arrived yet.
    return (
      <View style={[styles.image, styles.imagePlaceholder, corners]}>
        <Icon name="image" size={26} color={colors.textMuted} />
        <Txt variant="caption" tone="muted" style={styles.imagePct}>
          {msg.status === 'failed'
            ? 'Photo didn’t arrive'
            : msg.mediaGone
            ? 'Photo no longer stored'
            : msg.progress === undefined
            ? 'Loading photo…'
            : `Receiving… ${pct}%`}
        </Txt>
      </View>
    );
  }

  const hidden = !!msg.spoiler && !revealed && !msg.mine;
  return (
    <Pressable
      onPress={() => (press?.selecting ? press.toggle() : hidden ? onReveal(msg.id) : onOpen(msg))}
      onLongPress={press?.longPress}
      delayLongPress={220}
      style={[styles.image, corners]}
      accessibilityLabel={hidden ? 'Spoiler photo, tap to reveal' : 'Open photo'}>
      <Image
        source={{uri: `data:image/jpeg;base64,${msg.image}`}}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        blurRadius={hidden ? 40 : 0}
      />
      {hidden ? (
        <View style={styles.spoilerVeil}>
          <Icon name="spoiler" size={22} color="#fff" />
          <Txt variant="caption" style={{color: '#fff'}}>
            Spoiler · tap to reveal
          </Txt>
        </View>
      ) : null}
      {transferring ? (
        <View style={styles.imageOverlay}>
          <Txt variant="label" style={styles.imageOverlayTxt}>
            {msg.mine ? `Sending… ${pct}%` : `Receiving… ${pct}%`}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  flex: {flex: 1, backgroundColor: colors.bg},
  headerWrap: {flexDirection: 'row', alignItems: 'center'},
  headerIcon: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  headerText: {marginLeft: spacing.sm, flexShrink: 1},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  hdrRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  hdrBtn: {width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  off: {opacity: 0.35},
  encBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
  },
  list: {padding: spacing.lg, flexGrow: 1},
  bubbleCaption: {marginTop: 6},
  callRow: {flexDirection: 'row', marginVertical: 3},
  callBubble: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, width: 276, maxWidth: '86%', paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  callMine: {borderBottomRightRadius: 6},
  callTheirs: {borderBottomLeftRadius: 6},
  callSub: {flexDirection: 'row', alignItems: 'center', gap: 4},
  callText: {flexShrink: 1, gap: 1},
  callBadge: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  bubbleMedia: {paddingHorizontal: 3, paddingVertical: 3},
  mediaPad: {marginHorizontal: 8},
  mediaPadMeta: {marginHorizontal: 8, marginBottom: 3},
  // no caption: the time and tick float on the photo itself, in a small dark pill
  metaOnMedia: {position: 'absolute', right: 9, bottom: 9, marginTop: 0, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.42)'},
  timeOnMedia: {color: '#FFFFFF'},
  cardBox: {minWidth: 220, gap: spacing.sm},
  cardRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  cardText: {flex: 1},
  cardBtn: {height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  dateWrap: {alignItems: 'center', marginVertical: spacing.md},
  datePill: {backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center'},
  // Selected: the whole row, edge to edge, takes the accent colour.
  rowSelected: {backgroundColor: alpha(colors.primary, 0.14), marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: 3, marginVertical: -3},
  mineRow: {justifyContent: 'flex-end'},
  theirRow: {justifyContent: 'flex-start'},
  // The tick circle sits on the outer edge of the row (left for my messages, right for theirs), out of the way of the bubble.
  check: {position: 'absolute', alignSelf: 'center', width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center'},
  checkLeft: {left: spacing.xs},
  checkRight: {right: spacing.xs},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  avatarSlot: {width: 32, alignSelf: 'flex-start', marginRight: 6},
  swipeIcon: {position: 'absolute', left: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  bubble: {borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 78},
  mine: {backgroundColor: colors.bubbleMine, borderBottomRightRadius: 6, overflow: 'hidden'},
  onMineStrong: {color: colors.onBubbleMine},
  onMineSoft: {color: alpha(colors.onBubbleMine, 0.78)},
  their: {backgroundColor: colors.bubbleTheirs, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.glassBorder},
  mineText: {color: colors.onBubbleMine},
  quote: {borderLeftWidth: 3, paddingLeft: spacing.sm, paddingVertical: 2, marginBottom: 4, borderRadius: radius.sm},
  quoteMine: {borderLeftColor: alpha(colors.onBubbleMine, 0.7), backgroundColor: alpha(colors.onBubbleMine, 0.14)},
  quoteTheir: {borderLeftColor: colors.primaryBright, backgroundColor: colors.glass},
  sender: {marginBottom: 2},
  image: {width: 240, height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface},
  imagePlaceholder: {alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  imagePct: {marginTop: 6},
  imageOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  imageOverlayTxt: {color: '#fff', fontSize: 11},
  meta: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2},
  time: {fontSize: 10},
  timeMine: {color: alpha(colors.onBubbleMine, 0.72)},
  timeTheir: {color: colors.textMuted},
  tick: {fontSize: 11, color: alpha(colors.onBubbleMine, 0.7)},
  tickSeen: {color: colors.onBubbleMine, fontWeight: '900'},
  tickFailed: {color: colors.danger, fontWeight: '800'},
  reactions: {flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap'},
  reactionsMine: {justifyContent: 'flex-end'},
  reactChip: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  reactEmoji: {fontSize: 14},
  reactCount: {marginLeft: 3},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxxl},
  emptyIcon: {width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md},
  emptySub: {marginTop: spacing.xs, paddingHorizontal: spacing.xxl},
  dock: {position: 'absolute', left: 0, right: 0, bottom: 0},
  // Floats over the bottom of the chat (covering the message box); takes no room, so nothing in the chat moves.
  attachOverlay: {position: 'absolute', left: 0, right: 0, bottom: 0},
  blockedBar: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.card},
  replyBar: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.card},
  replyAccent: {width: 3, alignSelf: 'stretch', backgroundColor: colors.primaryBright, borderRadius: 2},
  replyBarText: {flex: 1},
  boxRow: {flexDirection: 'row', alignItems: 'flex-end'},
  clip: {width: 44, height: 46, alignItems: 'center', justifyContent: 'center'},
  lockPanel: {marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.surfaceRaised, borderRadius: 26, borderWidth: 1, borderColor: colors.border, shadowColor: shadowTone(), shadowOffset: {width: 0, height: 6}, shadowOpacity: 0.16, shadowRadius: 16, elevation: 4},
  lockTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  lockActions: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm},
  tile: {width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center'},
  tileOn: {backgroundColor: colors.primary},
  tileLive: {backgroundColor: colors.danger},
  // No outline: a soft shadow keeps the send / mic button apart from any message scrolled behind it.
  sendRing: {...elevation.floating},
  // Right padding: the mic grows while held and would otherwise sit on top of the hint.
  recPanel: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingLeft: spacing.lg, paddingRight: spacing.xl},
  cancelHint: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2},
  binDot: {width: 30, height: 30, borderRadius: 15, marginLeft: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHover},
  demoBin: {position: 'absolute', right: 70, flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 8, borderRadius: 20, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, ...elevation.card},
  micSlot: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center'},
  micHalo: {position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: alpha(colors.danger, 0.22)},
  lockCapsule: {position: 'absolute', bottom: 76, width: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, ...elevation.card},
  lockState: {marginLeft: 'auto'},
  composer: {flex: 1, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 24, minHeight: 48, ...elevation.card},
  inputRow: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm},
  attachBtn: {height: 44, width: 36, alignItems: 'center', justifyContent: 'center'},
  input: {flex: 1, maxHeight: 120, minHeight: 46, paddingHorizontal: spacing.lg, paddingVertical: 11, textAlignVertical: 'center', color: colors.text, ...typography.body},
  sendBtn: {height: 44, width: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {opacity: 0.4},
  reactBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.72)'},
  emojiBar: {flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingVertical: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: shadowTone(), shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: {width: 0, height: 6}, elevation: 5},
  emojiBtn: {paddingHorizontal: 6, paddingVertical: spacing.xs},
  // Same height as the message box (8 + 48 + 8), so the chat doesn't move when selecting starts.
  selDock: {height: 64, justifyContent: 'center', paddingHorizontal: spacing.md},
  pinBar: {position: 'absolute', top: spacing.xs, left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.card},
  mentionBar: {marginHorizontal: spacing.md, marginBottom: spacing.xs, flexGrow: 0},
  mentionRow: {gap: spacing.sm, paddingVertical: 2},
  mentionChip: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, paddingHorizontal: spacing.md, paddingLeft: spacing.sm, borderRadius: 20, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, ...elevation.card},
  reactTray: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 52, borderRadius: 26, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.floating},
  emoji: {fontSize: 28},
  moreEmoji: {width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center', marginTop: 2},
  emojiGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'},
  emojiCell: {width: '16.6%', alignItems: 'center', paddingVertical: spacing.sm},
  reactRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm},
  actionMenu: {position: 'absolute', left: 16, right: 16, bottom: 28, maxHeight: '52%', backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden', elevation: 5, shadowColor: shadowTone()},
  actionRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  actionDivider: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  pickRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  moreItem: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md},
  recPill: {flex: 1, height: 44, borderRadius: radius.xl, backgroundColor: colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg},
  recDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger},
  voice: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 210, paddingVertical: 2},
  playBtn: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  voiceBody: {flex: 1, gap: 4},
  track: {height: 4, borderRadius: 2, overflow: 'hidden'},
  trackFill: {height: 4, borderRadius: 2},
  videoBox: {width: 240, height: 170, borderRadius: 16, overflow: 'hidden', backgroundColor: '#15151A'},
  videoVeil: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center'},
  bigPlay: {width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'},
  videoTag: {position: 'absolute', left: 8, bottom: 6},
  fileRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 220, maxWidth: 260, paddingVertical: 2},
  fileIcon: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  fileText: {flex: 1},
  fmtBar: {flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 2, marginBottom: spacing.xs, paddingHorizontal: spacing.xs, height: 42, backgroundColor: colors.surfaceRaised, borderRadius: 21, borderWidth: 1, borderColor: colors.border},
  fmtDivider: {width: StyleSheet.hairlineWidth, height: 20, backgroundColor: colors.border, marginHorizontal: spacing.xs},
  onceRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 190, paddingVertical: 2},
  onceBadge: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  onceText: {flex: 1},
  spoilerVeil: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', gap: 6},
  trayRow: {gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.lg, paddingRight: spacing.md},
  trayTile: {width: 112, height: 148, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  trayImg: {width: '100%', height: '100%'},
  trayFile: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.sm},
  trayName: {maxWidth: '100%'},
  trayX: {position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center'},
  trayAdd: {width: 112, height: 148, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 4},
  pendingOpts: {marginBottom: spacing.md},
  poll: {minWidth: 220},
  pollHead: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm},
  pollQ: {flex: 1},
  pollOpt: {height: 40, borderRadius: radius.md, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.xs, overflow: 'hidden', flexDirection: 'row', alignItems: 'center'},
  pollFill: {position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primaryDim},
  pollOptText: {flex: 1},
  pollTotal: {marginTop: spacing.xs},
  addOpt: {marginBottom: spacing.lg},
}));
