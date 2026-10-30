import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {colors, spacing} from '@/theme/theme';
import {Icon} from './Icon';
import {Txt} from './Text';

const MIN = 4;
const MAX = 8;

type Props = {
  title: string;
  subtitle?: string;
  error?: string | null;
  submitLabel?: string;
  /** Changing this empties the dots (e.g. after a wrong PIN). */
  resetKey?: number;
  onSubmit: (pin: string) => void;
  /** Shows a fingerprint key in the bottom-left corner. */
  onBiometric?: () => void;
  onCancel?: () => void;
  /** Something small under the confirm button (e.g. "Forgot PIN?"). */
  footer?: React.ReactNode;
};

/** A calm full-screen number pad: 4–8 digits, then the confirm button. */
export function PinPad({title, subtitle, error, submitLabel = 'Continue', resetKey, onSubmit, onBiometric, onCancel, footer}: Props) {
  const [digits, setDigits] = useState('');

  useEffect(() => {
    setDigits('');
  }, [resetKey]);

  const press = (d: string) => setDigits(prev => (prev.length < MAX ? prev + d : prev));
  const back = () => setDigits(prev => prev.slice(0, -1));
  const ready = digits.length >= MIN;

  const Key = ({label, onPress, accessibility}: {label: string; onPress: () => void; accessibility?: string}) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibility ?? label} style={({pressed}) => [styles.key, pressed && styles.keyDown]}>
      <Txt variant="heading" style={styles.keyTxt}>
        {label}
      </Txt>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Icon name="lock" size={26} color={colors.text} />
        <Txt variant="title" center style={styles.title}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary" center>
            {subtitle}
          </Txt>
        ) : null}
        <View style={styles.dots} accessibilityLabel={`${digits.length} digits entered`}>
          {Array.from({length: Math.max(MIN, digits.length)}).map((_, i) => (
            <View key={i} style={[styles.dot, i < digits.length && styles.dotOn]} />
          ))}
        </View>
        <Txt variant="caption" tone="danger" center style={styles.error}>
          {error ?? ' '}
        </Txt>
      </View>

      <View style={styles.pad}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map(row => (
          <View key={row.join('')} style={styles.row}>
            {row.map(d => (
              <Key key={d} label={d} onPress={() => press(d)} />
            ))}
          </View>
        ))}
        <View style={styles.row}>
          {onBiometric ? (
            <Pressable onPress={onBiometric} style={styles.key} accessibilityRole="button" accessibilityLabel="Use fingerprint or face">
              <Icon name="fingerprint" size={28} color={colors.text} />
            </Pressable>
          ) : onCancel ? (
            <Pressable onPress={onCancel} style={styles.key} accessibilityRole="button" accessibilityLabel="Cancel">
              <Txt variant="caption" tone="secondary">
                Cancel
              </Txt>
            </Pressable>
          ) : (
            <View style={styles.key} />
          )}
          <Key label="0" onPress={() => press('0')} />
          <Pressable onPress={back} onLongPress={() => setDigits('')} style={styles.key} accessibilityRole="button" accessibilityLabel="Delete last digit">
            <Icon name="chevronLeft" size={26} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <Pressable
        disabled={!ready}
        onPress={() => onSubmit(digits)}
        style={[styles.submit, !ready && {opacity: 0.35}]}
        accessibilityRole="button"
        accessibilityLabel={submitLabel}>
        <Txt variant="subtitle" style={{color: colors.onPrimary}}>
          {submitLabel}
        </Txt>
      </Pressable>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg, justifyContent: 'space-between', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl},
  head: {alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl},
  title: {marginTop: spacing.sm},
  dots: {flexDirection: 'row', gap: 14, marginTop: spacing.xl, height: 18, alignItems: 'center'},
  dot: {width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.textMuted},
  dotOn: {backgroundColor: colors.text, borderColor: colors.text},
  error: {marginTop: spacing.sm, minHeight: 18},
  pad: {alignItems: 'center', gap: spacing.md},
  row: {flexDirection: 'row', gap: spacing.xl},
  key: {width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent'},
  keyDown: {backgroundColor: colors.surfaceHover},
  keyTxt: {fontSize: 28, lineHeight: 34},
  footer: {alignItems: 'center', marginTop: spacing.md},
  submit: {height: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
});

export default PinPad;
