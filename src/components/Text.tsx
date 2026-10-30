import React from 'react';
import {Text as RNText, StyleSheet, TextProps, TextStyle} from 'react-native';
import {colors, typography} from '@/theme/theme';

type Variant = keyof typeof typography;
type Tone = 'primary' | 'secondary' | 'muted' | 'danger' | 'accent' | 'success';

type Props = TextProps & {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
  style?: TextStyle | TextStyle[];
};

const toneColor: Record<Tone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  danger: colors.dangerBright,
  accent: colors.primaryBright,
  success: colors.success,
};

/**
 * Typed text primitive. Also guarantees line-height keeps up with font-size:
 * when a caller overrides fontSize (big numbers, emoji, avatars) we auto-grow
 * lineHeight so glyphs are never vertically clipped.
 */
export function Txt({variant = 'body', tone = 'primary', center, style, children, ...rest}: Props) {
  const merged = StyleSheet.flatten([
    typography[variant] as TextStyle,
    {color: toneColor[tone]},
    center && styles.center,
    style as TextStyle,
  ]) as TextStyle;

  if (merged.fontSize && (!merged.lineHeight || merged.lineHeight < merged.fontSize * 1.2)) {
    merged.lineHeight = Math.round(merged.fontSize * 1.3);
  }

  return (
    <RNText style={merged} {...rest}>
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  center: {textAlign: 'center'},
});

export default Txt;
