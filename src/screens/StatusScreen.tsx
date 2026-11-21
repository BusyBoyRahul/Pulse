import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Screen, Txt, Card, Avatar, Icon, IconButton, Pressy, ProfileButton, Reveal, Rim} from '@/components';
import {colors, spacing, shadowTone} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useStatusStore} from '@/store/statusStore';
import {usePrefsStore} from '@/store/prefsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePairingStore} from '@/store/pairingStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) {
    return 'Just now';
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ago`;
  }
  return `${Math.floor(s / 3600)} h ago`;
}

/** An avatar inside a ring: bright accent when there is something new, soft grey when seen. */
function Ring({children, state}: {children: React.ReactNode; state: 'new' | 'seen' | 'none'}) {
  return <View style={[styles.ring, state === 'new' && styles.ringNew, state === 'seen' && styles.ringSeen]}>{children}</View>;
}

export default function StatusScreen() {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const me = getIdentity().publicKey;
  const myName = useSessionStore(s => s.profileName);
  const myAvatar = useSessionStore(s => s.avatarUri);
  const mine = useStatusStore(s => s.mine);
  const views = useStatusStore(s => s.views);
  const feeds = useStatusStore(s => s.feeds);
  const seen = useStatusStore(s => s.seen);
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);

  const rows = useMemo(() => {
    const now = Date.now();
    return Object.entries(feeds)
      .map(([key, f]) => {
        const items = f.items.filter(i => i.exp > now);
        const unseen = items.filter(i => !seen[i.id]).length;
        return {key, name: prefs[key]?.nickname || paired.find(p => p.publicKey === key)?.name || f.name, items, unseen, last: items[items.length - 1]?.at ?? 0};
      })
      .filter(r => r.items.length > 0 && !prefs[r.key]?.blocked)
      .sort((a, b) => b.last - a.last);
  }, [feeds, seen, prefs, paired]);

  const fresh = rows.filter(r => r.unseen > 0);
  const viewed = rows.filter(r => r.unseen === 0);
  const myViews = mine.reduce((n, i) => n + (views[i.id]?.length ?? 0), 0);
  const avatarOf = (key: string) => peers[key]?.avatar ?? profiles[key]?.avatar;

  const open = (author: string) => nav.navigate('StatusViewer', {author});

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <View style={styles.who}>
          <ProfileButton />
          <Txt variant="title">Status</Txt>
        </View>
        <IconButton icon="more" label="Status settings" onPress={() => nav.navigate('StatusPrivacy')} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 170}]} showsVerticalScrollIndicator={false}>
        <Reveal>
          <Pressy onPress={() => (mine.length ? open('me') : nav.navigate('StatusComposer', {start: 'text'}))} accessibilityRole="button" accessibilityLabel="My status" scaleTo={0.985}>
            <Card flat style={styles.row}>
              <View>
                <Ring state={mine.length ? 'seen' : 'none'}>
                  <Avatar name={myName || 'You'} uri={myAvatar} seed={me} size={52} />
                </Ring>
                {mine.length === 0 ? (
                  <View style={styles.plus}>
                    <Icon name="plus" size={14} color={colors.onPrimary} strokeWidth={3} />
                  </View>
                ) : null}
              </View>
              <View style={styles.rowText}>
                <Txt variant="bodyStrong">My status</Txt>
                <Txt variant="caption" tone="muted">
                  {mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'} · ${ago(mine[mine.length - 1].at)} · ${myViews} view${myViews === 1 ? '' : 's'}` : 'Tap to share what is on your mind'}
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color={colors.textMuted} />
            </Card>
          </Pressy>
        </Reveal>

        {fresh.length > 0 ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              RECENT UPDATES
            </Txt>
            {fresh.map((r, i) => (
              <Reveal key={r.key} index={i + 1}>
                <Pressy onPress={() => open(r.key)} accessibilityRole="button" accessibilityLabel={`${r.name}, ${r.unseen} new`} scaleTo={0.985}>
                  <Card flat style={styles.row}>
                    <Ring state="new">
                      <Avatar name={r.name} seed={r.key} uri={avatarOf(r.key)} size={52} />
                    </Ring>
                    <View style={styles.rowText}>
                      <Txt variant="bodyStrong">{r.name}</Txt>
                      <Txt variant="caption" tone="muted">
                        {r.unseen} new · {ago(r.last)}
                      </Txt>
                    </View>
                  </Card>
                </Pressy>
              </Reveal>
            ))}
          </>
        ) : null}

        {viewed.length > 0 ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              VIEWED
            </Txt>
            {viewed.map(r => (
              <Pressy key={r.key} onPress={() => open(r.key)} accessibilityRole="button" accessibilityLabel={r.name} scaleTo={0.985}>
                <Card flat style={styles.row}>
                  <Ring state="seen">
                    <Avatar name={r.name} seed={r.key} uri={avatarOf(r.key)} size={52} />
                  </Ring>
                  <View style={styles.rowText}>
                    <Txt variant="bodyStrong" tone="secondary">
                      {r.name}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {ago(r.last)}
                    </Txt>
                  </View>
                </Card>
              </Pressy>
            ))}
          </>
        ) : null}

        {rows.length === 0 ? (
          <Card flat style={styles.empty}>
            <Icon name="status" size={30} color={colors.textMuted} />
            <Txt variant="subtitle" center>
              No updates yet
            </Txt>
            <Txt variant="caption" tone="muted" center>
              Updates from people you are connected to show up here.
            </Txt>
          </Card>
        ) : null}
      </ScrollView>

      <Pressy onPress={() => nav.navigate('StatusComposer', {start: 'text'})} accessibilityRole="button" accessibilityLabel="Write a text status" scaleTo={0.92} style={[styles.fabSmall, {bottom: insets.bottom + 172}]}>
        <Icon name="edit" size={20} color={colors.primary} />
      </Pressy>
      <Pressy onPress={() => nav.navigate('StatusComposer', {start: 'camera'})} accessibilityRole="button" accessibilityLabel="Take a photo for your status" scaleTo={0.92} style={[styles.fab, {bottom: insets.bottom + 100}]}>
        <Rim size={58} />
        <Icon name="camera" size={25} color={colors.onPrimary} />
      </Pressy>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, minHeight: 64, marginBottom: spacing.sm},
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  fabSmall: {position: 'absolute', right: spacing.lg + 6, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', shadowColor: shadowTone(), elevation: 3},
  content: {paddingHorizontal: spacing.lg, gap: spacing.sm},
  section: {marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  rowText: {flex: 1, gap: 2},
  // marginLeft pulls the ring into the gutter so the photo itself lines up with the page edge, like the chat list.
  ring: {marginLeft: -5.5, padding: 3, borderRadius: 34, borderWidth: 2.5, borderColor: 'transparent'},
  ringNew: {borderColor: colors.primary},
  ringSeen: {borderColor: colors.border},
  plus: {position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, marginTop: spacing.lg},
  fab: {position: 'absolute', right: spacing.lg, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, elevation: 4},
}));
