import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useHeaderHeight} from '@react-navigation/elements';
import {Screen, Txt, Icon, IconName, Button, TextField, Sheet, Avatar, ImageViewer, RichText, SettingRow, DisappearSheet, ChatUnlock, useChatLock, Wallpaper} from '@/components';
import {colors, radius, spacing, typography} from '@/theme/theme';
import {useChatStore} from '@/store/chatStore';
import {useSettingsStore} from '@/store/settingsStore';
import {applyMark, stripFormatting} from '@/services/richText';
import {useCallStore} from '@/store/callStore';
import {useMeshStore} from '@/mesh/meshStore';
import {usePeersStore} from '@/store/peersStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {pickChatPhoto, takeChatPhoto, ChatPhotoResult} from '@/services/imagePicker';
import {notifier} from '@/services/notifier';
import {mediaFiles, formatBytes, formatDuration} from '@/services/mediaFiles';
import {markExternal} from '@/services/appLifecycle';
import {loadBlob} from '@/services/storage';
import {requestMicrophone} from '@/services/permissions';
import {getIdentity} from '@/services/identity';
import {useLockStore} from '@/store/lockStore';
import type {RootStackParamList} from '@/navigation/types';
import type {ChatMessage, ReplyPreview} from '@/types';

type ConvRoute = RouteProp<RootStackParamList, 'Conversation'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJIS = [
  '😀', '😁', '😅', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡',
  '🥳', '🤯', '😬', '🙄', '👏', '🙌', '👌', '✌️', '🤝', '💪', '🔥', '✨',
  '🎉', '💯', '❤️‍🔥', '💔', '👀', '✅', '❌', '⚠️', '🆘', '🏥', '📍', '🚗',
];
const GROUP_WINDOW = 4 * 60 * 1000;
const BAR_W = 348;
const BAR_H = 58;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

type Row =
  | {kind: 'date'; id: string; label: string}
  | {kind: 'msg'; id: string; msg: ChatMessage; grouped: boolean; showSender: boolean};

type Anchor = {msg: ChatMessage; x: number; y: number; w: number; h: number};

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const formatTime = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const formatFull = (ts?: number) =>
  ts ? new Date(ts).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '—';
function dayLabel(ts: number) {
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
function previewOf(m: ChatMessage): string {
  if (m.type === 'file') {
    return m.file?.kind === 'voice' ? 'Voice message' : m.file?.kind === 'video' ? 'Video' : m.file?.name ?? 'File';
  }
  return m.type === 'image' ? (m.viewOnce ? 'View-once photo' : 'Photo') : m.type === 'poll' ? 'Poll' : stripFormatting(m.text ?? '');
}
const disappearLabel = (ms?: number) =>
  !ms ? 'Off' : ms <= 24 * 3600_000 ? '24 hours' : ms <= 7 * 24 * 3600_000 ? '7 days' : '90 days';
const relayWord = (n: number) => `${n} relay${n === 1 ? '' : 's'}`;
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
  const {width: screenW} = useWindowDimensions();

  const messages = useChatStore(s => s.byConversation[conversationId] ?? []);
  const reactions = useChatStore(s => s.reactions);
  const votes = useChatStore(s => s.votes);
  const {sendText, sendImage, sendPoll, sendFile, sendVoice, react, vote, markSeen} = useChatStore.getState();
  const devices = useMeshStore(s => s.devices);
  const online = usePeersStore(s => (kind === 'direct' ? s.isOnline(conversationId) : false));
  const hops = usePeersStore(s => (kind === 'direct' ? s.hopsTo(conversationId) : null));
  const peerAvatar = usePeersStore(s => (kind === 'direct' ? s.peers[conversationId]?.avatar : undefined));
  const knownAvatar = usePrefsStore(s => (kind === 'direct' ? s.profiles[conversationId]?.avatar : undefined));
  const prefs = usePrefsStore(s => s.prefs[conversationId]);
  const group = useGroupsStore(s => (kind === 'group' ? s.groups.find(g => g.id === conversationId) : undefined));
  const paired = usePairingStore(s => s.paired);
  const groups = useGroupsStore(s => s.groups);
  const title = kind === 'direct' ? prefs?.nickname?.trim() || params.title : kind === 'group' ? group?.name ?? params.title : params.title;
  const blocked = !!prefs?.blocked;
  // Notes to self: a chat with yourself that never leaves this phone.
  const isSelf = kind === 'direct' && conversationId === getIdentity().publicKey;
  // No chat without a connection: a direct chat needs you to have paired with them.
  const connected = kind !== 'direct' || isSelf || paired.some(p => p.publicKey === conversationId);
  const muted = usePrefsStore.getState().isMuted(conversationId);
  const typingNow = useChatStore(s => kind === 'direct' && (s.typing[conversationId] ?? 0) > Date.now());
  const wallpaper = useSettingsStore(s => s.app.wallpaper);
  const chatLocked = usePrefsStore(s => !!s.prefs[conversationId]?.locked);
  const unlocked = useLockStore(s => !!s.unlockedChats[conversationId] || !s.saved);
  // A locked chat shows only the PIN screen until it is unlocked.
  const lockedOut = chatLocked && !unlocked;
  const lockCtl = useChatLock(conversationId);

  const [text, setText] = useState('');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [infoMsg, setInfoMsg] = useState<ChatMessage | null>(null);
  const [forwardOf, setForwardOf] = useState<ChatMessage[] | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewingOnce, setViewingOnce] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoSpoiler, setPhotoSpoiler] = useState(false);
  const [photoOnce, setPhotoOnce] = useState(false);
  const [disOpen, setDisOpen] = useState(false);
  const [fmtOpen, setFmtOpen] = useState(false);
  const [sel, setSel] = useState({start: 0, end: 0});
  const [forcedSel, setForcedSel] = useState<{start: number; end: number} | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [wpPhoto, setWpPhoto] = useState<string | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [recMs, setRecMs] = useState(0);
  const [player, setPlayer] = useState<FileCtxValue['player']>({path: '', state: 'stopped', pos: 0, dur: 0});
  const listRef = useRef<FlatList<Row>>(null);
  const headerHeight = useHeaderHeight();

  const statusText =
    isSelf
      ? 'only you can see this'
      : typingNow
      ? 'typing…'
      : kind === 'nearby'
      ? `${devices.length} in range`
      : kind === 'group'
      ? `${group?.joined.length ?? 1} of ${group?.members.length ?? 1} joined`
      : blocked
      ? 'blocked'
      : online
      ? hops && hops > 0
        ? `reachable via ${relayWord(hops)}`
        : 'in range'
      : 'out of range · messages wait for them';

  const openInfo = () =>
    kind === 'group' ? nav.navigate('GroupInfo', {groupId: conversationId}) : isSelf ? nav.navigate('EditProfile') : nav.navigate('Contact', {publicKey: conversationId});
  const exitSelecting = () => {
    setSelecting(false);
    setSelected([]);
  };
  const selectedMsgs = messages.filter(m => selected.includes(m.id));

  // ---- header ---------------------------------------------------------------
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
        headerTitle: () => (
          <Txt variant="subtitle">{selected.length === 0 ? 'Select messages' : `${selected.length} selected`}</Txt>
        ),
        headerRight: () => (
          <View style={styles.hdrRow}>
            <Pressable onPress={copySelected} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Copy">
              <Icon name="copy" size={19} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => setForwardOf(selectedMsgs)} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Forward">
              <Icon name="forward" size={19} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => askDelete(selectedMsgs)} disabled={selected.length === 0} hitSlop={8} style={[styles.hdrBtn, selected.length === 0 && styles.off]} accessibilityLabel="Delete">
              <Icon name="trash" size={19} color={colors.dangerBright} />
            </Pressable>
          </View>
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
              onPress={() => void useCallStore.getState().start(conversationId, title)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Call ${title}`}
              style={styles.hdrBtn}>
              <Icon name="phone" size={18} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options" style={styles.hdrBtn}>
            <Icon name="more" size={20} color={colors.text} />
          </Pressable>
        </View>
      ),
      headerTitle: () => (
        <Pressable onPress={openInfo} style={styles.headerWrap} accessibilityRole="button" accessibilityLabel={`${title} profile`}>
          {kind === 'nearby' ? (
            <View style={[styles.headerIcon, {backgroundColor: colors.surfaceHover}]}>
              <Icon name="radar" size={18} color={colors.primaryBright} />
            </View>
          ) : kind === 'group' ? (
            <View style={[styles.headerIcon, {backgroundColor: colors.primaryDim}]}>
              <Icon name="users" size={18} color={colors.primaryBright} />
            </View>
          ) : (
            <Avatar name={title} seed={conversationId} uri={peerAvatar ?? knownAvatar} size={38} />
          )}
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Txt variant="subtitle" numberOfLines={1} style={{flexShrink: 1}}>
                {title}
              </Txt>
              {muted ? <Icon name="bellOff" size={12} color={colors.textMuted} /> : null}
            </View>
            <Txt variant="caption" tone={kind === 'direct' && online ? 'secondary' : 'muted'} numberOfLines={1}>
              {statusText}
            </Txt>
          </View>
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, title, kind, statusText, online, conversationId, peerAvatar, knownAvatar, selecting, selected, blocked, muted, messages, connected, lockedOut, isSelf]);

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
      listRef.current?.scrollToEnd({animated: true});
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
      const ms = Date.now() - recording;
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
      if (editing) {
        setEditing(null);
        setText('');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selecting, searching, editing]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searching || !q) {
      return messages;
    }
    return messages.filter(m => previewOf(m).toLowerCase().includes(q) || (m.poll?.question ?? '').toLowerCase().includes(q));
  }, [messages, query, searching]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastTs = 0;
    let lastFrom = '';
    visible.forEach(m => {
      if (out.length === 0 || !sameDay(lastTs, m.timestamp)) {
        out.push({kind: 'date', id: `d-${m.id}`, label: dayLabel(m.timestamp)});
        lastFrom = '';
      }
      const grouped = m.from === lastFrom && m.timestamp - lastTs < GROUP_WINDOW;
      out.push({kind: 'msg', id: m.id, msg: m, grouped, showSender: !m.mine && kind !== 'direct' && !grouped});
      lastTs = m.timestamp;
      lastFrom = m.from;
    });
    return out;
  }, [visible, kind]);

  // ---- actions --------------------------------------------------------------
  const startReply = (m: ChatMessage) => {
    setReplyTo({name: m.mine ? 'You' : m.fromName, text: previewOf(m)});
    setAnchor(null);
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
    Alert.alert(
      list.length > 1 ? `Delete ${list.length} messages?` : 'Delete message?',
      allMine ? '“Delete for everyone” also removes it from their phone.' : 'This removes it from your phone only.',
      buttons,
    );
  };

  const onType = (t: string) => {
    setText(t);
    if (kind === 'direct' && connected && !isSelf) {
      useChatStore.getState().setTyping(conversationId, t.length > 0);
    }
  };

  const submit = async () => {
    const t = text;
    useChatStore.getState().setTyping(conversationId, false);
    if (editing) {
      const ok = useChatStore.getState().editMessage(conversationId, kind, editing.id, t);
      if (!ok) {
        toast('Couldn’t edit — messages can only be changed for 15 minutes');
      }
      setEditing(null);
      setText('');
      return;
    }
    const r = replyTo ?? undefined;
    setText('');
    setReplyTo(null);
    await sendText(conversationId, kind, t, r);
  };

  const handlePhoto = async (result: ChatPhotoResult) => {
    if (result.ok) {
      setPhotoSpoiler(false);
      setPhotoOnce(false);
      setPendingPhoto(result.base64);
    } else if (result.reason === 'too-large') {
      toast('That photo is too large to send');
    }
    // 'cancelled' → do nothing.
  };

  const attachPhoto = async () => {
    setAttachOpen(false);
    await handlePhoto(await pickChatPhoto());
  };

  const capturePhoto = async () => {
    setAttachOpen(false);
    await handlePhoto(await takeChatPhoto());
  };

  const attachFile = async (mime?: string) => {
    setAttachOpen(false);
    const r = await mediaFiles.pick(mime);
    if (r.ok) {
      const reply = replyTo ?? undefined;
      setReplyTo(null);
      await sendFile(conversationId, kind, r.file, {reply});
    } else if (r.reason === 'too-large') {
      toast('Files up to 25 MB can be sent');
    } else if (r.reason === 'error') {
      toast('Couldn’t open that file');
    }
  };

  const startRecording = async () => {
    const phase = useCallStore.getState().phase;
    if (phase !== 'idle' && phase !== 'ended') {
      return toast('Finish the call first');
    }
    markExternal();
    if ((await requestMicrophone()) !== 'granted') {
      return toast('Microphone permission is needed for voice notes');
    }
    try {
      await mediaFiles.voice.start();
      setRecMs(0);
      setRecording(Date.now());
    } catch {
      toast('Couldn’t start recording');
    }
  };

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

  const sendPendingPhoto = async () => {
    const photo = pendingPhoto;
    if (!photo) {
      return;
    }
    const r = replyTo ?? undefined;
    setPendingPhoto(null);
    setReplyTo(null);
    await sendImage(conversationId, kind, photo, r, {spoiler: photoSpoiler, viewOnce: photoOnce && kind === 'direct'});
  };

  const openPhoto = (m: ChatMessage) => {
    if (!m.image) {
      return;
    }
    if (m.viewOnce) {
      if (m.mine || m.opened) {
        return;
      }
      notifier.setSecure(true); // nobody can screenshot a view-once photo
      setViewingOnce(m.id);
    }
    setViewing(m.image);
  };

  const closeViewer = () => {
    setViewing(null);
    if (viewingOnce) {
      useChatStore.getState().markOpened(conversationId, kind, viewingOnce);
      setViewingOnce(null);
      notifier.setSecure(useSettingsStore.getState().app.secureScreen);
    }
  };

  const format = (marker: string) => {
    const r = applyMark(text, sel.start, sel.end, marker);
    setText(r.text);
    setForcedSel({start: r.start, end: r.end});
  };

  const doReact = (emoji: string) => {
    if (anchor) {
      void react(conversationId, kind, anchor.msg.id, emoji);
    }
    setAnchor(null);
    setEmojiOpen(false);
  };

  const toggleSelect = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const jumpToQuote = (quoted: string) => {
    const idx = rows.findIndex(r => r.kind === 'msg' && previewOf(r.msg) === quoted);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({index: idx, viewPosition: 0.4, animated: true});
    } else {
      toast('That message is no longer here');
    }
  };

  const forwardTo = async (toId: string, toKind: 'direct' | 'group', toTitle: string) => {
    const list = forwardOf ?? [];
    setForwardOf(null);
    exitSelecting();
    for (const m of list) {
      await useChatStore.getState().forwardMessage(toId, toKind, m);
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
    Alert.alert('Clear this chat?', 'Deletes every message here from this phone. The other side keeps theirs.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useChatStore.getState().clearConversation(conversationId)},
    ]);
  };

  const confirmBlock = () => {
    setMoreOpen(false);
    Alert.alert(`Block ${title}?`, 'They won’t be able to message or call you. They are not told.', [
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
    return (
      <MessageBubble
        msg={item.msg}
        grouped={item.grouped}
        showSender={item.showSender}
        selecting={selecting}
        selected={selected.includes(item.msg.id)}
        reactions={aggregate((reactions[item.msg.id] ?? []).map(r => r.emoji))}
        votes={votes[item.msg.id] ?? {}}
        onVote={i => vote(conversationId, kind, item.msg.id, i)}
        onLongPress={(msg, x, y, w, h) => {
          if (selecting) {
            toggleSelect(msg.id);
          } else {
            setAnchor({msg, x, y, w, h});
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

  // Reaction bar geometry — anchored to the pressed message.
  const barTop = anchor ? (anchor.y - BAR_H - 8 > 70 ? anchor.y - BAR_H - 8 : anchor.y + anchor.h + 8) : 0;
  const barLeft = anchor ? Math.min(Math.max(anchor.x + anchor.w / 2 - BAR_W / 2, 8), screenW - BAR_W - 8) : 8;

  const canEdit = (m: ChatMessage) => m.mine && m.type === 'text' && Date.now() - m.timestamp < EDIT_WINDOW_MS && kind !== 'nearby';
  const actions: {icon: IconName; label: string; onPress: () => void; danger?: boolean}[] = anchor
    ? [
        {icon: 'reply', label: 'Reply', onPress: () => startReply(anchor.msg)},
        {
          icon: 'copy',
          label: 'Copy',
          onPress: () => {
            copyMessages([anchor.msg]);
            setAnchor(null);
          },
        },
        {icon: 'forward', label: 'Forward', onPress: () => { setForwardOf([anchor.msg]); setAnchor(null); }},
        {
          icon: 'star',
          label: anchor.msg.starred ? 'Remove star' : 'Star',
          onPress: () => {
            useChatStore.getState().toggleStar(conversationId, anchor.msg.id);
            setAnchor(null);
          },
        },
        ...(canEdit(anchor.msg)
          ? [{
              icon: 'edit' as IconName,
              label: 'Edit',
              onPress: () => {
                setEditing(anchor.msg);
                setReplyTo(null);
                setText(anchor.msg.text ?? '');
                setAnchor(null);
              },
            }]
          : []),
        ...(anchor.msg.type === 'image' && anchor.msg.image && !anchor.msg.viewOnce
          ? [{icon: 'download' as IconName, label: 'Save to gallery', onPress: () => { void saveImage(anchor.msg.image!); setAnchor(null); }}]
          : []),
        ...(anchor.msg.type === 'file' && anchor.msg.file?.done
          ? [
              {icon: 'download' as IconName, label: 'Save to phone', onPress: () => { void saveFile(anchor.msg); setAnchor(null); }},
              ...(anchor.msg.file.kind !== 'voice' ? [{icon: 'file' as IconName, label: 'Open', onPress: () => { void openFile(anchor.msg); setAnchor(null); }}] : []),
            ]
          : []),
        {icon: 'info', label: 'Info', onPress: () => { setInfoMsg(anchor.msg); setAnchor(null); }},
        {icon: 'check', label: 'Select', onPress: () => { setSelecting(true); setSelected([anchor.msg.id]); setAnchor(null); }},
        {icon: 'trash', label: 'Delete', danger: true, onPress: () => { const m = anchor.msg; setAnchor(null); askDelete([m]); }},
      ]
    : [];

  const reactionList = reactionsFor ? reactions[reactionsFor] ?? [] : [];

  if (lockedOut) {
    return (
      <Screen padded={false} edges={['left', 'right']} bottomClear={false}>
        <ChatUnlock chatId={conversationId} title={title} onUnlocked={() => undefined} onCancel={() => nav.goBack()} />
      </Screen>
    );
  }

  const fileCtxValue: FileCtxValue = {player, onPlay: m => void playVoice(m), onOpen: m => void openFile(m), hideTicks: isSelf};

  return (
    <FileCtx.Provider value={fileCtxValue}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      <Screen padded={false} edges={['left', 'right']} bottomClear={false}>
        {/* Subtle chat wallpaper */}
        <Wallpaper kind={wallpaper} photo={wpPhoto} />

        {searching ? (
          <View style={styles.searchBar}>
            <Icon name="search" size={16} color={colors.textMuted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search in this chat"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
            />
            <Txt variant="caption" tone="muted">
              {query.trim() ? `${visible.length} found` : ''}
            </Txt>
            <Pressable
              hitSlop={10}
              onPress={() => {
                setSearching(false);
                setQuery('');
              }}>
              <Icon name="x" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : (
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
        )}

        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={r => r.id}
          renderItem={renderRow}
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
                {searching ? 'Try a different word.' : 'Say hello — it travels over Bluetooth, no signal needed.'}
              </Txt>
            </View>
          }
        />

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
        ) : selecting ? null : (
          <>
            {fmtOpen ? (
              <View style={styles.fmtBar}>
                {[
                  {m: '*', label: 'B', style: {fontWeight: '900' as const}},
                  {m: '_', label: 'I', style: {fontStyle: 'italic' as const}},
                  {m: '~', label: 'S', style: {textDecorationLine: 'line-through' as const}},
                  {m: '`', label: '</>', style: {fontFamily: 'monospace'}},
                ].map(b => (
                  <Pressable key={b.m} onPress={() => format(b.m)} style={styles.fmtBtn} accessibilityLabel={`Format ${b.label}`}>
                    <Txt variant="bodyStrong" style={b.style}>
                      {b.label}
                    </Txt>
                  </Pressable>
                ))}
                <Pressable onPress={() => format('||')} style={styles.fmtBtn} accessibilityLabel="Format spoiler">
                  <Icon name="eyeOff" size={18} color={colors.text} />
                </Pressable>
                <Txt variant="caption" tone="muted" style={{flex: 1, textAlign: 'right'}}>
                  select words, then tap
                </Txt>
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
                    setText('');
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

            {recording !== null ? (
              <View style={styles.inputRow}>
                <Pressable onPress={() => void cancelRecording()} style={styles.attachBtn} hitSlop={8} accessibilityLabel="Cancel recording">
                  <Icon name="trash" size={22} color={colors.dangerBright} />
                </Pressable>
                <View style={styles.recPill}>
                  <View style={styles.recDot} />
                  <Txt variant="bodyStrong" style={{fontVariant: ['tabular-nums']}}>
                    {formatDuration(recMs)}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    Recording…
                  </Txt>
                </View>
                <Pressable onPress={() => void finishRecording()} style={styles.sendBtn} accessibilityLabel="Send voice note">
                  <Icon name="send" size={20} color={colors.onPrimary} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.inputRow}>
                {editing ? null : (
                  <Pressable onPress={() => setAttachOpen(true)} style={styles.attachBtn} hitSlop={8} accessibilityLabel="Add photo, file or poll">
                    <Icon name="plus" size={22} color={colors.primaryBright} />
                  </Pressable>
                )}
                <Pressable onPress={() => setFmtOpen(o => !o)} style={styles.fmtToggle} hitSlop={6} accessibilityLabel="Text formatting">
                  <Txt variant="bodyStrong" style={{color: fmtOpen ? colors.text : colors.textMuted}}>
                    Aa
                  </Txt>
                </Pressable>
                <TextInput
                  style={styles.input}
                  placeholder={editing ? 'Edit message…' : 'Message…'}
                  placeholderTextColor={colors.textMuted}
                  value={text}
                  onChangeText={onType}
                  selection={forcedSel}
                  onSelectionChange={e => {
                    setSel(e.nativeEvent.selection);
                    if (forcedSel) {
                      setForcedSel(undefined);
                    }
                  }}
                  multiline
                  maxLength={500}
                />
                {text.trim() || editing ? (
                  <Pressable onPress={submit} accessibilityLabel={editing ? 'Save edit' : 'Send'} style={styles.sendBtn}>
                    <Icon name={editing ? 'check' : 'send'} size={20} color={colors.onPrimary} />
                  </Pressable>
                ) : (
                  <Pressable onPress={() => void startRecording()} accessibilityLabel="Record a voice note" style={styles.sendBtn}>
                    <Icon name="mic" size={20} color={colors.onPrimary} />
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </Screen>

      {/* Long-press: reactions on top, every action below */}
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={() => setAnchor(null)}>
        <Pressable style={styles.reactBackdrop} onPress={() => setAnchor(null)}>
          {anchor ? (
            <>
              <View style={{position: 'absolute', left: anchor.x, top: anchor.y, maxWidth: screenW * 0.82}}>
                <View style={[styles.bubble, anchor.msg.mine ? styles.mine : styles.their]}>
                  <BubbleContent msg={anchor.msg} votes={{}} onVote={() => {}} showSender={false} onOpenImage={() => {}} onJump={() => {}} revealed onReveal={() => {}} />
                </View>
              </View>

              <Pressable style={[styles.emojiBar, {position: 'absolute', top: barTop, left: barLeft, width: BAR_W}]} onPress={() => {}}>
                {EMOJIS.map(e => (
                  <Pressable key={e} onPress={() => doReact(e)} style={styles.emojiBtn}>
                    <Txt style={styles.emoji}>{e}</Txt>
                  </Pressable>
                ))}
                <Pressable onPress={() => setEmojiOpen(true)} style={styles.emojiBtn} accessibilityLabel="More emoji">
                  <View style={styles.moreEmoji}>
                    <Icon name="plus" size={18} color={colors.text} />
                  </View>
                </Pressable>
              </Pressable>

              <View style={styles.actionMenu}>
                <ScrollView bounces={false}>
                  {actions.map((a, i) => (
                    <Pressable
                      key={a.label}
                      onPress={a.onPress}
                      style={[styles.actionRow, i < actions.length - 1 && styles.actionDivider]}>
                      <Txt variant="body" tone={a.danger ? 'danger' : 'primary'}>
                        {a.label}
                      </Txt>
                      <Icon name={a.icon} size={18} color={a.danger ? colors.dangerBright : colors.textSecondary} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </>
          ) : null}
        </Pressable>
      </Modal>

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

      {/* Message info */}
      <Sheet visible={!!infoMsg} onClose={() => setInfoMsg(null)} title="Message info">
        {infoMsg ? (
          <View style={{gap: spacing.md}}>
            <View style={[styles.bubble, infoMsg.mine ? styles.mine : styles.their, {alignSelf: 'flex-start', maxWidth: '100%'}]}>
              <Txt variant="body" style={infoMsg.mine ? styles.mineText : undefined} numberOfLines={4}>
                {previewOf(infoMsg)}
              </Txt>
            </View>
            {infoMsg.mine ? (
              <>
                <InfoLine label="Sent" value={formatFull(infoMsg.timestamp)} />
                <InfoLine label="Delivered" value={infoMsg.deliveredAt ? formatFull(infoMsg.deliveredAt) : infoMsg.status === 'delivered' || infoMsg.status === 'seen' ? 'Yes' : 'Not yet'} />
                <InfoLine label="Read" value={infoMsg.seenAt ? formatFull(infoMsg.seenAt) : infoMsg.status === 'seen' ? 'Yes' : 'Not yet'} />
              </>
            ) : (
              <InfoLine label="Received" value={formatFull(infoMsg.timestamp)} />
            )}
            <InfoLine label="Route" value={infoMsg.hops && infoMsg.hops > 0 ? `Through ${relayWord(infoMsg.hops)}` : kind === 'direct' ? 'Straight between the two phones' : '—'} />
            {infoMsg.edited ? <InfoLine label="Edited" value="Yes" /> : null}
            {infoMsg.starred ? <InfoLine label="Starred" value="Yes" /> : null}
          </View>
        ) : null}
      </Sheet>

      {/* Forward to… */}
      <Sheet visible={!!forwardOf} onClose={() => setForwardOf(null)} title="Forward to…" scroll>
        {groups.map(g => (
          <Pressable key={g.id} style={styles.pickRow} onPress={() => void forwardTo(g.id, 'group', g.name)}>
            <View style={[styles.headerIcon, {backgroundColor: colors.surfaceHover}]}>
              <Icon name="users" size={18} color={colors.text} />
            </View>
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
      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={title}>
        <MoreItem icon="user" label={kind === 'group' ? 'Group info' : 'View profile'} onPress={() => { setMoreOpen(false); openInfo(); }} />
        <MoreItem icon="search" label="Search in chat" onPress={() => { setMoreOpen(false); setSearching(true); }} />
        <MoreItem icon="check" label="Select messages" onPress={() => { setMoreOpen(false); setSelecting(true); setSelected([]); }} />
        <MoreItem icon="star" label="Starred messages" onPress={() => { setMoreOpen(false); nav.navigate('Starred'); }} />
        <MoreItem
          icon={muted ? 'bell' : 'bellOff'}
          label={muted ? `Unmute (${muteLabel(prefs) ?? 'muted'})` : 'Mute notifications'}
          onPress={() => (muted ? setMute(null) : setMuteOpen(true))}
        />
        {kind !== 'nearby' && connected ? (
          <MoreItem
            icon="clock"
            label={`Disappearing messages · ${disappearLabel(prefs?.disappear)}`}
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
        {kind === 'direct' && !isSelf ? <MoreItem icon="ban" label="Block" danger onPress={confirmBlock} /> : null}
      </Sheet>

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

      {/* Attach menu */}
      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Add to chat">
        <Pressable style={styles.sheetRow} onPress={capturePhoto}>
          <View style={styles.sheetIcon}>
            <Icon name="camera" size={22} color={colors.primaryBright} />
          </View>
          <View style={styles.sheetText}>
            <Txt variant="bodyStrong">Camera</Txt>
            <Txt variant="caption" tone="muted">
              Take a photo and send it
            </Txt>
          </View>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={attachPhoto}>
          <View style={styles.sheetIcon}>
            <Icon name="image" size={22} color={colors.primaryBright} />
          </View>
          <View style={styles.sheetText}>
            <Txt variant="bodyStrong">Photo</Txt>
            <Txt variant="caption" tone="muted">
              Send a full-quality photo from your library
            </Txt>
          </View>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => void attachFile('video/*')}>
          <View style={styles.sheetIcon}>
            <Icon name="video" size={22} color={colors.primaryBright} />
          </View>
          <View style={styles.sheetText}>
            <Txt variant="bodyStrong">Video</Txt>
            <Txt variant="caption" tone="muted">
              Send a video (up to 25 MB)
            </Txt>
          </View>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => void attachFile()}>
          <View style={styles.sheetIcon}>
            <Icon name="file" size={22} color={colors.primaryBright} />
          </View>
          <View style={styles.sheetText}>
            <Txt variant="bodyStrong">File</Txt>
            <Txt variant="caption" tone="muted">
              Any document, audio or file (up to 25 MB)
            </Txt>
          </View>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => {setAttachOpen(false); setPollOpen(true);}}>
          <View style={styles.sheetIcon}>
            <Icon name="note" size={22} color={colors.primaryBright} />
          </View>
          <View style={styles.sheetText}>
            <Txt variant="bodyStrong">Poll</Txt>
            <Txt variant="caption" tone="muted">
              Ask a question, everyone votes
            </Txt>
          </View>
        </Pressable>
      </Sheet>

      <PollCreator
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={(q, o) => {
          setPollOpen(false);
          void sendPoll(conversationId, kind, q, o);
        }}
      />

      <ImageViewer
        image={viewing}
        onClose={closeViewer}
        onSave={viewing && !viewingOnce ? () => void saveImage(viewing) : undefined}
        caption={viewingOnce ? 'View once — it disappears when you close it' : undefined}
      />
      {lockCtl.modal}

      {/* How to send a photo */}
      <Sheet visible={!!pendingPhoto} onClose={() => setPendingPhoto(null)} title="Send photo">
        {pendingPhoto ? (
          <Image source={{uri: `data:image/jpeg;base64,${pendingPhoto}`}} style={styles.pendingImg} resizeMode="cover" blurRadius={photoSpoiler || photoOnce ? 25 : 0} />
        ) : null}
        <View style={styles.pendingOpts}>
          <SettingRow icon="eyeOff" title="Hide as spoiler" subtitle="Blurred until they tap it" toggle={{value: photoSpoiler, onChange: setPhotoSpoiler}} />
          {kind === 'direct' ? (
            <SettingRow icon="clock" title="View once" subtitle="Disappears after they open it" toggle={{value: photoOnce, onChange: setPhotoOnce}} />
          ) : null}
        </View>
        <Button label="Send" onPress={() => void sendPendingPhoto()} />
      </Sheet>

      <DisappearSheet
        visible={disOpen}
        onClose={() => setDisOpen(false)}
        value={prefs?.disappear}
        onPick={ms => {
          useChatStore.getState().setDisappear(conversationId, kind, ms);
          setDisOpen(false);
        }}
      />
    </KeyboardAvoidingView>
    </FileCtx.Provider>
  );
}

function InfoLine({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.infoLine}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Txt variant="body">{value}</Txt>
    </View>
  );
}

function MoreItem({icon, label, onPress, danger}: {icon: IconName; label: string; onPress: () => void; danger?: boolean}) {
  return (
    <Pressable onPress={onPress} style={({pressed}) => [styles.moreItem, pressed && {backgroundColor: colors.surfaceHover}]}>
      <Icon name={icon} size={20} color={danger ? colors.dangerBright : colors.text} />
      <Txt variant="body" tone={danger ? 'danger' : 'primary'}>
        {label}
      </Txt>
    </Pressable>
  );
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
}: {
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

  return (
    <View style={[styles.row, msg.mine ? styles.mineRow : styles.theirRow, {marginTop: grouped ? 2 : spacing.sm}, selected && styles.rowSelected]}>
      {selecting ? (
        <Pressable onPress={() => onToggle(msg.id)} style={[styles.check, selected && styles.checkOn]} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{checked: selected}}>
          {selected ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3} /> : null}
        </Pressable>
      ) : null}
      <Animated.View style={[styles.swipeIcon, {opacity: tx.interpolate({inputRange: [0, 40], outputRange: [0, 1]})}]}>
        <Icon name="reply" size={16} color={colors.primaryBright} />
      </Animated.View>
      <Animated.View style={{transform: [{translateX: tx}], maxWidth: '82%'}} {...pan.panHandlers}>
        <Pressable onLongPress={measure} onPress={selecting ? () => onToggle(msg.id) : undefined} delayLongPress={220}>
          <View ref={ref} collapsable={false} style={[styles.bubble, msg.mine ? styles.mine : styles.their]}>
            <BubbleContent msg={msg} votes={votes} onVote={onVote} showSender={showSender} onOpenImage={onOpenImage} onJump={onJump} revealed={revealed} onReveal={onReveal} />
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
    </View>
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
}: {
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
  return (
    <>
      {msg.replyTo ? (
        <Pressable onPress={() => onJump(msg.replyTo!.text)} style={[styles.quote, msg.mine ? styles.quoteMine : styles.quoteTheir]}>
          <Txt variant="label" tone="accent" numberOfLines={1} style={msg.mine ? styles.onMineStrong : undefined}>
            {msg.replyTo.name}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1} style={msg.mine ? styles.onMineSoft : undefined}>
            {msg.replyTo.text}
          </Txt>
        </Pressable>
      ) : null}
      {showSender ? (
        <Txt variant="label" tone="accent" style={styles.sender}>
          {msg.fromName}
        </Txt>
      ) : null}
      {msg.type === 'text' ? (
        <RichText text={msg.text ?? ''} color={msg.mine ? colors.onPrimary : colors.text} />
      ) : null}
      {msg.type === 'image' ? <ImageBubble msg={msg} onOpen={onOpenImage} revealed={revealed} onReveal={onReveal} /> : null}
      {msg.type === 'file' && msg.file ? <FileBubble msg={msg} /> : null}
      {msg.type === 'poll' && msg.poll ? (
        <PollView question={msg.poll.question} options={msg.poll.options} tally={votes} onVote={onVote} mine={msg.mine} />
      ) : null}
      <View style={styles.meta}>
        {msg.starred ? <Icon name="star" size={10} color={msg.mine ? 'rgba(0,0,0,0.55)' : colors.textMuted} fill={msg.mine ? 'rgba(0,0,0,0.55)' : colors.textMuted} /> : null}
        {msg.edited ? (
          <Txt variant="label" style={[styles.time, msg.mine ? styles.timeMine : styles.timeTheir]}>
            edited
          </Txt>
        ) : null}
        <Txt variant="label" style={[styles.time, msg.mine ? styles.timeMine : styles.timeTheir]}>
          {formatTime(msg.timestamp)}
        </Txt>
        {msg.mine && msg.convKind === 'direct' && msg.hops && msg.hops > 0 && msg.status !== 'sending' ? (
          <Icon name="relay" size={10} color="rgba(0,0,0,0.55)" />
        ) : null}
        {msg.mine && !fileCtx.hideTicks ? (
          msg.status === 'failed' ? (
            <Txt variant="label" style={[styles.tick, styles.tickFailed]}>
              !
            </Txt>
          ) : msg.status === 'sending' ? (
            <Txt variant="label" style={styles.tick}>
              ⋯
            </Txt>
          ) : (
            // ✓ left my phone · ✓✓ reached theirs (grey) · ✓✓ they opened it (black)
            <Txt variant="label" style={[styles.tick, msg.status === 'seen' && styles.tickSeen]}>
              {msg.status === 'seen' || msg.status === 'delivered' ? '✓✓' : '✓'}
            </Txt>
          )
        ) : null}
      </View>
    </>
  );
}

/** A file, video, audio file or voice note: shows what it is, how far along it is, and opens on tap. */
function FileBubble({msg}: {msg: ChatMessage}) {
  const ctx = React.useContext(FileCtx);
  const f = msg.file!;
  const transferring = msg.progress !== undefined && msg.progress < 1;
  const pct = Math.round((msg.progress ?? 0) * 100);
  const failed = msg.status === 'failed';
  const fg = msg.mine ? colors.onPrimary : colors.text;
  const soft = msg.mine ? 'rgba(0,0,0,0.55)' : colors.textSecondary;
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
          style={[styles.playBtn, {backgroundColor: msg.mine ? '#000' : colors.primary}, !f.done && {opacity: 0.4}]}>
          <Icon name={playing ? 'pause' : 'play'} size={18} color={msg.mine ? '#fff' : colors.onPrimary} fill={msg.mine ? '#fff' : colors.onPrimary} />
        </Pressable>
        <View style={styles.voiceBody}>
          <View style={[styles.track, {backgroundColor: msg.mine ? 'rgba(0,0,0,0.18)' : colors.surfaceHover}]}>
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
      <Pressable onPress={() => ctx.onOpen(msg)} style={styles.videoBox} accessibilityRole="button" accessibilityLabel={`Play video ${f.name}`}>
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
    <Pressable onPress={() => ctx.onOpen(msg)} style={styles.fileRow} accessibilityRole="button" accessibilityLabel={`Open ${f.name}`}>
      <View style={[styles.fileIcon, {backgroundColor: msg.mine ? 'rgba(0,0,0,0.1)' : colors.surfaceHover}]}>
        <Icon name={f.kind === 'audio' ? 'mic' : 'file'} size={22} color={fg} />
      </View>
      <View style={styles.fileText}>
        <Txt variant="bodyStrong" numberOfLines={2} style={{color: fg}}>
          {f.name}
        </Txt>
        <Txt variant="caption" style={{color: soft}}>
          {failed ? 'Didn’t arrive' : transferring ? `${msg.mine ? 'Sending' : 'Receiving'}… ${pct}%` : `${formatBytes(f.size)}${ext ? ` · ${ext}` : ''}`}
        </Txt>
        {transferring ? (
          <View style={[styles.track, {backgroundColor: msg.mine ? 'rgba(0,0,0,0.18)' : colors.surfaceHover, marginTop: 4}]}>
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
}: {
  msg: ChatMessage;
  onOpen: (m: ChatMessage) => void;
  revealed: boolean;
  onReveal: (id: string) => void;
}) {
  const transferring = msg.progress !== undefined && msg.progress < 1;
  const pct = Math.round((msg.progress ?? 0) * 100);

  // View-once photo: no preview, ever. Opened ones leave only a note behind.
  if (msg.viewOnce && (msg.opened || msg.image || msg.mine)) {
    const label = msg.opened ? 'Photo · opened' : msg.mine ? 'View-once photo · sent' : 'View-once photo · tap to open';
    return (
      <Pressable
        onPress={() => onOpen(msg)}
        disabled={msg.mine || !!msg.opened}
        style={[styles.onceTile, msg.mine && {borderColor: 'rgba(0,0,0,0.35)'}]}
        accessibilityLabel={label}>
        <Icon name={msg.opened ? 'eyeOff' : 'eye'} size={20} color={msg.mine ? colors.onPrimary : colors.text} />
        <Txt variant="caption" style={msg.mine ? styles.onMineStrong : undefined}>
          {label}
        </Txt>
      </Pressable>
    );
  }

  if (!msg.image) {
    // Incoming photo not fully arrived yet.
    return (
      <View style={[styles.image, styles.imagePlaceholder]}>
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
      onPress={() => (hidden ? onReveal(msg.id) : onOpen(msg))}
      style={styles.image}
      accessibilityLabel={hidden ? 'Spoiler photo, tap to reveal' : 'Open photo'}>
      <Image
        source={{uri: `data:image/jpeg;base64,${msg.image}`}}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        blurRadius={hidden ? 40 : 0}
      />
      {hidden ? (
        <View style={styles.spoilerVeil}>
          <Icon name="eyeOff" size={22} color="#fff" />
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

function PollView({
  question,
  options,
  tally,
  onVote,
  mine,
}: {
  question: string;
  options: string[];
  tally: Record<number, string[]>;
  onVote: (i: number) => void;
  mine?: boolean;
}) {
  const total = useMemo(() => Object.values(tally).reduce((s, v) => s + v.length, 0), [tally]);
  return (
    <View style={styles.poll}>
      <View style={styles.pollHead}>
        <Icon name="note" size={16} color={mine ? colors.onPrimary : colors.text} />
        <Txt variant="bodyStrong" style={mine ? [styles.pollQ, styles.onMineStrong] : styles.pollQ}>
          {question}
        </Txt>
      </View>
      {options.map((opt, i) => {
        const count = tally[i]?.length ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <Pressable key={i} onPress={() => onVote(i)} style={styles.pollOpt}>
            <View style={[styles.pollFill, {width: `${pct}%`}]} />
            <Txt variant="body" style={styles.pollOptText}>
              {opt}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {count}
            </Txt>
          </Pressable>
        );
      })}
      <Txt variant="caption" tone="muted" style={styles.pollTotal}>
        {total} vote{total === 1 ? '' : 's'} · tap to vote
      </Txt>
    </View>
  );
}

function PollCreator({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (q: string, o: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const valid = q.trim().length > 0 && opts.filter(o => o.trim()).length >= 2;
  const create = () => {
    onCreate(q.trim(), opts.map(o => o.trim()).filter(Boolean));
    setQ('');
    setOpts(['', '']);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="New poll" scroll>
      <TextField label="Question" placeholder="Where should we meet?" value={q} onChangeText={setQ} />
      {opts.map((o, i) => (
        <TextField
          key={i}
          label={`Option ${i + 1}`}
          placeholder={`Option ${i + 1}`}
          value={o}
          onChangeText={t => setOpts(prev => prev.map((x, idx) => (idx === i ? t : x)))}
        />
      ))}
      {opts.length < 4 ? (
        <Txt variant="caption" tone="accent" onPress={() => setOpts(prev => [...prev, ''])} style={styles.addOpt}>
          + Add option
        </Txt>
      ) : null}
      <Button label="Create poll" onPress={create} disabled={!valid} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1, backgroundColor: colors.bg},
  headerWrap: {flexDirection: 'row', alignItems: 'center', maxWidth: 230},
  headerIcon: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  headerText: {marginLeft: spacing.sm, flexShrink: 1},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  hdrRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  hdrBtn: {width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  off: {opacity: 0.35},
  encBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 48,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchInput: {flex: 1, color: colors.text, ...typography.body, padding: 0},
  list: {padding: spacing.lg, flexGrow: 1},
  dateWrap: {alignItems: 'center', marginVertical: spacing.md},
  datePill: {backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center'},
  rowSelected: {backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg},
  mineRow: {justifyContent: 'flex-end'},
  theirRow: {justifyContent: 'flex-start'},
  check: {width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  swipeIcon: {position: 'absolute', left: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  bubble: {borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 78},
  mine: {backgroundColor: '#EDEDF0', borderBottomRightRadius: radius.sm},
  onMineStrong: {color: '#000000'},
  onMineSoft: {color: 'rgba(0,0,0,0.6)'},
  their: {backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: radius.sm},
  mineText: {color: colors.onPrimary},
  quote: {borderLeftWidth: 3, paddingLeft: spacing.sm, paddingVertical: 2, marginBottom: 4, borderRadius: 3},
  quoteMine: {borderLeftColor: 'rgba(0,0,0,0.6)', backgroundColor: 'rgba(0,0,0,0.08)'},
  quoteTheir: {borderLeftColor: colors.primaryBright, backgroundColor: 'rgba(255,255,255,0.05)'},
  sender: {marginBottom: 2},
  image: {width: 210, height: 210, borderRadius: radius.md, marginVertical: 2, overflow: 'hidden', backgroundColor: colors.surface},
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
  timeMine: {color: 'rgba(0,0,0,0.5)'},
  timeTheir: {color: colors.textMuted},
  tick: {fontSize: 11, color: 'rgba(0,0,0,0.45)'},
  tickSeen: {color: '#000000', fontWeight: '900'},
  tickFailed: {color: colors.danger, fontWeight: '800'},
  reactions: {flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap'},
  reactionsMine: {justifyContent: 'flex-end'},
  reactChip: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  reactEmoji: {fontSize: 14},
  reactCount: {marginLeft: 3},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxxl},
  emptyIcon: {width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md},
  emptySub: {marginTop: spacing.xs, paddingHorizontal: spacing.xxl},
  blockedBar: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  replyBar: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  replyAccent: {width: 3, alignSelf: 'stretch', backgroundColor: colors.primaryBright, borderRadius: 2},
  replyBarText: {flex: 1},
  inputRow: {flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.sm, backgroundColor: colors.bg},
  attachBtn: {height: 44, width: 36, alignItems: 'center', justifyContent: 'center'},
  input: {flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: colors.surfaceRaised, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: Platform.OS === 'ios' ? spacing.md : spacing.sm, color: colors.text, ...typography.body},
  sendBtn: {height: 44, width: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {opacity: 0.4},
  reactBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.72)'},
  emojiBar: {flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingVertical: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: {width: 0, height: 6}, elevation: 12},
  emojiBtn: {paddingHorizontal: 6, paddingVertical: spacing.xs},
  emoji: {fontSize: 28},
  moreEmoji: {width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center', marginTop: 2},
  emojiGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'},
  emojiCell: {width: '16.6%', alignItems: 'center', paddingVertical: spacing.sm},
  reactRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm},
  actionMenu: {position: 'absolute', left: 16, right: 16, bottom: 28, maxHeight: '52%', backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden', elevation: 12},
  actionRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  actionDivider: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  infoLine: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  pickRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  moreItem: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md},
  sheetRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  recPill: {flex: 1, height: 44, borderRadius: radius.xl, backgroundColor: colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg},
  recDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger},
  voice: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 210, paddingVertical: 2},
  playBtn: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  voiceBody: {flex: 1, gap: 4},
  track: {height: 4, borderRadius: 2, overflow: 'hidden'},
  trackFill: {height: 4, borderRadius: 2},
  videoBox: {width: 210, height: 150, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#15151A', marginVertical: 2},
  videoVeil: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center'},
  bigPlay: {width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'},
  videoTag: {position: 'absolute', left: 8, bottom: 6},
  fileRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 220, maxWidth: 260, paddingVertical: 2},
  fileIcon: {width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center'},
  fileText: {flex: 1},
  fmtBar: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  fmtBtn: {minWidth: 40, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm},
  fmtToggle: {height: 44, minWidth: 30, alignItems: 'center', justifyContent: 'center'},
  onceTile: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted},
  spoilerVeil: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', gap: 6},
  pendingImg: {width: '100%', height: 200, borderRadius: radius.lg, marginBottom: spacing.md, backgroundColor: colors.surface},
  pendingOpts: {marginBottom: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden'},
  sheetIcon: {width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center'},
  sheetText: {flex: 1},
  poll: {minWidth: 220},
  pollHead: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm},
  pollQ: {flex: 1},
  pollOpt: {height: 40, borderRadius: radius.md, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.xs, overflow: 'hidden', flexDirection: 'row', alignItems: 'center'},
  pollFill: {position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primaryDim},
  pollOptText: {flex: 1},
  pollTotal: {marginTop: spacing.xs},
  addOpt: {marginBottom: spacing.lg},
});
