import {themedStyles} from '@/theme/themed';
import React from 'react';
import {Pressable, StyleSheet, Switch, View} from 'react-native';
import {colors, elevation, radius, spacing, themeInfo} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';
import {IconTile} from './Tile3D';

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

/** Tells rows whether they sit in a card (padded sides) or flat on the page. */
const FlatCtx = React.createContext(false);

/** One line of a settings list: icon, title, optional note, and a switch / value / chevron. */
export function SettingRow({title, subtitle, icon, value, onPress, toggle, danger, disabled, noChevron}: Props) {
  const flat = React.useContext(FlatCtx);
  const body = (
    <View style={[styles.row, !flat && styles.rowInCard, disabled && styles.disabled]}>
      {icon ? (
        <View style={styles.icon}>
          <IconTile icon={icon} size={38} color={danger ? '#EF4444' : undefined} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Txt variant="bodyStrong" tone={danger ? 'danger' : 'primary'} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" style={styles.sub} numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={disabled}
          trackColor={{false: colors.surfaceHover, true: colors.primary}}
          thumbColor={toggle.value ? colors.onPrimary : colors.textMuted}
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
        style={({pressed}) => pressed && (flat ? styles.pressedFlat : styles.pressed)}>
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

/**
 * Stacks rows with hairline dividers. By default it is a soft card (settings and info screens); pass `flat`
 * for rows that sit straight on the page (profile, lists).
 */
export function SettingGroup({children, flat = false}: {children: React.ReactNode; flat?: boolean}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <FlatCtx.Provider value={flat}>
      <View style={flat ? styles.group : styles.card}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={[styles.divider, !flat && styles.dividerCard]} /> : null}
            {child}
          </View>
        ))}
      </View>
    </FlatCtx.Provider>
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

/** Light from above: a bright top edge and a slightly darker bottom edge give a raised, 3D feel. */
const bevel = () => ({
  borderTopColor: themeInfo.isDark ? 'rgba(255,255,255,0.16)' : '#FFFFFF',
  borderBottomColor: themeInfo.isDark ? 'rgba(0,0,0,0.4)' : '#CDD2E8',
});

const styles = themedStyles(() => StyleSheet.create({
  group: {},
  // Solid (not see-through): a soft shadow shows through a translucent card as a dirty inner frame.
  // overflow hidden: a pressed or selected row is clipped to the card's rounded corners (no square highlight).
  card: {backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...bevel(), ...elevation.card},
  rowInCard: {paddingHorizontal: spacing.lg},
  dividerCard: {marginLeft: spacing.lg},
  pressedFlat: {opacity: 0.55},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, minHeight: 60},
  disabled: {opacity: 0.45},
  pressed: {backgroundColor: colors.surfaceHover},
  icon: {marginRight: spacing.md},
  text: {flex: 1, paddingRight: spacing.sm},
  sub: {marginTop: 2},
  value: {maxWidth: 150, marginRight: spacing.xs},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.glassBorder},
  label: {marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs},
}));

export default SettingRow;
