import {themedStyles} from '@/theme/themed';
import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, TextInput, ToastAndroid, View} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {
  Screen,
  Txt,
  Avatar,
  Icon,
  IconTile,
  GroupAvatar,
  ActionTile,
  MediaStrip,
  ImageViewer,
  Popover,
  PopoverItem,
  PopoverDivider,
  Sheet,
  SettingRow,
  SettingGroup,
  SettingLabel,
  LabelSheet,
  DisappearSheet,
  disappearText,
  useChatLock,
} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {useGroupsStore, isAdminOf, canEditInfoOf, MAX_NAME, MAX_DESC, MAX_MEMBERS} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {mediaFiles} from '@/services/mediaFiles';
import {pickProfilePhoto, takeProfilePhoto} from '@/services/imagePicker';
import type {MediaVisual} from '@/services/sharedMedia';
import {notifier} from '@/services/notifier';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GroupInfo'>;

const HOUR = 3600_000;
const MUTE_CHOICES: {label: string; ms: number | typeof MUTE_FOREVER}[] = [
  {label: 'For 1 hour', ms: HOUR},
  {label: 'For 8 hours', ms: 8 * HOUR},
  {label: 'For 1 week', ms: 7 * 24 * HOUR},
  {label: 'Until I turn it back on', ms: MUTE_FOREVER},
];

/**
 * A group, in full: its picture, name and description (changed right here), who made it and when, quick actions,
 * everything shared in it, its link and join requests, the rules, and who is in it — with what each person is (admin,
 * joined, invited) and what an admin can do with them.
 */
export default function GroupInfoScreen() {
  const nav = useNavigation<Nav>();
  const {groupId} = useRoute<R>().params;
  const group = useGroupsStore(s => s.groups.find(g => g.id === groupId));
  const requestCount = useGroupsStore(s => s.joinRequests.filter(r => r.gid === groupId).length);
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);
  const prefs = usePrefsStore(s => s.prefs[groupId]);
  const messages = useChatStore(s => s.byConversation[groupId]);
  const myName = useSessionStore(s => s.profileName) || 'You';
  const [muteOpen, setMuteOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [disOpen, setDisOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const lockCtl = useChatLock(groupId);
  const me = getIdentity().publicKey;
  const api = usePrefsStore.getState();
  const store = useGroupsStore.getState();
  const muted = api.isMuted(groupId);
  const admin = !!group && isAdminOf(group, me);
  const canEdit = !!group && canEditInfoOf(group, me);

  const nameOf = (key: string) =>
    key === me
      ? `${myName} (you)`
      : api.nameFor(key, paired.find(p => p.publicKey === key)?.name || peers[key]?.name || known[key]?.name || 'Pulse user');

  // Me first, then admins, then people who joined, then people who haven't yet.
  const members = useMemo(() => {
    if (!group) {
      return [];
    }
    const rank = (k: string) => (k === me ? 0 : isAdminOf(group, k) ? 1 : group.joined.includes(k) ? 2 : 3);
    return [...group.members].sort((a, b) => rank(a) - rank(b));
  }, [group, me]);

  if (!group) {
    return (
      <Screen>
        <Txt variant="subtitle" tone="secondary" center style={{marginTop: spacing.xxl}}>
          You’re not in this group any more.
        </Txt>
      </Screen>
    );
  }

  const waiting = group.members.length - group.joined.length;
  const goChat = () => nav.navigate('Conversation', {conversationId: groupId, kind: 'group', title: group.name});
  const full = group.members.length >= MAX_MEMBERS;

  const setMute = (ms: number | typeof MUTE_FOREVER | null) => {
    api.mute(groupId, ms);
    if (ms !== null) {
      notifier.clearConversation(groupId);
    }
    setMuteOpen(false);
  };

  // ---- picture ------------------------------------------------------------------------
  const setPic = (thumb: string | null) => {
    if (!thumb) {
      ToastAndroid.show('That photo is too detailed. Try another.', ToastAndroid.SHORT);
      return;
    }
    store.setInfo(groupId, {pic: thumb});
  };
  const changePic = () =>
    alertDialog('Group picture', undefined, [
      {text: 'Choose a photo', onPress: () => void pickProfilePhoto().then(p => p && setPic(p.thumb))},
      {text: 'Take a photo', onPress: () => void takeProfilePhoto().then(p => p && setPic(p.thumb))},
      ...(group.pic ? [{text: 'Remove picture', style: 'destructive' as const, onPress: () => store.setInfo(groupId, {pic: ''})}] : []),
      {text: 'Cancel', style: 'cancel' as const},
    ]);

  // ---- name and description ------------------------------------------------------------
  const saveRename = () => {
    const n = draft.trim();
    if (n && n !== group.name) {
      store.setInfo(groupId, {name: n});
    }
    setRenaming(false);
  };
  const saveDesc = () => {
    store.setInfo(groupId, {desc: descDraft});
    setEditingDesc(false);
  };

  const openMedia = (it: MediaVisual) => {
    if (it.kind === 'photo') {
      setViewing(it.image);
    } else if (it.msg.file?.path) {
      void mediaFiles.open(it.msg.file.path, it.msg.file.mime).then(err => err && ToastAndroid.show('Can’t open this video', ToastAndroid.SHORT));
    }
  };

  // ---- people ---------------------------------------------------------------------------
  const remove = (key: string) => {
    const joined = group.joined.includes(key);
    alertDialog(
      joined ? `Remove ${nameOf(key)}?` : `Cancel the invite to ${nameOf(key)}?`,
      joined ? 'They won’t get this group’s messages any more. The group also gets a new secret key, so they can’t read what is said next.' : 'They haven’t joined yet. Their invite is withdrawn.',
      [
        {text: 'Keep', style: 'cancel'},
        {text: joined ? 'Remove' : 'Cancel invite', style: 'destructive', onPress: () => store.removeMember(groupId, key)},
      ],
    );
  };

  const leave = () =>
    alertDialog(
      'Leave this group?',
      group.createdBy === me
        ? 'You made this group. When you leave, the next person in the list becomes admin. The group’s chat is deleted from this phone.'
        : 'Everyone is told you left. You’ll stop receiving its messages and its chat is deleted from this phone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            useChatStore.getState().clearConversation(groupId);
            store.leave(groupId);
            notifier.clearConversation(groupId);
            nav.popToTop();
          },
        },
      ],
    );

  const endGroup = () =>
    alertDialog('Delete this group for everyone?', 'Everybody is removed and the group is gone from every phone. Their copies of the chat stay on their phones.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete group',
        style: 'destructive',
        onPress: () => {
          useChatStore.getState().clearConversation(groupId);
          store.endGroup(groupId);
          notifier.clearConversation(groupId);
          nav.popToTop();
        },
      },
    ]);

  const clear = () =>
    alertDialog('Clear this chat?', 'Deletes every message in this group from this phone.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useChatStore.getState().clearConversation(groupId)},
    ]);

  const menuKey = menuFor;
  const menuPaired = !!menuKey && paired.some(p => p.publicKey === menuKey);
  const menuJoined = !!menuKey && group.joined.includes(menuKey);
  const menuAdmin = !!menuKey && isAdminOf(group, menuKey);
  const menuIsCreator = menuKey === group.createdBy;
  const closeMenu = () => setMenuFor(null);

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <Pressable onPress={() => (group.pic ? setViewing(group.pic) : canEdit ? changePic() : undefined)} accessibilityRole="button" accessibilityLabel="Group picture">
          <GroupAvatar pic={group.pic} size={104} />
        </Pressable>
        {canEdit ? (
          <Pressable onPress={changePic} hitSlop={8} style={styles.camera} accessibilityRole="button" accessibilityLabel="Change group picture">
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </Pressable>
        ) : null}

        {renaming ? (
          <View style={styles.renameRow}>
            <TextInput
              value={draft}
              onChangeText={t => setDraft(t.slice(0, MAX_NAME))}
              autoFocus
              selectTextOnFocus
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              returnKeyType="done"
              onSubmitEditing={saveRename}
              style={styles.renameInput}
            />
            <Pressable onPress={() => setRenaming(false)} hitSlop={8} style={styles.circle} accessibilityRole="button" accessibilityLabel="Cancel">
              <Icon name="x" size={18} color={colors.text} />
            </Pressable>
            <Pressable onPress={saveRename} hitSlop={8} style={[styles.circle, styles.circleOn]} accessibilityRole="button" accessibilityLabel="Save name">
              <Icon name="check" size={18} color={colors.onPrimary} strokeWidth={3} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <Txt variant="title" center style={styles.name} numberOfLines={2}>
              {group.name}
            </Txt>
            {canEdit ? (
              <Pressable
                onPress={() => {
                  setDraft(group.name);
                  setRenaming(true);
                }}
                hitSlop={10}
                style={styles.circle}
                accessibilityRole="button"
                accessibilityLabel="Rename group">
                <Icon name="edit" size={17} color={colors.text} />
              </Pressable>
            ) : null}
          </View>
        )}

        <Txt variant="caption" tone="secondary">
          {group.members.length} members{waiting > 0 ? ` · ${waiting} not joined yet` : ''}
        </Txt>
        <View style={styles.encRow}>
          <Icon name="lock" size={12} color={colors.textMuted} />
          <Txt variant="caption" tone="muted">
            End-to-end encrypted
          </Txt>
        </View>
        <Txt variant="caption" tone="muted" style={styles.created}>
          Created by {nameOf(group.createdBy)} · {new Date(group.createdAt).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})}
        </Txt>
      </View>

      {/* the same quick actions as on a person's profile */}
      <View style={styles.actions}>
        <ActionTile icon="chat" label="Message" onPress={goChat} />
        <ActionTile icon={muted ? 'bellOff' : 'bell'} label={muted ? 'Unmute' : 'Mute'} active={muted} onPress={() => (muted ? setMute(null) : setMuteOpen(true))} />
        <ActionTile icon="pin" label={prefs?.pinned ? 'Unpin' : 'Pin'} active={!!prefs?.pinned} onPress={() => api.patch(groupId, {pinned: !prefs?.pinned})} />
        {admin && !full ? <ActionTile icon="userPlus" label="Add" onPress={() => nav.navigate('AddGroupMembers', {groupId})} /> : null}
      </View>

      {/* what the group is about */}
      {group.desc || canEdit ? (
        <>
          <SettingLabel>ABOUT</SettingLabel>
          {editingDesc ? (
            <View style={styles.descBox}>
              <TextInput
                value={descDraft}
                onChangeText={t => setDescDraft(t.slice(0, MAX_DESC))}
                autoFocus
                multiline
                placeholder="What is this group for?"
                placeholderTextColor={colors.textMuted}
                selectionColor={colors.primary}
                style={styles.descInput}
              />
              <View style={styles.descFoot}>
                <Txt variant="caption" tone="muted">
                  {descDraft.length}/{MAX_DESC}
                </Txt>
                <View style={styles.descBtns}>
                  <Pressable onPress={() => setEditingDesc(false)} hitSlop={8} style={styles.circle} accessibilityRole="button" accessibilityLabel="Cancel">
                    <Icon name="x" size={18} color={colors.text} />
                  </Pressable>
                  <Pressable onPress={saveDesc} hitSlop={8} style={[styles.circle, styles.circleOn]} accessibilityRole="button" accessibilityLabel="Save description">
                    <Icon name="check" size={18} color={colors.onPrimary} strokeWidth={3} />
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              disabled={!canEdit}
              onPress={() => {
                setDescDraft(group.desc ?? '');
                setEditingDesc(true);
              }}
              style={styles.descCard}
              accessibilityRole={canEdit ? 'button' : undefined}
              accessibilityLabel="Group description">
              <Txt variant="body" tone={group.desc ? 'primary' : 'muted'} style={{flex: 1}}>
                {group.desc || 'Add a group description'}
              </Txt>
              {canEdit ? <Icon name="edit" size={16} color={colors.textMuted} /> : null}
            </Pressable>
          )}
        </>
      ) : null}

      <MediaStrip messages={messages ?? []} onOpen={openMedia} onSeeAll={() => nav.navigate('Media', {conversationId: groupId, title: group.name})} />

      <SettingLabel>INVITE</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="qr"
          title="Group link and QR code"
          subtitle="Anyone with it can ask to join. An admin approves"
          value={admin && requestCount ? `${requestCount} waiting` : undefined}
          onPress={() => nav.navigate('GroupInvite', {groupId})}
        />
      </SettingGroup>

      <SettingLabel>{`MEMBERS · ${group.members.length}/${MAX_MEMBERS}`}</SettingLabel>
      <SettingGroup>
        {admin && !full ? (
          <Pressable onPress={() => nav.navigate('AddGroupMembers', {groupId})} style={({pressed}) => [styles.member, pressed && {backgroundColor: colors.surfaceHover}]} accessibilityRole="button" accessibilityLabel="Add people">
            <IconTile icon="userPlus" size={40} color={colors.primary} />
            <View style={styles.memberText}>
              <Txt variant="bodyStrong">Add people</Txt>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {members.map(key => {
          const isMe = key === me;
          const isAdmin = isAdminOf(group, key);
          const joined = group.joined.includes(key);
          const online = !isMe && usePeersStore.getState().isOnline(key);
          return (
            <Pressable
              key={key}
              disabled={isMe}
              onPress={() => nav.navigate('Contact', {publicKey: key})}
              style={({pressed}) => [styles.member, pressed && {backgroundColor: colors.surfaceHover}]}
              accessibilityRole="button"
              accessibilityLabel={nameOf(key)}>
              <View>
                <Avatar name={nameOf(key)} seed={key} uri={peers[key]?.avatar ?? known[key]?.avatar} size={40} />
                {online ? <View style={styles.onlineDot} /> : null}
              </View>
              <View style={styles.memberText}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {nameOf(key)}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {joined ? (online ? 'Online' : 'Joined') : 'Invited · hasn’t accepted yet'}
                </Txt>
              </View>
              {isAdmin ? (
                <View style={styles.adminPill}>
                  <Txt variant="label" tone="accent">
                    {key === group.createdBy ? 'OWNER' : 'ADMIN'}
                  </Txt>
                </View>
              ) : null}
              {!isMe && admin && key !== group.createdBy ? (
                <Pressable onPress={() => setMenuFor(key)} hitSlop={10} style={styles.moreBtn} accessibilityRole="button" accessibilityLabel={`More for ${nameOf(key)}`}>
                  <Icon name="more" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : !isMe ? (
                <Icon name="chevronRight" size={18} color={colors.textMuted} />
              ) : null}
            </Pressable>
          );
        })}
      </SettingGroup>

      {admin ? (
        <>
          <SettingLabel>GROUP RULES</SettingLabel>
          <SettingGroup>
            <SettingRow
              icon="edit"
              title="Only admins can edit the group"
              subtitle="Name, picture and description"
              toggle={{value: group.perms?.edit === 'admins', onChange: v => store.setPerms(groupId, {...group.perms, edit: v ? 'admins' : undefined})}}
            />
            <SettingRow
              icon="chat"
              title="Only admins can send messages"
              subtitle="Everyone else can read and react"
              toggle={{value: group.perms?.send === 'admins', onChange: v => store.setPerms(groupId, {...group.perms, send: v ? 'admins' : undefined})}}
            />
          </SettingGroup>
        </>
      ) : null}

      <SettingLabel>THIS GROUP</SettingLabel>
      <SettingGroup>
        <SettingRow icon={muted ? 'bellOff' : 'bell'} title="Mute notifications" value={muteLabel(prefs) ?? 'Off'} onPress={() => (muted ? setMute(null) : setMuteOpen(true))} />
        <SettingRow icon="pin" title="Pin to top of chats" toggle={{value: !!prefs?.pinned, onChange: v => api.patch(groupId, {pinned: v})}} />
        <SettingRow icon="star" title="Favorite" toggle={{value: !!prefs?.favorite, onChange: v => api.patch(groupId, {favorite: v})}} />
        <SettingRow icon="tag" title="Label" value={prefs?.label || 'None'} onPress={() => setLabelOpen(true)} />
        <SettingRow icon="clock" title="Disappearing messages" value={disappearText(prefs?.disappear)} onPress={() => setDisOpen(true)} />
        <SettingRow icon="lock" title="Lock chat" subtitle="Moves it to Locked chats. Opens with your chat code" toggle={{value: lockCtl.shown, onChange: () => (lockCtl.locked && !lockCtl.shown ? undefined : lockCtl.toggle())}} />
        <SettingRow icon="star" title="Starred messages" onPress={() => nav.navigate('Starred')} />
      </SettingGroup>

      <SettingLabel>MANAGE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="trash" title="Clear chat" onPress={clear} />
        <SettingRow icon="userX" title="Leave group" danger onPress={leave} />
        {admin ? <SettingRow icon="trash" title="Delete group for everyone" danger onPress={endGroup} /> : null}
      </SettingGroup>

      {/* a member's menu: a drop-down, not a pop-up */}
      <Popover visible={!!menuKey} onClose={closeMenu} align="right">
        <PopoverItem
          icon="user"
          label="View profile"
          onPress={() => {
            const k = menuKey;
            closeMenu();
            if (k) {
              nav.navigate('Contact', {publicKey: k});
            }
          }}
        />
        {menuPaired ? (
          <PopoverItem
            icon="chat"
            label="Message"
            onPress={() => {
              const k = menuKey;
              closeMenu();
              if (k) {
                nav.navigate('Conversation', {conversationId: k, kind: 'direct', title: nameOf(k)});
              }
            }}
          />
        ) : null}
        {menuJoined && !menuIsCreator ? (
          <PopoverItem
            icon="verified"
            label={menuAdmin ? 'Remove as admin' : 'Make admin'}
            onPress={() => {
              const k = menuKey;
              closeMenu();
              if (k) {
                store.setAdmin(groupId, k, !menuAdmin);
              }
            }}
          />
        ) : null}
        {!menuJoined ? (
          <PopoverItem
            icon="send"
            label="Send invite again"
            onPress={() => {
              const k = menuKey;
              closeMenu();
              if (k && store.resendInvite(groupId, k)) {
                ToastAndroid.show('Invite sent again', ToastAndroid.SHORT);
              }
            }}
          />
        ) : null}
        <PopoverDivider />
        <PopoverItem
          icon="userX"
          label={menuJoined ? 'Remove from group' : 'Cancel invite'}
          danger
          onPress={() => {
            const k = menuKey;
            closeMenu();
            if (k) {
              remove(k);
            }
          }}
        />
      </Popover>

      {lockCtl.modal}
      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
      <LabelSheet
        visible={labelOpen}
        onClose={() => setLabelOpen(false)}
        current={prefs?.label}
        onPick={l => {
          api.patch(groupId, {label: l ?? undefined});
          setLabelOpen(false);
        }}
      />
      <DisappearSheet
        visible={disOpen}
        onClose={() => setDisOpen(false)}
        value={prefs?.disappear}
        onPick={ms => {
          useChatStore.getState().setDisappear(groupId, 'group', ms);
          setDisOpen(false);
        }}
      />

      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        {MUTE_CHOICES.map(c => (
          <Pressable key={c.label} style={styles.choice} onPress={() => setMute(c.ms)}>
            <Txt variant="body">{c.label}</Txt>
          </Pressable>
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md},
  camera: {position: 'absolute', top: spacing.xl + 70, left: '50%', marginLeft: 20, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg},
  nameRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, maxWidth: '92%'},
  name: {flexShrink: 1},
  renameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, width: '100%'},
  renameInput: {flex: 1, height: 48, borderRadius: radius.pill, paddingHorizontal: spacing.lg, color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primary, fontSize: 17},
  circle: {width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised},
  circleOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  encRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs},
  created: {marginTop: spacing.xs},
  actions: {flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md},
  descCard: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  descBox: {padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primary},
  descInput: {minHeight: 80, maxHeight: 200, color: colors.text, fontSize: 15, padding: 0, textAlignVertical: 'top'},
  descFoot: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md},
  descBtns: {flexDirection: 'row', gap: spacing.sm},
  member: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  memberText: {flex: 1, marginLeft: spacing.md},
  onlineDot: {position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.meshOnline, borderWidth: 2, borderColor: colors.surfaceRaised},
  adminPill: {height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm},
  moreBtn: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  choice: {paddingVertical: spacing.md},
}));
