import React from 'react';
import {Linking, StyleSheet} from 'react-native';

import {Screen, Txt, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {notifier} from '@/services/notifier';

export default function SettingsCallsScreen() {
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingLabel>INCOMING CALLS</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="phone"
          title="Allow calls"
          subtitle={app.allowCalls ? 'People you’re connected to can ring you' : 'All calls are declined automatically'}
          toggle={{value: app.allowCalls, onChange: v => setApp({allowCalls: v})}}
        />
        <SettingRow icon="phone" title="Call ringtone" subtitle="Choose the sound in Android settings" onPress={() => notifier.openSystemSettings('calls')} />
      </SettingGroup>

      <SettingLabel>DURING A CALL</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="speaker"
          title="Start on loudspeaker"
          toggle={{value: app.callSpeaker, onChange: v => setApp({callSpeaker: v})}}
        />
      </SettingGroup>

      <SettingLabel>PERMISSIONS</SettingLabel>
      <SettingGroup>
        <SettingRow icon="mic" title="Microphone" subtitle="Needed to talk. Manage it in Android settings" onPress={() => Linking.openSettings()} />
      </SettingGroup>

      <Txt variant="caption" tone="muted" style={styles.note}>
        Calls use Pulse, not phone numbers, and are end-to-end encrypted. They work over Bluetooth / Wi-Fi, including through other people’s phones. You can also allow or block calls for one person from their profile.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {marginTop: spacing.lg, paddingHorizontal: spacing.xs},
});
