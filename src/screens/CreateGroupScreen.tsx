import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Button, Txt, Card, TextField, Avatar, Icon} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CreateGroupScreen() {
  const nav = useNavigation<Nav>();
  const paired = usePairingStore(s => s.paired);
  const createGroup = useGroupsStore(s => s.create);

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const canCreate = name.trim().length > 0 && selected.size > 0;

  const create = () => {
    const group = createGroup(name.trim(), [...selected]);
    nav.replace('Conversation', {conversationId: group.id, kind: 'group', title: group.name});
  };

  return (
    <Screen
      scroll
      edges={['left', 'right']}
      bottomClear={false}
      footer={
        <Button
          label={selected.size ? `Send ${selected.size} invite${selected.size === 1 ? '' : 's'}` : 'Send invites'}
          onPress={create}
          disabled={!canCreate}
        />
      }>
      <Txt variant="body" tone="secondary" style={styles.intro}>
        Groups are end-to-end encrypted. You invite people you've paired with, and
        each person must accept before they join — no one is added without consent.
      </Txt>

      <TextField label="Group name" placeholder="Trail crew" value={name} onChangeText={setName} />

      <Txt variant="label" tone="muted" style={styles.section}>
        INVITE PEOPLE
      </Txt>
      {paired.length === 0 ? (
        <Card style={styles.empty} raised>
          <Txt variant="subtitle" center>
            No paired people yet
          </Txt>
          <Txt variant="caption" tone="muted" center style={styles.emptySub}>
            Pair with someone nearby first — then you can add them to a group.
          </Txt>
        </Card>
      ) : (
        <View>
          {paired.map(p => {
            const on = selected.has(p.publicKey);
            return (
              <Pressable key={p.publicKey} onPress={() => toggle(p.publicKey)}>
                <Card style={[styles.member, on && styles.memberOn]}>
                  <Avatar name={p.name} seed={p.publicKey} size={40} />
                  <Txt variant="bodyStrong" style={styles.memberName}>
                    {p.name}
                  </Txt>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Icon name="check" size={14} color={colors.onPrimary} /> : null}
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {marginTop: spacing.md, marginBottom: spacing.lg},
  section: {marginTop: spacing.md, marginBottom: spacing.sm},
  empty: {alignItems: 'center', paddingVertical: spacing.xl},
  emptySub: {marginTop: spacing.xs, textAlign: 'center'},
  member: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md},
  memberOn: {borderColor: colors.primary},
  memberName: {flex: 1},
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  checkMark: {color: colors.onPrimary},
});
