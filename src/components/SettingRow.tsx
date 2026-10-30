import React from 'react';
import {Pressable, StyleSheet, Switch, View} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';

type Props = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Right-hand text, e.g. the current choice. */
  value?: string;
  onPress?: () => void;
  /** Renders an on/off switch instead of a chevron. */
  toggle?: {value: boolean; onChange: (v: boolean) => void};
  danger?: boolean;
  disabled?: boolean;
  /** Hide the chevron on a tappable row. */
  noChevron?: boolean;
};

/** One line of a settings list: icon, title, optional note, and a switch / value / chevron. */
export function SettingRow({title, subtitle, icon, value, onPress, toggle, danger, disabled, noChevron}: Props) {
  const body = (
    <View style={[styles.row, disabled && styles.disabled]}>
      {icon ? (
        <View style={[styles.icon, danger && styles.iconDanger]}>
          <Icon name={icon} size={19} color={danger ? colors.dangerBright : colors.text} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Txt variant="bodyStrong" tone={danger ? 'danger' : 'primary'}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" style={styles.sub}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={disabled}
          trackColor={{false: colors.border, true: colors.primaryDim}}
          thumbColor={toggle.value ? colors.primaryBright : colors.textMuted}
        />
      ) : (
        <>
          {value ? (
            <Txt variant="caption" tone="secondary" style={styles.value} numberOfLines={1}>
              {value}
            </Txt>
          ) : null}
          {onPress && !noChevron ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : null}
        </>
      )}
    </View>
  );

  if (onPress && !toggle) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={title}
        android_ripple={{color: colors.surfaceHover}}
        style={({pressed}) => pressed && styles.pressed}>
        {body}
      </Pressable>
    );
  }
  if (toggle) {
    return (
      <Pressable
        onPress={() => toggle.onChange(!toggle.value)}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{checked: toggle.value}}
        accessibilityLabel={title}>
        {body}
      </Pressable>
    );
  }
  return body;
}

/** A rounded card that stacks rows with hairline dividers between them. */
export function SettingGroup({children}: {children: React.ReactNode}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** Small grey heading above a group. */
export function SettingLabel({children}: {children: string}) {
  return (
    <Txt variant="label" tone="muted" style={styles.label}>
      {children}
    </Txt>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56},
  disabled: {opacity: 0.45},
  pressed: {backgroundColor: colors.surfaceHover},
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconDanger: {backgroundColor: colors.dangerDim},
  text: {flex: 1, paddingRight: spacing.sm},
  sub: {marginTop: 2},
  value: {maxWidth: 150, marginRight: spacing.xs},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg},
  label: {marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs},
});

export default SettingRow;
