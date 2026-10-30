import React, {useEffect, useState} from 'react';
import {Keyboard, Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {Icon} from './Icon';
import {Txt} from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Tap the exposed area above the sheet to close. */
  dismissOnBackdrop?: boolean;
  scroll?: boolean;
};

/**
 * A premium bottom sheet that is ALWAYS flush to the bottom edge (anchored with
 * position:absolute so no keyboard-avoider gap), lifts itself exactly by the
 * keyboard height when an input focuses, and uses NO dark tint — just the
 * sheet's own surface + shadow for separation. Taps on the sheet never close it.
 */
export function Sheet({visible, onClose, title, children, dismissOnBackdrop = true, scroll}: Props) {
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Transparent backdrop — no tint. Tap to dismiss. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismissOnBackdrop ? onClose : undefined} />
      <View style={[styles.sheet, {bottom: kb}]}>
        <View style={styles.handle} />
        {title ? (
          <View style={styles.header}>
            <Txt variant="heading">{title}</Txt>
            <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
              <Icon name="x" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    // bottom is set dynamically (0, or keyboard height)
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    maxHeight: '88%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: -8},
    elevation: 24,
  },
  handle: {alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg},
  close: {padding: spacing.xs},
});

export default Sheet;
