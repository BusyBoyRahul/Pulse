import React from 'react';
import {StyleProp, ViewStyle} from 'react-native';
import Animated, {FadeInDown, FadeIn, ZoomIn} from 'react-native-reanimated';

type Props = {
  children: React.ReactNode;
  /** Position in a list: each item starts a little after the one before. */
  index?: number;
  kind?: 'rise' | 'fade' | 'pop';
  style?: StyleProp<ViewStyle>;
};

const STEP = 45;

/** Things glide in, one after another, instead of snapping onto the screen. */
export function Reveal({children, index = 0, kind = 'rise', style}: Props) {
  const delay = Math.min(index, 12) * STEP;
  const entering =
    kind === 'fade' ? FadeIn.delay(delay).duration(320) : kind === 'pop' ? ZoomIn.delay(delay).springify().damping(14) : FadeInDown.delay(delay).duration(380).springify().damping(18);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

export default Reveal;
