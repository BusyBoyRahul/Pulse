import React, {useState} from 'react';
import {KeyboardAvoidingView, Platform, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Screen, Button, Txt, TextField, PulseLogo} from '@/components';
import {colors, spacing} from '@/theme/theme';
import authService from '@/services/authService';
import {useSessionStore} from '@/store/sessionStore';

type Stage = 'phone' | 'code';

export default function AuthScreen() {
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('+1');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);

  const nav = useNavigation();
  const linkCloudAccount = useSessionStore(s => s.linkCloudAccount);

  const requestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await authService.requestOtp(phone.trim());
      setDevMode(res.devMode);
      setStage('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await authService.verifyOtp(phone.trim(), code.trim(), name.trim() || undefined);
      linkCloudAccount(res.token, res.user.id, res.user.phone);
      nav.goBack(); // optional cloud backup linked — return to the app
      return;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        footer={
          stage === 'phone' ? (
            <Button
              label="Send code"
              onPress={requestCode}
              loading={busy}
              disabled={phone.trim().length < 8}
            />
          ) : (
            <View>
              <Button
                label="Verify & continue"
                onPress={verify}
                loading={busy}
                disabled={code.trim().length < 4}
              />
              <Button label="Change number" variant="ghost" onPress={() => setStage('phone')} />
            </View>
          )
        }>
        <View style={styles.hero}>
          <PulseLogo size={96} />
          <Txt variant="title" center style={styles.brand}>
            Pulse
          </Txt>
        </View>

        {stage === 'phone' ? (
          <>
            <Txt variant="heading" style={styles.h}>
              Verify your phone
            </Txt>
            <Txt variant="body" tone="secondary" style={styles.sub}>
              We text you a one-time code. Your number is how your trusted circle
              recognizes an alert from you.
            </Txt>
            <TextField
              label="Your name (optional)"
              placeholder="Alex"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <TextField
              label="Phone number"
              placeholder="+15551234567"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              hint="Include your country code, e.g. +1."
            />
          </>
        ) : (
          <>
            <Txt variant="heading" style={styles.h}>
              Enter the code
            </Txt>
            <Txt variant="body" tone="secondary" style={styles.sub}>
              Sent to {phone.trim()}.
            </Txt>
            <TextField
              label="6-digit code"
              placeholder="123456"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              maxLength={8}
            />
            {devMode ? (
              <Txt variant="caption" tone="accent" style={styles.dev}>
                Dev mode: use code 000000
              </Txt>
            ) : null}
            <Button label="Resend code" variant="ghost" onPress={requestCode} />
          </>
        )}

        {error ? (
          <Txt variant="caption" tone="danger" style={styles.err}>
            {error}
          </Txt>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1, backgroundColor: colors.bg},
  hero: {alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xxl},
  brand: {marginTop: spacing.md},
  h: {marginBottom: spacing.sm},
  sub: {marginBottom: spacing.xl},
  dev: {marginTop: -spacing.sm, marginBottom: spacing.sm},
  err: {marginTop: spacing.md},
});
