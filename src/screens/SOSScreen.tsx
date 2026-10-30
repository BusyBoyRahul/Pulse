import React, {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Screen, Button, Txt, Card, HoldButton, StatusPill} from '@/components';
import {colors, spacing} from '@/theme/theme';
import config from '@/config';
import type {AppNavigation} from '@/navigation/types';
import {useSosStore} from '@/store/sosStore';
import {useMeshStore} from '@/mesh/meshStore';
import {useContactsStore} from '@/store/contactsStore';
import {requestSms, requestLocation} from '@/services/permissions';

export default function SOSScreen() {
  const nav = useNavigation<AppNavigation>();
  const {state, countdownMs, fix, error, smsResult, beginCountdown, cancel, reset} = useSosStore();
  const devices = useMeshStore(s => s.devices);
  const contacts = useContactsStore(s => s.contacts);
  const hasContacts = contacts.length > 0;

  // Ask for SMS + location up front (not mid-emergency) so an SOS can text
  // contacts from the SIM, with a location, the instant it's triggered.
  useEffect(() => {
    void requestSms();
    void requestLocation();
  }, []);

  // Leave the screen in a clean state when it unmounts.
  useEffect(() => () => reset(), [reset]);

  const seconds = Math.ceil(countdownMs / 1000);

  if (state === 'countdown') {
    return (
      <Screen
        footer={<Button label={`Cancel (${seconds}s)`} variant="secondary" onPress={cancel} />}>
        <View style={styles.center}>
          <Txt variant="label" tone="danger">
            SENDING SOS
          </Txt>
          <Txt style={styles.count} tone="danger">
            {seconds}
          </Txt>
          <Txt variant="body" tone="secondary" center style={styles.msg}>
            Hold tight — your alert goes out in {seconds} second{seconds === 1 ? '' : 's'}.
            Cancel now if this was an accident.
          </Txt>
          <StatusPill
            label={fix ? 'Location locked' : 'Getting location…'}
            tone={fix ? 'online' : 'idle'}
          />
        </View>
      </Screen>
    );
  }

  if (state === 'sent') {
    const sentCount = smsResult?.sent ?? 0;
    const failedCount = smsResult?.failed ?? 0;
    return (
      <Screen
        footer={
          <View>
            <Button label="I'm safe — stand down" variant="secondary" onPress={cancel} />
            <Button label="Back to home" variant="ghost" onPress={() => nav.goBack()} />
          </View>
        }>
        <View style={styles.center}>
          <View style={styles.sentBadge}>
            <Txt variant="display" tone="success">
              ✓
            </Txt>
          </View>
          <Txt variant="title" center style={styles.msg}>
            SOS sent
          </Txt>
          <Txt variant="body" tone="secondary" center>
            {devices.length > 0
              ? `Alerting ${devices.length} nearby phone${devices.length === 1 ? '' : 's'}`
              : 'Broadcasting to any Pulse phone that comes into range'}
            {sentCount > 0
              ? ` and texted ${sentCount} contact${sentCount === 1 ? '' : 's'}${fix ? ' with your location' : ''}.`
              : '.'}
            {failedCount > 0 ? ` ${failedCount} text${failedCount === 1 ? '' : 's'} couldn’t go through.` : ''}
          </Txt>
          <Card style={styles.honest} raised>
            <Txt variant="caption" tone="muted" center>
              Nearby phones will see your alert and location. Texts also go over
              cell signal — no internet needed. If you can, call your local
              emergency number too.
            </Txt>
          </Card>
        </View>
      </Screen>
    );
  }

  if (state === 'failed') {
    return (
      <Screen
        footer={
          <View>
            {hasContacts ? (
              <Button label="Try again" onPress={() => beginCountdown()} />
            ) : (
              <Button label="Add a trusted contact" onPress={() => nav.navigate('TrustedCircle')} />
            )}
            <Button label="Back to home" variant="ghost" onPress={() => reset()} />
          </View>
        }>
        <View style={styles.center}>
          <View style={[styles.sentBadge, styles.failBadge]}>
            <Txt variant="display" tone="danger">
              !
            </Txt>
          </View>
          <Txt variant="title" center style={styles.msg}>
            SOS didn’t send
          </Txt>
          <Txt variant="body" tone="secondary" center>
            {error ?? 'Your alert couldn’t reach anyone.'}
          </Txt>
        </View>
      </Screen>
    );
  }

  // idle / cancelled
  return (
    <Screen
      footer={
        <Txt variant="caption" tone="muted" center>
          Press and hold for 3 seconds to send.
        </Txt>
      }>
      <View style={styles.top}>
        <Txt variant="title">Emergency</Txt>
        <StatusPill
          label={`${devices.length} nearby`}
          tone={devices.length > 0 ? 'online' : 'idle'}
        />
      </View>
      <Txt variant="body" tone="secondary" style={styles.intro}>
        Holding SOS alerts every Pulse phone around you — showing who you are and
        where — so people nearby can help. It also texts your trusted contacts if
        you've added any.
      </Txt>

      <View style={styles.holdWrap}>
        <HoldButton
          label="SOS"
          sublabel="hold 3s"
          holdMs={config.sosHoldMs}
          onComplete={() => beginCountdown()}
          color={colors.danger}
        />
      </View>

      {!hasContacts ? (
        <Button
          label="Add trusted contacts (optional)"
          variant="ghost"
          onPress={() => nav.navigate('TrustedCircle')}
          style={styles.addBtn}
        />
      ) : null}

      {error ? (
        <Txt variant="caption" tone="danger" center>
          {error}
        </Txt>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  intro: {marginTop: spacing.md},
  holdWrap: {alignItems: 'center', marginTop: spacing.xl},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  count: {fontSize: 96, fontWeight: '800', lineHeight: 104},
  msg: {marginVertical: spacing.lg},
  sentBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  failBadge: {backgroundColor: colors.dangerDim},
  addBtn: {marginTop: spacing.xl, alignSelf: 'stretch'},
  honest: {marginTop: spacing.xl},
});
