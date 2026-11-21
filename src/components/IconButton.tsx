import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, ViewStyle} from 'react-native';
import {colors} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Pressy} from './Pressy';

/**
 * THE icon-only button. Pulse UI rule: a bar or row with two or more actions is
 * either all icon buttons (this) or all text buttons (<Button/>) — never mixed.
 * Always give it a `label` (read aloud by screen readers).
 */
type Tone = 'plain' | 'filled' | 'danger';

type Props = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  tone?: Tone;
  /** 'md' 40px (default, bars and rows), 'sm' 34px (dense bars), 'lg' 48px (call controls). */
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function IconButton({icon, label, onPress, tone = 'filled', size = 'md', active, disabled, style}: Props) {
  const box = size === 'lg' ? 48 : size === 'sm' ? 34 : 40;
  const iconColor = active ? colors.onPrimary : tone === 'danger' ? colors.dangerBright : colors.text;
  return (
    <Pressy
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled: !!disabled, selected: !!active}}
      style={[
        styles.base,
        {width: box, height: box, borderRadius: box / 2},
        tone === 'filled' && styles.filled,
        active && styles.active,
        disabled && styles.disabled,
        style,
      ]}>
      <Icon name={icon} size={size === 'lg' ? 21 : size === 'sm' ? 17 : 18} color={iconColor} />
    </Pressy>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  base: {alignItems: 'center', justifyContent: 'center'},
  filled: {backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border},
  active: {backgroundColor: colors.primary, borderColor: colors.primary},
  disabled: {opacity: 0.4},
}));

export default IconButton;
