import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, elevation} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Pressy} from './Pressy';
import {Rim} from './Tile3D';
import {Txt} from './Text';

type Props = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** Switched on (muted, pinned…): the circle fills with the app colour. */
  active?: boolean;
  disabled?: boolean;
};

/**
 * A round icon with its name underneath. Rows of these are the "quick actions" on a profile or a group.
 * Calm, in the app's own colours: a dark circle with an accent-coloured symbol; solid accent when switched on.
 * Same rule as every row of actions: icons only, never mixed with text buttons.
 */
export function ActionTile({icon, label, onPress, active, disabled}: Props) {
  return (
    <View style={[styles.wrap, disabled && styles.disabled]}>
      <Pressy
        onPress={onPress}
        disabled={disabled}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{disabled: !!disabled, selected: !!active}}
        style={[styles.circle, active && styles.circleOn]}>
        {active ? <Rim size={54} /> : null}
        <Icon name={icon} size={24} color={active ? colors.onPrimary : colors.primaryBright} strokeWidth={2.1} />
      </Pressy>
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {alignItems: 'center', gap: 7, minWidth: 64},
  disabled: {opacity: 0.4},
  circle: {width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, ...elevation.card},
  circleOn: {backgroundColor: colors.primary, borderColor: colors.primary},
}));

export default ActionTile;
