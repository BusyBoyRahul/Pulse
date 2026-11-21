import {themedStyles} from '@/theme/themed';
import React from 'react';
import {Share, StyleSheet, ToastAndroid, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {RouteProp, useRoute} from '@react-navigation/native';

import {Screen, Txt, Button, Avatar, QrCode, Reveal, SettingGroup, SettingLabel} from '@/components';
import {GroupAvatar} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useGroupsStore, isAdminOf} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {makeGroupLink} from '@/services/inviteLink';
import {getIdentity} from '@/services/identity';

type R = RouteProp<RootStackParamList, 'GroupInvite'>;

/**
 * A group's link and QR code, for anybody in the group to share, and the people who opened it and asked to join. A link
 * never lets anyone in by itself: an admin has to say yes here. So a link that ends up in the wrong hands is harmless.
 */
export default function GroupInviteScreen() {
  const {groupId} = useRoute<R>().params;
  const group = useGroupsStore(s => s.groups.find(g => g.id === groupId));
  const requests = useGroupsStore(s => s.joinRequests.filter(r => r.gid === groupId));
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);

  if (!group) {
    return (
      <Screen edges={['left', 'right']}>
        <Txt variant="subtitle" tone="secondary" center style={{marginTop: spacing.xxl}}>
          You’re not in this group any more.
        </Txt>
      </Screen>
    );
  }

  const admin = isAdminOf(group, getIdentity().publicKey);
  // People are sent to the group's creator, who is always an admin (and is the one phone every member is connected to).
  const link = makeGroupLink(group.id, group.createdBy, group.name);

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <Reveal kind="pop" style={styles.qrWrap}>
        <QrCode value={link} size={236} />
      </Reveal>
      <View style={styles.title}>
        <GroupAvatar pic={group.pic} size={36} />
        <Txt variant="heading" numberOfLines={1} style={{flexShrink: 1}}>
          {group.name}
        </Txt>
      </View>
      <Txt variant="caption" tone="muted" center style={styles.hint}>
        Anyone who scans this or opens the link can ask to join. An admin has to approve them.
      </Txt>

      <View style={styles.buttons}>
        <Button label="Share link" onPress={() => void Share.share({message: `Join “${group.name}” on Pulse: ${link}`})} />
        <Button
          label="Copy link"
          variant="secondary"
          onPress={() => {
            Clipboard.setString(link);
            ToastAndroid.show('Link copied', ToastAndroid.SHORT);
          }}
        />
      </View>

      {admin ? (
        <>
          <SettingLabel>{requests.length ? `JOIN REQUESTS · ${requests.length}` : 'JOIN REQUESTS'}</SettingLabel>
          {requests.length === 0 ? (
            <Txt variant="caption" tone="muted" style={styles.none}>
              Nobody is waiting. Requests show up here.
            </Txt>
          ) : (
            <SettingGroup>
              {requests.map(r => (
                <View key={r.id} style={styles.request}>
                  <Avatar name={r.name} seed={r.key} uri={peers[r.key]?.avatar ?? known[r.key]?.avatar} size={40} />
                  <Txt variant="bodyStrong" numberOfLines={1} style={styles.reqName}>
                    {r.name}
                  </Txt>
                  <Button label="Decline" variant="secondary" size="sm" fullWidth={false} onPress={() => useGroupsStore.getState().declineJoin(r.id)} />
                  <Button label="Approve" size="sm" fullWidth={false} onPress={() => useGroupsStore.getState().approveJoin(r.id)} />
                </View>
              ))}
            </SettingGroup>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  qrWrap: {alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.lg},
  title: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm},
  hint: {marginTop: spacing.sm, paddingHorizontal: spacing.lg},
  buttons: {gap: spacing.sm, marginTop: spacing.xl},
  none: {marginTop: spacing.sm, marginLeft: spacing.xs, color: colors.textMuted},
  request: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  reqName: {flex: 1},
}));
