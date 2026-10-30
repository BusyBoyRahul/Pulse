import React from 'react';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {Txt} from './Text';

type Props = {
  label: string;
  tone?: 'online' | 'relay' | 'danger' | 'idle';
  style?: ViewStyle;
};

const dot: Record<NonNullable<Props['tone']>, string> = {
  online: colors.meshOnline,
  relay: colors.meshRelay,
  danger: colors.danger,
  idle: colors.textMuted,
};

export function StatusPill({label, tone = 'idle', style}: Props) {
  return (
    <View style={[styles.pill, style]}>
      <View style={[styles.dot, {backgroundColor: dot[tone]}]} />
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dot: {width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm},
});

export default StatusPill;
