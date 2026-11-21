import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Screen, Button, Txt, Card, HoldButton, StatusPill, ProfileButton, Icon} from '@/components';
import {colors, spacing} from '@/theme/theme';
import config from '@/config';
import type {AppNavigation} from '@/navigation/types';
import {useSosStore} from '@/store/sosStore';
import {useMeshStore} from '@/mesh/meshStore';
import {usePeersStore} from '@/store/peersStore';
import {useContactsStore} from '@/store/contactsStore';
import {requestLocation} from '@/services/permissions';

export default function SOSScreen() {
  const nav = useNavigation<AppNavigation>();
  const {state, countdownMs, fix, error, smsResult, beginCountdown, cancel, reset} = useSosStore();
  const devices = useMeshStore(s => s.devices);
  // Same count the Nearby tab shows (identified people), so the two screens never disagree.
  const nearbyCount = usePeersStore(s => Object.keys(s.peers).length);
  const contacts = useContactsStore(s => s.contacts);
  const hasContacts = contacts.length > 0;

  // Ask for location up front (not mid-emergency) so an SOS carries it the instant it's triggered.
  useFocusEffect(
    useCallback(() => {
      void requestLocation();
    }, []),
  );

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
    const openedCount = smsResult?.opened ?? 0;
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
            <Icon name="check" size={48} color={colors.success} strokeWidth={2.6} />
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
              : openedCount > 0
              ? '. Your messages app is open with the SOS text ready — tap Send.'
              : '.'}
            {failedCount > 0 ? ` ${failedCount} text${failedCount === 1 ? '' : 's'} couldn’t go through.` : ''}
          </Txt>
          <Card style={styles.honest} raised>
            <Txt variant="caption" tone="muted" center>
              Nearby phones will see your alert and location. The text goes over
              cell signal, no internet needed. If you can, call your local
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
    <Screen style={{paddingHorizontal: spacing.lg}}>
      <View style={styles.top}>
        <View style={styles.who}>
          <ProfileButton />
          <Txt variant="title">Emergency</Txt>
        </View>
        <StatusPill
          label={`${nearbyCount} nearby`}
          tone={nearbyCount > 0 ? 'online' : 'idle'}
        />
      </View>
      <Txt variant="body" tone="secondary" style={styles.intro}>
        Alerts nearby phones and your trusted contacts.
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

const styles = themedStyles(() => StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 64,
  },
  intro: {marginTop: spacing.md},
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
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
}));
