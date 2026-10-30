import React from 'react';
import {ScrollView, StyleSheet, View, ViewStyle, StatusBar} from 'react-native';
import {Edge, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing} from '@/theme/theme';

type Props = {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: ViewStyle;
  footer?: React.ReactNode;
  /**
   * Which safe-area edges to inset. Tab screens (no native header) keep 'top';
   * screens pushed under a native stack header must NOT re-inset the top —
   * pass ['left','right'] or the header + inset stack into a double gap.
   */
  edges?: Edge[];
  /** Extra bottom clearance for the raised SOS tab button (tab screens only). */
  bottomClear?: boolean;
};

// Clearance so nothing sits under the raised SOS tab button / gesture bar.
const BOTTOM_CLEARANCE = 40;

/**
 * App-wide page container. Owns the safe area, status bar and the standard
 * gutter. Bottom padding clears both the device gesture bar and the raised
 * SOS button in the footer tab bar, so content is never obscured.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  footer,
  edges = ['top', 'left', 'right'],
  bottomClear = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, bottomClear ? BOTTOM_CLEARANCE : insets.bottom);

  const inner = <View style={[padded && styles.padded, styles.grow, style]}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {scroll ? (
        <ScrollView
          style={styles.grow}
          contentContainerStyle={[styles.scrollContent, {paddingBottom: bottom + spacing.lg}]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
      {footer ? (
        <View style={[styles.footer, {paddingBottom: bottom}, padded && styles.footerPad]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.bg},
  grow: {flex: 1},
  padded: {paddingHorizontal: spacing.xl},
  scrollContent: {flexGrow: 1},
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  footerPad: {paddingHorizontal: spacing.xl},
});

export default Screen;
