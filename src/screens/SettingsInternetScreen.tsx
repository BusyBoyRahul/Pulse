import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, View} from 'react-native';

import {Screen, Txt, Card, Icon, IconName, Pressy, Reveal, SettingLabel, TextField} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {useNetStore} from '@/net/netStore';
import {DEFAULT_RELAYS} from '@/net/nostr';

type Mode = 'off' | 'whenOpen' | 'always';

const MODES: {key: Mode; icon: IconName; title: string; body: string}[] = [
  {key: 'always', icon: 'globe', title: 'Always connected', body: 'Stays connected as long as Android lets Pulse run in the background. No permanent notification. If Android pauses Pulse, waiting messages arrive when you open it.'},
  {key: 'whenOpen', icon: 'phone', title: 'Only when Pulse is open', body: 'No battery cost in the background. You get messages when you open Pulse; people’s messages wait for you.'},
  {key: 'off', icon: 'radar', title: 'Off — Bluetooth and Wi-Fi only', body: 'Pulse never touches the internet. Works only with people near you.'},
];

/** Internet use: when Pulse connects, which public relays help phones find each other, and an optional relay server for strict networks. */
export default function SettingsInternetScreen() {
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const relays = useNetStore(s => s.relays);
  const linked = useNetStore(s => s.linked.length);
  const on = relays > 0;

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <Reveal>
        <Card style={styles.status} glowing={on}>
          <View style={[styles.dot, {backgroundColor: on ? colors.meshOnline : colors.textMuted}]} />
          <View style={styles.statusText}>
            <Txt variant="bodyStrong">{on ? 'Connected to the internet' : app.internetMode === 'off' ? 'Internet is off' : 'Not connected right now'}</Txt>
            <Txt variant="caption" tone="muted">
              {on ? `${relays} relay${relays === 1 ? '' : 's'} · ${linked} live direct link${linked === 1 ? '' : 's'}` : 'Messages still travel over Bluetooth and Wi-Fi.'}
            </Txt>
          </View>
        </Card>
      </Reveal>

      <Txt variant="label" tone="muted" style={styles.section}>
        WHEN TO CONNECT
      </Txt>
      {MODES.map((m, i) => {
        const sel = app.internetMode === m.key;
        return (
          <Reveal key={m.key} index={i}>
            <Pressy onPress={() => setApp({internetMode: m.key})} accessibilityRole="button" accessibilityState={{selected: sel}} accessibilityLabel={m.title} scaleTo={0.985}>
              <Card style={[styles.mode, sel && styles.modeOn]}>
                <View style={[styles.modeIcon, sel && {backgroundColor: colors.primary}]}>
                  <Icon name={m.icon} size={20} color={sel ? colors.onPrimary : colors.textSecondary} />
                </View>
                <View style={styles.modeText}>
                  <Txt variant="bodyStrong">{m.title}</Txt>
                  <Txt variant="caption" tone="muted">
                    {m.body}
                  </Txt>
                </View>
                <View style={[styles.radio, sel && styles.radioOn]}>{sel ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3.2} /> : null}</View>
              </Card>
            </Pressy>
          </Reveal>
        );
      })}

      <Txt variant="caption" tone="muted" style={styles.privacy}>
        Relays only help phones find each other and can’t read anything. People you chat with can see your internet address while connected.
      </Txt>

      <SettingLabel>ADVANCED</SettingLabel>
      <Card>
        <TextField
          label="Public relays"
          placeholder={DEFAULT_RELAYS.join('  ')}
          value={app.relays}
          onChangeText={t => setApp({relays: t})}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          hint="Addresses starting with wss://, separated by spaces. Leave empty to use the built-in ones."
        />
        <TextField label="Relay server for strict networks (TURN)" placeholder="turn:example.com:3478" value={app.turnUrl} onChangeText={t => setApp({turnUrl: t})} autoCapitalize="none" autoCorrect={false} hint="Optional. For networks that block direct links." />
        {app.turnUrl.trim() ? (
          <>
            <TextField label="TURN username" value={app.turnUser} onChangeText={t => setApp({turnUser: t})} autoCapitalize="none" autoCorrect={false} />
            <TextField label="TURN password" value={app.turnPass} onChangeText={t => setApp({turnPass: t})} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  status: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md},
  dot: {width: 12, height: 12, borderRadius: 6},
  statusText: {flex: 1, gap: 2},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs},
  mode: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, borderWidth: 1.5},
  modeOn: {borderColor: colors.primary, backgroundColor: colors.primaryDim},
  modeIcon: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center'},
  modeText: {flex: 1, gap: 2},
  radio: {width: 24, height: 24, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center'},
  radioOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  privacy: {marginTop: spacing.md},
}));
