import {themedStyles} from '@/theme/themed';
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, StatusBar, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Avatar, CallButton, Icon, Txt} from '@/components';
import {colors, spacing, themeInfo} from '@/theme/theme';
import {useInternetCallStore} from '@/net/internetCall';
import {usePeersStore} from '@/store/peersStore';
import {displayName} from '@/services/names';

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

// The video view comes from the WebRTC engine; loaded only when a call screen opens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useRtcView(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-webrtc').RTCView;
}

const STATUS: Record<string, string> = {
  outgoing: 'Calling…',
  incoming: 'Incoming call',
  connecting: 'Connecting…',
};

const ENDED: Record<string, string> = {
  declined: 'Declined',
  busy: 'Busy right now',
  'no answer': 'No answer',
  ended: 'Call ended',
  missed: 'Missed call',
};

/**
 * Voice and video calls over the internet. A voice call is a calm page in the app's own theme: a pulsing picture while it
 * rings, the name, the state or the running time, labelled round buttons and one big red End. A video call puts the other
 * person full screen with your own picture in a corner and the same buttons floating over it.
 */
export default function InternetCallScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const c = useInternetCallStore();
  const who = c.peerKey ? displayName(c.peerKey, c.name) : c.name; // their name, never their ID
  const avatar = usePeersStore(s => (c.peerKey ? s.peers[c.peerKey]?.avatar : undefined));
  const [now, setNow] = useState(Date.now());
  const RTCView = c.video ? useRtcView() : null;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Once the call is over and cleared, leave.
  useEffect(() => {
    if (c.phase === 'idle' && nav.canGoBack()) {
      nav.goBack();
    }
  }, [c.phase, nav]);

  // Rings that pulse out from the picture while the phone is ringing.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, {toValue: 1, duration: 2400, easing: Easing.out(Easing.ease), useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringing = c.phase === 'outgoing' || c.phase === 'incoming' || c.phase === 'connecting';
  const showVideo = !!(c.video && (c.phase === 'active' || c.phase === 'connecting') && c.remote);
  const status =
    c.phase === 'ended'
      ? ENDED[c.endedReason ?? ''] ?? c.endedReason ?? 'Call ended'
      : c.phase === 'active' && c.startedAt
      ? clock(now - c.startedAt)
      : STATUS[c.phase] ?? '';
  const sub =
    c.phase === 'outgoing'
      ? `Waiting for ${who || 'them'} to answer`
      : c.phase === 'incoming'
      ? c.video
        ? 'Video call'
        : 'Voice call'
      : c.phase === 'connecting'
      ? 'Setting up a private connection'
      : '';

  // On video the screen is dark behind the picture; otherwise it follows the app's theme.
  const dark = showVideo;
  const textColor = dark ? '#FFFFFF' : colors.text;
  const softColor = dark ? 'rgba(255,255,255,0.78)' : colors.textSecondary;

  return (
    <View style={[styles.flex, dark && {backgroundColor: '#000'}]}>
      <StatusBar barStyle={dark || themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {showVideo && RTCView ? <RTCView streamURL={c.remote!.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" /> : null}
      {dark ? <View style={styles.scrimTop} pointerEvents="none" /> : null}
      {dark ? <View style={styles.scrimBottom} pointerEvents="none" /> : null}
      {c.video && c.local && !c.cameraOff && RTCView && c.phase !== 'incoming' ? (
        <RTCView streamURL={c.local.toURL()} style={[styles.pip, {top: insets.top + 100}]} objectFit="cover" mirror zOrder={1} />
      ) : null}

      <View style={[styles.top, {paddingTop: insets.top + spacing.sm}]} pointerEvents="box-none">
        {/* Minimise: leave this screen but keep the call going (a green bar at the top brings you back). */}
        <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={14} accessibilityRole="button" accessibilityLabel="Minimise the call" style={[styles.minimise, dark && styles.minimiseVideo]}>
          <Icon name="chevronDown" size={18} color={textColor} />
          <Txt variant="label" style={{color: textColor}}>
            Minimise
          </Txt>
        </Pressable>
        <View style={[styles.badge, dark ? styles.badgeVideo : {backgroundColor: colors.primaryDim}]}>
          <Icon name="lock" size={12} color={dark ? '#FFFFFF' : colors.primaryBright} />
          <Txt variant="label" style={{color: dark ? '#FFFFFF' : colors.primaryBright}}>
            END-TO-END ENCRYPTED
          </Txt>
        </View>
      </View>

      {showVideo ? <View style={styles.fill} pointerEvents="none" /> : null}
      {showVideo ? (
        <View style={[styles.videoInfo, {top: insets.top + 64}]} pointerEvents="none">
          <Txt variant="subtitle" style={{color: '#FFFFFF'}}>
            {who}
          </Txt>
          <Txt variant="caption" style={{color: softColor, fontVariant: ['tabular-nums']}}>
            {status}
          </Txt>
        </View>
      ) : (
        <View style={styles.center}>
          <View style={styles.stage}>
            {ringing
              ? [0, 1].map(i => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.ring,
                      {
                        opacity: pulse.interpolate({inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0]}),
                        transform: [{scale: pulse.interpolate({inputRange: [0, 1], outputRange: [1 + i * 0.25, 1.9 + i * 0.25]})}],
                      },
                    ]}
                  />
                ))
              : null}
            <Avatar name={who || '?'} seed={c.peerKey ?? undefined} uri={avatar} size={148} ring />
          </View>
          <Txt variant="title" center numberOfLines={1} style={styles.name}>
            {who}
          </Txt>
          <Txt variant="subtitle" tone={c.phase === 'ended' ? 'muted' : 'secondary'} center style={{fontVariant: ['tabular-nums']}}>
            {status}
          </Txt>
          {sub ? (
            <Txt variant="caption" tone="muted" center style={styles.sub}>
              {sub}
            </Txt>
          ) : null}
        </View>
      )}

      <View style={[styles.controls, {paddingBottom: insets.bottom + spacing.xl}]}>
        {c.phase === 'incoming' ? (
          <View style={styles.pair}>
            <CallButton icon="phoneOff" label="Decline" tone="danger" size={76} onPress={() => c.decline()} />
            <CallButton icon="phone" label="Answer" tone="success" size={76} onPress={() => void c.accept()} />
          </View>
        ) : c.phase === 'ended' ? null : (
          <>
            <View style={styles.row}>
              <CallButton icon={c.muted ? 'micOff' : 'mic'} label={c.muted ? 'Unmute' : 'Mute'} on={c.muted} overVideo={dark} onPress={() => c.toggleMute()} />
              <CallButton icon="speaker" label="Speaker" on={c.speaker} overVideo={dark} onPress={() => c.toggleSpeaker()} />
              {c.video ? <CallButton icon="video" label={c.cameraOff ? 'Camera off' : 'Camera'} on={c.cameraOff} overVideo={dark} onPress={() => c.toggleCamera()} /> : null}
              {c.video ? <CallButton icon="swap" label="Flip" overVideo={dark} onPress={() => c.flipCamera()} /> : null}
            </View>
            <View style={styles.endRow}>
              <CallButton icon="phoneOff" label={c.phase === 'active' ? 'End call' : 'Cancel'} tone="danger" size={76} overVideo={dark} onPress={() => c.end()} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    flex: {flex: 1, backgroundColor: colors.bg},
    top: {alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg},
    minimise: {alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: spacing.md, borderRadius: 18, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
    minimiseVideo: {backgroundColor: 'rgba(0,0,0,0.45)', borderColor: 'transparent'},
    badge: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 14},
    badgeVideo: {backgroundColor: 'rgba(0,0,0,0.45)'},
    fill: {flex: 1},
    center: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.xs},
    stage: {width: 230, height: 230, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg},
    ring: {position: 'absolute', width: 148, height: 148, borderRadius: 74, borderWidth: 1.5, borderColor: colors.primary},
    name: {maxWidth: '90%'},
    sub: {marginTop: spacing.sm, maxWidth: 280},
    videoInfo: {position: 'absolute', left: spacing.xl, gap: 2},
    scrimTop: {position: 'absolute', top: 0, left: 0, right: 0, height: 170, backgroundColor: 'rgba(0,0,0,0.35)'},
    scrimBottom: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 300, backgroundColor: 'rgba(0,0,0,0.35)'},
    pip: {position: 'absolute', right: spacing.lg, width: 108, height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)'},
    controls: {alignItems: 'center', gap: spacing.lg, paddingTop: spacing.lg},
    row: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: spacing.md},
    endRow: {alignItems: 'center'},
    pair: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 64},
  }),
);
