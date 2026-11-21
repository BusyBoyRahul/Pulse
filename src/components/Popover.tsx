import {themedStyles} from '@/theme/themed';
import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import Animated, {FadeIn, FadeOut} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, radius, spacing, shadowTone} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Which top corner the menu hangs from (under the button that opened it). */
  align?: 'left' | 'right';
  /** 'bottom' rises from just above the message box (for the attach menu). */
  from?: 'top' | 'bottom';
  children: React.ReactNode;
};

/**
 * A small dropdown menu that hangs from the top corner, under the button that opened it.
 * For short lists of actions. Use a bottom Sheet only for things that need room (forms, long pickers).
 */
export function Popover({visible, onClose, align = 'right', from = 'top', children}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(90)}
        style={[styles.card, from === 'bottom' ? {bottom: insets.bottom + 84} : {top: insets.top + 60}, align === 'right' ? {right: spacing.lg} : {left: spacing.lg}]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

type ItemProps = {
  icon: IconName;
  label: string;
  /** Small text on the right (a count, the current value). */
  value?: string;
  danger?: boolean;
  selected?: boolean;
  onPress: () => void;
  /** Leading element instead of an icon (e.g. an avatar). */
  lead?: React.ReactNode;
};

export function PopoverItem({icon, label, value, danger, selected, onPress, lead}: ItemProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [styles.item, selected && styles.itemOn, pressed && {backgroundColor: colors.surfaceHover}]}>
      {lead ?? <Icon name={icon} size={20} color={danger ? colors.dangerBright : colors.text} />}
      <Txt variant="body" tone={danger ? 'danger' : 'primary'} numberOfLines={1} style={styles.label}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="caption" tone="muted">
          {value}
        </Txt>
      ) : null}
      {selected ? <Icon name="check" size={18} color={colors.primaryBright} /> : null}
    </Pressable>
  );
}

export function PopoverDivider() {
  return <View style={styles.divider} />;
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    position: 'absolute',
    minWidth: 230,
    maxWidth: 320,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    shadowColor: shadowTone(),
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 6,
  },
  // Inset and rounded, so a selected or pressed row never meets the card's edge with square corners.
  item: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 48, marginHorizontal: spacing.xs, borderRadius: radius.md},
  itemOn: {backgroundColor: colors.primaryDim},
  label: {flex: 1},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs, marginHorizontal: spacing.md},
}));

export default Popover;
