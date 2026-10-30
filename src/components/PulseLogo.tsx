import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {colors} from '@/theme/theme';

type Props = {
  size?: number;
  color?: string;
  animated?: boolean;
};

/**
 * The Pulse mark: a solid core with two expanding rings, evoking a signal
 * radiating outward through the mesh. Pure RN Animated (no SVG dep).
 */
export function PulseLogo({size = 96, color = colors.primary, animated = true}: Props) {
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) {
      return;
    }
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
    const a = make(ringA, 0);
    const b = make(ringB, 1100);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [animated, ringA, ringB]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0]}),
    transform: [
      {scale: v.interpolate({inputRange: [0, 1], outputRange: [0.4, 1.6]})},
    ],
  });

  const core = size * 0.34;

  return (
    <View style={[styles.wrap, {width: size, height: size}]}>
      <Animated.View
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2, borderColor: color},
          ringStyle(ringA),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2, borderColor: color},
          ringStyle(ringB),
        ]}
      />
      <View
        style={[
          styles.core,
          {width: core, height: core, borderRadius: core / 2, backgroundColor: color},
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', borderWidth: 2},
  core: {},
});

export default PulseLogo;
