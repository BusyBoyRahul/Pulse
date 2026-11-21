import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, Switch, View} from 'react-native';

import {Screen, Txt, Card, Avatar, Icon, Pressy, Reveal} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSettingsStore} from '@/store/settingsStore';

type Mode = 'all' | 'except' | 'only';

/** Who sees my Status. The three choices are always on screen; the people list appears under the two that need it. */
export default function StatusPrivacyScreen() {
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const patch = usePrefsStore(s => s.patch);
  const mode = useSettingsStore(s => s.app.statusAudience) ?? 'all';
  const setApp = useSettingsStore(s => s.setApp);

  const people = paired.filter(p => !prefs[p.publicKey]?.blocked).sort((a, b) => a.name.localeCompare(b.name));
  const hidden = people.filter(p => prefs[p.publicKey]?.hideStatus).length;
  const chosen = people.filter(p => prefs[p.publicKey]?.showStatus).length;

  const options: {id: Mode; title: string; sub: string}[] = [
    {id: 'all', title: 'My connections', sub: 'Everyone you are connected to'},
    {id: 'except', title: 'My connections except…', sub: hidden ? `${hidden} excluded` : 'Pick who to leave out'},
    {id: 'only', title: 'Only share with…', sub: chosen ? `${chosen} selected` : 'Pick who can see it'},
  ];

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <Txt variant="label" tone="muted" style={styles.section}>
        WHO CAN SEE MY STATUS
      </Txt>
      <View style={styles.options}>
        {options.map(o => (
          <Pressy key={o.id} onPress={() => setApp({statusAudience: o.id})} accessibilityRole="button" accessibilityState={{selected: mode === o.id}} accessibilityLabel={o.title} scaleTo={0.985}>
            <Card solid style={[styles.option, mode === o.id && styles.optionOn]}>
              <View style={[styles.radio, mode === o.id && styles.radioOn]}>{mode === o.id ? <View style={styles.radioDot} /> : null}</View>
              <View style={styles.text}>
                <Txt variant="bodyStrong">{o.title}</Txt>
                <Txt variant="caption" tone="muted">
                  {o.sub}
                </Txt>
              </View>
            </Card>
          </Pressy>
        ))}
      </View>

      {mode === 'all' ? (
        <Reveal>
          <View style={styles.note}>
            <Icon name="lock" size={14} color={colors.textMuted} />
            <Txt variant="caption" tone="muted">
              Updates disappear after 24 hours.
            </Txt>
          </View>
        </Reveal>
      ) : (
        <>
          <Txt variant="label" tone="muted" style={styles.section}>
            {mode === 'except' ? 'LEAVE OUT' : 'SHARE WITH'}
          </Txt>
          {people.length === 0 ? (
            <Txt variant="caption" tone="muted">
              When you connect with people they will be listed here.
            </Txt>
          ) : (
            people.map((p, i) => {
              const on = mode === 'except' ? !!prefs[p.publicKey]?.hideStatus : !!prefs[p.publicKey]?.showStatus;
              return (
                <Reveal key={p.publicKey} index={Math.min(i, 6)}>
                  <Card solid flat style={styles.row}>
                    <Avatar name={p.name} seed={p.publicKey} uri={peers[p.publicKey]?.avatar ?? profiles[p.publicKey]?.avatar} size={42} />
                    <Txt variant="bodyStrong" style={styles.text} numberOfLines={1}>
                      {prefs[p.publicKey]?.nickname || p.name}
                    </Txt>
                    <Switch
                      value={on}
                      onValueChange={v => patch(p.publicKey, mode === 'except' ? {hideStatus: v} : {showStatus: v})}
                      trackColor={{false: colors.surfaceHover, true: colors.primary}}
                      thumbColor={on ? colors.onPrimary : colors.textMuted}
                      accessibilityLabel={`${mode === 'except' ? 'Leave out' : 'Share with'} ${p.name}`}
                    />
                  </Card>
                </Reveal>
              );
            })
          )}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  section: {marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs},
  options: {gap: spacing.sm},
  option: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderColor: colors.border},
  optionOn: {borderColor: colors.primary},
  radio: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center'},
  radioOn: {borderColor: colors.primary},
  radioDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary},
  text: {flex: 1, gap: 2},
  note: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginLeft: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm},
}));
