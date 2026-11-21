import {themedStyles} from '@/theme/themed';
import React, {useRef, useState} from 'react';
import {StatusBar, StyleSheet, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Button, IconButton, Txt, Card, TextField, Avatar, Icon, IconName, Pressy, Reveal, PulseLogo, HeroScene, Aurora} from '@/components';
import {alertDialog} from '@/components/Dialog';
import {accounts} from '@/services/accounts';
import type {SceneKind} from '@/components';
import {colors, radius, spacing, themeInfo} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {getAccounts} from '@/services/storage';
import {pickProfilePhoto} from '@/services/imagePicker';
import {requestNotifications, requestBluetooth, requestLocation, PermissionResult} from '@/services/permissions';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SLIDES: {scene: SceneKind; title: string; body: string}[] = [
  {scene: 'private', title: 'Private by design', body: 'Every message and call is end-to-end encrypted. Not even the phones that carry it can read it.'},
  {scene: 'anywhere', title: 'Talk from anywhere', body: 'Chat and call over the internet with no server of ours in the middle — just you and the other person.'},
  {scene: 'nearby', title: 'Works with no signal', body: 'No internet? Nearby phones pass your messages along over Bluetooth and Wi-Fi until they arrive.'},
];

type PermStep = {
  key: 'notifications' | 'bluetooth' | 'location';
  icon: IconName;
  title: string;
  body: string;
  cta: string;
  request: () => Promise<PermissionResult>;
};

const PERMS: PermStep[] = [
  {key: 'notifications', icon: 'bell', title: 'Stay in the loop', body: 'Allow notifications so Pulse can tell you about messages and ring you when someone calls.', cta: 'Allow notifications', request: requestNotifications},
  {key: 'bluetooth', icon: 'bluetooth', title: 'Find people nearby', body: 'Bluetooth and nearby-device access let Pulse find phones around you and pass messages along. Pulse never reads what it carries.', cta: 'Allow nearby devices', request: requestBluetooth},
  {key: 'location', icon: 'mapPin', title: 'Share where you are, when you choose', body: 'Location is only used when you decide to share it — for example in a safety alert or a shared note. Never in the background.', cta: 'Allow location', request: requestLocation},
];

type Stage = {kind: 'welcome'} | {kind: 'account'} | {kind: 'perm'; perm: PermStep} | {kind: 'profile'};

function Slide({i, scrollX, w, h}: {i: number; scrollX: Animated.SharedValue<number>; w: number; h: number}) {
  const s = SLIDES[i];
  const insets = useSafeAreaInsets();
  const sceneStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, [(i - 0.7) * w, i * w, (i + 0.7) * w], [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      {translateX: interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [w * 0.45, 0, -w * 0.45], Extrapolation.CLAMP)},
      {scale: interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [0.8, 1, 0.8], Extrapolation.CLAMP)},
    ],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, [(i - 0.6) * w, i * w, (i + 0.6) * w], [0, 1, 0], Extrapolation.CLAMP),
    transform: [{translateY: interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [40, 0, 40], Extrapolation.CLAMP)}],
  }));
  return (
    <View style={{width: w, height: h}}>
      <Animated.View style={[styles.scene, {top: insets.top + 36}, sceneStyle]}>
        <HeroScene kind={s.scene} height={Math.min(340, h * 0.42)} />
      </Animated.View>
      <Animated.View style={[styles.slideText, textStyle]}>
        <Txt variant="display">{s.title}</Txt>
        <Txt variant="body" tone="secondary">
          {s.body}
        </Txt>
      </Animated.View>
    </View>
  );
}

function Dot({i, scrollX, w}: {i: number; scrollX: Animated.SharedValue<number>; w: number}) {
  const st = useAnimatedStyle(() => ({
    width: interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [8, 28, 8], Extrapolation.CLAMP),
    opacity: interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [0.45, 1, 0.45], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.dot, st]} />;
}

function Welcome({onDone}: {onDone: () => void}) {
  const {width: w, height: h} = useWindowDimensions();
  const scrollX = useSharedValue(0);
  const ref = useRef<Animated.ScrollView>(null);
  const [page, setPage] = useState(0);
  const onScroll = useAnimatedScrollHandler(e => {
    scrollX.value = e.contentOffset.x;
  });
  const last = page === SLIDES.length - 1;
  return (
    <View style={styles.flex}>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <Aurora />
      <Animated.ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / w))}>
        {SLIDES.map((_, i) => (
          <Slide key={i} i={i} scrollX={scrollX} w={w} h={h} />
        ))}
      </Animated.ScrollView>
      <View style={styles.welcomeFoot} pointerEvents="box-none">
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <Dot key={i} i={i} scrollX={scrollX} w={w} />
          ))}
        </View>
        <Button
          label={last ? 'Get started' : 'Next'}
          onPress={() => {
            if (last) {
              onDone();
            } else {
              ref.current?.scrollTo({x: (page + 1) * w, animated: true});
              setPage(p => p + 1);
            }
          }}
        />
        {!last ? <Button label="Skip" variant="ghost" onPress={onDone} /> : <View style={styles.skipGap} />}
      </View>
    </View>
  );
}

/** While adding another account, a way out at every step: nothing is kept and the previous account opens again. */
function CancelAdd() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const ask = () =>
    alertDialog('Cancel adding this account?', 'Nothing will be saved. You will go back to your other account.', [
      {text: 'Keep going', style: 'cancel'},
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void accounts.cancelAdd().then(ok => {
            if (!ok) {
              setBusy(false);
            }
          });
        },
      },
    ]);
  return (
    <View style={[styles.cancelAdd, {top: insets.top + spacing.sm}]} pointerEvents="box-none">
      <IconButton icon="x" label="Cancel adding this account" onPress={ask} disabled={busy} />
    </View>
  );
}

/** The sign-up flow, with a cancel button on top when it was opened by "Add account". */
export default function OnboardingScreen() {
  return (
    <View style={styles.flex}>
      <OnboardingFlow />
      {accounts.canCancelAdd() ? <CancelAdd /> : null}
    </View>
  );
}

function OnboardingFlow() {
  const nav = useNavigation<Nav>();
  const hasOtherAccounts = getAccounts().accounts.length > 1;
  const [stage, setStage] = useState<Stage>(hasOtherAccounts ? {kind: 'account'} : {kind: 'welcome'});
  const [wantPhone, setWantPhone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarThumb, setAvatarThumb] = useState<string | null>(null);
  const setupLocalProfile = useSessionStore(s => s.setupLocalProfile);
  const verified = useSessionStore(s => s.phoneVerified);
  const phone = useSessionStore(s => s.phone);

  const goPerms = () => setStage(hasOtherAccounts ? {kind: 'profile'} : {kind: 'perm', perm: PERMS[0]});

  const nextPerm = (perm: PermStep) => {
    const i = PERMS.findIndex(p => p.key === perm.key);
    setStage(i + 1 < PERMS.length ? {kind: 'perm', perm: PERMS[i + 1]} : {kind: 'profile'});
  };

  const pickPhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setAvatar(picked.uri);
      setAvatarThumb(picked.thumb);
    }
  };

  const finish = () => {
    getIdentity(); // make sure this account's key exists
    setupLocalProfile(name.trim(), phone ?? '', avatar ? {uri: avatar, thumb: avatarThumb} : null);
  };

  if (stage.kind === 'welcome') {
    return <Welcome onDone={() => setStage({kind: 'account'})} />;
  }

  // ---- how to sign up ---------------------------------------------------------
  if (stage.kind === 'account') {
    return (
      <Screen
        scroll
        footer={
          verified ? (
            <Button label="Continue" onPress={goPerms} />
          ) : wantPhone ? (
            <Button label="Add my number" onPress={() => nav.navigate('VerifyPhone', {from: 'onboarding'})} />
          ) : (
            <Button label="Continue without a number" onPress={goPerms} />
          )
        }>
        <Reveal style={styles.logoRow}>
          <PulseLogo size={84} />
        </Reveal>
        <Reveal index={1}>
          <Txt variant="display" style={styles.h}>
            {hasOtherAccounts ? 'Set up another account' : 'Create your account'}
          </Txt>
          <Txt variant="body" tone="secondary" style={styles.sub}>
            How people will know it is you.
          </Txt>
        </Reveal>

        {verified ? (
          <Reveal kind="pop">
            <Card glowing style={styles.verifiedCard}>
              <View style={[styles.optIcon, {backgroundColor: colors.primary}]}>
                <Icon name="verified" size={22} color={colors.onPrimary} />
              </View>
              <View style={styles.optText}>
                <Txt variant="bodyStrong">Number confirmed</Txt>
                <Txt variant="caption" tone="muted">
                  {phone}
                </Txt>
              </View>
            </Card>
          </Reveal>
        ) : (
          <>
            <Reveal index={2}>
              <Pressy onPress={() => setWantPhone(true)} accessibilityRole="button" accessibilityState={{selected: wantPhone}} accessibilityLabel="With a verified phone number" scaleTo={0.985}>
                <Card style={[styles.opt, wantPhone && styles.optOn]} glowing={wantPhone}>
                  <View style={[styles.optIcon, wantPhone && {backgroundColor: colors.primary}]}>
                    <Icon name="phone" size={22} color={wantPhone ? colors.onPrimary : colors.textSecondary} />
                  </View>
                  <View style={styles.optText}>
                    <Txt variant="bodyStrong">With a phone number</Txt>
                    <Txt variant="caption" tone="muted">
                      Picked from your phone.
                    </Txt>
                  </View>
                  <View style={[styles.radio, wantPhone && styles.radioOn]}>{wantPhone ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3.2} /> : null}</View>
                </Card>
              </Pressy>
            </Reveal>
            <Reveal index={3}>
              <Pressy onPress={() => setWantPhone(false)} accessibilityRole="button" accessibilityState={{selected: !wantPhone}} accessibilityLabel="Without a phone number" scaleTo={0.985}>
                <Card style={[styles.opt, !wantPhone && styles.optOn]} glowing={!wantPhone}>
                  <View style={[styles.optIcon, !wantPhone && {backgroundColor: colors.primary}]}>
                    <Icon name="at" size={22} color={!wantPhone ? colors.onPrimary : colors.textSecondary} />
                  </View>
                  <View style={styles.optText}>
                    <Txt variant="bodyStrong">Without a phone number</Txt>
                    <Txt variant="caption" tone="muted">
                      Just a name. Most private.
                    </Txt>
                  </View>
                  <View style={[styles.radio, !wantPhone && styles.radioOn]}>{!wantPhone ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3.2} /> : null}</View>
                </Card>
              </Pressy>
            </Reveal>
          </>
        )}
        <Txt variant="caption" tone="muted" center style={styles.foot}>
          Add a number any time.
        </Txt>
      </Screen>
    );
  }

  // ---- permissions ----------------------------------------------------------------
  if (stage.kind === 'perm') {
    const p = stage.perm;
    const step = PERMS.findIndex(x => x.key === p.key);
    return (
      <Screen
        scroll
        footer={
          <View>
            <Button
              label={p.cta}
              loading={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await p.request(); // carry on either way — it can be granted later in Settings
                } finally {
                  setBusy(false);
                }
                nextPerm(p);
              }}
            />
            <Button label="Not now" variant="ghost" onPress={() => nextPerm(p)} />
          </View>
        }>
        <View style={styles.progress}>
          {PERMS.map((_, i) => (
            <View key={i} style={[styles.tick, i <= step ? styles.tickOn : styles.tickOff]} />
          ))}
        </View>
        <Reveal kind="pop" style={styles.permHero}>
          <View style={styles.permCircle}>
            <Icon name={p.icon} size={44} color={colors.onPrimary} />
          </View>
        </Reveal>
        <Reveal index={1}>
          <Txt variant="display" style={styles.h}>
            {p.title}
          </Txt>
          <Txt variant="body" tone="secondary" style={styles.sub}>
            {p.body}
          </Txt>
        </Reveal>
        <Card style={styles.note}>
          <Txt variant="caption" tone="muted">
            You can change this any time in Settings.
          </Txt>
        </Card>
      </Screen>
    );
  }

  // ---- profile ----------------------------------------------------------------------
  return (
    <Screen scroll footer={<Button label="Enter Pulse" onPress={finish} disabled={name.trim().length === 0} />}>
      <Reveal style={styles.permHero}>
        <Pressy onPress={pickPhoto} accessibilityRole="button" accessibilityLabel="Choose a profile photo" scaleTo={0.94}>
          <Avatar name={name || 'You'} uri={avatar} seed={getIdentity().publicKey} size={118} ring />
          <View style={styles.cameraBadge}>
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressy>
      </Reveal>
      <Reveal index={1}>
        <Txt variant="display" style={styles.h}>
          Who are you?
        </Txt>
        <Txt variant="body" tone="secondary" style={styles.sub}>
          This is what the people you connect with will see.
        </Txt>
        <TextField label="Your name" placeholder="Alex" value={name} onChangeText={setName} autoCapitalize="words" />
        {verified && phone ? (
          <View style={styles.verifiedLine}>
            <Icon name="verified" size={16} color={colors.primaryBright} />
            <Txt variant="caption" tone="secondary">
              Verified number {phone.slice(0, 3)}••••{phone.slice(-2)} — only you can see it.
            </Txt>
          </View>
        ) : null}
      </Reveal>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  cancelAdd: {position: 'absolute', left: spacing.lg, zIndex: 50},
  flex: {flex: 1, backgroundColor: colors.bg},
  scene: {position: 'absolute', left: 0, right: 0, alignItems: 'center'},
  slideText: {position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: 232, gap: spacing.sm},
  welcomeFoot: {position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: spacing.xxl, gap: spacing.xs},
  dots: {flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: spacing.lg},
  dot: {height: 8, borderRadius: 4, backgroundColor: colors.primary},
  skipGap: {height: 44},
  logoRow: {alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xl},
  h: {marginBottom: spacing.sm},
  sub: {marginBottom: spacing.xl},
  opt: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md, borderWidth: 1.5},
  optOn: {borderColor: colors.primary, backgroundColor: colors.primaryDim},
  optIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: "transparent", alignItems: 'center', justifyContent: 'center'},
  optText: {flex: 1, gap: 2},
  radio: {width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center'},
  radioOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  verifiedCard: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderColor: colors.primary},
  foot: {marginTop: spacing.lg},
  progress: {flexDirection: 'row', gap: spacing.xs, marginTop: spacing.lg},
  tick: {flex: 1, height: 4, borderRadius: radius.pill},
  tickOn: {backgroundColor: colors.primary},
  tickOff: {backgroundColor: colors.glassStrong},
  permHero: {alignItems: 'center', marginTop: spacing.xxxl, marginBottom: spacing.xxl},
  permCircle: {width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  note: {marginTop: spacing.sm},
  cameraBadge: {position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg},
  verifiedLine: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -spacing.sm},
}));
