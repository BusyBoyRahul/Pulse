import {themedStyles} from '@/theme/themed';
import React, {useEffect} from 'react';
import {StyleSheet, View, ViewStyle, StyleProp} from 'react-native';
import Svg, {Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop} from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {alpha, colors, glow, themeInfo} from '@/theme/theme';
import {Icon} from './Icon';
import {Avatar} from './Avatar';

/**
 * Animated artwork for hero areas — drawn in code, so it is crisp at any size,
 * follows the chosen theme and accent, works offline and weighs nothing.
 * Every scene tells one idea: private, anywhere, nearby, secret, verify.
 */
export type SceneKind = 'private' | 'anywhere' | 'nearby' | 'secret' | 'verify';

const AnimatedPath = Animated.createAnimatedComponent(Path);

function useLoop(ms: number, delay = 0, yoyo = true) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, {duration: ms, easing: yoyo ? Easing.inOut(Easing.sin) : Easing.out(Easing.quad)}), -1, yoyo));
  }, [t, ms, delay, yoyo]);
  return t;
}

/** Drifts gently up and down (and tilts a little), forever. */
function Float({children, amp = 10, ms = 3200, delay = 0, tilt = 3, style}: {children: React.ReactNode; amp?: number; ms?: number; delay?: number; tilt?: number; style?: StyleProp<ViewStyle>}) {
  const t = useLoop(ms, delay);
  const a = useAnimatedStyle(() => ({
    transform: [{translateY: interpolate(t.value, [0, 1], [-amp, amp])}, {rotate: `${interpolate(t.value, [0, 1], [-tilt, tilt])}deg`}],
  }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** A ring that swells and fades, over and over (like a sonar ping). */
function Ping({size, color, ms = 2800, delay = 0, stroke = 2}: {size: number; color: string; ms?: number; delay?: number; stroke?: number}) {
  const t = useLoop(ms, delay, false);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 1], [0, 0.65, 0]),
    transform: [{scale: interpolate(t.value, [0, 1], [0.45, 1.25])}],
  }));
  return <Animated.View pointerEvents="none" style={[{position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color}, a]} />;
}

function Twinkle({x, y, size = 5, delay = 0, color}: {x: number; y: number; size?: number; delay?: number; color: string}) {
  const t = useLoop(1800 + (delay % 900), delay);
  const a = useAnimatedStyle(() => ({opacity: interpolate(t.value, [0, 1], [0.15, 1]), transform: [{scale: interpolate(t.value, [0, 1], [0.6, 1.3])}]}));
  return <Animated.View pointerEvents="none" style={[{position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: color}, a]} />;
}

/** Frosted panel with a bright top edge. */
function Glass({w, h, r = 24, children, style, tint}: {w: number; h: number; r?: number; children?: React.ReactNode; style?: StyleProp<ViewStyle>; tint?: [string, string]}) {
  return (
    <View style={[{width: w, height: h, borderRadius: r, overflow: 'hidden', borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass}, style]}>
      {tint ? <View style={[StyleSheet.absoluteFill, {backgroundColor: tint[0]}]} /> : null}
      {children}
    </View>
  );
}

/** A tiny pretend chat bubble. */
function Mock({w, mine, lines = 2}: {w: number; mine?: boolean; lines?: number}) {
  const bar = mine ? alpha('#FFFFFF', 0.85) : colors.textMuted;
  return (
    <Glass w={w} h={14 + lines * 14 + 12} r={18} tint={mine ? [colors.primary, colors.accent2] : undefined} style={mine ? {borderColor: 'transparent'} : undefined}>
      <View style={{padding: 12, gap: 8}}>
        {Array.from({length: lines}).map((_, i) => (
          <View key={i} style={{height: 6, borderRadius: 3, width: i === lines - 1 ? '58%' : '100%', backgroundColor: bar, opacity: 0.9}} />
        ))}
      </View>
    </Glass>
  );
}

function Orb({size, color, x, y, o = 0.5}: {size: number; color: string; x: number; y: number; o?: number}) {
  return (
    <View pointerEvents="none" style={{position: 'absolute', left: x, top: y, width: size, height: size}}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`o${x}${y}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={o} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#o${x}${y})`} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// scenes — each is drawn on a 320 x 300 stage
// ---------------------------------------------------------------------------
const W = 320;
const H = 300;

function Private() {
  return (
    <>
      <Orb size={300} color={colors.primary} x={10} y={0} o={0.5} />
      <Orb size={200} color={colors.accent2} x={150} y={110} o={0.35} />
      <View style={styles.center}>
        <Ping size={230} color={colors.primary} />
        <Ping size={230} color={colors.accent2} delay={1400} />
      </View>
      <Float amp={6} ms={3600} style={[styles.abs, {left: 6, top: 28}]}>
        <Mock w={122} lines={2} />
      </Float>
      <Float amp={8} ms={4200} delay={500} style={[styles.abs, {right: 0, top: 112}]}>
        <Mock w={136} mine lines={2} />
      </Float>
      <Float amp={7} ms={3900} delay={900} style={[styles.abs, {left: 14, bottom: 22}]}>
        <Mock w={108} lines={1} />
      </Float>
      <View style={styles.center}>
        <Float amp={5} ms={3000} tilt={2}>
          <Glass w={118} h={118} r={34} tint={[colors.primary, colors.accent2]} style={[{borderColor: 'rgba(255,255,255,0.5)'}, glow(colors.primary, 1.1)]}>
            <View style={styles.fill}>
              <Icon name="lock" size={54} color="#FFFFFF" strokeWidth={2.2} />
            </View>
          </Glass>
        </Float>
      </View>
      <Twinkle x={44} y={20} color={colors.primaryBright} delay={0} />
      <Twinkle x={286} y={44} size={6} color={colors.accent2} delay={400} />
      <Twinkle x={298} y={238} color={colors.primaryBright} delay={800} />
      <Twinkle x={150} y={286} size={4} color={colors.accent2} delay={1200} />
    </>
  );
}

const PEOPLE: {x: number; y: number; name: string}[] = [
  {x: 40, y: 70, name: 'Maya'},
  {x: 242, y: 52, name: 'Noor'},
  {x: 262, y: 196, name: 'Sam'},
  {x: 56, y: 206, name: 'Leo'},
];

function Arc({d, delay}: {d: string; delay: number}) {
  const t = useLoop(2600, delay, false);
  const props = useAnimatedProps(() => ({strokeDashoffset: interpolate(t.value, [0, 1], [60, 0])}));
  return <AnimatedPath d={d} stroke={colors.primaryBright} strokeWidth={2} strokeLinecap="round" strokeDasharray="6 54" fill="none" animatedProps={props} />;
}

function Anywhere() {
  const cx = W / 2;
  const cy = H / 2;
  const R = 108;
  const nodes = PEOPLE.map(p => ({x: p.x + 22, y: p.y + 22}));
  return (
    <>
      <Orb size={300} color={colors.primary} x={10} y={0} o={0.45} />
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="gl" cx="38%" cy="32%" r="75%">
            <Stop offset="0" stopColor={colors.primaryBright} stopOpacity={0.55} />
            <Stop offset="0.6" stopColor={colors.primary} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0.05} />
          </RadialGradient>
          <LinearGradient id="ln" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.primaryBright} stopOpacity={0.9} />
            <Stop offset="1" stopColor={colors.accent2} stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={R} fill="url(#gl)" stroke={alpha('#FFFFFF', 0.28)} strokeWidth={1.2} />
        {[0.28, 0.58, 0.86].map(k => (
          <Ellipse key={k} cx={cx} cy={cy} rx={R * k} ry={R} fill="none" stroke={alpha('#FFFFFF', 0.16)} strokeWidth={1} />
        ))}
        {[-0.55, -0.2, 0.2, 0.55].map(k => (
          <Ellipse key={k} cx={cx} cy={cy + R * k} rx={R * Math.sqrt(1 - k * k)} ry={R * 0.08} fill="none" stroke={alpha('#FFFFFF', 0.14)} strokeWidth={1} />
        ))}
        {/* faint links, then glowing packets travelling along them */}
        <Path d={`M ${nodes[0].x} ${nodes[0].y} Q ${cx} ${cy - 90} ${nodes[1].x} ${nodes[1].y}`} stroke="url(#ln)" strokeWidth={1.2} fill="none" opacity={0.5} />
        <Path d={`M ${nodes[1].x} ${nodes[1].y} Q ${cx + 70} ${cy + 20} ${nodes[2].x} ${nodes[2].y}`} stroke="url(#ln)" strokeWidth={1.2} fill="none" opacity={0.5} />
        <Path d={`M ${nodes[2].x} ${nodes[2].y} Q ${cx} ${cy + 100} ${nodes[3].x} ${nodes[3].y}`} stroke="url(#ln)" strokeWidth={1.2} fill="none" opacity={0.5} />
        <Path d={`M ${nodes[3].x} ${nodes[3].y} Q ${cx - 70} ${cy - 10} ${nodes[0].x} ${nodes[0].y}`} stroke="url(#ln)" strokeWidth={1.2} fill="none" opacity={0.5} />
        <Arc d={`M ${nodes[0].x} ${nodes[0].y} Q ${cx} ${cy - 90} ${nodes[1].x} ${nodes[1].y}`} delay={0} />
        <Arc d={`M ${nodes[1].x} ${nodes[1].y} Q ${cx + 70} ${cy + 20} ${nodes[2].x} ${nodes[2].y}`} delay={700} />
        <Arc d={`M ${nodes[2].x} ${nodes[2].y} Q ${cx} ${cy + 100} ${nodes[3].x} ${nodes[3].y}`} delay={1400} />
        <Arc d={`M ${nodes[3].x} ${nodes[3].y} Q ${cx - 70} ${cy - 10} ${nodes[0].x} ${nodes[0].y}`} delay={2100} />
      </Svg>
      {PEOPLE.map((p, i) => (
        <Float key={p.name} amp={5} ms={3000 + i * 400} delay={i * 300} tilt={0} style={[styles.abs, {left: p.x, top: p.y}]}>
          <View style={[styles.avatarHalo, {borderColor: alpha('#FFFFFF', 0.45)}]}>
            <Avatar name={p.name} size={44} />
          </View>
        </Float>
      ))}
      <View style={styles.center}>
        <Float amp={4} ms={3400} tilt={0}>
          <Glass w={60} h={60} r={30} tint={[colors.primary, colors.accent2]} style={[{borderColor: 'rgba(255,255,255,0.55)'}, glow(colors.primary, 1)]}>
            <View style={styles.fill}>
              <Icon name="globe" size={30} color="#FFFFFF" />
            </View>
          </Glass>
        </Float>
      </View>
      <Twinkle x={150} y={4} color={colors.primaryBright} />
      <Twinkle x={20} y={140} size={6} color={colors.accent2} delay={500} />
      <Twinkle x={300} y={140} color={colors.primaryBright} delay={900} />
    </>
  );
}

function Nearby() {
  const peers = [
    {x: 28, y: 36, n: 'Ana'},
    {x: 246, y: 24, n: 'Raj'},
    {x: 268, y: 214, n: 'Kim'},
    {x: 14, y: 196, n: 'Ola'},
  ];
  return (
    <>
      <Orb size={280} color={colors.primary} x={20} y={10} o={0.4} />
      <View style={styles.center}>
        <Ping size={300} color={colors.primary} ms={3600} />
        <Ping size={300} color={colors.primary} ms={3600} delay={1200} />
        <Ping size={300} color={colors.accent2} ms={3600} delay={2400} />
      </View>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {peers.map((p, i) => (
          <Path key={i} d={`M ${W / 2} ${H / 2} L ${p.x + 22} ${p.y + 22}`} stroke={alpha(colors.primaryBright, 0.5)} strokeWidth={1.4} strokeDasharray="4 6" />
        ))}
      </Svg>
      {peers.map((p, i) => (
        <Float key={p.n} amp={4} ms={2800 + i * 300} delay={i * 250} tilt={0} style={[styles.abs, {left: p.x, top: p.y}]}>
          <View style={[styles.avatarHalo, {borderColor: alpha('#FFFFFF', 0.45)}]}>
            <Avatar name={p.n} size={44} />
          </View>
        </Float>
      ))}
      <View style={styles.center}>
        <Glass w={76} h={76} r={38} tint={[colors.primary, colors.accent2]} style={[{borderColor: 'rgba(255,255,255,0.6)'}, glow(colors.primary, 1.1)]}>
          <View style={styles.fill}>
            <Icon name="radar" size={36} color="#FFFFFF" />
          </View>
        </Glass>
      </View>
    </>
  );
}

function Secret() {
  const t = useLoop(3200, 0, false);
  const ring = useAnimatedProps(() => ({strokeDashoffset: interpolate(t.value, [0, 1], [0, 2 * Math.PI * 78])}));
  const dissolve = (delay: number) => ({delay});
  return (
    <>
      <Orb size={300} color={colors.primary} x={10} y={0} o={0.45} />
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Circle cx={W / 2} cy={H / 2} r={78} fill="none" stroke={alpha('#FFFFFF', 0.16)} strokeWidth={6} />
        <AnimatedCircleRing cx={W / 2} cy={H / 2} r={78} animatedProps={ring} />
      </Svg>
      <View style={styles.center}>
        <Float amp={4} ms={3200} tilt={0}>
          <Glass w={104} h={104} r={32} tint={[colors.primary, colors.accent2]} style={[{borderColor: 'rgba(255,255,255,0.5)'}, glow(colors.primary, 1)]}>
            <View style={styles.fill}>
              <Icon name="lock" size={46} color="#FFFFFF" strokeWidth={2.2} />
            </View>
          </Glass>
        </Float>
      </View>
      <Vanish style={[styles.abs, {left: 4, top: 40}]} {...dissolve(0)}>
        <Mock w={110} lines={1} />
      </Vanish>
      <Vanish style={[styles.abs, {right: 0, top: 84}]} {...dissolve(900)}>
        <Mock w={120} mine lines={1} />
      </Vanish>
      <Vanish style={[styles.abs, {left: 18, bottom: 26}]} {...dissolve(1800)}>
        <Mock w={104} lines={1} />
      </Vanish>
      <View style={[styles.abs, {right: 24, bottom: 20}]}>
        <Glass w={64} h={34} r={17}>
          <View style={[styles.fill, {flexDirection: 'row', gap: 5}]}>
            <Icon name="clock" size={14} color={colors.text} />
            <View style={{width: 22, height: 6, borderRadius: 3, backgroundColor: colors.text, opacity: 0.8}} />
          </View>
        </Glass>
      </View>
    </>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
function AnimatedCircleRing(props: React.ComponentProps<typeof AnimatedCircle>) {
  const c = 2 * Math.PI * 78;
  return <AnimatedCircle {...props} fill="none" stroke={colors.primaryBright} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${c * 0.72} ${c}`} rotation={-90} origin={`${W / 2}, ${H / 2}`} />;
}

/** Fades in, drifts up and dissolves, on a loop — a message that disappears. */
function Vanish({children, delay, style}: {children: React.ReactNode; delay: number; style?: StyleProp<ViewStyle>}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withSequence(withTiming(1, {duration: 700}), withTiming(1, {duration: 1500}), withTiming(2, {duration: 1100})), -1, false));
  }, [t, delay]);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1, 2], [0, 1, 0]),
    transform: [{translateY: interpolate(t.value, [0, 1, 2], [12, 0, -22])}, {scale: interpolate(t.value, [0, 1, 2], [0.9, 1, 0.94])}],
  }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

function Verify() {
  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = withRepeat(withSequence(withDelay(900, withTiming(1, {duration: 380, easing: Easing.out(Easing.back(2))})), withDelay(1900, withTiming(0, {duration: 260}))), -1, false);
  }, [pop]);
  const badge = useAnimatedStyle(() => ({transform: [{scale: pop.value}], opacity: pop.value}));
  return (
    <>
      <Orb size={300} color={colors.primary} x={10} y={0} o={0.45} />
      <View style={styles.center}>
        <Ping size={240} color={colors.primary} ms={3400} />
        <Float amp={5} ms={3400} tilt={2}>
          <Glass w={132} h={216} r={32} style={glow(colors.primary, 0.6)}>
            <View style={{flex: 1, padding: 12, gap: 10}}>
              <View style={{height: 6, width: 38, borderRadius: 3, alignSelf: 'center', backgroundColor: colors.textMuted, opacity: 0.7}} />
              <Mock w={96} lines={2} />
              <Mock w={84} mine lines={1} />
              <View style={{flexDirection: 'row', gap: 6, marginTop: 4, justifyContent: 'center'}}>
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <View key={i} style={{width: 11, height: 14, borderRadius: 4, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder}} />
                ))}
              </View>
            </View>
          </Glass>
        </Float>
      </View>
      <Animated.View style={[styles.abs, {right: 56, top: 56}, badge]}>
        <Glass w={58} h={58} r={29} tint={[colors.success, colors.primaryBright]} style={{borderColor: 'rgba(255,255,255,0.6)'}}>
          <View style={styles.fill}>
            <Icon name="check" size={30} color="#FFFFFF" strokeWidth={3.2} />
          </View>
        </Glass>
      </Animated.View>
      <Twinkle x={30} y={60} color={colors.primaryBright} />
      <Twinkle x={286} y={210} size={6} color={colors.accent2} delay={600} />
    </>
  );
}

const SCENES: Record<SceneKind, React.FC> = {private: Private, anywhere: Anywhere, nearby: Nearby, secret: Secret, verify: Verify};

export function HeroScene({kind, height = 300, style}: {kind: SceneKind; height?: number; style?: StyleProp<ViewStyle>}) {
  const Scene = SCENES[kind];
  const scale = height / H;
  return (
    <View style={[{height, alignItems: 'center', justifyContent: 'center'}, style]} pointerEvents="none">
      <View style={{width: W, height: H, transform: [{scale}]}}>
        <Scene />
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  abs: {position: 'absolute'},
  center: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  fill: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  avatarHalo: {borderWidth: 2, borderRadius: 26, padding: 2, backgroundColor: themeInfo.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)'},
}));

export default HeroScene;
