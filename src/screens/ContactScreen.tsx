import React, {useEffect, useMemo, useState} from 'react';
import {Alert, Image, Pressable, StyleSheet, ToastAndroid, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {
  Screen,
  Txt,
  Avatar,
  Icon,
  IconName,
  Button,
  Sheet,
  TextField,
  ImageViewer,
  LabelSheet,
  DisappearSheet,
  disappearText,
  useChatLock,
  SettingRow,
  SettingGroup,
  SettingLabel,
} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useCallStore} from '@/store/callStore';
import {useChatStore} from '@/store/chatStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {getIdentity, shortId} from '@/services/identity';
import {safetyCode} from '@/services/safetyCode';
import {notifier} from '@/services/notifier';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'Contact'>;

const HOUR = 3600_000;
const MUTE_CHOICES: {label: string; ms: number | typeof MUTE_FOREVER}[] = [
  {label: 'For 1 hour', ms: HOUR},
  {label: 'For 8 hours', ms: 8 * HOUR},
  {label: 'For 1 week', ms: 7 * 24 * HOUR},
  {label: 'Until I turn it back on', ms: MUTE_FOREVER},
];

function ago(ts?: number): string | null {
  if (!ts) {
    return null;
  }
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hrs = Math.round(mins / 60);
  if (hrs < 24) {
    return `${hrs} h ago`;
  }
  return `${Math.round(hrs / 24)} days ago`;
}

function RoundAction({icon, label, onPress, on, disabled}: {icon: IconName; label: string; onPress: () => void; on?: boolean; disabled?: boolean}) {
  return (
    <View style={[styles.actionWrap, disabled && {opacity: 0.4}]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({pressed}) => [styles.action, on && styles.actionOn, pressed && {opacity: 0.8}]}>
        <Icon name={icon} size={22} color={on ? colors.onPrimary : colors.text} />
      </Pressable>
      <Txt variant="caption" tone="secondary" style={styles.actionLabel}>
        {label}
      </Txt>
    </View>
  );
}

export default function ContactScreen() {
  const nav = useNavigation<Nav>();
  const {publicKey: key} = useRoute<R>().params;

  const peer = usePeersStore(s => s.peers[key]);
  const online = usePeersStore(s => s.isOnline(key));
  const known = usePrefsStore(s => s.profiles[key]);
  const prefs = usePrefsStore(s => s.prefs[key]);
  const paired = usePairingStore(s => s.paired.find(p => p.publicKey === key));
  const status = usePairingStore(s => s.statusOf(key));
  const messages = useChatStore(s => s.byConversation[key]);

  const [muteOpen, setMuteOpen] = useState(false);
  const [nickOpen, setNickOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [nick, setNick] = useState(prefs?.nickname ?? '');
  const [viewing, setViewing] = useState<string | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [disOpen, setDisOpen] = useState(false);
  const lockCtl = useChatLock(key);

  const realName = paired?.name || peer?.name || known?.name || 'Pulse user';
  const name = prefs?.nickname?.trim() || realName;
  const avatar = peer?.avatar ?? known?.avatar;
  const bio = peer?.bio ?? known?.bio;
  const isPaired = status === 'paired';
  const blocked = !!prefs?.blocked;
  const muted = usePrefsStore.getState().isMuted(key);
  const hops = peer?.hops ?? 0;

  useEffect(() => {
    if (isPaired) {
      void useChatStore.getState().hydrateMedia(key);
    }
  }, [isPaired, key]);

  const photos = useMemo(() => (messages ?? []).filter(m => m.type === 'image' && m.image).slice(-9).reverse(), [messages]);
  const code = useMemo(() => safetyCode(getIdentity().publicKey, key), [key]);

  const where = online
    ? hops > 0
      ? `Via ${hops} relay${hops === 1 ? '' : 's'}`
      : 'In range'
    : known?.seenAt
    ? `Last seen ${ago(known.seenAt)}`
    : 'Out of range';

  const prefsApi = usePrefsStore.getState();

  const message = () => nav.navigate('Conversation', {conversationId: key, kind: 'direct', title: name});
  const call = () => void useCallStore.getState().start(key, name);

  const setMute = (ms: number | typeof MUTE_FOREVER | null) => {
    prefsApi.mute(key, ms);
    if (ms !== null) {
      notifier.clearConversation(key);
    }
    setMuteOpen(false);
  };

  const block = () => {
    if (blocked) {
      prefsApi.patch(key, {blocked: false});
      return;
    }
    Alert.alert(
      `Block ${name}?`,
      'They won’t be able to message or call you, and they’ll disappear from your Nearby list. They are not told.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            prefsApi.patch(key, {blocked: true});
            notifier.clearConversation(key);
          },
        },
      ],
    );
  };

  const clearChat = () =>
    Alert.alert('Clear this chat?', `Deletes every message with ${name} from this phone. They keep their copy.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Clear', style: 'destructive', onPress: () => useChatStore.getState().clearConversation(key)},
    ]);

  const removeConnection = () =>
    Alert.alert(
      `Remove ${name}?`,
      'Deletes the chat and the connection. You can connect again later from Nearby.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            useChatStore.getState().clearConversation(key);
            usePairingStore.getState().remove(key);
            notifier.clearConversation(key);
            nav.popToTop();
          },
        },
      ],
    );

  const copyId = () => {
    Clipboard.setString(key);
    ToastAndroid.show('Mesh id copied', ToastAndroid.SHORT);
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <Avatar name={name} uri={avatar} seed={key} size={112} ring />
        <Txt variant="title" style={styles.name} numberOfLines={2} center>
          {name}
        </Txt>
        {prefs?.nickname?.trim() && prefs.nickname.trim() !== realName ? (
          <Txt variant="caption" tone="muted">
            {realName}
          </Txt>
        ) : null}
        <View style={styles.statusRow}>
          <View style={[styles.dot, {backgroundColor: online ? colors.meshOnline : colors.textMuted}]} />
          <Txt variant="caption" tone="secondary">
            {where}
          </Txt>
          {prefs?.verified ? (
            <>
              <Txt variant="caption" tone="muted">
                {' · '}
              </Txt>
              <Icon name="verified" size={13} color={colors.text} />
              <Txt variant="caption" tone="secondary">
                Verified
              </Txt>
            </>
          ) : null}
        </View>
        {bio ? (
          <Txt variant="body" tone="secondary" center style={styles.bio}>
            {bio}
          </Txt>
        ) : null}
      </View>

      {isPaired && !blocked ? (
        <View style={styles.actions}>
          <RoundAction icon="chat" label="Message" onPress={message} />
          <RoundAction icon="phone" label="Call" onPress={call} disabled={prefs?.allowCalls === false} />
          <RoundAction icon={muted ? 'bellOff' : 'bell'} label={muted ? 'Unmute' : 'Mute'} on={muted} onPress={() => (muted ? setMute(null) : setMuteOpen(true))} />
          <RoundAction icon="pin" label={prefs?.pinned ? 'Unpin' : 'Pin'} on={!!prefs?.pinned} onPress={() => prefsApi.patch(key, {pinned: !prefs?.pinned})} />
        </View>
      ) : null}

      {!isPaired && !blocked ? (
        <View style={styles.connectBox}>
          {status === 'incoming' ? (
            <Button
              label="Accept connect request"
              onPress={() => usePairingStore.getState().accept({publicKey: key, name: realName, at: Date.now()})}
            />
          ) : status === 'outgoing' ? (
            <Button label="Request sent…" variant="secondary" disabled />
          ) : (
            <Button
              label="Connect"
              onPress={() => usePairingStore.getState().request({publicKey: key, name: realName, lastSeen: Date.now(), hops})}
              disabled={!online}
            />
          )}
          <Txt variant="caption" tone="muted" center style={styles.connectNote}>
            {online
              ? 'Connecting lets you message and call each other, even through other people’s phones.'
              : 'They need to be nearby (or reachable through someone) before you can connect.'}
          </Txt>
        </View>
      ) : null}

      {blocked ? (
        <View style={styles.blockedBox}>
          <Icon name="ban" size={18} color={colors.dangerBright} />
          <Txt variant="caption" tone="danger" style={{flex: 1}}>
            You blocked {name}. They can’t message, call or find you.
          </Txt>
        </View>
      ) : null}

      {isPaired && photos.length > 0 ? (
        <>
          <SettingLabel>SHARED PHOTOS</SettingLabel>
          <View style={styles.grid}>
            {photos.map(m => (
              <Pressable key={m.id} onPress={() => setViewing(m.image ?? null)} style={styles.tile}>
                <Image source={{uri: `data:image/jpeg;base64,${m.image}`}} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {isPaired ? (
        <>
          <SettingLabel>THIS CHAT</SettingLabel>
          <SettingGroup>
            <SettingRow icon="edit" title="Nickname" value={prefs?.nickname || 'Not set'} onPress={() => { setNick(prefs?.nickname ?? ''); setNickOpen(true); }} />
            <SettingRow
              icon={muted ? 'bellOff' : 'bell'}
              title="Mute notifications"
              value={muteLabel(prefs) ?? 'Off'}
              onPress={() => (muted ? setMute(null) : setMuteOpen(true))}
            />
            <SettingRow icon="pin" title="Pin to top of chats" toggle={{value: !!prefs?.pinned, onChange: v => prefsApi.patch(key, {pinned: v})}} />
            <SettingRow icon="star" title="Favorite" subtitle="Shows under the Favorites tab" toggle={{value: !!prefs?.favorite, onChange: v => prefsApi.patch(key, {favorite: v})}} />
            <SettingRow icon="tag" title="Label" value={prefs?.label || 'None'} onPress={() => setLabelOpen(true)} />
            <SettingRow
              icon="clock"
              title="Disappearing messages"
              subtitle="Delete new messages from both phones after a while"
              value={disappearText(prefs?.disappear)}
              onPress={() => setDisOpen(true)}
            />
            <SettingRow
              icon="phone"
              title="Allow calls from them"
              subtitle={prefs?.allowCalls === false ? 'Their calls are declined automatically' : 'They can ring your phone'}
              toggle={{value: prefs?.allowCalls !== false, onChange: v => prefsApi.patch(key, {allowCalls: v})}}
            />
            <SettingRow icon="lock" title="Lock chat" subtitle="Needs your PIN or fingerprint to open. Hides its preview and notifications" toggle={{value: lockCtl.locked, onChange: () => lockCtl.toggle()}} />
            <SettingRow icon="star" title="Starred messages" onPress={() => nav.navigate('Starred')} />
          </SettingGroup>
        </>
      ) : null}

      <SettingLabel>SECURITY</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="key"
          title="Security code"
          subtitle="Compare with them to be sure no one is in the middle"
          value={prefs?.verified ? 'Verified' : undefined}
          onPress={() => setCodeOpen(true)}
        />
        <SettingRow icon="copy" title="Mesh id" value={shortId(key)} onPress={copyId} noChevron />
        <SettingRow icon="lock" title="Phone number" subtitle="Pulse never shares phone numbers. You can’t see theirs and they can’t see yours." noChevron />
      </SettingGroup>

      <SettingLabel>MANAGE</SettingLabel>
      <SettingGroup>
        {isPaired ? <SettingRow icon="trash" title="Clear chat" onPress={clearChat} /> : null}
        <SettingRow icon="ban" title={blocked ? `Unblock ${name}` : `Block ${name}`} danger={!blocked} onPress={block} />
        {isPaired ? <SettingRow icon="userX" title="Remove connection" danger onPress={removeConnection} /> : null}
      </SettingGroup>

      {/* mute choices */}
      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        {MUTE_CHOICES.map(c => (
          <Pressable key={c.label} style={styles.choice} onPress={() => setMute(c.ms)}>
            <Txt variant="body">{c.label}</Txt>
          </Pressable>
        ))}
        <Txt variant="caption" tone="muted" style={{marginTop: spacing.sm}}>
          Messages still arrive. You just won’t be notified.
        </Txt>
      </Sheet>

      {/* nickname */}
      <Sheet visible={nickOpen} onClose={() => setNickOpen(false)} title="Nickname">
        <TextField label="Only you see this" placeholder={realName} value={nick} onChangeText={t => setNick(t.slice(0, 30))} autoFocus />
        <Button
          label="Save"
          onPress={() => {
            prefsApi.patch(key, {nickname: nick.trim()});
            setNickOpen(false);
          }}
        />
      </Sheet>

      {/* security code */}
      <Sheet visible={codeOpen} onClose={() => setCodeOpen(false)} title="Security code">
        <Txt variant="caption" tone="secondary" style={{marginBottom: spacing.lg}}>
          Ask {name} to open this same screen. If both phones show the same numbers, your connection is private and no one swapped the keys.
        </Txt>
        <View style={styles.codeBox}>
          {[code.slice(0, 3), code.slice(3)].map((row, i) => (
            <Txt key={i} variant="heading" style={styles.codeRow}>
              {row.join('   ')}
            </Txt>
          ))}
        </View>
        <Button
          label={prefs?.verified ? 'Remove “verified” mark' : 'Mark as verified'}
          variant={prefs?.verified ? 'secondary' : 'primary'}
          onPress={() => {
            prefsApi.patch(key, {verified: !prefs?.verified});
            setCodeOpen(false);
          }}
        />
      </Sheet>

      {lockCtl.modal}
      <LabelSheet
        visible={labelOpen}
        onClose={() => setLabelOpen(false)}
        current={prefs?.label}
        onPick={l => {
          prefsApi.patch(key, {label: l ?? undefined});
          setLabelOpen(false);
        }}
      />
      <DisappearSheet
        visible={disOpen}
        onClose={() => setDisOpen(false)}
        value={prefs?.disappear}
        onPick={ms => {
          useChatStore.getState().setDisappear(key, 'direct', ms);
          setDisOpen(false);
        }}
      />

      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md},
  name: {marginTop: spacing.lg, maxWidth: '90%'},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs},
  dot: {width: 8, height: 8, borderRadius: 4},
  bio: {marginTop: spacing.md, paddingHorizontal: spacing.xl},
  actions: {flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, paddingHorizontal: spacing.sm},
  actionWrap: {alignItems: 'center', width: 72},
  action: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOn: {backgroundColor: colors.primary},
  actionLabel: {marginTop: spacing.xs},
  connectBox: {marginTop: spacing.lg},
  connectNote: {marginTop: spacing.sm, paddingHorizontal: spacing.lg},
  blockedBox: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.dangerDim, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 4},
  tile: {width: '32.5%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface},
  choice: {paddingVertical: spacing.md},
  codeBox: {backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  codeRow: {fontVariant: ['tabular-nums'], letterSpacing: 1},
});
