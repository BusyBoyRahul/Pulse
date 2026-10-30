import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Screen, Button, Txt, Card, TextField, PulseLogo, Avatar, Icon} from '@/components';
import {colors, spacing, radius} from '@/theme/theme';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {pickProfilePhoto} from '@/services/imagePicker';
import {isValidOptionalPhone, normalizeOptionalPhone} from '@/services/privacy';
import {
  requestNotifications,
  requestBluetooth,
  requestLocation,
  PermissionResult,
} from '@/services/permissions';

type StepKind = 'intro' | 'how' | 'honest' | 'perm' | 'profile';

type Step = {
  kind: StepKind;
  title: string;
  body: string;
  cta: string;
  permKey?: 'notifications' | 'bluetooth' | 'location';
  request?: () => Promise<PermissionResult>;
};

const STEPS: Step[] = [
  {
    kind: 'intro',
    title: 'Help travels, even with no signal',
    body: 'Pulse turns nearby phones into a relay network. Send a message, make a call or raise an SOS — it hops phone to phone, even to someone who is out of your own range.',
    cta: 'How it works',
  },
  {
    kind: 'how',
    title: 'A mesh, not a tower',
    body: 'Your phone quietly connects to other Pulse phones over Bluetooth and Wi-Fi. If you can reach Sam and Sam can reach Alex, you can reach Alex — encrypted end to end, so the phone in the middle cannot read a thing.',
    cta: 'Continue',
  },
  {
    kind: 'honest',
    title: "Honest about the limits",
    body: 'Delivery depends on how many Pulse phones are around you. Messages wait on a relay phone until the person comes into reach, then arrive with a delivery tick. Android only for now. Pulse is a strong backup, not a replacement for calling emergency services when you can.',
    cta: 'I understand',
  },
  {
    kind: 'perm',
    permKey: 'notifications',
    title: 'Stay in the loop',
    body: 'Allow notifications so Pulse can keep relaying in the background and ring you when someone calls.',
    cta: 'Allow notifications',
    request: requestNotifications,
  },
  {
    kind: 'perm',
    permKey: 'bluetooth',
    title: 'Join the mesh',
    body: 'Bluetooth and nearby-device access let Pulse find phones around you and pass things along. Pulse never reads what it relays.',
    cta: 'Enable Bluetooth',
    request: requestBluetooth,
  },
  {
    kind: 'perm',
    permKey: 'location',
    title: 'Pinpoint your SOS',
    body: 'Your location is attached to an SOS so responders and your circle know where to find you. It is only shared when you trigger an alert.',
    cta: 'Allow location',
    request: requestLocation,
  },
  {
    kind: 'profile',
    title: 'Who are you?',
    body: "This stays on your phone. Your name is what people nearby see. A phone number is optional and is never shared — chats and calls use Pulse, not your number. No account, no sign-in, no internet.",
    cta: 'Enter Pulse',
  },
];

export default function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarThumb, setAvatarThumb] = useState<string | null>(null);
  const setupLocalProfile = useSessionStore(s => s.setupLocalProfile);

  const step = STEPS[index];
  const isProfile = step.kind === 'profile';

  const pickPhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setAvatar(picked.uri);
      setAvatarThumb(picked.thumb);
    }
  };

  const finish = () => {
    getIdentity(); // ensure the device mesh identity exists
    setupLocalProfile(name.trim(), normalizeOptionalPhone(phone), avatar ? {uri: avatar, thumb: avatarThumb} : null);
  };

  const next = async () => {
    if (step.request) {
      setBusy(true);
      try {
        await step.request(); // proceed regardless — can be granted later in Settings
      } finally {
        setBusy(false);
      }
    }
    if (isProfile) {
      finish();
    } else {
      setIndex(i => i + 1);
    }
  };

  const skip = () => setIndex(i => i + 1);

  const profileValid = name.trim().length > 0 && isValidOptionalPhone(phone);

  return (
    <Screen
      scroll
      footer={
        <View>
          <Button
            label={step.cta}
            onPress={next}
            loading={busy}
            disabled={isProfile && !profileValid}
          />
          {step.kind === 'perm' ? (
            <Button label="Not now" variant="ghost" onPress={skip} />
          ) : null}
        </View>
      }>
      <View style={styles.progress}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.tick, i <= index ? styles.tickOn : styles.tickOff]} />
        ))}
      </View>

      <View style={styles.hero}>
        {isProfile ? (
          <Pressable onPress={pickPhoto} style={styles.avatarWrap}>
            <Avatar name={name || 'You'} uri={avatar} seed={getIdentity().publicKey} size={104} ring />
            <View style={styles.cameraBadge}>
              <Icon name="camera" size={16} color={colors.onPrimary} />
            </View>
          </Pressable>
        ) : (
          <PulseLogo
            size={132}
            animated={step.kind !== 'honest'}
            color={step.kind === 'honest' ? colors.textSecondary : colors.primary}
          />
        )}
      </View>

      <Txt variant="display" style={styles.title}>
        {step.title}
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.body}>
        {step.body}
      </Txt>

      {isProfile ? (
        <View style={styles.form}>
          <TextField
            label="Your name"
            placeholder="Alex"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <TextField
            label="Phone number (optional)"
            placeholder="Leave blank to stay private"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            hint="Optional. Encrypted on this phone, never sent to anyone."
          />
        </View>
      ) : step.kind === 'perm' ? (
        <Card style={styles.note} raised>
          <Txt variant="caption" tone="muted">
            You can change this anytime in Settings. Pulse asks for one thing at a
            time and explains why first.
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: {flexDirection: 'row', gap: spacing.xs, marginTop: spacing.lg},
  tick: {flex: 1, height: 4, borderRadius: radius.pill},
  tickOn: {backgroundColor: colors.primary},
  tickOff: {backgroundColor: colors.border},
  hero: {alignItems: 'center', marginTop: spacing.xxxl, marginBottom: spacing.xxl},
  avatarWrap: {},
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  title: {marginBottom: spacing.md},
  body: {marginBottom: spacing.xl},
  form: {marginTop: spacing.sm},
  note: {marginTop: spacing.sm},
});
