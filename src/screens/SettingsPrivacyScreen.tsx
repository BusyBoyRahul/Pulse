import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Sheet, Icon, PinFlow, PinFlowMode, AudienceSheet, Choice, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSettingsStore, Audience} from '@/store/settingsStore';
import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';
import {useLockStore, AUTO_LOCK_CHOICES, LockKind} from '@/store/lockStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PROFILE_CHOICES: Choice<Audience>[] = [
  {key: 'everyone', label: 'Everyone', note: 'Your connections, wherever they are, and anyone close to you who uses Pulse'},
  {key: 'connections', label: 'My connections', note: 'Only people you are connected to — sent privately, never shown to strangers'},
  {key: 'nobody', label: 'Nobody', note: 'People only see your name'},
];
const NEARBY_CHOICES: Choice<'everyone' | 'nobody'>[] = [
  {key: 'everyone', label: 'Visible', note: 'People close to you see you in Nearby and can send a connect request'},
  {key: 'nobody', label: 'Hidden', note: 'New people cannot see you or send a request. People you are connected to can still message you'},
];
const CALL_CHOICES: Choice<'connections' | 'nobody'>[] = [
  {key: 'connections', label: 'My connections', note: 'People you are connected to can ring you'},
  {key: 'nobody', label: 'Nobody', note: 'Every call is declined automatically'},
];

const audienceText = (a: Audience) => (a === 'everyone' ? 'Everyone' : a === 'connections' ? 'My connections' : 'Nobody');

type Which = null | 'photo' | 'about' | 'nearby' | 'calls';

/** Who can see my profile, who can reach me, how messages behave, and how the app is locked. */
export default function SettingsPrivacyScreen() {
  const nav = useNavigation<Nav>();
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const prefs = usePrefsStore(s => s.prefs);
  const paired = usePairingStore(s => s.paired);
  const blockedCount = Object.values(prefs).filter(p => p.blocked).length;
  const hiddenStatus = paired.filter(p => prefs[p.publicKey]?.hideStatus).length;
  const appLock = useLockStore(s => s.saved.app);
  const bioAvailable = useLockStore(s => s.bioAvailable);
  const lock = useLockStore.getState();
  const [flow, setFlow] = useState<{kind: LockKind; mode: PinFlowMode} | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [which, setWhich] = useState<Which>(null);

  const nearby: 'everyone' | 'nobody' = app.discoverable || app.acceptRequests ? 'everyone' : 'nobody';
  const calls: 'connections' | 'nobody' = app.allowCalls ? 'connections' : 'nobody';
  const timeLabel = AUTO_LOCK_CHOICES.find(c => c.ms === appLock?.autoLockMs)?.label ?? 'After 1 minute';
  const findMe = [app.findByUsername && app.username ? `@${app.username}` : null, app.findByNumber ? 'number' : null].filter(Boolean).join(' · ') || 'Off';

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingLabel>WHO CAN SEE MY PERSONAL INFO</SettingLabel>
      <SettingGroup>
        <SettingRow icon="image" title="Profile photo" value={audienceText(app.photoAudience)} onPress={() => setWhich('photo')} />
        <SettingRow icon="edit" title="About" value={audienceText(app.aboutAudience)} onPress={() => setWhich('about')} />
        <SettingRow icon="status" title="Status" value={app.statusAudience === 'only' ? 'Selected people' : app.statusAudience === 'except' ? `Except ${hiddenStatus}` : 'My connections'} onPress={() => nav.navigate('StatusPrivacy')} />
      </SettingGroup>

      <SettingLabel>WHO CAN REACH ME</SettingLabel>
      <SettingGroup>
        <SettingRow icon="radar" title="Show me in Nearby" value={nearby === 'everyone' ? 'Visible' : 'Hidden'} onPress={() => setWhich('nearby')} />
        <SettingRow icon="at" title="Find me by username or number" value={findMe} onPress={() => nav.navigate('MyCode')} />
        <SettingRow icon="phone" title="Calls" value={audienceText(calls)} onPress={() => setWhich('calls')} />
      </SettingGroup>

      <SettingLabel>MESSAGES</SettingLabel>
      <SettingGroup>
        <SettingRow icon="verified" title="Read receipts" subtitle="Show when you’ve read messages. Off = you won’t see theirs" toggle={{value: app.readReceipts, onChange: v => setApp({readReceipts: v})}} />
        <SettingRow icon="edit" title="Typing indicator" subtitle="Show “typing…” to your chats, and see theirs" toggle={{value: app.typingIndicator, onChange: v => setApp({typingIndicator: v})}} />
      </SettingGroup>

      <SettingLabel>APP LOCK</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="lock"
          title="App lock"
          subtitle="Ask for your PIN when you open Pulse"
          toggle={{value: !!appLock, onChange: v => setFlow({kind: 'app', mode: v ? 'set' : 'remove'})}}
        />
        {appLock ? (
          <>
            <SettingRow icon="clock" title="Lock the app" value={timeLabel} onPress={() => setTimeOpen(true)} />
            {bioAvailable ? <SettingRow icon="fingerprint" title="Use fingerprint or face" toggle={{value: appLock.biometric, onChange: v => lock.setBiometric('app', v)}} /> : null}
            <SettingRow icon="key" title="Change PIN" onPress={() => setFlow({kind: 'app', mode: 'change'})} />
          </>
        ) : null}
      </SettingGroup>

      <SettingLabel>CHAT LOCK</SettingLabel>
      <SettingGroup>
        {/* The same plain row whether or not chat lock is used, so Settings never shows that chats are locked or hidden.
            The settings behind it ask for the chat code first. */}
        <SettingRow icon="chat" title="Chat lock" subtitle="Lock and hide chats" onPress={() => nav.navigate('SettingsChatLock')} />
      </SettingGroup>

      <SettingLabel>THIS PHONE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="eyeOff" title="Hide Pulse in screenshots & recent apps" subtitle="Screens go black in the app switcher and can’t be captured" toggle={{value: app.secureScreen, onChange: v => setApp({secureScreen: v})}} />
        <SettingRow icon="ban" title="Blocked people" value={blockedCount ? String(blockedCount) : 'None'} onPress={() => nav.navigate('Blocked')} />
      </SettingGroup>

      <Txt variant="caption" tone="muted" style={styles.note}>
        Chats and calls are end-to-end encrypted.
      </Txt>

      <AudienceSheet visible={which === 'photo'} onClose={() => setWhich(null)} title="Who can see my profile photo" intro="Your name is always visible, so people know who you are." choices={PROFILE_CHOICES} value={app.photoAudience} onPick={v => setApp({photoAudience: v, shareAvatar: v !== 'nobody'})} />
      <AudienceSheet visible={which === 'about'} onClose={() => setWhich(null)} title="Who can see my about" choices={PROFILE_CHOICES} value={app.aboutAudience} onPick={v => setApp({aboutAudience: v})} />
      <AudienceSheet visible={which === 'nearby'} onClose={() => setWhich(null)} title="Show me in Nearby" choices={NEARBY_CHOICES} value={nearby} onPick={v => setApp({discoverable: v === 'everyone', acceptRequests: v === 'everyone'})} />
      <AudienceSheet visible={which === 'calls'} onClose={() => setWhich(null)} title="Who can call me" intro="You can also allow or block calls for one person from their profile." choices={CALL_CHOICES} value={calls} onPick={v => setApp({allowCalls: v === 'connections'})} />

      <PinFlow visible={!!flow} kind={flow?.kind ?? 'app'} mode={flow?.mode ?? 'set'} onClose={() => setFlow(null)} onDone={() => setFlow(null)} />

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
            {appLock?.autoLockMs === c.ms ? <Icon name="check" size={18} color={colors.text} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  note: {marginTop: spacing.lg, paddingHorizontal: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md},
}));
