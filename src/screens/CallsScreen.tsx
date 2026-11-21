import {themedStyles} from '@/theme/themed';
import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Screen, Txt, Card, Avatar, Button, Icon, IconButton, Pressy, ProfileButton, Reveal, Sheet, Rim} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useCallLogStore, CallEntry} from '@/store/callLogStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {placeCall} from '@/net/callRouter';
import {displayName} from '@/services/names';
import {ago} from './StatusScreen';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Filter = 'all' | 'missed';

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function describe(c: CallEntry): string {
  const kind = c.video ? 'Video' : 'Voice';
  switch (c.outcome) {
    case 'answered':
      return `${c.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · ${clock(c.durationMs)}`;
    case 'missed':
      return 'Missed';
    case 'declined':
      return c.direction === 'incoming' ? 'You declined' : 'Declined';
    case 'no-answer':
      return 'No answer';
    case 'busy':
      return 'Busy';
    default:
      return `${kind} call failed`;
  }
}

/** Call history: who called, who you called, what you missed — with one tap to call back. */
export default function CallsScreen() {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const calls = useCallLogStore(s => s.calls);
  const [filter, setFilter] = useState<Filter>('all');
  const [picker, setPicker] = useState(false);
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);

  // Looking at the tab clears the "missed" badge.
  useFocusEffect(
    React.useCallback(() => {
      useCallLogStore.getState().hydrate();
      const t = setTimeout(() => useCallLogStore.getState().markSeen(), 600);
      return () => clearTimeout(t);
    }, []),
  );

  const missed = calls.filter(c => c.direction === 'incoming' && c.outcome === 'missed');
  const shown = filter === 'missed' ? missed : calls;
  const avatarOf = (key: string) => peers[key]?.avatar ?? profiles[key]?.avatar;

  const people = useMemo(() => paired.filter(p => !prefs[p.publicKey]?.blocked).sort((a, b) => a.name.localeCompare(b.name)), [paired, prefs]);

  const clear = () =>
    alertDialog('Clear call history?', 'This removes every call from this list.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useCallLogStore.getState().clear()},
    ]);

  const renderRow = ({item: c, index}: {item: CallEntry; index: number}) => {
    const bad = c.direction === 'incoming' && c.outcome === 'missed';
    const name = displayName(c.peerKey, c.name); // their name now, even if an older entry saved only an ID
    return (
      <Reveal index={Math.min(index, 6)}>
        <Pressy
          onPress={() => nav.navigate('Contact', {publicKey: c.peerKey})}
          onLongPress={() =>
            alertDialog('Remove from history?', undefined, [
              {text: 'Cancel', style: 'cancel'},
              {text: 'Remove', style: 'destructive', onPress: () => useCallLogStore.getState().remove(c.id)},
            ])
          }
          accessibilityRole="button"
          accessibilityLabel={`${name}, ${describe(c)}`}
          scaleTo={0.985}>
          <Card solid flat style={styles.row}>
            <Avatar name={name} seed={c.peerKey} uri={avatarOf(c.peerKey)} size={46} />
            <View style={styles.text}>
              <Txt variant="bodyStrong" numberOfLines={1} style={bad ? {color: colors.dangerBright} : undefined}>
                {name}
              </Txt>
              <View style={styles.meta}>
                <Icon name={c.video ? 'video' : 'phone'} size={12} color={bad ? colors.dangerBright : colors.textMuted} />
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {describe(c)} · {ago(c.at)}
                  {c.via === 'internet' ? ' · Internet' : ''}
                </Txt>
              </View>
            </View>
            <IconButton icon={c.video ? 'video' : 'phone'} label={`Call ${name} again`} onPress={() => placeCall(c.peerKey, name, c.video)} />
          </Card>
        </Pressy>
      </Reveal>
    );
  };

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <View style={styles.who}>
          <ProfileButton />
          <Txt variant="title">Calls</Txt>
        </View>
        {calls.length > 0 ? <IconButton icon="trash" label="Clear call history" onPress={clear} /> : null}
      </View>

      <View style={styles.chips}>
        {([['all', 'All'], ['missed', `Missed${missed.length ? ` ${missed.length}` : ''}`]] as [Filter, string][]).map(([k, label]) => {
          const on = filter === k;
          return (
            <Pressy key={k} onPress={() => setFilter(k)} accessibilityRole="button" accessibilityState={{selected: on}} accessibilityLabel={label} style={[styles.chip, on && styles.chipOn]}>
              <Txt variant="bodyStrong" style={{fontSize: 14, color: on ? colors.onPrimary : colors.textSecondary}}>
                {label}
              </Txt>
            </Pressy>
          );
        })}
      </View>

      <FlatList
        data={shown}
        keyExtractor={c => c.id}
        renderItem={renderRow}
        contentContainerStyle={[styles.list, {paddingBottom: insets.bottom + 170}]}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <Card solid flat style={styles.empty}>
            <Icon name="phone" size={26} color={colors.textMuted} />
            <Txt variant="subtitle" center>
              {filter === 'missed' ? 'No missed calls' : 'No calls yet'}
            </Txt>
          </Card>
        }
      />

      <Pressy onPress={() => setPicker(true)} accessibilityRole="button" accessibilityLabel="New call" scaleTo={0.92} style={[styles.fab, {bottom: insets.bottom + 100}]}>
        <Rim size={58} />
        <Icon name="phone" size={24} color={colors.onPrimary} />
      </Pressy>

      <Sheet visible={picker} onClose={() => setPicker(false)} title="New call" scroll>
        {people.length === 0 ? (
          <View style={styles.pickEmpty}>
            <Txt variant="body" tone="muted" center>
              Connect with someone first.
            </Txt>
            <Button
              label="Find people"
              onPress={() => {
                setPicker(false);
                nav.navigate('FindPeople');
              }}
            />
          </View>
        ) : (
          people.map(p => (
            <View key={p.publicKey} style={styles.pickRow}>
              <Avatar name={p.name} seed={p.publicKey} uri={avatarOf(p.publicKey)} size={42} dot={peers[p.publicKey] ? colors.meshOnline : undefined} />
              <Txt variant="bodyStrong" style={styles.pickName} numberOfLines={1}>
                {prefs[p.publicKey]?.nickname || p.name}
              </Txt>
              <IconButton
                icon="phone"
                label={`Voice call ${p.name}`}
                onPress={() => {
                  setPicker(false);
                  placeCall(p.publicKey, p.name, false);
                }}
              />
              <IconButton
                icon="video"
                label={`Video call ${p.name}`}
                onPress={() => {
                  setPicker(false);
                  placeCall(p.publicKey, p.name, true);
                }}
              />
            </View>
          ))
        )}
      </Sheet>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, minHeight: 64},
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  chips: {flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm},
  chip: {flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border},
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  list: {paddingHorizontal: spacing.lg, gap: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  text: {flex: 1, gap: 2},
  meta: {flexDirection: 'row', alignItems: 'center', gap: 5},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, marginTop: spacing.lg},
  fab: {position: 'absolute', right: spacing.lg, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, elevation: 4},
  pickRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm},
  pickName: {flex: 1, marginLeft: spacing.xs},
  pickEmpty: {gap: spacing.md, paddingVertical: spacing.lg},
}));
