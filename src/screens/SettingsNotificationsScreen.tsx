import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {Screen, Txt, Button, Sheet, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {notifier} from '@/services/notifier';

/** "10:30 PM" from minutes after midnight. */
function clock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m < 10 ? '0' : ''}${m} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const TIMES = Array.from({length: 48}, (_, i) => i * 30);

export default function SettingsNotificationsScreen() {
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const [allowed, setAllowed] = useState(true);
  const [picking, setPicking] = useState<'quietFrom' | 'quietTo' | null>(null);

  // Re-check when coming back from Android's own settings.
  useFocusEffect(
    useCallback(() => {
      void notifier.enabled().then(setAllowed);
    }, []),
  );

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {!allowed ? (
        <View style={styles.warn}>
          <Txt variant="bodyStrong">Notifications are turned off for Pulse</Txt>
          <Txt variant="caption" tone="secondary" style={styles.warnSub}>
            Android is blocking them, so you won’t hear about messages, calls or SOS alerts while the app is closed.
          </Txt>
          <Button label="Turn on in Android settings" onPress={() => notifier.openSystemSettings(null)} />
        </View>
      ) : null}

      <SettingLabel>MESSAGES</SettingLabel>
      <SettingGroup>
        <SettingRow icon="bell" title="Message notifications" toggle={{value: app.notifyMessages, onChange: v => setApp({notifyMessages: v})}} />
        <SettingRow
          icon="eye"
          title="Show message text"
          subtitle={app.notifyPreview ? 'Notifications show what was written' : 'Notifications only say “New message”'}
          disabled={!app.notifyMessages}
          toggle={{value: app.notifyPreview, onChange: v => setApp({notifyPreview: v})}}
        />
        <SettingRow
          icon="speaker"
          title="Sound & vibration"
          subtitle="Off = notifications arrive silently"
          disabled={!app.notifyMessages}
          toggle={{value: app.notifyAlert, onChange: v => setApp({notifyAlert: v})}}
        />
      </SettingGroup>

      <SettingLabel>CONNECT REQUESTS & GROUP INVITES</SettingLabel>
      <SettingGroup>
        <SettingRow icon="users" title="Notify me" toggle={{value: app.notifyRequests, onChange: v => setApp({notifyRequests: v})}} />
      </SettingGroup>

      <SettingLabel>QUIET HOURS</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="moon"
          title="Silence notifications at night"
          subtitle="SOS alerts and calls always ring through"
          toggle={{value: app.quietOn, onChange: v => setApp({quietOn: v})}}
        />
        <SettingRow title="From" value={clock(app.quietFrom)} disabled={!app.quietOn} onPress={() => setPicking('quietFrom')} />
        <SettingRow title="Until" value={clock(app.quietTo)} disabled={!app.quietOn} onPress={() => setPicking('quietTo')} />
      </SettingGroup>

      <SettingLabel>SOUNDS (ANDROID SETTINGS)</SettingLabel>
      <SettingGroup>
        <SettingRow icon="chat" title="Message sound" onPress={() => notifier.openSystemSettings('messages')} />
        <SettingRow icon="sos" title="SOS alert sound" onPress={() => notifier.openSystemSettings('sos')} />
        <SettingRow icon="phone" title="Call ringtone" onPress={() => notifier.openSystemSettings('calls')} />
        <SettingRow icon="users" title="Requests & invites sound" onPress={() => notifier.openSystemSettings('requests')} />
      </SettingGroup>

      <SettingLabel>TRY IT</SettingLabel>
      <SettingGroup>
        <SettingRow icon="chat" title="Send a test message notification" onPress={() => notifier.test('message')} noChevron />
        <SettingRow icon="sos" title="Send a test SOS alert" onPress={() => notifier.test('sos')} noChevron />
        <SettingRow icon="users" title="Send a test connect request" onPress={() => notifier.test('request')} noChevron />
      </SettingGroup>
      <Txt variant="caption" tone="muted" style={styles.note}>
        Notifications appear in your phone’s notification bar and on the lock screen, even when Pulse is closed (as long as the mesh is on).
      </Txt>

      <Sheet visible={picking !== null} onClose={() => setPicking(null)} title={picking === 'quietFrom' ? 'Quiet from' : 'Quiet until'} scroll>
        {TIMES.map(t => {
          const selected = picking !== null && app[picking] === t;
          return (
            <Pressable
              key={t}
              style={[styles.time, selected && styles.timeOn]}
              onPress={() => {
                if (picking) {
                  setApp({[picking]: t});
                }
                setPicking(null);
              }}>
              <Txt variant="body" style={selected ? {color: colors.onPrimary} : undefined}>
                {clock(t)}
              </Txt>
            </Pressable>
          );
        })}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {backgroundColor: colors.dangerDim, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg, gap: spacing.sm},
  warnSub: {marginBottom: spacing.sm},
  note: {marginTop: spacing.md, paddingHorizontal: spacing.xs},
  time: {paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md},
  timeOn: {backgroundColor: colors.primary},
});
