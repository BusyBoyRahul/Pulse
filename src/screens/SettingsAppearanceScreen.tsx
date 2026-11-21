import {themedStyles} from '@/theme/themed';
import React, {useMemo, useState} from 'react';
import {Appearance, StyleSheet, View} from 'react-native';

import {Screen, Txt, Card, Button, TextField, Icon, IconName, Pressy, Reveal} from '@/components';
import {
  ACCENTS,
  AccentKey,
  DarkStyle,
  ThemeMode,
  ThemePrefs,
  applyThemeLive,
  colors,
  themeInfo,
  radius,
  resolveColors,
  saveThemePrefs,
  spacing,
} from '@/theme/theme';

const MODES: {key: ThemeMode; label: string; note: string; icon: IconName}[] = [
  {key: 'system', label: 'System', note: 'Follows your phone', icon: 'settings'},
  {key: 'light', label: 'Light', note: 'Bright and clean', icon: 'sun'},
  {key: 'dark', label: 'Dark', note: 'Easy on the eyes', icon: 'moon'},
];

const DARKS: {key: DarkStyle; label: string; bg: string}[] = [
  {key: 'midnight', label: 'Midnight', bg: '#070813'},
  {key: 'graphite', label: 'Graphite', bg: '#0B0B0D'},
  {key: 'amoled', label: 'True black', bg: '#000000'},
];

const ACCENT_KEYS = Object.keys(ACCENTS) as Exclude<AccentKey, 'custom'>[];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A little phone showing exactly how the chosen theme will look. */
function Preview({prefs}: {prefs: ThemePrefs}) {
  const sys = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  const r = useMemo(() => resolveColors(prefs, sys), [prefs, sys]);
  const c = r.colors;
  return (
    <View style={[styles.preview, {backgroundColor: c.bg, borderColor: c.border}]}>
      <View style={styles.pvTop}>
        <View style={[styles.pvAvatar, {backgroundColor: c.primary}]} />
        <View>
          <View style={[styles.pvLine, {width: 70, backgroundColor: c.text}]} />
          <View style={[styles.pvLine, {width: 44, backgroundColor: c.textMuted, marginTop: 5}]} />
        </View>
      </View>
      <View style={[styles.pvBubble, {backgroundColor: c.bubbleTheirs, alignSelf: 'flex-start'}]}>
        <View style={[styles.pvLine, {width: 90, backgroundColor: c.textSecondary}]} />
      </View>
      <View style={[styles.pvBubble, {alignSelf: 'flex-end', backgroundColor: c.bubbleMine}]}>
        <View style={[styles.pvLine, {width: 70, backgroundColor: c.onBubbleMine}]} />
      </View>
      <View style={[styles.pvBar, {backgroundColor: c.surfaceRaised, borderColor: c.glassBorder}]}>
        <View style={[styles.pvDot, {backgroundColor: c.primary}]} />
        <View style={[styles.pvDot, {backgroundColor: c.textMuted}]} />
        <View style={[styles.pvDot, {backgroundColor: c.textMuted}]} />
      </View>
    </View>
  );
}

export default function SettingsAppearanceScreen() {
  const saved = themeInfo.prefs;
  const [mode, setMode] = useState<ThemeMode>(saved.mode);
  const [accent, setAccent] = useState<AccentKey>(saved.accent);
  const [custom, setCustom] = useState(saved.custom ?? '#2F8BFF');
  const [dark, setDark] = useState<DarkStyle>(saved.dark);

  const prefs: ThemePrefs = {mode, accent, custom: HEX.test(custom) ? custom : undefined, dark};
  const customOk = accent !== 'custom' || HEX.test(custom);
  const changed = mode !== saved.mode || accent !== saved.accent || dark !== saved.dark || (accent === 'custom' && custom !== saved.custom);

  const apply = () => {
    saveThemePrefs(prefs);
    applyThemeLive(prefs); // the whole app repaints right now; nothing restarts
  };

  return (
    <Screen
      scroll
      edges={['left', 'right']}
      bottomClear={false}
      footer={changed ? <Button label="Apply" onPress={apply} disabled={!customOk} /> : undefined}>
      <Reveal>
        <Preview prefs={prefs} />
      </Reveal>

      <Txt variant="label" tone="muted" style={styles.section}>
        THEME
      </Txt>
      <View style={styles.modes}>
        {MODES.map((m, i) => {
          const on = mode === m.key;
          return (
            <Reveal key={m.key} index={i} style={styles.modeWrap}>
              <Pressy onPress={() => setMode(m.key)} accessibilityRole="button" accessibilityLabel={m.label} accessibilityState={{selected: on}} style={[styles.mode, on && styles.modeOn]}>
                <View style={[styles.modeIcon, on && {backgroundColor: colors.primary}]}>
                  <Icon name={m.icon} size={20} color={on ? colors.onPrimary : colors.textSecondary} />
                </View>
                <Txt variant="bodyStrong">{m.label}</Txt>
                <Txt variant="caption" tone="muted" center>
                  {m.note}
                </Txt>
              </Pressy>
            </Reveal>
          );
        })}
      </View>

      <Txt variant="label" tone="muted" style={styles.section}>
        ACCENT COLOUR
      </Txt>
      <Card style={styles.swatches}>
        {ACCENT_KEYS.map(k => {
          const on = accent === k;
          return (
            <Pressy key={k} onPress={() => setAccent(k)} accessibilityRole="button" accessibilityLabel={ACCENTS[k].label} accessibilityState={{selected: on}} style={styles.swatchWrap}>
              <View style={[styles.swatch, {backgroundColor: ACCENTS[k].a}, on && styles.swatchOn]}>
                {on ? <Icon name="check" size={20} color="#FFFFFF" strokeWidth={3} /> : null}
              </View>
              <Txt variant="caption" tone={on ? 'primary' : 'muted'}>
                {ACCENTS[k].label}
              </Txt>
            </Pressy>
          );
        })}
        <Pressy onPress={() => setAccent('custom')} accessibilityRole="button" accessibilityLabel="Custom colour" accessibilityState={{selected: accent === 'custom'}} style={styles.swatchWrap}>
          <View style={[styles.swatch, styles.customSwatch, {backgroundColor: HEX.test(custom) ? custom : colors.surfaceHover}, accent === 'custom' && styles.swatchOn]}>
            <Icon name={accent === 'custom' ? 'check' : 'plus'} size={20} color="#FFFFFF" strokeWidth={3} />
          </View>
          <Txt variant="caption" tone={accent === 'custom' ? 'primary' : 'muted'}>
            Custom
          </Txt>
        </Pressy>
      </Card>

      {accent === 'custom' ? (
        <Reveal kind="fade">
          <TextField
            label="Custom colour"
            value={custom}
            onChangeText={t => setCustom(t.startsWith('#') ? t.slice(0, 7) : ('#' + t).slice(0, 7))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#2F8BFF"
            error={HEX.test(custom) ? undefined : 'Use a colour like #2F8BFF (a # and six letters or numbers).'}
            hint="Any colour you like. Pulse picks readable text and a matching second shade."
          />
        </Reveal>
      ) : null}

      {mode !== 'light' ? (
        <>
          <Txt variant="label" tone="muted" style={styles.section}>
            DARK BACKGROUND
          </Txt>
          <View style={styles.darks}>
            {DARKS.map(d => {
              const on = dark === d.key;
              return (
                <Pressy key={d.key} onPress={() => setDark(d.key)} accessibilityRole="button" accessibilityLabel={d.label} accessibilityState={{selected: on}} style={[styles.dark, on && styles.modeOn]}>
                  <View style={[styles.darkChip, {backgroundColor: d.bg}]} />
                  <Txt variant="caption" tone={on ? 'primary' : 'muted'}>
                    {d.label}
                  </Txt>
                </Pressy>
              );
            })}
          </View>
        </>
      ) : null}

      <Txt variant="caption" tone="muted" style={styles.note}>
        Pulse restarts once to apply a new look. Your chats and settings are not touched.
      </Txt>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  section: {marginTop: spacing.xl, marginBottom: spacing.sm},
  preview: {borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm, marginTop: spacing.md},
  pvTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs},
  pvAvatar: {width: 30, height: 30, borderRadius: 15},
  pvLine: {height: 7, borderRadius: 4},
  pvBubble: {paddingHorizontal: 12, paddingVertical: 11, borderRadius: 14},
  pvBar: {flexDirection: 'row', justifyContent: 'space-around', borderRadius: 22, borderWidth: 1, paddingVertical: 10, marginTop: spacing.xs},
  pvDot: {width: 14, height: 14, borderRadius: 7},
  modes: {flexDirection: 'row', gap: spacing.sm},
  modeWrap: {flex: 1},
  mode: {alignItems: 'center', gap: 4, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.glassBorder, backgroundColor: colors.glass},
  modeOn: {borderColor: colors.primary, backgroundColor: colors.primaryDim},
  modeIcon: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', marginBottom: 2},
  swatches: {flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg, justifyContent: 'space-between'},
  swatchWrap: {width: '22%', alignItems: 'center', gap: 6},
  swatch: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  customSwatch: {borderWidth: 1, borderColor: colors.glassBorder},
  swatchOn: {borderWidth: 3, borderColor: colors.text},
  darks: {flexDirection: 'row', gap: spacing.sm},
  dark: {flex: 1, alignItems: 'center', gap: 8, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.glassBorder, backgroundColor: colors.glass},
  darkChip: {width: '100%', height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.glassBorder},
  note: {marginTop: spacing.xl},
}));
