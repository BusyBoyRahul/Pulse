import React, {useState} from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import {colors, radius, spacing, typography} from '@/theme/theme';
import {Txt} from './Text';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
};

export function TextField({label, hint, error, style, ...rest}: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="label" tone="secondary" style={styles.label}>
          {label.toUpperCase()}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.errored,
          style,
        ]}
        onFocus={e => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" tone="danger" style={styles.help}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="muted" style={styles.help}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginBottom: spacing.lg},
  label: {marginBottom: spacing.sm},
  input: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    ...typography.body,
  },
  focused: {borderColor: colors.primary},
  errored: {borderColor: colors.danger},
  help: {marginTop: spacing.xs},
});

export default TextField;
