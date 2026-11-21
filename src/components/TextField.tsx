import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet, TextInput, TextInputProps, View} from 'react-native';
import Animated, {interpolateColor, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {colors, radius, spacing, typography} from '@/theme/theme';
import {Txt} from './Text';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
};

export function TextField({label, hint, error, style, ...rest}: Props) {
  const [focused, setFocused] = useState(false);
  const f = useSharedValue(0);
  const ring = useAnimatedStyle(() => ({
    borderColor: interpolateColor(f.value, [0, 1], [colors.glassBorder, colors.primary]),
  }));
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="label" tone={focused ? 'accent' : 'secondary'} style={styles.label}>
          {label.toUpperCase()}
        </Txt>
      ) : null}
      <Animated.View style={[styles.box, ring, !!error && styles.errored]}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          style={[styles.input, style]}
          onFocus={e => {
            setFocused(true);
            f.value = withTiming(1, {duration: 160});
            rest.onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            f.value = withTiming(0, {duration: 160});
            rest.onBlur?.(e);
          }}
          {...rest}
        />
      </Animated.View>
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

const styles = themedStyles(() => StyleSheet.create({
  wrap: {marginBottom: spacing.lg},
  label: {marginBottom: spacing.sm},
  box: {
    borderRadius: radius.md,
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
  },
  input: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    ...typography.body,
  },
  errored: {borderColor: colors.danger},
  help: {marginTop: spacing.xs},
}));

export default TextField;
