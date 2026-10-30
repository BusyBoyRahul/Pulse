import React, {useCallback, useState} from 'react';
import {Alert, Linking, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSettingsStore} from '@/store/settingsStore';
import {useSessionStore} from '@/store/sessionStore';
import {useMeshStore} from '@/mesh/meshStore';
import {getIdentity, shortId} from '@/services/identity';
import {notifier} from '@/services/notifier';
import type {TransportState} from '@/mesh/transport/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_LABEL: Record<TransportState, string> = {
  idle: 'Idle',
  starting: 'Starting…',
  active: 'On',
  'bluetooth-off': 'Bluetooth off',
  unauthorized: 'Permission needed',
  unsupported: 'Not supported',
  error: 'Unavailable',
};

export default function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const responderMode = useSettingsStore(s => s.responderMode);
  const setResponderMode = useSettingsStore(s => s.setResponderMode);
  const status = useMeshStore(s => s.status);
  const resetProfile = useSessionStore(s => s.resetProfile);
  const [battery, setBattery] = useState<boolean | null>(null);

  // Re-check after the user comes back from Android's battery screen.
  useFocusEffect(
    useCallback(() => {
      void notifier.batteryUnrestricted().then(setBattery);
    }, []),
  );

  const confirmReset = () => {
    Alert.alert(
      'Reset profile?',
      'This clears your name, contacts and profile from this phone. Your mesh id stays the same.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Reset', style: 'destructive', onPress: resetProfile},
      ],
    );
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingLabel>PREFERENCES</SettingLabel>
      <SettingGroup>
        <SettingRow icon="bell" title="Notifications" subtitle="Messages, calls, SOS, quiet hours" onPress={() => nav.navigate('SettingsNotifications')} />
        <SettingRow icon="lock" title="Privacy & security" subtitle="Who finds you, read receipts, blocked people" onPress={() => nav.navigate('SettingsPrivacy')} />
        <SettingRow icon="wallpaper" title="Chats" subtitle="Wallpaper, typing indicator" onPress={() => nav.navigate('SettingsChats')} />
        <SettingRow icon="phone" title="Calls" subtitle="Allow calls, speaker, ringtone" onPress={() => nav.navigate('SettingsCalls')} />
        <SettingRow icon="database" title="Storage & data" subtitle="Photos, chats, free up space" onPress={() => nav.navigate('SettingsStorage')} />
        <SettingRow icon="star" title="Starred messages" onPress={() => nav.navigate('Starred')} />
      </SettingGroup>

      <SettingLabel>EMERGENCY</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="sos"
          title="Nearby SOS alerts"
          subtitle="Alert me — who needs help and where — when someone near me sends an SOS. On by default."
          toggle={{value: responderMode, onChange: setResponderMode}}
        />
        <SettingRow icon="shield" title="Trusted Circle" subtitle="Who gets your SOS text" onPress={() => nav.navigate('TrustedCircle')} />
      </SettingGroup>
      <Txt variant="caption" tone="muted" style={styles.note}>
        An SOS is meant to be seen, so nearby phones can read who needs help and where. Your private chats and pairings stay end-to-end encrypted.
      </Txt>

      <SettingLabel>MESH & BACKGROUND</SettingLabel>
      <SettingGroup>
        <SettingRow icon="bluetooth" title="Mesh network" value={STATUS_LABEL[status] ?? 'Starting…'} onPress={() => Linking.openSettings()} />
        <SettingRow
          icon="battery"
          title="Keep running in the background"
          subtitle={
            battery === null
              ? undefined
              : battery
              ? 'Allowed. Pulse can relay messages with the screen off'
              : 'Android may stop Pulse while the screen is off. Tap to allow'
          }
          value={battery ? 'Allowed' : battery === false ? 'Restricted' : undefined}
          onPress={() => notifier.requestBatteryUnrestricted()}
        />
        <SettingRow icon="settings" title="App permissions" subtitle="Bluetooth, location, microphone, notifications" onPress={() => Linking.openSettings()} />
      </SettingGroup>

      <SettingLabel>THIS DEVICE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="key" title="Your mesh id" subtitle="The short handle other phones see. Never your phone number" value={shortId(getIdentity().publicKey)} noChevron />
        <SettingRow icon="info" title="About Pulse" onPress={() => nav.navigate('About')} />
        <SettingRow icon="trash" title="Reset profile" danger onPress={confirmReset} />
      </SettingGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {marginTop: spacing.md, paddingHorizontal: spacing.xs},
});
