import {themedStyles} from '@/theme/themed';
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import Svg, {Circle, Defs, RadialGradient, Stop, Path, Line} from 'react-native-svg';
import Reanimated, {ZoomIn} from 'react-native-reanimated';
import {colors} from '@/theme/theme';
import {Txt} from './Text';
import {Avatar} from './Avatar';
import {Icon} from './Icon';

export type RadarBlip = {
  key: string;
  label: string;
  color?: string;
  /** Their profile photo (the initials show when there is none). */
  uri?: string;
  /** Someone who asked to connect: a livelier ring and a small + badge. */
  pending?: boolean;
};

type Props = {
  size?: number;
  blips: RadarBlip[];
  active?: boolean;
};

// Deterministic angle/radius so a given peer sits in a stable spot.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Animated sonar/radar. Concentric rings with a continuously sweeping beam;
 * each nearby peer shows as a labelled blip at a stable position. The visual
 * heartbeat of "scanning for people around you."
 */
export function Radar({size = 300, blips, active = true}: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      return;
    }
    const rot = Animated.loop(
      Animated.timing(spin, {toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true}),
    );
    const pl = Animated.loop(
      Animated.timing(pulse, {toValue: 1, duration: 2600, easing: Easing.out(Easing.ease), useNativeDriver: true}),
    );
    rot.start();
    pl.start();
    return () => {
      rot.stop();
      pl.stop();
    };
  }, [active, spin, pulse]);

  const r = size / 2;
  const rings = [0.32, 0.62, 0.92];
  const rotate = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});

  return (
    <View style={{width: size, height: size, alignItems: 'center', justifyContent: 'center'}}>
      {/* Static rings */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {rings.map((f, i) => (
          <Circle key={i} cx={r} cy={r} r={r * f} stroke={colors.border} strokeWidth={1} fill="none" />
        ))}
        <Line x1={r} y1={0} x2={r} y2={size} stroke={colors.border} strokeWidth={0.5} opacity={0.5} />
        <Line x1={0} y1={r} x2={size} y2={r} stroke={colors.border} strokeWidth={0.5} opacity={0.5} />
      </Svg>

      {/* Expanding pulse ring */}
      {active ? (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              width: size,
              height: size,
              borderRadius: r,
              opacity: pulse.interpolate({inputRange: [0, 0.1, 1], outputRange: [0, 0.35, 0]}),
              transform: [{scale: pulse.interpolate({inputRange: [0, 1], outputRange: [0.3, 1]})}],
            },
          ]}
        />
      ) : null}

      {/* Sweeping beam */}
      {active ? (
        <Animated.View style={[StyleSheet.absoluteFill, {transform: [{rotate}]}]}>
          <Svg width={size} height={size}>
            <Defs>
              <RadialGradient id="beam" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={colors.primaryBright} stopOpacity="0.55" />
                <Stop offset="1" stopColor={colors.primaryBright} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Path d={`M ${r} ${r} L ${r} 0 A ${r} ${r} 0 0 1 ${r + r * 0.72} ${r * 0.3} Z`} fill="url(#beam)" />
          </Svg>
        </Animated.View>
      ) : null}

      {/* Center (you) */}
      <View style={[styles.center, {backgroundColor: colors.primary}]} />

      {/* Blips: each person is their photo, popping in and gently pulsing */}
      {blips.map(b => {
        const h = hash(b.key);
        const angle = (h % 360) * (Math.PI / 180);
        const dist = r * (0.4 + ((h >> 3) % 45) / 100); // 0.40-0.85 of radius
        return <BlipView key={b.key} blip={b} x={r + Math.cos(angle) * dist} y={r + Math.sin(angle) * dist} />;
      })}
    </View>
  );
}

const AV = 34;
const BLIP_W = 76;

function BlipView({blip, x, y}: {blip: RadarBlip; x: number; y: number}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const color = blip.pending ? colors.primary : blip.color ?? colors.meshOnline;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, {toValue: 1, duration: blip.pending ? 1300 : 2400, easing: Easing.out(Easing.quad), useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [pulse, blip.pending]);
  const ringSize = AV + 10;
  return (
    <Reanimated.View entering={ZoomIn.springify().damping(13)} style={[styles.blip, {left: x - BLIP_W / 2, top: y - ringSize / 2}]}>
      <View style={{width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center'}}>
        <Animated.View
          style={{
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: 2,
            borderColor: color,
            opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.55, 0]}),
            transform: [{scale: pulse.interpolate({inputRange: [0, 1], outputRange: [1, 1.8]})}],
          }}
        />
        <View style={[styles.blipRing, {width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: color}]}>
          <Avatar name={blip.label} seed={blip.key} uri={blip.uri} size={AV} />
        </View>
        {blip.pending ? (
          <View style={styles.badge}>
            <Icon name="plus" size={10} color="#FFFFFF" strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <Txt variant="label" tone="secondary" style={styles.blipLabel} numberOfLines={1}>
        {blip.label}
      </Txt>
    </Reanimated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  center: {width: 14, height: 14, borderRadius: 7},
  pulseRing: {position: 'absolute', borderWidth: 2, borderColor: colors.primaryBright},
  blip: {position: 'absolute', alignItems: 'center', width: BLIP_W},
  blipRing: {borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg},
  badge: {position: 'absolute', right: -3, top: -3, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
  blipLabel: {marginTop: 2, maxWidth: BLIP_W, textAlign: 'center'},
}));

export default Radar;
