import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';

import {Screen, Button, Txt, Card, Icon, Reveal, HeroScene} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {smsVerify} from '@/services/smsVerify';
import {useSessionStore} from '@/store/sessionStore';
import {alertDialog} from '@/components/Dialog';

type Stage = 'pick' | 'done';

/**
 * Add your phone number with NO server, no typing and no text messages: Android shows a popup of the
 * numbers on this phone and you tap yours. Optional — Pulse works fine without a number.
 */
export default function VerifyPhoneScreen() {
  const nav = useNavigation();
  const [stage, setStage] = useState<Stage>('pick');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    setBusy(true);
    const r = await smsVerify.pick();
    setBusy(false);
    if (r.ok) {
      if (!useSessionStore.getState().markPhoneVerified({phone: r.number})) {
        alertDialog('Number already in use', 'This number is already on another account on this phone. Choose a different number, or continue without one.');
        return;
      }
      setNumber(r.number);
      setStage('done');
    } else if (r.reason === 'none') {
      setError('No number was found on this phone. Some SIM cards do not store their number. You can continue without one.');
    } else if (r.reason === 'unavailable') {
      setError('This needs an Android phone with Google Play services.');
    }
  };

  return (
    <Screen
      scroll
      edges={['left', 'right']}
      bottomClear={false}
      footer={
        stage === 'pick' ? (
          <View style={styles.footer}>
            <Button label="Choose my number" onPress={choose} loading={busy} />
            <Button label="Not now — continue without a number" variant="ghost" onPress={() => nav.goBack()} />
          </View>
        ) : (
          <Button label="Done" onPress={() => nav.goBack()} />
        )
      }>
      <HeroScene kind="verify" height={220} style={styles.hero} />

      {stage === 'pick' ? (
        <Reveal>
          <Txt variant="title" style={styles.h}>
            Add your phone number
          </Txt>
          <Txt variant="body" tone="secondary" style={styles.sub}>
            Optional. Choose it from your phone. Nothing is typed or sent.
          </Txt>
          <Card style={styles.note}>
            <Icon name="info" size={16} color={colors.textMuted} />
            <Txt variant="caption" tone="muted" style={styles.noteTxt}>
              Android shows the numbers on this phone. Tap yours.
            </Txt>
          </Card>
        </Reveal>
      ) : (
        <Reveal kind="pop">
          <Txt variant="title" style={styles.h}>
            Number added
          </Txt>
          <Txt variant="body" tone="secondary" style={styles.sub}>
            {number} is chosen from this phone and gets a badge on your profile.
          </Txt>
        </Reveal>
      )}

      {error ? (
        <Txt variant="caption" tone="danger" style={styles.err}>
          {error}
        </Txt>
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hero: {marginTop: spacing.md, marginBottom: spacing.lg},
  h: {marginBottom: spacing.sm},
  sub: {marginBottom: spacing.xl},
  note: {flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start'},
  noteTxt: {flex: 1},
  err: {marginTop: spacing.md},
  footer: {gap: spacing.xs},
}));
