import React from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import {colors, elevation, radius, spacing} from '@/theme/theme';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  padded?: boolean;
};

export function Card({children, style, raised = false, padded = true}: Props) {
  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        raised && elevation.card,
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  padded: {padding: spacing.lg},
});

export default Card;
