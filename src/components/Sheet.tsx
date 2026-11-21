import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Keyboard, Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {FadeIn, ZoomIn} from 'react-native-reanimated';
import {colors, elevation, radius, spacing} from '@/theme/theme';
import {Icon} from './Icon';
import {Txt} from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Tap the dimmed area around the card to close. */
  dismissOnBackdrop?: boolean;
  /** Kept for older callers: the card always scrolls if its content is taller than the screen. */
  scroll?: boolean;
};

/**
 * A pop-up card in the middle of the screen: dims what is behind it, closes with the ✕, a tap outside,
 * or Back. It does NOT hang off the bottom edge — bottom sheets sat differently on every phone (gesture
 * bar, rounded corners, gaps) — so nothing here depends on the screen edges. It lifts above the keyboard.
 */
export function Sheet({visible, onClose, title, children, dismissOnBackdrop = true}: Props) {
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[styles.wrap, {paddingBottom: kb}]}>
        <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissOnBackdrop ? onClose : undefined} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View entering={ZoomIn.duration(170)} style={styles.card}>
          {title ? (
            <View style={styles.header}>
              <Txt variant="heading" style={styles.title} numberOfLines={2}>
                {title}
              </Txt>
              <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityLabel="Close" accessibilityRole="button">
                <Icon name="x" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg},
  scrim: {backgroundColor: 'rgba(3,4,12,0.55)'},
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '84%',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    ...elevation.floating,
  },
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.lg},
  title: {flex: 1},
  close: {width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  body: {flexGrow: 0},
}));

export default Sheet;
