import {themedStyles} from '@/theme/themed';
import React from 'react';
import {ScrollView, StyleSheet, View, ViewStyle, StatusBar} from 'react-native';
import {Edge, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {HeaderHeightContext} from '@react-navigation/elements';
import {colors, spacing, themeInfo} from '@/theme/theme';
import {Aurora} from './Aurora';

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
  /** Extra bottom clearance for the floating tab bar (tab screens only). */
  bottomClear?: boolean;
  /** The drifting colour glows behind the page (on by default). */
  aurora?: boolean;
};

// Clearance so nothing sits under the floating tab bar / gesture bar.
const BOTTOM_CLEARANCE = 96;

/**
 * App-wide page container. Owns the safe area, status bar, the soft animated
 * background and the standard gutter.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  footer,
  edges = ['top', 'left', 'right'],
  bottomClear = true,
  aurora = true,
}: Props) {
  const insets = useSafeAreaInsets();
  // Under a (transparent) native header: start below it, but let the background run behind it.
  const headerH = React.useContext(HeaderHeightContext) ?? 0;
  const bottom = Math.max(insets.bottom, bottomClear ? BOTTOM_CLEARANCE : insets.bottom);

  const inner = <View style={[padded && styles.padded, styles.grow, style]}>{children}</View>;

  return (
    <SafeAreaView style={[styles.safe, !edges.includes('top') && headerH > 0 ? {paddingTop: headerH} : null]} edges={edges}>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      {aurora ? <Aurora /> : null}
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

const styles = themedStyles(() => StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.bg},
  grow: {flex: 1},
  padded: {paddingHorizontal: spacing.xl},
  scrollContent: {flexGrow: 1},
  footer: {
    paddingTop: spacing.lg,
  },
  footerPad: {paddingHorizontal: spacing.xl},
}));

export default Screen;
