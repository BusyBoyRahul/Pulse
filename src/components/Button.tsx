import {themedStyles} from '@/theme/themed';
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {colors, spacing, typography} from '@/theme/theme';
import {Pressy} from './Pressy';

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
  /** 'md' 54px for forms and sheets (default); 'sm' 40px for buttons inside a row or card. */
  size?: 'md' | 'sm';
};

/**
 * Pulse button — solid, flat colours (no gradients, no glow): fast to draw and easy to read.
 * UI rule: a row of actions is all text buttons (this) or all icon buttons
 * (<IconButton/>) — never mixed.
 * Primary = solid accent · secondary = outlined · ghost = text only · danger = solid red.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  fullWidth = true,
  size = 'md',
}: Props) {
  const isDisabled = disabled || loading;
  const small = size === 'sm';
  const height = small ? 40 : variant === 'ghost' ? 44 : 52;
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.onDanger : variant === 'secondary' ? colors.text : colors.primaryBright;

  return (
    <Pressy
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled: isDisabled}}
      scaleTo={0.98}
      style={[
        styles.base,
        {height, borderRadius: 999},
        variant === 'primary' && {backgroundColor: colors.primary},
        variant === 'danger' && {backgroundColor: colors.danger},
        variant === 'secondary' && styles.outline,
        fullWidth ? styles.fullWidth : {paddingHorizontal: small ? spacing.lg : spacing.xl},
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text style={[styles.label, small && styles.labelSmall, {color: fg}]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressy>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  base: {alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl},
  fullWidth: {alignSelf: 'stretch'},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  icon: {marginRight: spacing.sm},
  label: {...typography.subtitle, fontWeight: '700'},
  labelSmall: {fontSize: 14, lineHeight: 20, fontWeight: '700'},
  outline: {backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.glassBorder},
  disabled: {opacity: 0.42},
}));

export default Button;
