import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Button, Txt, Card, Avatar, Icon, IconTile} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'AddGroupMembers'>;

/** The group's admin invites more of their connections. Each one still has to accept before they join. */
export default function AddGroupMembersScreen() {
  const nav = useNavigation<Nav>();
  const {groupId} = useRoute<R>().params;
  const group = useGroupsStore(s => s.groups.find(g => g.id === groupId));
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);
  const [selected, setSelected] = useState<string[]>([]);

  if (!group) {
    return (
      <Screen edges={['left', 'right']}>
        <Txt variant="subtitle" tone="secondary" center style={{marginTop: spacing.xxl}}>
          This group no longer exists.
        </Txt>
      </Screen>
    );
  }

  const candidates = paired.filter(p => !group.members.includes(p.publicKey));
  const toggle = (key: string) => setSelected(s => (s.includes(key) ? s.filter(k => k !== key) : [...s, key]));
  const send = () => {
    if (useGroupsStore.getState().addMembers(groupId, selected)) {
      nav.goBack();
    }
  };

  return (
    <Screen
      scroll
      edges={['left', 'right']}
      bottomClear={false}
      footer={<Button label={selected.length ? `Send ${selected.length} invite${selected.length === 1 ? '' : 's'}` : 'Send invites'} onPress={send} disabled={selected.length === 0} />}>
      <Txt variant="label" tone="muted" style={styles.section}>
        {selected.length ? `ADD TO ${group.name.toUpperCase()} · ${selected.length} CHOSEN` : `ADD TO ${group.name.toUpperCase()}`}
      </Txt>
      {candidates.length === 0 ? (
        <Card flat raised style={styles.empty}>
          <IconTile icon="users" size={48} color={colors.primary} />
          <Txt variant="subtitle" center>
            Everyone you’re connected with is already in
          </Txt>
        </Card>
      ) : (
        candidates.map(p => {
          const on = selected.includes(p.publicKey);
          return (
            <Pressable key={p.publicKey} onPress={() => toggle(p.publicKey)} accessibilityRole="checkbox" accessibilityState={{checked: on}}>
              <Card style={[styles.member, on && styles.memberOn]}>
                <Avatar name={p.name} seed={p.publicKey} uri={peers[p.publicKey]?.avatar ?? known[p.publicKey]?.avatar} size={40} />
                <Txt variant="bodyStrong" style={styles.memberName} numberOfLines={1}>
                  {usePrefsStore.getState().nameFor(p.publicKey, p.name)}
                </Txt>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={14} color={colors.onPrimary} /> : null}</View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  section: {marginTop: spacing.md, marginBottom: spacing.sm},
  empty: {alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl},
  member: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md},
  memberOn: {borderColor: colors.primary},
  memberName: {flex: 1},
  check: {width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
}));
