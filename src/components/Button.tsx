import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {colors, radius, spacing, typography} from '@/theme/theme';

type Variant = 'primary' | 'danger' | 'secondary' | 'ghost';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
};

const bg: Record<Variant, string> = {
  primary: colors.primary,
  danger: colors.danger,
  secondary: colors.surfaceRaised,
  ghost: 'transparent',
};

const fg: Record<Variant, string> = {
  primary: colors.onPrimary,
  danger: colors.onDanger,
  secondary: colors.text,
  ghost: colors.primaryBright,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  fullWidth = true,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        {backgroundColor: bg[variant]},
        variant === 'ghost' && styles.ghost,
        variant === 'secondary' && styles.secondaryBorder,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text style={[styles.label, {color: fg[variant]}]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  fullWidth: {alignSelf: 'stretch'},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  icon: {marginRight: spacing.sm},
  label: {...typography.subtitle},
  ghost: {height: 44},
  secondaryBorder: {borderWidth: 1, borderColor: colors.border},
  pressed: {opacity: 0.85, transform: [{scale: 0.99}]},
  disabled: {opacity: 0.4},
});

export default Button;
