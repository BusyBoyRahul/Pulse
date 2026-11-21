import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet} from 'react-native';

import {Screen, Txt, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';

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
      </SettingGroup>

      <SettingLabel>DURING A CALL</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="speaker"
          title="Start on loudspeaker"
          toggle={{value: app.callSpeaker, onChange: v => setApp({callSpeaker: v})}}
        />
      </SettingGroup>

      <Txt variant="caption" tone="muted" style={styles.note}>
        Calls are end-to-end encrypted.
      </Txt>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  note: {marginTop: spacing.lg, paddingHorizontal: spacing.xs},
}));
