import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import {colors, elevation, radius, spacing} from '@/theme/theme';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  padded?: boolean;
  /** Solid surface instead of frosted glass (for dense lists). */
  solid?: boolean;
  /** A soft accent glow around the card (for the one thing to look at). */
  glowing?: boolean;
  /** No box at all: a plain row or block sitting on the page (for lists). */
  flat?: boolean;
};

/** A frosted-glass panel: translucent, with a bright hairline edge. */
export function Card({children, style, raised = false, padded = true, solid = false, glowing = false, flat = false}: Props) {
  return (
    <View
      style={[
        styles.card,
        (solid || raised) && styles.solid,
        padded && styles.padded,
        raised && !flat && elevation.card,
        glowing && styles.accentEdge,
        flat && styles.flat,
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  accentEdge: {borderColor: colors.primary},
  solid: {backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth},
  padded: {padding: spacing.lg},
  flat: {backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0},
}));

export default Card;
