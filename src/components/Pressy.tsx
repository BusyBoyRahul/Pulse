import React from 'react';
import {GestureResponderEvent, Pressable, StyleProp, ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSpring} from 'react-native-reanimated';
import {motion} from '@/theme/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  children?: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks while pressed (1 = not at all). */
  scaleTo?: number;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab' | 'checkbox' | 'switch';
  accessibilityState?: {disabled?: boolean; selected?: boolean; checked?: boolean};
  delayLongPress?: number;
};

/**
 * Every tappable thing in Pulse presses the same way: a quick springy squeeze.
 * Use this instead of a bare Pressable for buttons, chips, rows and tiles.
 */
export function Pressy({children, onPress, onLongPress, disabled, style, scaleTo = 0.96, hitSlop, ...rest}: Props) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({transform: [{scale: s.value}]}));
  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        s.value = withSpring(scaleTo, motion.spring);
      }}
      onPressOut={() => {
        s.value = withSpring(1, motion.spring);
      }}
      style={[style, anim]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}

export default Pressy;
