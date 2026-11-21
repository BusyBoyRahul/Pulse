import {themedStyles} from '@/theme/themed';
import React, {useEffect} from 'react';
import {Pressable, ScrollView, StyleSheet, Switch, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Button, IconButton, Avatar, Icon, Radar, Reveal, SettingGroup, SettingRow, ProfileButton} from '@/components';
import type {RadarBlip} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePeersStore} from '@/store/peersStore';
import {usePairingStore} from '@/store/pairingStore';
import {useCallStore} from '@/store/callStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSettingsStore} from '@/store/settingsStore';
import {lanManager} from '@/lan/lanManager';
import {useRadioStore, grantPowerOn} from '@/mesh/radioGate';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function NearbyScreen() {
  const nav = useNavigation<Nav>();
  const {width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const meshOn = useSettingsStore(s => s.app.meshOn);
  const peersMap = usePeersStore(s => s.peers);
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
  const radio = useRadioStore(s => s.state);
  const scanning = meshOn && radio === 'on';

  // Bright = straight to your phone; grey = reached through someone else's phone.
  const asked = new Set(incoming.map(r => r.publicKey));
  const blips: RadarBlip[] = [
    ...peers.map(p => ({
      key: p.publicKey,
      label: nameOf(p.publicKey, p.name),
      uri: p.avatar,
      pending: asked.has(p.publicKey),
      color: p.hops > 0 ? colors.meshRelay : colors.meshOnline,
    })),
    // Someone who asked to connect but is not in the list yet still shows up on the radar.
    ...incoming
      .filter(r => !peersMap[r.publicKey])
      .map(r => ({key: r.publicKey, label: r.name, pending: true})),
  ];
  const toggleMesh = (on: boolean) => {
    useSettingsStore.getState().setApp({meshOn: on});
    // The radio part follows this setting by itself (see NearbyMeshTransport). Switching the mesh on is the person's permission
    // for Pulse to switch Wi-Fi / Bluetooth on; opening the app is not.
    if (on) {
      grantPowerOn();
    }
    try {
      on ? lanManager.start() : lanManager.stop(); // the Wi-Fi part of the mesh follows the same switch
    } catch {
      /* Wi-Fi part unavailable — Bluetooth still works. */
    }
  };
  const direct = peers.filter(p => p.hops === 0).length;
  const relayed = peers.length - direct;
  const routeText = (hops: number) => (hops === 0 ? 'In range' : `Via ${hops} relay${hops === 1 ? '' : 's'}`);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 130}]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <ProfileButton />
            <Txt variant="title">Nearby</Txt>
          </View>
          <View style={styles.meshPill}>
            <Txt variant="caption" tone="secondary">
              {!meshOn ? 'Mesh off' : scanning ? 'Mesh on' : radio === 'wifi-off' ? 'Wi-Fi is off' : radio === 'bluetooth-off' ? 'Bluetooth is off' : radio === 'error' || radio === 'unsupported' ? 'Unavailable' : 'Starting…'}
            </Txt>
            <Switch
              value={meshOn}
              onValueChange={toggleMesh}
              trackColor={{false: colors.surfaceHover, true: colors.primary}}
              thumbColor={meshOn ? colors.onPrimary : colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.radarWrap}>
          <Radar size={radarSize} blips={blips} active={scanning} />
        </View>

        <Txt variant="body" tone="secondary" center style={styles.caption}>
          {!meshOn
            ? 'Mesh is off, so Pulse is not using Bluetooth or Wi-Fi to look for people. Turn it on to find people nearby.'
            : radio === 'wifi-off' || radio === 'bluetooth-off'
            ? `${radio === 'wifi-off' ? 'Wi-Fi' : 'Bluetooth'} is off, so the mesh is waiting. It starts by itself when you turn it on.`
            : peers.length === 0
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
              <Card key={req.publicKey} flat style={styles.row}>
                <Pressable style={styles.who} onPress={() => openProfile(req.publicKey)}>
                  <Avatar name={req.name} seed={req.publicKey} uri={peersMap[req.publicKey]?.avatar} size={44} />
                  <View style={styles.rowText}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {req.name}
                    </Txt>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Button label="Ignore" variant="secondary" size="sm" fullWidth={false} onPress={() => dismiss(req.publicKey)} />
                  <Button label="Accept" size="sm" fullWidth={false} onPress={() => accept(req)} />
                </View>
              </Card>
            ))}
          </>
        ) : null}

        <Reveal>
          <SettingGroup>
            <SettingRow icon="userPlus" title="Find people anywhere" subtitle="Username, contacts or QR" onPress={() => nav.navigate('FindPeople')} />
          </SettingGroup>
        </Reveal>

        <Txt variant="label" tone="muted" style={styles.section}>
          PEOPLE NEARBY
        </Txt>
        {peers.length === 0 ? (
          <Card flat style={styles.empty} raised>
            <Icon name="radar" size={28} color={colors.textMuted} />
            <Txt variant="subtitle" center style={styles.emptyTitle}>
              No one detected yet
            </Txt>
            <Txt variant="caption" tone="muted" center>
              Phones running Pulse show up here.
            </Txt>
          </Card>
        ) : (
          peers.map((p, idx) => {
            const st = statusOf(p.publicKey);
            return (
              <Reveal key={p.publicKey} index={idx}>
              <Card flat style={styles.row}>
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
                    <IconButton
                      icon="chat"
                      label={`Message ${p.name}`}
                      onPress={() =>
                        nav.navigate('Conversation', {conversationId: p.publicKey, kind: 'direct', title: p.name})
                      }
                    />
                    <IconButton icon="phone" label={`Call ${p.name}`} onPress={() => void useCallStore.getState().start(p.publicKey, p.name)} />
                  </View>
                ) : st === 'outgoing' ? (
                  <View style={styles.sentPill}>
                    <Icon name="check" size={15} color={colors.meshOnline} strokeWidth={2.6} />
                    <Txt variant="caption" tone="secondary">
                      Request sent
                    </Txt>
                  </View>
                ) : st === 'incoming' ? (
                  <Button label="Accept" size="sm" fullWidth={false} onPress={() => accept({publicKey: p.publicKey, name: p.name, at: Date.now()})} />
                ) : (
                  <Button label="Connect" size="sm" fullWidth={false} onPress={() => request(p)} />
                )}
              </Card>
              </Reveal>
            );
          })
        )}

        {paired.length > 0 ? (
          <Txt variant="caption" tone="muted" center style={styles.footNote}>
            {paired.length} connected
          </Txt>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm, minHeight: 64},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  radarWrap: {alignItems: 'center', marginTop: spacing.xl},
  caption: {marginTop: spacing.lg, marginBottom: spacing.lg},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md},
  rowText: {flex: 1, marginLeft: spacing.md, marginRight: spacing.sm},
  who: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  actions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  empty: {alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm},
  emptyTitle: {marginTop: spacing.xs},
  footNote: {marginTop: spacing.lg},
  routeRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  pairedActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  meshPill: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.md, paddingRight: spacing.xs, height: 40, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  sentPill: {flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border},
}));
