import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {Icon} from './Icon';
import {Pressy} from './Pressy';
import {Sheet} from './Sheet';
import {Txt} from './Text';

export type Choice<T extends string> = {key: T; label: string; note?: string};

type Props<T extends string> = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** One plain sentence about what this setting does. */
  intro?: string;
  choices: Choice<T>[];
  value: T;
  onPick: (v: T) => void;
};

/** "Who can…?" — pick one option, see what each means, done. Used everywhere a setting is a choice. */
export function AudienceSheet<T extends string>({visible, onClose, title, intro, choices, value, onPick}: Props<T>) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {intro ? (
        <Txt variant="caption" tone="secondary" style={styles.intro}>
          {intro}
        </Txt>
      ) : null}
      {choices.map(c => {
        const on = c.key === value;
        return (
          <Pressy
            key={c.key}
            onPress={() => {
              onPick(c.key);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityState={{selected: on}}
            accessibilityLabel={c.label}
            scaleTo={0.985}
            style={[styles.row, on && styles.rowOn]}>
            <View style={styles.text}>
              <Txt variant="bodyStrong">{c.label}</Txt>
              {c.note ? (
                <Txt variant="caption" tone="muted">
                  {c.note}
                </Txt>
              ) : null}
            </View>
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" size={13} color={colors.onPrimary} strokeWidth={3.2} /> : null}</View>
          </Pressy>
        );
      })}
    </Sheet>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  intro: {marginBottom: spacing.md},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md},
  rowOn: {backgroundColor: colors.primaryDim},
  text: {flex: 1, gap: 2},
  radio: {width: 24, height: 24, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center'},
  radioOn: {backgroundColor: colors.primary, borderColor: colors.primary},
}));

export default AudienceSheet;
