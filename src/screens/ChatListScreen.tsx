import {themedStyles} from '@/theme/themed';
import React, {useEffect, useMemo, useState} from 'react';
import {BackHandler, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {FadeInDown, interpolate, LinearTransition, SharedValue, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, GroupAvatar, Icon, IconName, IconTile, Rim, IconButton, Button, Pressy, Reveal, Sheet, LabelSheet, ChatUnlock, useChatLock, ProfileButton, LabelsSheet, HeroScene, Popover, PopoverItem, PopoverDivider} from '@/components';
import {alpha, colors, radius, spacing, typography} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore, MUTE_FOREVER} from '@/store/prefsStore';
import {notifier} from '@/services/notifier';
import {useLockStore} from '@/store/lockStore';
import {useSecretStore, secretTimerText} from '@/store/secretStore';
import {mentions} from '@/services/mentions';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {storage, StorageKeys} from '@/services/storage';
import {formatDuration} from '@/services/mediaFiles';
import {stripFormatting} from '@/services/richText';
import type {ChatMessage} from '@/types';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Filter = {kind: 'all' | 'unread' | 'favorites' | 'groups' | 'secret' | 'archived' | 'locked'} | {kind: 'label'; label: string};

type Item = {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  avatar?: string;
  last: number;
  lastMsg?: ChatMessage;
  unread: number;
  pinned: boolean;
  pinnedAt: number;
  muted: boolean;
  favorite: boolean;
  label?: string;
  disappearing: boolean;
  online: boolean;
  where: string;
  /** In the "Locked chats" folder: not in the main list, opened with the chat code. */
  locked: boolean;
  typing: boolean;
  /** The chat with yourself. */
  self: boolean;
  /** A group: somebody mentioned me (@Name) in a message I haven't read. */
  mentioned: boolean;
  /** A secret chat: own keys, self-destructing, previews hidden. */
  secret: boolean;
  /** Tucked away in Archived. */
  archived: boolean;
};

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
function stamp(ts: number): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (diff === 1) {
    return 'Yesterday';
  }
  return d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

const CHIPS: {kind: 'all' | 'unread' | 'favorites' | 'groups' | 'secret'; label: string}[] = [
  {kind: 'all', label: 'All'},
  {kind: 'unread', label: 'Unread'},
  {kind: 'favorites', label: 'Favorites'},
  {kind: 'groups', label: 'Groups'},
  {kind: 'secret', label: 'Secret'},
];

/**
 * What a swipe reveals: a round colour tile and a short word, with no panel behind them. They fade and grow as
 * the row is dragged, and are completely hidden when it is not (rows have no box to hide them).
 */
function SwipeAction({progress, icon, label}: {progress: SharedValue<number>; icon: IconName; label: string}) {
  const anim = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.25, 0.7], [0, 0.5, 1], 'clamp'),
    transform: [{scale: interpolate(progress.value, [0, 1], [0.55, 1], 'clamp')}],
  }));
  return (
    <View style={styles.swipe}>
      <Animated.View style={[styles.swipeInner, anim]}>
        <IconTile icon={icon} size={46} color={colors.primary} />
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {label}
        </Txt>
      </Animated.View>
    </View>
  );
}

/** The values shared by all pinned rows while one of them is being dragged. */
type Drag = {idx: SharedValue<number>; y: SharedValue<number>; target: SharedValue<number>; rowH: SharedValue<number>};

/** Wraps a pinned row: it follows the finger while dragged, and the others slide out of its way. */
function PinnedRow({pos, drag, children}: {pos: number; drag: Drag; children: React.ReactNode}) {
  const style = useAnimatedStyle(() => {
    const d = drag.idx.value;
    if (d < 0) {
      return {transform: [{translateY: 0}, {scale: 1}], zIndex: 0};
    }
    if (pos === d) {
      return {transform: [{translateY: drag.y.value}, {scale: 1.03}], zIndex: 10};
    }
    const t = drag.target.value;
    let y = 0;
    if (d < pos && pos <= t) {
      y = -drag.rowH.value;
    } else if (t <= pos && pos < d) {
      y = drag.rowH.value;
    }
    return {transform: [{translateY: withTiming(y, {duration: 150})}, {scale: 1}], zIndex: 0};
  });
  return (
    <Animated.View style={style} onLayout={e => (drag.rowH.value = e.nativeEvent.layout.height)}>
      {children}
    </Animated.View>
  );
}

/** The pin icon of a pinned chat is its handle: hold it, then drag the chat up or down to put it where you want. */
function PinHandle({pos, count, drag, onDrop}: {pos: number; count: number; drag: Drag; onDrop: (from: number, to: number) => void}) {
  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      drag.idx.value = pos;
      drag.target.value = pos;
      drag.y.value = 0;
    })
    .onUpdate(e => {
      drag.y.value = e.translationY;
      drag.target.value = Math.max(0, Math.min(count - 1, Math.round(pos + e.translationY / drag.rowH.value)));
    })
    .onEnd(() => {
      const to = drag.target.value;
      drag.y.value = withTiming((to - pos) * drag.rowH.value, {duration: 140}, () => {
        runOnJS(onDrop)(pos, to);
        drag.idx.value = -1;
        drag.y.value = 0;
        drag.target.value = -1;
      });
    });
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.pinHandle} accessibilityLabel="Pinned. Hold and drag to change its place">
        <Icon name="pin" size={16} color={colors.textMuted} />
      </View>
    </GestureDetector>
  );
}

export default function ChatListScreen() {
  const nav = useNavigation<Nav>();
  const paired = usePairingStore(s => s.paired);
  const groups = useGroupsStore(s => s.groups);
  const pendingInvites = useGroupsStore(s => s.pendingInvites);
  const {accept, decline} = useGroupsStore.getState();
  const peers = usePeersStore(s => s.peers);
  const byConversation = useChatStore(s => s.byConversation);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const labels = usePrefsStore(s => s.labels);
  const typingMap = useChatStore(s => s.typing);
  const chatsUnlocked = useLockStore(s => s.chatsUnlocked);
  const hideLocked = useLockStore(s => !!s.saved.chat?.hidden);
  const secretChats = useSecretStore(s => s.chats);
  const secretInvites = useSecretStore(s => s.incoming);
  const hasChatLock = useLockStore(s => !!s.saved.chat);
  const myName = useSessionStore(s => s.profileName);
  const myAvatar = useSessionStore(s => s.avatarUri);
  const meKey = getIdentity().publicKey;

  const [welcomeGone, setWelcomeGone] = useState(() => storage.getBoolean(StorageKeys.welcomeDismissed) === true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>({kind: 'all'});
  const [selected, setSelected] = useState<string[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selMenuOpen, setSelMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selecting = selected.length > 0;

  useEffect(() => {
    useChatStore.getState().init();
    usePairingStore.getState().init();
    useGroupsStore.getState().init();
  }, []);

  // Android back leaves selection mode first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selected.length > 0) {
        setSelected([]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selected.length]);

  const all = useMemo<Item[]>(() => {
    const build = (id: string, kind: 'direct' | 'group', title: string, avatar: string | undefined, fallbackTs: number, peerKey?: string): Item => {
      const list = byConversation[id] ?? [];
      const last = list[list.length - 1];
      const p = prefs[id];
      const lastRead = p?.lastRead ?? 0;
      const who = peerKey ?? id;
      const online = kind === 'direct' && usePeersStore.getState().isOnline(who);
      const hops = peers[who]?.hops ?? 0;
      return {
        id,
        kind,
        title,
        avatar,
        last: last?.timestamp ?? fallbackTs,
        lastMsg: last,
        unread: list.filter(m => !m.mine && m.timestamp > lastRead).length,
        pinned: !!p?.pinned,
        pinnedAt: p?.pinnedAt ?? 0,
        muted: usePrefsStore.getState().isMuted(id),
        favorite: !!p?.favorite,
        label: p?.label,
        disappearing: !!p?.disappear,
        online,
        where: online ? (hops > 0 ? `Online · via ${hops} relay${hops === 1 ? '' : 's'}` : 'Online · in range') : 'Out of range',
        locked: hasChatLock && !!p?.locked,
        typing:
          kind === 'direct'
            ? (typingMap[id] ?? 0) > Date.now()
            : kind === 'group' && !!groups.find(g => g.id === id)?.members.some(k => (typingMap[`${id}:${k}`] ?? 0) > Date.now()),
        self: id === meKey,
        mentioned: kind === 'group' && list.some(m => !m.mine && m.timestamp > lastRead && !!m.text && mentions(m.text, myName ?? '')),
        secret: !!peerKey,
        archived: !!p?.archived,
      };
    };
    return [
      // Notes to self: a chat with yourself that never leaves this phone.
      build(meKey, 'direct', `${myName || 'You'} (You)`, myAvatar ?? undefined, 0),
      ...groups.map(g => build(g.id, 'group', g.name, g.pic, g.createdAt)), // (for a group, "avatar" is its picture, raw base64)
      ...Object.values(secretChats).map(c =>
        build(c.id, 'direct', prefs[c.peerKey]?.nickname || c.name, peers[c.peerKey]?.avatar ?? profiles[c.peerKey]?.avatar, c.createdAt, c.peerKey),
      ),
      ...paired
        .filter(p => !prefs[p.publicKey]?.blocked)
        .map(p =>
          build(p.publicKey, 'direct', prefs[p.publicKey]?.nickname || p.name, peers[p.publicKey]?.avatar ?? profiles[p.publicKey]?.avatar, p.pairedAt),
        ),
    ];
  }, [groups, paired, secretChats, byConversation, prefs, peers, profiles, typingMap, hasChatLock, myName, myAvatar, meKey]);

  const unreadChats = all.filter(i => i.unread > 0 && !i.locked).length;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const textOf = (i: Item) => (i.lastMsg?.type === 'text' ? stripFormatting(i.lastMsg.text ?? '') : '').toLowerCase();
    return all
      // Locked chats live only in their own folder; they never show in the main list, filters or search.
      .filter(i => (filter.kind === 'locked' ? i.locked : !i.locked))
      .filter(i => (filter.kind === 'archived' ? i.archived : filter.kind === 'locked' || !i.archived))
      .filter(i =>
        filter.kind === 'unread'
          ? i.unread > 0
          : filter.kind === 'favorites'
          ? i.favorite
          : filter.kind === 'groups'
          ? i.kind === 'group'
          : filter.kind === 'secret'
          ? i.secret
          : filter.kind === 'label'
          ? i.label === filter.label
          : true,
      )
      .filter(i => !q || i.title.toLowerCase().includes(q) || textOf(i).includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.pinned ? b.pinnedAt - a.pinnedAt || b.last - a.last : b.last - a.last));
  }, [all, filter, query]);

  const go = (i: Item) => nav.navigate('Conversation', {conversationId: i.id, kind: i.kind, title: i.title});
  const open = go;
  // The Locked chats folder asks for the chat code first (until the app has been away for a while).
  const openLockedFolder = () => (useLockStore.getState().chatsUnlocked ? setFilter({kind: 'locked'}) : setUnlocking(true));
  // Locked chats close again the moment the app relocks.
  useEffect(() => {
    if (filter.kind === 'locked' && !chatsUnlocked) {
      setFilter({kind: 'all'});
    }
  }, [filter.kind, chatsUnlocked]);
  // Typing your chat code into the search box opens the folder, even when it is hidden. A wrong guess costs nothing.
  const onSearchText = (t: string) => {
    setQuery(t);
    if (/^\d{4,8}$/.test(t) && useLockStore.getState().matches('chat', t)) {
      useLockStore.getState().unlockChats();
      setQuery('');
      setSearching(false);
      setFilter({kind: 'locked'});
    }
  };
  const openInfo = (i: Item) =>
    i.kind === 'group'
      ? nav.navigate('GroupInfo', {groupId: i.id})
      : i.self
      ? nav.navigate('EditProfile')
      : nav.navigate('Contact', {publicKey: i.secret ? secretChats[i.id]?.peerKey ?? i.id : i.id});
  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  // ---- multi-select actions -------------------------------------------------------
  const api = usePrefsStore.getState();
  const chosen = all.filter(i => selected.includes(i.id));
  const done = () => setSelected([]);

  const doPin = () => {
    const on = !chosen.every(i => i.pinned);
    api.patchMany(selected, {pinned: on});
    done();
  };
  const doFavorite = () => {
    const on = !chosen.every(i => i.favorite);
    api.patchMany(selected, {favorite: on});
    done();
  };
  const doRead = () => {
    selected.forEach(id => {
      api.markRead(id);
      notifier.clearConversation(id);
    });
    done();
  };
  const doMute = (ms: number | null) => {
    selected.forEach(id => {
      api.mute(id, ms);
      if (ms !== null) {
        notifier.clearConversation(id);
      }
    });
    setMuteOpen(false);
    done();
  };
  const allArchived = chosen.length > 0 && chosen.every(i => i.archived);
  const doArchive = () => {
    api.patchMany(selected, {archived: !allArchived});
    done();
  };
  const doClear = () =>
    alertDialog(
      selected.length === 1 ? 'Clear this chat?' : `Clear ${selected.length} chats?`,
      'Deletes every message in them from this phone. The other people keep their copies.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            selected.forEach(id => useChatStore.getState().clearConversation(id));
            done();
          },
        },
      ],
    );

  const allPinned = chosen.length > 0 && chosen.every(i => i.pinned);
  // Move the one selected pinned chat up or down among the pinned chats.
  const pinnedList = items.filter(i => i.pinned);
  const pinnedRef = React.useRef<string[]>([]);
  pinnedRef.current = pinnedList.map(i => i.id);
  const drag: Drag = {idx: useSharedValue(-1), y: useSharedValue(0), target: useSharedValue(-1), rowH: useSharedValue(92)};
  const dropPinned = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    const order = [...pinnedRef.current];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const base = Date.now();
    order.forEach((pid, k) => usePrefsStore.getState().patch(pid, {pinnedAt: base - k}));
  };
  const allFav = chosen.length > 0 && chosen.every(i => i.favorite);
  const allMuted = chosen.length > 0 && chosen.every(i => i.muted);
  const sharedLabel = chosen.length > 0 && chosen.every(i => i.label && i.label === chosen[0].label) ? chosen[0].label : null;

  /** What to show when a list is empty: one line, and the button that fixes it. */
  const empty: {icon: IconName; title: string; action?: {label: string; go: () => void}} = query
    ? {icon: 'search', title: 'No chats found'}
    : filter.kind === 'unread'
    ? {icon: 'check', title: 'You’re all caught up'}
    : filter.kind === 'favorites'
    ? {icon: 'star', title: 'No favorites yet'}
    : filter.kind === 'groups'
    ? {icon: 'users', title: 'No groups yet', action: {label: 'New group', go: () => nav.navigate('CreateGroup')}}
    : filter.kind === 'secret'
    ? {icon: 'lock', title: 'No secret chats', action: {label: 'New secret chat', go: () => nav.navigate('NewSecretChat')}}
    : filter.kind === 'archived'
    ? {icon: 'archive', title: 'Nothing archived'}
    : filter.kind === 'locked'
    ? {icon: 'lock', title: 'No locked chats'}
    : filter.kind === 'label'
    ? {icon: 'tag', title: 'No chats with this label'}
    : {icon: 'chat', title: 'No chats yet', action: {label: 'Find people', go: () => nav.navigate('FindPeople')}};

  // Brand-new: nobody to talk to yet. Say hello and offer the two ways to start.
  const firstRun = !welcomeGone && paired.length === 0 && groups.length === 0 && Object.keys(secretChats).length === 0;

  const archivedCount = all.filter(i => i.archived && !i.locked).length;
  const lockedCount = all.filter(i => i.locked).length;
  // Lock / unlock the selected chats (shown in the ⋮ menu while selecting). Locking sends them to the Locked chats folder.
  const lockCtl = useChatLock(selected, () => setSelected([]));

  // The "Archived" row is tucked away: the list opens with it scrolled out of sight above the first chat, and pulling the
  // list down reveals it (like pulling to search). It stays out of the way again whenever you come back to your chats.
  const listRef = React.useRef<FlatList<Item>>(null);
  const [listH, setListH] = useState(0);
  const [archH, setArchH] = useState(0);
  const hideArch = React.useRef(true);
  const showArchRow = filter.kind === 'all' && archivedCount > 0 && !query;
  useEffect(() => {
    if (filter.kind !== 'all') {
      hideArch.current = true;
    }
  }, [filter.kind]);
  const hideArchivedNow = (contentH: number) => {
    if (hideArch.current && showArchRow && archH > 0 && listH > 0 && contentH >= listH + archH - 2) {
      listRef.current?.scrollToOffset({offset: archH, animated: false});
      hideArch.current = false;
    }
  };

  /** One chat in the list. Swipe right to pin, swipe left to archive. */
  const renderRow = ({item: i, index}: {item: Item; index: number}) => {
    const on = selected.includes(i.id);
    const rowEl = (
      <Animated.View entering={index < 10 ? FadeInDown.delay(index * 40).duration(300) : undefined} layout={LinearTransition.duration(220)}>
      <ReanimatedSwipeable
        containerStyle={styles.swipeBox}
        enabled={!selecting}
        friction={2}
        overshootLeft={false}
        overshootRight={false}
        renderLeftActions={progress => (
          <SwipeAction progress={progress} icon="pin" label={i.pinned ? 'Unpin' : 'Pin'} />
        )}
        renderRightActions={progress => (
          <SwipeAction progress={progress} icon="archive" label={i.archived ? 'Unarchive' : 'Archive'} />
        )}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'left') {
            usePrefsStore.getState().patch(i.id, {pinned: !i.pinned});
          } else {
            usePrefsStore.getState().patch(i.id, {archived: !i.archived});
          }
          swipeable.close();
        }}>
      <Pressable
        key={i.id}
        onPress={() => (selecting ? toggle(i.id) : open(i))}
        onLongPress={() => toggle(i.id)}
        delayLongPress={300}
        accessibilityLabel={`${i.title}${i.unread ? `, ${i.unread} unread` : ''}`}
        style={styles.rowPress}>
        <Card solid flat style={styles.chatRow}>
          {/* Selected: the whole row, edge to edge, takes the accent colour. It is drawn behind the row, so nothing moves. */}
          {on ? <View style={styles.rowSelBg} pointerEvents="none" /> : null}

          <Pressable style={styles.avatarWrap} onPress={() => (selecting ? toggle(i.id) : openInfo(i))} hitSlop={6} accessibilityLabel={`${i.title} profile`}>
            {i.kind === 'group' ? (
              <View style={[styles.iconAvatar, {marginRight: 0}]}>
                <GroupAvatar pic={i.avatar} size={44} />
              </View>
            ) : (
              <Avatar name={i.self ? myName || 'You' : i.title} seed={i.id} uri={i.avatar} size={44} ring={i.online} />
            )}
            {on ? (
              // The picture stays as it is; a small tick sits on its corner.
              <View style={styles.tick}>
                <Icon name="check" size={12} color={colors.onPrimary} strokeWidth={3.5} />
              </View>
            ) : i.disappearing ? (
              <View style={styles.timerBadge}>
                <Icon name="clock" size={11} color={colors.text} />
              </View>
            ) : i.kind === 'direct' ? (
              <View style={[styles.onlineDot, {backgroundColor: i.online ? colors.meshOnline : colors.textMuted}]} />
            ) : null}
          </Pressable>
          <View style={styles.rowText}>
            <View style={styles.titleRow}>
              <Txt variant="bodyStrong" numberOfLines={1} style={styles.title}>
                {i.title}
              </Txt>
              {i.secret ? <Icon name="lock" size={12} color={colors.primaryBright} /> : null}
              {i.muted ? <Icon name="bellOff" size={12} color={colors.textMuted} /> : null}
            </View>
            <Preview item={i} />
            {i.label ? (
              <View style={styles.labelPill}>
                <Txt variant="label" tone="secondary" style={styles.labelTxt}>
                  {i.label.toUpperCase()}
                </Txt>
              </View>
            ) : null}
          </View>
          <View style={styles.meta}>
            <Txt variant="label" tone={i.unread && !i.muted ? 'primary' : 'muted'} style={styles.time}>
              {stamp(i.last)}
            </Txt>
            {i.unread > 0 ? (
              <View style={styles.badgeRow}>
                {i.mentioned ? (
                  <View style={styles.atBadge} accessibilityLabel="You were mentioned">
                    <Icon name="at" size={13} color={colors.onPrimary} strokeWidth={2.6} />
                  </View>
                ) : null}
                <View style={[styles.badge, i.muted && !i.mentioned && styles.badgeMuted]}>
                  <Txt variant="label" style={[styles.badgeTxt, i.muted && !i.mentioned && {color: colors.text}]}>
                    {i.unread > 99 ? '99+' : i.unread}
                  </Txt>
                </View>
              </View>
            ) : i.pinned ? (
              pinnedList.length > 1 && !selecting ? (
                <PinHandle pos={pinnedList.findIndex(p => p.id === i.id)} count={pinnedList.length} drag={drag} onDrop={dropPinned} />
              ) : (
                <Icon name="pin" size={16} color={colors.textMuted} />
              )
            ) : (
              <View style={styles.badgeSpace} />
            )}
          </View>
        </Card>
      </Pressable>
      </ReanimatedSwipeable>
      </Animated.View>
    );
    // Pinned chats can be dragged into a new order (hold the pin icon), so they carry the drag animation.
    return i.pinned && pinnedList.length > 1 ? (
      <PinnedRow pos={pinnedList.findIndex(p => p.id === i.id)} drag={drag}>
        {rowEl}
      </PinnedRow>
    ) : (
      rowEl
    );
  };

  return (
    <Screen padded={false}>
      {/* top bar: normal, search, or multi-select */}
      {selecting ? (
        <View style={styles.topBar}>
          <IconButton icon="x" label="Cancel selection" size="sm" onPress={done} />
          <Txt variant="subtitle" style={styles.selCount}>
            {selected.length}
          </Txt>
          <View style={styles.selSpacer} />
          {/* the main four as icons; the rest are in the ⋮ menu */}
          <View style={styles.selActions}>
            <SelAction icon="pin" label={allPinned ? 'Unpin' : 'Pin'} on={allPinned} onPress={doPin} />
            <SelAction icon={allMuted ? 'bell' : 'bellOff'} label={allMuted ? 'Unmute' : 'Mute'} onPress={() => (allMuted ? doMute(null) : setMuteOpen(true))} />
            <SelAction icon="tag" label="Label" onPress={() => setAssignOpen(true)} />
            <SelAction icon="trash" label="Clear" onPress={doClear} />
            <IconButton icon="more" label="More actions" size="sm" onPress={() => setSelMenuOpen(true)} />
          </View>
        </View>
      ) : (
        <View style={styles.topBar}>
          {searching ? (
            <View style={styles.searchBox}>
              <Icon name="search" size={16} color={colors.textMuted} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={onSearchText}
                placeholder="Search chats"
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                returnKeyType="search"
              />
              <Pressable
                hitSlop={10}
                onPress={() => {
                  setQuery('');
                  setSearching(false);
                }}>
                <Icon name="x" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.who}>
                <ProfileButton />
                <Txt variant="title">Chats</Txt>
              </View>
              <View style={styles.topActions}>
                <IconButton icon="search" label="Search chats" onPress={() => setSearching(true)} />
                <IconButton icon="more" label="Menu" onPress={() => setMenuOpen(true)} />
              </View>
            </>
          )}
        </View>
      )}

      {/* filter tabs (they stay while selecting, so the list never shifts) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={[styles.chipScroll, selecting && styles.chipsOff]} pointerEvents={selecting ? 'none' : 'auto'}>
          {CHIPS.map(c => {
            const on = filter.kind === c.kind;
            return (
              <Pressable key={c.kind} onPress={() => setFilter({kind: c.kind})} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{selected: on}}>
                <Txt variant="bodyStrong" style={[styles.chipTxt, on && styles.chipTxtOn]}>
                  {c.label}
                  {c.kind === 'unread' && unreadChats > 0 ? ` ${unreadChats}` : ''}
                </Txt>
              </Pressable>
            );
          })}
          {filter.kind === 'label' ? (
            <Pressable style={[styles.chip, styles.chipOn]} onPress={() => setFilter({kind: 'all'})} accessibilityState={{selected: true}}>
              <Icon name="tag" size={13} color={colors.onPrimary} />
              <Txt variant="bodyStrong" style={[styles.chipTxt, styles.chipTxtOn]}>
                {filter.label}
              </Txt>
            </Pressable>
          ) : null}
          <Pressable style={[styles.chip, styles.chipMore]} onPress={() => setLabelsOpen(true)} accessibilityLabel="Labels">
            <Icon name="chevronDown" size={16} color={colors.text} />
          </Pressable>
        </ScrollView>

      <FlatList
        ref={listRef}
        style={styles.list}
        onLayout={e => setListH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => hideArchivedNow(h)}
        data={items}
        keyExtractor={i => i.id}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        // Tall enough to scroll the Archived row out of sight even when there are only a few chats.
        contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 170}, showArchRow && archH > 0 ? {minHeight: listH + archH} : null]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <>
            {firstRun && filter.kind === 'all' && !query ? (
              <Reveal>
                <Card flat style={styles.welcome}>
                  <View style={styles.welcomeClose}>
                    <IconButton
                      icon="x"
                      label="Hide welcome"
                      onPress={() => {
                        storage.set(StorageKeys.welcomeDismissed, true);
                        setWelcomeGone(true);
                      }}
                    />
                  </View>
                  <HeroScene kind="nearby" height={150} />
                  <Txt variant="heading" center>
                    {myName ? `Welcome, ${myName}` : 'Welcome to Pulse'}
                  </Txt>
                  <Txt variant="body" tone="secondary" center>
                    Connect with someone to start chatting.
                  </Txt>
                  <View style={styles.welcomeBtns}>
                    <Button label="Find people" onPress={() => nav.navigate('FindPeople')} />
                    <Button label="Show my code" variant="secondary" onPress={() => nav.navigate('MyCode')} />
                  </View>
                </Card>
              </Reveal>
            ) : null}
            {filter.kind === 'archived' || filter.kind === 'locked' ? (
              <Pressy onPress={() => setFilter({kind: 'all'})} accessibilityRole="button" accessibilityLabel="Back to chats" scaleTo={0.985}>
                <Card flat style={styles.row}>
                  <Icon name="chevronLeft" size={20} color={colors.text} />
                  <Txt variant="bodyStrong" style={styles.archBack}>
                    {filter.kind === 'locked' ? 'Locked chats' : 'Archived chats'}
                  </Txt>
                </Card>
              </Pressy>
            ) : showArchRow ? (
              <View onLayout={e => setArchH(Math.round(e.nativeEvent.layout.height))}>
              <Pressy onPress={() => setFilter({kind: 'archived'})} accessibilityRole="button" accessibilityLabel={`Archived chats, ${archivedCount}`} scaleTo={0.985}>
                <Card flat style={styles.row}>
                  <View style={styles.iconAvatar}>
                    <IconTile icon="archive" size={44} color={colors.primary} />
                  </View>
                  <Txt variant="bodyStrong" style={styles.archBack}>
                    Archived
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {archivedCount}
                  </Txt>
                </Card>
              </Pressy>
              </View>
            ) : null}
            {/* One folder for every locked chat. Hidden (no row) when "Hide locked chats" is on: type the code in search. */}
            {filter.kind === 'all' && lockedCount > 0 && !hideLocked && !query ? (
              <Pressy onPress={openLockedFolder} accessibilityRole="button" accessibilityLabel={`Locked chats, ${lockedCount}`} scaleTo={0.985}>
                <Card flat style={styles.row}>
                  <View style={styles.iconAvatar}>
                    <IconTile icon="lock" size={44} color={colors.primary} />
                  </View>
                  <Txt variant="bodyStrong" style={styles.archBack}>
                    Locked chats
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {lockedCount}
                  </Txt>
                </Card>
              </Pressy>
            ) : null}
        {pendingInvites.length > 0 ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              GROUP INVITES
            </Txt>
            {pendingInvites.map(inv => (
              <Card key={inv.id} flat style={styles.row}>
                <View style={styles.iconAvatar}>
                  <GroupAvatar pic={inv.pic} size={44} />
                </View>
                <View style={styles.rowText}>
                  <Txt variant="bodyStrong">{inv.name}</Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {inv.byName} invited you · {inv.members.length} people
                  </Txt>
                  {inv.desc ? (
                    <Txt variant="caption" tone="secondary" numberOfLines={2}>
                      {inv.desc}
                    </Txt>
                  ) : null}
                </View>
                <View style={styles.inviteBtns}>
                  <Button label="Decline" variant="secondary" size="sm" fullWidth={false} onPress={() => decline(inv.id)} />
                  <Button label="Accept" size="sm" fullWidth={false} onPress={() => accept(inv.id)} />
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {secretInvites.length > 0 ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              SECRET CHAT REQUESTS
            </Txt>
            {secretInvites.map(inv => (
              <Reveal key={inv.id}>
                <Card flat style={styles.row} glowing>
                  <View style={styles.iconAvatar}>
                    <IconTile icon="lock" size={44} color={colors.primary} />
                  </View>
                  <View style={styles.rowText}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {prefs[inv.peerKey]?.nickname || inv.name}
                    </Txt>
                    <Txt variant="caption" tone="muted" numberOfLines={2}>
                      wants a secret chat · messages vanish after {secretTimerText(inv.t)}
                    </Txt>
                  </View>
                  <View style={styles.inviteBtns}>
                    <Button label="Decline" variant="secondary" size="sm" fullWidth={false} onPress={() => useSecretStore.getState().decline(inv.id)} />
                    <Button
                      label="Accept"
                      size="sm"
                      fullWidth={false}
                      onPress={() => {
                        const id = useSecretStore.getState().accept(inv.id);
                        if (id) {
                          nav.navigate('Conversation', {conversationId: id, kind: 'direct', title: prefs[inv.peerKey]?.nickname || inv.name});
                        }
                      }}
                    />
                  </View>
                </Card>
              </Reveal>
            ))}
          </>
        ) : null}

          </>
        }
        ListEmptyComponent={
          <Card flat style={styles.empty} raised>
            <Icon name={empty.icon} size={26} color={colors.textMuted} />
            <Txt variant="subtitle" center style={styles.emptyTitle}>
              {empty.title}
            </Txt>
            {empty.action ? <Button label={empty.action.label} size="sm" fullWidth={false} onPress={empty.action.go} /> : null}
          </Card>
        }
      />

      <Pressy
        onPress={() => nav.navigate('NewChat')}
        accessibilityRole="button"
        accessibilityLabel="New chat"
        scaleTo={0.92}
        style={[styles.fab, {bottom: insets.bottom + 100}]}>
        <Rim size={58} />
        <Icon name="chatPlus" size={26} color={colors.onPrimary} />
      </Pressy>

      {/* ⋮ menu while chats are selected */}
      <Popover visible={selMenuOpen} onClose={() => setSelMenuOpen(false)} align="right">
        <PopoverItem icon="selectAll" label="Select all" onPress={() => { setSelMenuOpen(false); setSelected(items.map(i => i.id)); }} />
        <PopoverItem icon="checkAll" label="Mark as read" onPress={() => { setSelMenuOpen(false); doRead(); }} />
        <PopoverItem icon="star" label={allFav ? 'Remove favorite' : 'Favorite'} onPress={() => { setSelMenuOpen(false); doFavorite(); }} />
        <PopoverItem icon="archive" label={allArchived ? 'Unarchive' : 'Archive'} onPress={() => { setSelMenuOpen(false); doArchive(); }} />
        <PopoverItem icon="lock" label={lockCtl.locked ? 'Unlock chat' : 'Lock chat'} onPress={() => { setSelMenuOpen(false); lockCtl.toggle(); }} />
      </Popover>

      {/* ⋮ menu */}
      <Popover visible={menuOpen} onClose={() => setMenuOpen(false)} align="right">
        <PopoverItem icon="users" label="New group" onPress={() => { setMenuOpen(false); nav.navigate('CreateGroup'); }} />
        <PopoverItem icon="lock" label="New secret chat" onPress={() => { setMenuOpen(false); nav.navigate('NewSecretChat'); }} />
        <PopoverItem icon="userPlus" label="Find people" onPress={() => { setMenuOpen(false); nav.navigate('FindPeople'); }} />
        <PopoverDivider />
        <PopoverItem icon="archive" label="Archived chats" value={archivedCount ? String(archivedCount) : undefined} onPress={() => { setMenuOpen(false); setFilter({kind: 'archived'}); }} />
        <PopoverItem icon="star" label="Starred messages" onPress={() => { setMenuOpen(false); nav.navigate('Starred'); }} />
        <PopoverItem icon="settings" label="Settings" onPress={() => { setMenuOpen(false); nav.navigate('Settings'); }} />
      </Popover>

      {/* labels: open one, make a new one, rename, delete */}
      <LabelsSheet
        visible={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        counts={Object.fromEntries(labels.map(l => [l, all.filter(i => i.label === l).length]))}
        onOpen={l => setFilter({kind: 'label', label: l})}
        onDeleted={l => {
          if (filter.kind === 'label' && filter.label === l) {
            setFilter({kind: 'all'});
          }
        }}
      />

      <LabelSheet
        visible={assignOpen}
        onClose={() => setAssignOpen(false)}
        current={sharedLabel}
        title={selected.length === 1 ? 'Label this chat' : `Label ${selected.length} chats`}
        onPick={l => {
          api.patchMany(selected, {label: l ?? undefined});
          setAssignOpen(false);
          done();
        }}
      />

      {lockCtl.modal}

      {/* Chat-code screen for the Locked chats folder */}
      <Modal visible={unlocking} animationType="slide" onRequestClose={() => setUnlocking(false)} statusBarTranslucent>
        {unlocking ? (
          <ChatUnlock
            onCancel={() => setUnlocking(false)}
            onUnlocked={() => {
              setUnlocking(false);
              setFilter({kind: 'locked'});
            }}
          />
        ) : null}
      </Modal>

      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        {[
          {label: 'For 8 hours', ms: 8 * 3600_000},
          {label: 'For 1 week', ms: 7 * 24 * 3600_000},
          {label: 'Until I turn it back on', ms: MUTE_FOREVER},
        ].map(c => (
          <Pressable key={c.label} style={styles.muteRow} onPress={() => doMute(c.ms)}>
            <Txt variant="body">{c.label}</Txt>
          </Pressable>
        ))}
      </Sheet>
    </Screen>
  );
}

/** One line under the name: ticks for my last message, an icon for photos/files/voice, then the words. */
function Preview({item}: {item: Item}) {
  const m = item.lastMsg;
  const tone = item.unread ? 'primary' : item.online ? 'secondary' : 'muted';
  if (item.secret) {
    // Secret chats never show what was said, not even in this list.
    return (
      <View style={styles.previewRow}>
        <Icon name="lock" size={13} color={colors.primaryBright} />
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {item.typing ? 'typing…' : m ? 'Encrypted message' : 'Secret chat · messages vanish'}
        </Txt>
      </View>
    );
  }
  if (item.typing) {
    return (
      <Txt variant="caption" numberOfLines={1} style={styles.typingTxt}>
        typing…
      </Txt>
    );
  }
  if (!m) {
    return (
      <Txt variant="caption" tone={tone} numberOfLines={1}>
        {item.self ? 'Message yourself' : item.kind === 'group' ? 'No messages yet' : item.where}
      </Txt>
    );
  }
  const seen = m.status === 'seen';
  const f = m.file;
  const icon: IconName | null =
    m.type === 'image'
      ? m.viewOnce
        ? 'eye'
        : 'image'
      : m.type === 'poll'
      ? 'note'
      : m.type === 'contact'
      ? 'user'
      : m.type === 'file'
      ? f?.kind === 'voice' || f?.kind === 'audio'
        ? 'mic'
        : f?.kind === 'video'
        ? 'video'
        : 'file'
      : null;
  const text =
    m.type === 'image'
      ? m.viewOnce
        ? 'View-once photo'
        : 'Photo'
      : m.type === 'poll'
      ? 'Poll'
      : m.type === 'contact'
      ? `Contact · ${m.contact?.name ?? ''}`
      : m.type === 'file'
      ? f?.kind === 'voice'
        ? `Voice message ${formatDuration(f.dur)}`
        : f?.kind === 'video'
        ? 'Video'
        : f?.name ?? 'File'
      : stripFormatting(m.text ?? '');
  return (
    <View style={styles.previewRow}>
      {m.mine && !item.self && m.status !== 'failed' && m.status !== 'sending' ? (
        <View style={styles.ticks}>
          <Icon name={m.status === 'delivered' || seen ? 'checkAll' : 'check'} size={15} color={seen ? '#22C55E' : colors.textMuted} strokeWidth={2.4} />
        </View>
      ) : null}
      {item.kind === 'group' ? (
        <Txt variant="caption" tone="muted" numberOfLines={1} style={{flexShrink: 0, maxWidth: 90}}>
          {m.mine ? 'You' : m.fromName}:
        </Txt>
      ) : null}
      {icon ? <Icon name={icon} size={14} color={colors.textMuted} /> : null}
      <Txt variant="caption" tone={tone} numberOfLines={1} style={[styles.previewTxt, item.unread ? styles.unreadText : undefined]}>
        {text}
      </Txt>
    </View>
  );
}

function SelAction({icon, label, onPress, on, danger}: {icon: IconName; label: string; onPress: () => void; on?: boolean; danger?: boolean}) {
  return <IconButton icon={icon} label={label} size="sm" active={on} tone={danger ? 'danger' : 'filled'} onPress={onPress} />;
}

const styles = themedStyles(() => StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    // Same height as the normal header (44px buttons + padding), so selecting never moves anything below it.
    minHeight: 64,
  },
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  welcome: {gap: spacing.sm, marginBottom: spacing.lg},
  welcomeClose: {position: 'absolute', top: spacing.xs, right: spacing.xs, zIndex: 2},
  welcomeBtns: {gap: spacing.xs, marginTop: spacing.sm},
  topActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  searchBox: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44},
  searchInput: {flex: 1, color: colors.text, ...typography.body, padding: 0},
  selCount: {marginLeft: spacing.sm, minWidth: 18},
  selActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  selSpacer: {flex: 1},
  fab: {position: 'absolute', right: spacing.lg, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, elevation: 4},
  archBack: {flex: 1, marginLeft: spacing.md},
  swipe: {width: 96, alignItems: 'center', justifyContent: 'center'},
  swipeInner: {alignItems: 'center', gap: 4},
  chipScroll: {flexGrow: 0, flexShrink: 0},
  // flex: 1 (basis 0) so the list takes the rest of the screen and never pushes the filter tabs smaller.
  list: {flex: 1},
  // The filter tabs are switched off (dimmed, untouchable) while chats are being selected.
  chipsOff: {opacity: 0.4},
  // A roomy touch target around the pin icon, since it is the drag handle of a pinned chat.
  pinHandle: {padding: 10, margin: -10},
  chips: {paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, alignItems: 'center'},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent'},
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipMore: {paddingHorizontal: spacing.md},
  chipTxt: {fontSize: 14, color: colors.textSecondary},
  chipTxtOn: {color: colors.onPrimary},
  // No extra space above the first row: the filter tabs already have their own gap, and each row has its own padding.
  content: {paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxxl},
  section: {marginTop: spacing.lg, marginBottom: spacing.sm},
  // A chat row is 72 px tall (a 48 px photo with 12 px above and below), with no extra gap between rows.
  rowPress: {marginBottom: 0},
  chatRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12},
  row: {flexDirection: 'row', alignItems: 'center'},
  rowSelBg: {position: 'absolute', left: -spacing.lg, right: -spacing.lg, top: 0, bottom: 0, backgroundColor: alpha(colors.primary, 0.14)},
  swipeBox: {overflow: 'visible'},
  iconAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowText: {flex: 1, marginRight: spacing.sm},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  title: {flexShrink: 1},
  previewRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  previewTxt: {flexShrink: 1},
  ticks: {marginRight: 4},
  unreadText: {fontWeight: '700'},
  typingTxt: {color: colors.text, fontStyle: 'italic'},
  labelPill: {alignSelf: 'flex-start', marginTop: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.textMuted, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2},
  labelTxt: {fontSize: 10, lineHeight: 14, letterSpacing: 0.8},
  avatarWrap: {marginRight: spacing.md},
  onlineDot: {
    position: 'absolute',
    right: -1,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  timerBadge: {position: 'absolute', right: -3, bottom: -2, width: 19, height: 19, borderRadius: 10, backgroundColor: colors.surfaceHover, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  tick: {position: 'absolute', right: -3, bottom: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  meta: {alignItems: 'flex-end', gap: 6, minWidth: 44},
  time: {fontSize: 11},
  badge: {minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  badgeMuted: {backgroundColor: colors.surfaceHover},
  badgeRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  atBadge: {width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  badgeTxt: {color: colors.onPrimary, fontSize: 11, lineHeight: 14},
  badgeSpace: {height: 22},
  empty: {alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm, marginTop: spacing.lg},
  emptyTitle: {marginTop: spacing.xs},
  inviteBtns: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  labelRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  labelMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  muteRow: {paddingVertical: spacing.md},
}));
