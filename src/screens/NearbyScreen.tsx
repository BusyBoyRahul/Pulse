import React, {useEffect} from 'react';
import {Pressable, ScrollView, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Button, Avatar, Icon, Radar, StatusPill} from '@/components';
import type {RadarBlip} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePeersStore} from '@/store/peersStore';
import {usePairingStore} from '@/store/pairingStore';
import {useMeshStore} from '@/mesh/meshStore';
import {useCallStore} from '@/store/callStore';
import {usePrefsStore} from '@/store/prefsStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function NearbyScreen() {
  const nav = useNavigation<Nav>();
  const {width} = useWindowDimensions();
  const peersMap = usePeersStore(s => s.peers);
  const status = useMeshStore(s => s.status);
  const {paired, incoming, request, accept, dismiss, statusOf} = usePairingStore();

  useEffect(() => {
    usePairingStore.getState().init();
  }, []);

  const prefs = usePrefsStore(s => s.prefs);
  const peers = Object.values(peersMap)
    .filter(p => !prefs[p.publicKey]?.blocked)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  const nameOf = (key: string, fallback: string) => prefs[key]?.nickname || fallback;
  const openProfile = (publicKey: string) => nav.navigate('Contact', {publicKey});
  const radarSize = Math.min(width - spacing.xl * 2, 340);
  const scanning = status === 'active';

  // Bright = straight to your phone; grey = reached through someone else's phone.
  const blips: RadarBlip[] = peers.map(p => ({
    key: p.publicKey,
    label: p.name,
    color: p.hops > 0 ? colors.meshRelay : colors.meshOnline,
  }));
  const direct = peers.filter(p => p.hops === 0).length;
  const relayed = peers.length - direct;
  const routeText = (hops: number) => (hops === 0 ? 'In range' : `Via ${hops} relay${hops === 1 ? '' : 's'}`);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Txt variant="title">Nearby</Txt>
          <StatusPill
            label={scanning ? 'Mesh on' : status === 'bluetooth-off' ? 'Bluetooth off' : 'Idle'}
            tone={scanning ? 'online' : 'idle'}
          />
        </View>

        <View style={styles.radarWrap}>
          <Radar size={radarSize} blips={blips} active={scanning} />
        </View>

        <Txt variant="body" tone="secondary" center style={styles.caption}>
          {peers.length === 0
            ? 'Looking for Pulse phones around you…'
            : relayed > 0
            ? `${direct} in range · ${relayed} reachable through others`
            : `${peers.length} ${peers.length === 1 ? 'person' : 'people'} in range`}
        </Txt>

        {incoming.length > 0 ? (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              WANTS TO CONNECT
            </Txt>
            {incoming.map(req => (
              <Card key={req.publicKey} style={styles.row}>
                <Pressable style={styles.who} onPress={() => openProfile(req.publicKey)}>
                  <Avatar name={req.name} seed={req.publicKey} uri={peersMap[req.publicKey]?.avatar} size={44} />
                  <View style={styles.rowText}>
                    <Txt variant="bodyStrong">{req.name}</Txt>
                    <Txt variant="caption" tone="muted">
                      sent you a connect request
                    </Txt>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Button label="Accept" fullWidth={false} onPress={() => accept(req)} />
                  <Txt variant="caption" tone="muted" onPress={() => dismiss(req.publicKey)}>
                    Ignore
                  </Txt>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        <Txt variant="label" tone="muted" style={styles.section}>
          PEOPLE NEARBY
        </Txt>
        {peers.length === 0 ? (
          <Card style={styles.empty} raised>
            <Icon name="radar" size={28} color={colors.textMuted} />
            <Txt variant="subtitle" center style={styles.emptyTitle}>
              No one detected yet
            </Txt>
            <Txt variant="caption" tone="muted" center>
              Other phones running Pulse appear here automatically, including people who are only
              reachable through a friend's phone.
            </Txt>
          </Card>
        ) : (
          peers.map(p => {
            const st = statusOf(p.publicKey);
            return (
              <Card key={p.publicKey} style={styles.row}>
                <Pressable style={styles.who} onPress={() => openProfile(p.publicKey)} accessibilityLabel={`Open ${p.name}'s profile`}>
                  <Avatar name={nameOf(p.publicKey, p.name)} seed={p.publicKey} uri={p.avatar} size={44} ring />
                  <View style={styles.rowText}>
                    <Txt variant="bodyStrong">{nameOf(p.publicKey, p.name)}</Txt>
                    <View style={styles.routeRow}>
                      {p.hops > 0 ? <Icon name="relay" size={11} color={colors.textMuted} /> : null}
                      <Txt variant="caption" tone="muted" numberOfLines={1}>
                        {st === 'paired' ? `Connected · ${routeText(p.hops)}` : `${routeText(p.hops)} · tap for profile`}
                      </Txt>
                    </View>
                  </View>
                </Pressable>
                {st === 'paired' ? (
                  <View style={styles.pairedActions}>
                    <Pressable
                      onPress={() => void useCallStore.getState().start(p.publicKey, p.name)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${p.name}`}
                      style={styles.callBtn}>
                      <Icon name="phone" size={18} color={colors.text} />
                    </Pressable>
                    <Button
                      label="Message"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() =>
                        nav.navigate('Conversation', {conversationId: p.publicKey, kind: 'direct', title: p.name})
                      }
                    />
                  </View>
                ) : st === 'outgoing' ? (
                  <Txt variant="caption" tone="muted">
                    Requested…
                  </Txt>
                ) : st === 'incoming' ? (
                  <Button label="Accept" fullWidth={false} onPress={() => accept({publicKey: p.publicKey, name: p.name, at: Date.now()})} />
                ) : (
                  <Button label="Connect" fullWidth={false} onPress={() => request(p)} />
                )}
              </Card>
            );
          })
        )}

        {paired.length > 0 ? (
          <Txt variant="caption" tone="muted" center style={styles.footNote}>
            {paired.length} paired {paired.length === 1 ? 'person' : 'people'} · pairing is remembered even
            when they leave range
          </Txt>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {padding: spacing.xl, paddingBottom: spacing.xxxl},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  radarWrap: {alignItems: 'center', marginTop: spacing.xl},
  caption: {marginTop: spacing.lg},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md},
  rowText: {flex: 1, marginLeft: spacing.md, marginRight: spacing.sm},
  who: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  actions: {alignItems: 'flex-end', gap: spacing.xs},
  empty: {alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm},
  emptyTitle: {marginTop: spacing.xs},
  footNote: {marginTop: spacing.lg},
  routeRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  pairedActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  callBtn: {width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
});
