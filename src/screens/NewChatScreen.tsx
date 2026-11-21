import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Icon, IconName, Pressy, Reveal, SettingGroup, SettingRow, useHeaderSearch} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Start a conversation: a person you are connected to, a group, a secret chat, or a note to yourself. */
export default function NewChatScreen() {
  const nav = useNavigation<Nav>();
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const myName = useSessionStore(s => s.profileName);
  const me = getIdentity().publicKey;
  // Search is a header icon, like on every other page.
  const {q} = useHeaderSearch(nav, 'Search people', 'Search people');

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return paired
      .filter(p => !prefs[p.publicKey]?.blocked)
      .map(p => ({key: p.publicKey, name: prefs[p.publicKey]?.nickname || p.name}))
      .filter(p => !needle || p.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [paired, prefs, q]);

  const go = (key: string, title: string) => nav.replace('Conversation', {conversationId: key, kind: 'direct', title});

  const shortcuts: {icon: IconName; title: string; sub: string; onPress: () => void}[] = [
    {icon: 'users', title: 'New group', sub: 'Chat with several people', onPress: () => nav.replace('CreateGroup')},
    {icon: 'lock', title: 'New secret chat', sub: 'Self-destructing, extra private', onPress: () => nav.replace('NewSecretChat')},
    {icon: 'userPlus', title: 'Find people', sub: 'By username, contacts or a code', onPress: () => nav.replace('FindPeople')},
    {icon: 'note', title: 'Message yourself', sub: 'Keep notes and files for later', onPress: () => go(me, `${myName || 'You'} (You)`)},
  ];

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {!q ? (
        <Reveal>
          <SettingGroup>
            {shortcuts.map(s => (
              <SettingRow key={s.title} icon={s.icon} title={s.title} subtitle={s.sub} onPress={s.onPress} />
            ))}
          </SettingGroup>
        </Reveal>
      ) : null}

      <Txt variant="label" tone="muted" style={styles.section}>
        PEOPLE ON PULSE
      </Txt>
      {people.length === 0 ? (
        <Card flat style={styles.empty}>
          <Icon name="users" size={26} color={colors.textMuted} />
          <Txt variant="caption" tone="muted" center>
            {q ? 'Nobody matches that.' : 'Connect with someone from the Nearby tab and they will show up here.'}
          </Txt>
        </Card>
      ) : (
        people.map((p, i) => (
          <Reveal key={p.key} index={i}>
            <Pressy onPress={() => go(p.key, p.name)} accessibilityRole="button" accessibilityLabel={`Message ${p.name}`} scaleTo={0.985}>
              <Card flat style={styles.row}>
                <Avatar name={p.name} seed={p.key} uri={peers[p.key]?.avatar ?? profiles[p.key]?.avatar} size={46} dot={peers[p.key] ? colors.meshOnline : undefined} />
                <View style={styles.text}>
                  <Txt variant="bodyStrong">{p.name}</Txt>
                  <Txt variant="caption" tone="muted">
                    {peers[p.key] ? 'Nearby now' : profiles[p.key]?.bio || 'Connected'}
                  </Txt>
                </View>
              </Card>
            </Pressy>
          </Reveal>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  section: {marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm},
  text: {flex: 1, gap: 2},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl},
}));
