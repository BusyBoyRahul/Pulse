import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';

import {Screen, Txt, Icon, IconName, Avatar} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {useCallStore} from '@/store/callStore';
import {usePeersStore} from '@/store/peersStore';

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

function RoundButton({
  icon,
  label,
  onPress,
  on,
  tone,
  size = 68,
}: {
  icon: IconName;
  label?: string;
  onPress: () => void;
  on?: boolean;
  tone?: 'danger' | 'primary';
  size?: number;
}) {
  const bg = tone === 'danger' ? colors.danger : tone === 'primary' ? colors.primary : on ? colors.primary : colors.surfaceRaised;
  const fg = tone === 'danger' ? colors.onDanger : tone === 'primary' || on ? colors.onPrimary : colors.text;
  return (
    <View style={styles.btnWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({pressed}) => [styles.btn, {width: size, height: size, borderRadius: size / 2, backgroundColor: bg}, pressed && {opacity: 0.8}]}>
        <Icon name={icon} size={size * 0.38} color={fg} />
      </Pressable>
      {label ? (
        <Txt variant="caption" tone="secondary" style={styles.btnLabel}>
          {label}
        </Txt>
      ) : null}
    </View>
  );
}

export default function CallScreen() {
  const nav = useNavigation();
  const call = useCallStore();
  const avatar = usePeersStore(s => (call.peerKey ? s.peers[call.peerKey]?.avatar : undefined));
  const [now, setNow] = useState(Date.now());

  // Nothing to show (e.g. opened after the call already cleared): leave.
  useEffect(() => {
    if (call.phase === 'idle') {
      if (nav.isFocused() && nav.canGoBack()) {
        nav.goBack();
      }
    }
  }, [call.phase, nav]);

  useEffect(() => {
    if (call.phase !== 'active') {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call.phase]);

  // Rings that swell with the other person's voice.
  const swell = useRef(new Animated.Value(0)).current;
  const idle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(swell, {toValue: call.levelPeer, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true}).start();
  }, [call.levelPeer, swell]);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(idle, {toValue: 1, duration: 2400, easing: Easing.out(Easing.ease), useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [idle]);

  const ringing = call.phase === 'outgoing' || call.phase === 'incoming';
  const via = call.hops > 0 ? `via ${call.hops} relay${call.hops === 1 ? '' : 's'}` : 'direct';

  const status =
    call.phase === 'incoming'
      ? 'Incoming call'
      : call.phase === 'outgoing'
      ? call.hops > 0
        ? `Calling through ${call.hops} relay${call.hops === 1 ? '' : 's'}…`
        : 'Calling…'
      : call.phase === 'active'
      ? clock(now - (call.startedAt ?? now))
      : call.phase === 'ended'
      ? call.endReason ?? 'Call ended'
      : '';

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <View style={styles.badge}>
          <Icon name="lock" size={12} color={colors.textSecondary} />
          <Txt variant="label" tone="secondary">
            END-TO-END ENCRYPTED{call.phase === 'active' ? ` · ${via.toUpperCase()}` : ''}
          </Txt>
        </View>
        <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={14} style={styles.minimise}>
          <Icon name="chevronDown" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <View style={styles.avatarStage}>
          {[0, 1].map(i => (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  opacity: idle.interpolate({inputRange: [0, 0.2, 1], outputRange: [0, ringing ? 0.5 : 0.18, 0]}),
                  transform: [{scale: idle.interpolate({inputRange: [0, 1], outputRange: [1 + i * 0.25, 1.9 + i * 0.25]})}],
                },
              ]}
            />
          ))}
          <Animated.View style={{transform: [{scale: swell.interpolate({inputRange: [0, 1], outputRange: [1, 1.16]})}]}}>
            <Avatar name={call.peerName || '?'} seed={call.peerKey ?? undefined} uri={avatar} size={148} ring />
          </Animated.View>
        </View>

        <Txt variant="title" center style={styles.name} numberOfLines={1}>
          {call.peerName}
        </Txt>
        <Txt variant="subtitle" tone={call.phase === 'ended' ? 'muted' : 'secondary'} center style={styles.status}>
          {status}
        </Txt>
        <Txt variant="caption" tone="muted" center style={styles.privacy}>
          Calls use Pulse, not your phone number. They never see yours.
        </Txt>
      </View>

      <View style={styles.controls}>
        {call.phase === 'incoming' ? (
          <View style={styles.row}>
            <RoundButton icon="phoneOff" label="Decline" tone="danger" size={76} onPress={call.decline} />
            <RoundButton icon="phone" label="Accept" tone="primary" size={76} onPress={() => void call.accept()} />
          </View>
        ) : call.phase === 'active' ? (
          <>
            <View style={styles.row}>
              <RoundButton icon={call.muted ? 'micOff' : 'mic'} label={call.muted ? 'Unmute' : 'Mute'} on={call.muted} onPress={call.toggleMute} />
              <RoundButton icon="speaker" label="Speaker" on={call.speaker} onPress={call.toggleSpeaker} />
            </View>
            <View style={styles.endRow}>
              <RoundButton icon="phoneOff" label="End" tone="danger" size={76} onPress={call.hangup} />
            </View>
          </>
        ) : call.phase === 'outgoing' ? (
          <View style={styles.endRow}>
            <RoundButton icon="phoneOff" label="Cancel" tone="danger" size={76} onPress={call.hangup} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {paddingTop: 20, alignItems: 'center'},
  badge: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  minimise: {position: "absolute", left: spacing.xl, top: 22},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl},
  avatarStage: {width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl},
  ring: {position: 'absolute', width: 148, height: 148, borderRadius: 74, borderWidth: 1.5, borderColor: colors.text},
  name: {maxWidth: '90%'},
  status: {marginTop: spacing.sm, fontVariant: ['tabular-nums']},
  privacy: {marginTop: spacing.xl, maxWidth: 260},
  controls: {paddingBottom: 56, paddingHorizontal: spacing.xl},
  row: {flexDirection: 'row', justifyContent: 'space-evenly'},
  endRow: {alignItems: 'center', marginTop: spacing.xl},
  btnWrap: {alignItems: 'center'},
  btn: {alignItems: 'center', justifyContent: 'center'},
  btnLabel: {marginTop: spacing.sm},
});
