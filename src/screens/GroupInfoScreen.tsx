import React, {useState} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Avatar, Icon, Sheet, SettingRow, SettingGroup, SettingLabel, LabelSheet, DisappearSheet, disappearText, useChatLock} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {notifier} from '@/services/notifier';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GroupInfo'>;

const HOUR = 3600_000;
const MUTE_CHOICES: {label: string; ms: number | typeof MUTE_FOREVER}[] = [
  {label: 'For 1 hour', ms: HOUR},
  {label: 'For 8 hours', ms: 8 * HOUR},
  {label: 'For 1 week', ms: 7 * 24 * HOUR},
  {label: 'Until I turn it back on', ms: MUTE_FOREVER},
];

export default function GroupInfoScreen() {
  const nav = useNavigation<Nav>();
  const {groupId} = useRoute<R>().params;
  const group = useGroupsStore(s => s.groups.find(g => g.id === groupId));
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);
  const prefs = usePrefsStore(s => s.prefs[groupId]);
  const myName = useSessionStore(s => s.profileName) || 'You';
  const [muteOpen, setMuteOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [disOpen, setDisOpen] = useState(false);
  const lockCtl = useChatLock(groupId);
  const me = getIdentity().publicKey;
  const api = usePrefsStore.getState();
  const muted = api.isMuted(groupId);

  if (!group) {
    return (
      <Screen>
        <Txt variant="subtitle" tone="secondary" center style={{marginTop: spacing.xxl}}>
          You’re not in this group any more.
        </Txt>
      </Screen>
    );
  }

  const nameOf = (key: string) =>
    key === me
      ? `${myName} (you)`
      : api.nameFor(key, paired.find(p => p.publicKey === key)?.name || peers[key]?.name || known[key]?.name || 'Pulse user');

  const setMute = (ms: number | typeof MUTE_FOREVER | null) => {
    api.mute(groupId, ms);
    if (ms !== null) {
      notifier.clearConversation(groupId);
    }
    setMuteOpen(false);
  };

  const leave = () =>
    Alert.alert('Leave this group?', 'You’ll stop receiving its messages and its chat is deleted from this phone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          useChatStore.getState().clearConversation(groupId);
          useGroupsStore.getState().leave(groupId);
          notifier.clearConversation(groupId);
          nav.popToTop();
        },
      },
    ]);

  const clear = () =>
    Alert.alert('Clear this chat?', 'Deletes every message in this group from this phone.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useChatStore.getState().clearConversation(groupId)},
    ]);

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <View style={styles.groupIcon}>
          <Icon name="users" size={42} color={colors.text} />
        </View>
        <Txt variant="title" center style={styles.name}>
          {group.name}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {group.joined.length} of {group.members.length} joined · encrypted for members only
        </Txt>
      </View>

      <SettingLabel>MEMBERS</SettingLabel>
      <SettingGroup>
        {group.members.map(key => (
          <Pressable
            key={key}
            disabled={key === me}
            onPress={() => nav.navigate('Contact', {publicKey: key})}
            style={({pressed}) => [styles.member, pressed && {backgroundColor: colors.surfaceHover}]}>
            <Avatar name={nameOf(key)} seed={key} uri={peers[key]?.avatar ?? known[key]?.avatar} size={40} />
            <View style={styles.memberText}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {nameOf(key)}
              </Txt>
              <Txt variant="caption" tone="muted">
                {key === group.createdBy ? 'Created the group · ' : ''}
                {group.joined.includes(key) ? 'Joined' : 'Invited'}
              </Txt>
            </View>
            {key !== me ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : null}
          </Pressable>
        ))}
      </SettingGroup>

      <SettingLabel>THIS GROUP</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon={muted ? 'bellOff' : 'bell'}
          title="Mute notifications"
          value={muteLabel(prefs) ?? 'Off'}
          onPress={() => (muted ? setMute(null) : setMuteOpen(true))}
        />
        <SettingRow icon="pin" title="Pin to top of chats" toggle={{value: !!prefs?.pinned, onChange: v => api.patch(groupId, {pinned: v})}} />
        <SettingRow icon="star" title="Favorite" toggle={{value: !!prefs?.favorite, onChange: v => api.patch(groupId, {favorite: v})}} />
        <SettingRow icon="tag" title="Label" value={prefs?.label || 'None'} onPress={() => setLabelOpen(true)} />
        <SettingRow icon="clock" title="Disappearing messages" value={disappearText(prefs?.disappear)} onPress={() => setDisOpen(true)} />
        <SettingRow icon="lock" title="Lock chat" subtitle="Needs your PIN or fingerprint to open" toggle={{value: lockCtl.locked, onChange: () => lockCtl.toggle()}} />
        <SettingRow icon="star" title="Starred messages" onPress={() => nav.navigate('Starred')} />
      </SettingGroup>

      <SettingLabel>MANAGE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="trash" title="Clear chat" onPress={clear} />
        <SettingRow icon="userX" title="Leave group" danger onPress={leave} />
      </SettingGroup>

      {lockCtl.modal}
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

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md},
  groupIcon: {width: 104, height: 104, borderRadius: 52, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  name: {marginTop: spacing.lg, maxWidth: '90%'},
  member: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  memberText: {flex: 1, marginLeft: spacing.md},
  choice: {paddingVertical: spacing.md},
});

