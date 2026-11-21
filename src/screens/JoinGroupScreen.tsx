import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Button, GroupAvatar, Icon} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'JoinGroup'>;

/**
 * Opened from a group's link or QR code. Nothing happens by itself: you ask, and an admin of the group decides.
 * (To ask, you must be connected with the person who runs the group, so first you connect with them.)
 */
export default function JoinGroupScreen() {
  const nav = useNavigation<Nav>();
  const {id, admin, name} = useRoute<R>().params;
  const inGroup = useGroupsStore(s => s.groups.some(g => g.id === id));
  const invited = useGroupsStore(s => s.pendingInvites.some(i => i.id === id));
  const connected = usePairingStore(s => s.paired.some(p => p.publicKey === admin));
  const [sent, setSent] = useState(false);

  return (
    <Screen edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <GroupAvatar size={104} />
        <Txt variant="title" center numberOfLines={2} style={styles.name}>
          {name}
        </Txt>
        <View style={styles.encRow}>
          <Icon name="lock" size={12} color={colors.textMuted} />
          <Txt variant="caption" tone="muted">
            End-to-end encrypted group
          </Txt>
        </View>
      </View>

      {inGroup ? (
        <>
          <Txt variant="body" tone="secondary" center style={styles.note}>
            You’re already in this group.
          </Txt>
          <Button label="Open the group" onPress={() => nav.replace('Conversation', {conversationId: id, kind: 'group', title: name})} />
        </>
      ) : invited ? (
        <Txt variant="body" tone="secondary" center style={styles.note}>
          You’ve already been invited. Accept the invite in your Chats.
        </Txt>
      ) : !connected ? (
        <>
          <Txt variant="body" tone="secondary" center style={styles.note}>
            To join, first connect with the person who runs this group. Then open the link again.
          </Txt>
          <Button label="Connect first" onPress={() => nav.replace('FindPeople', {invite: {key: admin, name: 'Group admin'}})} />
        </>
      ) : sent ? (
        <>
          <Txt variant="body" tone="secondary" center style={styles.note}>
            Request sent. You’ll get an invite here as soon as an admin says yes.
          </Txt>
          <Button label="Done" variant="secondary" onPress={() => nav.goBack()} />
        </>
      ) : (
        <>
          <Txt variant="body" tone="secondary" center style={styles.note}>
            An admin of this group has to say yes before you’re in.
          </Txt>
          <Button
            label="Ask to join"
            onPress={() => {
              useGroupsStore.getState().requestToJoin(id, admin);
              setSent(true);
            }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.lg},
  name: {marginTop: spacing.lg, maxWidth: '90%'},
  encRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs},
  note: {marginVertical: spacing.xl, paddingHorizontal: spacing.lg},
}));
