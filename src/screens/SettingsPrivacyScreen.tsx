import React, {useState} from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Sheet, Icon, PinFlow, PinFlowMode, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSettingsStore} from '@/store/settingsStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useLockStore, AUTO_LOCK_CHOICES} from '@/store/lockStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsPrivacyScreen() {
  const nav = useNavigation<Nav>();
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const blockedCount = usePrefsStore(s => Object.values(s.prefs).filter(p => p.blocked).length);
  const lockedCount = usePrefsStore(s => Object.values(s.prefs).filter(p => p.locked).length);
  const saved = useLockStore(s => s.saved);
  const bioAvailable = useLockStore(s => s.bioAvailable);
  const lock = useLockStore.getState();
  const [flow, setFlow] = useState<PinFlowMode | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);

  const timeLabel = AUTO_LOCK_CHOICES.find(c => c.ms === saved?.autoLockMs)?.label ?? 'After 1 minute';

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingLabel>WHO CAN FIND YOU</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="radar"
          title="Appear in Nearby"
          subtitle={app.discoverable ? 'People around you can see you and connect' : 'Hidden. People you’re already connected to can still message you'}
          toggle={{value: app.discoverable, onChange: v => setApp({discoverable: v})}}
        />
        <SettingRow
          icon="users"
          title="Accept new connect requests"
          subtitle="Turn off to stop strangers asking to connect"
          toggle={{value: app.acceptRequests, onChange: v => setApp({acceptRequests: v})}}
        />
        <SettingRow icon="image" title="Share my profile photo" toggle={{value: app.shareAvatar, onChange: v => setApp({shareAvatar: v})}} />
      </SettingGroup>

      <SettingLabel>MESSAGES</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="verified"
          title="Read receipts"
          subtitle="Let people see when you’ve opened their message. If off, you won’t see theirs either"
          toggle={{value: app.readReceipts, onChange: v => setApp({readReceipts: v})}}
        />
        <SettingRow
          icon="edit"
          title="Typing indicator"
          subtitle="Show “typing…” to the people you chat with, and see theirs"
          toggle={{value: app.typingIndicator, onChange: v => setApp({typingIndicator: v})}}
        />
      </SettingGroup>

      <SettingLabel>PIN & LOCKS</SettingLabel>
      <SettingGroup>
        {saved ? (
          <>
            <SettingRow icon="lock" title="Lock Pulse with your PIN" subtitle="Nothing shows until the PIN (or fingerprint) is given" toggle={{value: saved.appLock, onChange: v => lock.setAppLock(v)}} />
            <SettingRow icon="clock" title="Lock the app" value={timeLabel} disabled={!saved.appLock} onPress={() => setTimeOpen(true)} />
            {bioAvailable ? (
              <SettingRow icon="fingerprint" title="Use fingerprint or face" toggle={{value: saved.biometric, onChange: v => lock.setBiometric(v)}} />
            ) : null}
            <SettingRow icon="key" title="Change PIN" onPress={() => setFlow('change')} />
            <SettingRow icon="trash" title="Remove PIN" subtitle="Also unlocks every locked chat" danger onPress={() => setFlow('remove')} />
          </>
        ) : (
          <SettingRow icon="lock" title="Set a PIN" subtitle="Needed to lock the whole app or single chats" onPress={() => setFlow('set')} />
        )}
        <SettingRow icon="chat" title="Locked chats" value={lockedCount ? String(lockedCount) : 'None'} subtitle="Open a chat’s profile and turn on “Lock chat”" noChevron />
      </SettingGroup>

      <SettingLabel>THIS PHONE</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="eyeOff"
          title="Hide Pulse in screenshots & recent apps"
          subtitle="Screens go black in the app switcher and can’t be captured"
          toggle={{value: app.secureScreen, onChange: v => setApp({secureScreen: v})}}
        />
        <SettingRow icon="ban" title="Blocked people" value={blockedCount ? String(blockedCount) : 'None'} onPress={() => nav.navigate('Blocked')} />
      </SettingGroup>

      <Txt variant="caption" tone="muted" style={styles.note}>
        Your phone number is optional, stored encrypted on this phone, and never sent to anyone. Chats and calls are end-to-end encrypted.
      </Txt>

      <PinFlow visible={!!flow} mode={flow ?? 'set'} onClose={() => setFlow(null)} onDone={() => setFlow(null)} />

      <Sheet visible={timeOpen} onClose={() => setTimeOpen(false)} title="Lock the app">
        {AUTO_LOCK_CHOICES.map(c => (
          <Pressable
            key={c.ms}
            style={styles.row}
            onPress={() => {
              lock.setAutoLock(c.ms);
              setTimeOpen(false);
            }}>
            <Txt variant="body">{c.label}</Txt>
            {saved?.autoLockMs === c.ms ? <Icon name="check" size={18} color={colors.text} /> : null}
          </Pressable>
        ))}
        <Txt variant="caption" tone="muted" style={{marginTop: spacing.sm}}>
          The app locks after being out of sight for this long. Locked chats lock again after about 15 seconds.
        </Txt>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {marginTop: spacing.lg, paddingHorizontal: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md},
});
