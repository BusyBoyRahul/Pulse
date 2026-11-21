import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Icon, IconName, HeroScene, Pressy, Reveal, IconTile} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSecretStore, SECRET_TIMERS, DEFAULT_SECRET_TIMER, secretTimerText} from '@/store/secretStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PROMISES: {icon: IconName; text: string}[] = [
  {icon: 'key', text: 'Brand-new keys, separate from your normal chat'},
  {icon: 'clock', text: 'Messages delete themselves after the timer'},
  {icon: 'eyeOff', text: 'No screenshots, no forwarding, no previews'},
  {icon: 'trash', text: 'Delete it once — it is erased on both phones'},
];

/** Pick a connected person to start a secret chat with. */
export default function NewSecretChatScreen() {
  const nav = useNavigation<Nav>();
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const [timer, setTimer] = useState(DEFAULT_SECRET_TIMER);

  const people = paired.filter(p => !prefs[p.publicKey]?.blocked);

  const start = (key: string, name: string) => {
    const id = useSecretStore.getState().start(key, name, timer);
    nav.replace('Conversation', {conversationId: id, kind: 'direct', title: name});
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <HeroScene kind="secret" height={230} />
        <Txt variant="title" center>
          Secret chat
        </Txt>
        <Txt variant="body" tone="secondary" center>
          Only you and one other person. Nothing is kept.
        </Txt>
      </View>

      <Reveal>
        <Card style={styles.promises}>
          {PROMISES.map(p => (
            <View key={p.text} style={styles.promise}>
              <IconTile icon={p.icon} size={30} color={colors.primary} />
              <Txt variant="caption" tone="secondary" style={styles.promiseTxt}>
                {p.text}
              </Txt>
            </View>
          ))}
        </Card>
      </Reveal>

      <Txt variant="label" tone="muted" style={styles.section}>
        SELF-DESTRUCT TIMER
      </Txt>
      <View style={styles.chips}>
        {SECRET_TIMERS.map(ms => {
          const on = ms === timer;
          return (
            <Pressy key={ms} onPress={() => setTimer(ms)} accessibilityRole="button" accessibilityLabel={`Timer ${secretTimerText(ms)}`} accessibilityState={{selected: on}} style={[styles.chip, on && styles.chipOn]}>
              <Txt variant="caption" style={{color: on ? colors.onPrimary : colors.textSecondary}}>
                {ms === 0 ? 'Off' : secretTimerText(ms).replace(' seconds', 's').replace(' minute', ' min').replace(' hour', ' h')}
              </Txt>
            </Pressy>
          );
        })}
      </View>

      <Txt variant="label" tone="muted" style={styles.section}>
        START WITH
      </Txt>
      {people.length === 0 ? (
        <Card flat style={styles.empty}>
          <Icon name="users" size={26} color={colors.textMuted} />
          <Txt variant="caption" tone="muted" center>
            Connect with someone first.
          </Txt>
        </Card>
      ) : (
        people.map((p, i) => (
          <Reveal key={p.publicKey} index={i}>
            <Pressy onPress={() => start(p.publicKey, prefs[p.publicKey]?.nickname || p.name)} accessibilityRole="button" accessibilityLabel={`Start a secret chat with ${p.name}`} scaleTo={0.98}>
              <Card flat style={styles.person}>
                <Avatar name={p.name} seed={p.publicKey} uri={peers[p.publicKey]?.avatar ?? profiles[p.publicKey]?.avatar} size={46} />
                <View style={styles.personText}>
                  <Txt variant="bodyStrong">{prefs[p.publicKey]?.nickname || p.name}</Txt>
                  <Txt variant="caption" tone="muted">
                    {peers[p.publicKey] ? 'Nearby now' : 'Out of range · invite waits for them'}
                  </Txt>
                </View>
                <Icon name="chevronRight" size={18} color={colors.textMuted} />
              </Card>
            </Pressy>
          </Reveal>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hero: {marginTop: spacing.md, gap: 4, paddingHorizontal: spacing.md},
  promises: {gap: spacing.md, marginTop: spacing.lg},
  promise: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  promiseIcon: {width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center'},
  promiseTxt: {flex: 1},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  chip: {paddingHorizontal: 16, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass},
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  person: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm},
  personText: {flex: 1},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl},
}));
