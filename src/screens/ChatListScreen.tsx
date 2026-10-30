import React, {useEffect, useMemo, useState} from 'react';
import {Alert, BackHandler, Modal, Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Icon, IconName, Sheet, LabelSheet, ChatUnlock} from '@/components';
import {colors, radius, spacing, typography} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore, MUTE_FOREVER} from '@/store/prefsStore';
import {notifier} from '@/services/notifier';
import {useLockStore} from '@/store/lockStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {formatDuration} from '@/services/mediaFiles';
import {stripFormatting} from '@/services/richText';
import type {ChatMessage} from '@/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Filter = {kind: 'all' | 'unread' | 'favorites' | 'groups'} | {kind: 'label'; label: string};

type Item = {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  avatar?: string;
  last: number;
  lastMsg?: ChatMessage;
  unread: number;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  label?: string;
  disappearing: boolean;
  online: boolean;
  where: string;
  /** Needs the PIN to open: preview hidden. */
  locked: boolean;
  typing: boolean;
  /** The chat with yourself. */
  self: boolean;
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

const CHIPS: {kind: 'all' | 'unread' | 'favorites' | 'groups'; label: string}[] = [
  {kind: 'all', label: 'All'},
  {kind: 'unread', label: 'Unread'},
  {kind: 'favorites', label: 'Favorites'},
  {kind: 'groups', label: 'Groups'},
];

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
  const unlockedChats = useLockStore(s => s.unlockedChats);
  const hasPin = useLockStore(s => !!s.saved);
  const myName = useSessionStore(s => s.profileName);
  const myAvatar = useSessionStore(s => s.avatarUri);
  const meKey = getIdentity().publicKey;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>({kind: 'all'});
  const [selected, setSelected] = useState<string[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [unlocking, setUnlocking] = useState<Item | null>(null);
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
    const build = (id: string, kind: 'direct' | 'group', title: string, avatar: string | undefined, fallbackTs: number): Item => {
      const list = byConversation[id] ?? [];
      const last = list[list.length - 1];
      const p = prefs[id];
      const lastRead = p?.lastRead ?? 0;
      const online = kind === 'direct' && usePeersStore.getState().isOnline(id);
      const hops = peers[id]?.hops ?? 0;
      return {
        id,
        kind,
        title,
        avatar,
        last: last?.timestamp ?? fallbackTs,
        lastMsg: last,
        unread: list.filter(m => !m.mine && m.timestamp > lastRead).length,
        pinned: !!p?.pinned,
        muted: usePrefsStore.getState().isMuted(id),
        favorite: !!p?.favorite,
        label: p?.label,
        disappearing: !!p?.disappear,
        online,
        where: online ? (hops > 0 ? `Online · via ${hops} relay${hops === 1 ? '' : 's'}` : 'Online · in range') : 'Out of range',
        locked: hasPin && !!p?.locked,
        typing: kind === 'direct' && (typingMap[id] ?? 0) > Date.now(),
        self: id === meKey,
      };
    };
    return [
      // Notes to self: a chat with yourself that never leaves this phone.
      build(meKey, 'direct', `${myName || 'You'} (You)`, myAvatar ?? undefined, 0),
      ...groups.map(g => build(g.id, 'group', g.name, undefined, g.createdAt)),
      ...paired
        .filter(p => !prefs[p.publicKey]?.blocked)
        .map(p =>
          build(p.publicKey, 'direct', prefs[p.publicKey]?.nickname || p.name, peers[p.publicKey]?.avatar ?? profiles[p.publicKey]?.avatar, p.pairedAt),
        ),
    ];
  }, [groups, paired, byConversation, prefs, peers, profiles, typingMap, hasPin, myName, myAvatar, meKey]);

  const unreadChats = all.filter(i => i.unread > 0).length;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const textOf = (i: Item) => (!i.locked && i.lastMsg?.type === 'text' ? stripFormatting(i.lastMsg.text ?? '') : '').toLowerCase();
    return all
      .filter(i =>
        filter.kind === 'unread'
          ? i.unread > 0
          : filter.kind === 'favorites'
          ? i.favorite
          : filter.kind === 'groups'
          ? i.kind === 'group'
          : filter.kind === 'label'
          ? i.label === filter.label
          : true,
      )
      .filter(i => !q || i.title.toLowerCase().includes(q) || textOf(i).includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last - a.last);
  }, [all, filter, query]);

  const go = (i: Item) => nav.navigate('Conversation', {conversationId: i.id, kind: i.kind, title: i.title});
  // A locked chat asks for the PIN first (until the app has been away for a while).
  const open = (i: Item) => (i.locked && !unlockedChats[i.id] ? setUnlocking(i) : go(i));
  const openInfo = (i: Item) =>
    i.kind === 'group' ? nav.navigate('GroupInfo', {groupId: i.id}) : i.self ? nav.navigate('EditProfile') : nav.navigate('Contact', {publicKey: i.id});
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
  const doClear = () =>
    Alert.alert(
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
  const allFav = chosen.length > 0 && chosen.every(i => i.favorite);
  const allMuted = chosen.length > 0 && chosen.every(i => i.muted);
  const sharedLabel = chosen.length > 0 && chosen.every(i => i.label && i.label === chosen[0].label) ? chosen[0].label : null;

  const emptyText =
    filter.kind === 'unread'
      ? 'You’re all caught up.'
      : filter.kind === 'favorites'
      ? 'Mark a chat as a favorite from its profile, or press and hold a chat and tap the star.'
      : filter.kind === 'groups'
      ? 'You’re not in any groups yet.'
      : filter.kind === 'label'
      ? 'No chats have this label. Press and hold a chat, then tap the label button.'
      : query
      ? 'Try a different name or word.'
      : 'Open the Nearby tab to connect with people around you, or with anyone reachable through them.';

  return (
    <Screen padded={false}>
      {/* top bar: normal, search, or multi-select */}
      {selecting ? (
        <View style={styles.topBar}>
          <Pressable onPress={done} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Cancel selection">
            <Icon name="x" size={18} color={colors.text} />
          </Pressable>
          <Txt variant="subtitle" style={styles.selCount}>
            {selected.length}
          </Txt>
          <Pressable onPress={() => setSelected(items.map(i => i.id))} hitSlop={8}>
            <Txt variant="caption" tone="secondary">
              All
            </Txt>
          </Pressable>
          <View style={styles.selActions}>
            <SelAction icon="pin" label={allPinned ? 'Unpin' : 'Pin'} on={allPinned} onPress={doPin} />
            <SelAction icon={allMuted ? 'bell' : 'bellOff'} label={allMuted ? 'Unmute' : 'Mute'} onPress={() => (allMuted ? doMute(null) : setMuteOpen(true))} />
            <SelAction icon="checkAll" label="Mark read" onPress={doRead} />
            <SelAction icon="star" label={allFav ? 'Unfavorite' : 'Favorite'} on={allFav} onPress={doFavorite} />
            <SelAction icon="tag" label="Label" onPress={() => setAssignOpen(true)} />
            <SelAction icon="trash" label="Clear" danger onPress={doClear} />
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
                onChangeText={setQuery}
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
              <Txt variant="title">Chats</Txt>
              <View style={styles.topActions}>
                <Pressable style={styles.iconBtn} hitSlop={8} accessibilityLabel="Search chats" onPress={() => setSearching(true)}>
                  <Icon name="search" size={18} color={colors.text} />
                </Pressable>
                <Pressable style={styles.newGroup} onPress={() => nav.navigate('CreateGroup')}>
                  <Icon name="users" size={16} color={colors.primaryBright} />
                  <Txt variant="caption" tone="accent">
                    New group
                  </Txt>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

      {/* filter tabs */}
      {!selecting ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
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
      ) : null}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {pendingInvites.length > 0 && !selecting ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              GROUP INVITES
            </Txt>
            {pendingInvites.map(inv => (
              <Card key={inv.id} style={styles.row}>
                <View style={[styles.iconAvatar, {backgroundColor: colors.primaryDim}]}>
                  <Icon name="users" size={20} color={colors.primaryBright} />
                </View>
                <View style={styles.rowText}>
                  <Txt variant="bodyStrong">{inv.name}</Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {inv.byName} invited you · {inv.members.length} people
                  </Txt>
                </View>
                <View style={styles.inviteBtns}>
                  <Pressable onPress={() => accept(inv.id)} style={styles.accept}>
                    <Txt variant="caption" style={styles.acceptTxt}>
                      Accept
                    </Txt>
                  </Pressable>
                  <Pressable onPress={() => decline(inv.id)} hitSlop={6}>
                    <Txt variant="caption" tone="muted">
                      Decline
                    </Txt>
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {items.length === 0 ? (
          <Card style={styles.empty} raised>
            <Icon name={query ? 'search' : 'chat'} size={26} color={colors.textMuted} />
            <Txt variant="subtitle" center style={styles.emptyTitle}>
              {query ? 'No chats found' : filter.kind === 'all' ? 'No chats yet' : 'Nothing here'}
            </Txt>
            <Txt variant="caption" tone="muted" center>
              {emptyText}
            </Txt>
          </Card>
        ) : (
          items.map(i => {
            const on = selected.includes(i.id);
            return (
              <Pressable
                key={i.id}
                onPress={() => (selecting ? toggle(i.id) : open(i))}
                onLongPress={() => toggle(i.id)}
                delayLongPress={300}
                accessibilityLabel={`${i.title}${i.unread ? `, ${i.unread} unread` : ''}`}
                style={styles.rowPress}>
                <Card style={[styles.row, on && styles.rowOn]}>
                  <Pressable style={styles.avatarWrap} onPress={() => (selecting ? toggle(i.id) : openInfo(i))} hitSlop={6} accessibilityLabel={`${i.title} profile`}>
                    {i.kind === 'group' ? (
                      <View style={[styles.iconAvatar, {backgroundColor: colors.surfaceHover, marginRight: 0}]}>
                        <Icon name="users" size={20} color={colors.text} />
                      </View>
                    ) : (
                      <Avatar name={i.self ? myName || 'You' : i.title} seed={i.id} uri={i.avatar} size={44} ring={i.online} />
                    )}
                    {on ? (
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
                      {i.locked ? <Icon name="lock" size={12} color={colors.textMuted} /> : null}
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
                      <View style={[styles.badge, i.muted && styles.badgeMuted]}>
                        <Txt variant="label" style={[styles.badgeTxt, i.muted && {color: colors.text}]}>
                          {i.unread > 99 ? '99+' : i.unread}
                        </Txt>
                      </View>
                    ) : i.pinned ? (
                      <Icon name="pin" size={16} color={colors.textMuted} />
                    ) : (
                      <View style={styles.badgeSpace} />
                    )}
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* labels: filter by one, or make a new one */}
      <Sheet visible={labelsOpen} onClose={() => setLabelsOpen(false)} title="Labels" scroll>
        {labels.length === 0 ? (
          <Txt variant="caption" tone="muted" style={{marginBottom: spacing.md}}>
            Labels tag your chats — “Work”, “Family”, “Hiking”. Press and hold a chat, then tap the label button.
          </Txt>
        ) : null}
        {labels.map(l => {
          const count = all.filter(i => i.label === l).length;
          return (
            <View key={l} style={styles.labelRow}>
              <Pressable
                style={styles.labelMain}
                onPress={() => {
                  setFilter({kind: 'label', label: l});
                  setLabelsOpen(false);
                }}>
                <Icon name="tag" size={18} color={colors.textSecondary} />
                <Txt variant="body" style={{flex: 1}}>
                  {l}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {count}
                </Txt>
              </Pressable>
              <Pressable
                hitSlop={10}
                accessibilityLabel={`Delete label ${l}`}
                onPress={() =>
                  Alert.alert(`Delete label “${l}”?`, 'The chats stay; they just lose this label.', [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        usePrefsStore.getState().removeLabel(l);
                        if (filter.kind === 'label' && filter.label === l) {
                          setFilter({kind: 'all'});
                        }
                      },
                    },
                  ])
                }>
                <Icon name="trash" size={17} color={colors.textMuted} />
              </Pressable>
            </View>
          );
        })}
        <Txt variant="caption" tone="muted" style={{marginTop: spacing.md}}>
          Create new labels from a chat’s profile, or select chats and tap the label button.
        </Txt>
      </Sheet>

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

      {/* PIN screen for a locked chat */}
      <Modal visible={!!unlocking} animationType="slide" onRequestClose={() => setUnlocking(null)} statusBarTranslucent>
        {unlocking ? (
          <ChatUnlock
            chatId={unlocking.id}
            title={unlocking.title}
            onCancel={() => setUnlocking(null)}
            onUnlocked={() => {
              const target = unlocking;
              setUnlocking(null);
              go(target);
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
  if (item.locked) {
    return (
      <View style={styles.previewRow}>
        <Icon name="lock" size={13} color={colors.textMuted} />
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          Locked chat
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
        <Txt variant="caption" style={[styles.ticks, seen && styles.ticksSeen]}>
          {m.status === 'delivered' || seen ? '✓✓' : '✓'}
        </Txt>
      ) : null}
      {item.kind === 'group' && !m.mine ? (
        <Txt variant="caption" tone="muted" numberOfLines={1} style={{flexShrink: 0, maxWidth: 90}}>
          {m.fromName}:
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
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[styles.selBtn, on && styles.selBtnOn]}>
      <Icon name={icon} size={18} color={on ? colors.onPrimary : danger ? colors.dangerBright : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 52,
  },
  topActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  iconBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  searchBox: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44},
  searchInput: {flex: 1, color: colors.text, ...typography.body, padding: 0},
  newGroup: {flexDirection: 'row', alignItems: 'center', gap: 6},
  selCount: {marginLeft: spacing.md, marginRight: spacing.md, minWidth: 18},
  selActions: {flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto', paddingLeft: spacing.sm},
  selBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  selBtnOn: {backgroundColor: colors.primary},
  chipScroll: {flexGrow: 0},
  chips: {paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, alignItems: 'center'},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent'},
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipMore: {paddingHorizontal: spacing.md},
  chipTxt: {fontSize: 14, color: colors.textSecondary},
  chipTxtOn: {color: colors.onPrimary},
  content: {padding: spacing.lg, paddingBottom: spacing.xxxl},
  section: {marginTop: spacing.lg, marginBottom: spacing.sm},
  rowPress: {marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center'},
  rowOn: {backgroundColor: colors.surfaceHover, borderColor: colors.textMuted},
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
  ticks: {color: colors.textMuted, fontSize: 12},
  ticksSeen: {color: colors.text, fontWeight: '800'},
  unreadText: {fontWeight: '700'},
  typingTxt: {color: colors.text, fontStyle: 'italic'},
  labelPill: {alignSelf: 'flex-start', marginTop: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.textMuted, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 1},
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
  badgeTxt: {color: colors.onPrimary, fontSize: 11, lineHeight: 14},
  badgeSpace: {height: 22},
  empty: {alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm, marginTop: spacing.lg},
  emptyTitle: {marginTop: spacing.xs},
  inviteBtns: {alignItems: 'flex-end', gap: spacing.xs},
  accept: {backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.sm},
  acceptTxt: {color: colors.onPrimary},
  labelRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  labelMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  muteRow: {paddingVertical: spacing.md},
});
