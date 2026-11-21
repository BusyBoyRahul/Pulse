import {themedStyles} from '@/theme/themed';
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {colors} from '@/theme/theme';

type Props = {
  size?: number;
  color?: string;
  animated?: boolean;
};

/**
 * The Pulse mark: a rounded app-icon square with a chat bubble and a heartbeat line inside, with soft
 * rings spreading out of it (a signal travelling through the mesh).
 */
export function PulseLogo({size = 96, color = colors.primary, animated = true}: Props) {
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) {
      return;
    }
    const loop = Animated.loop(Animated.timing(ring, {toValue: 1, duration: 2600, easing: Easing.out(Easing.ease), useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [animated, ring]);

  const tile = size * 0.62;
  const ringStyle = {
    opacity: ring.interpolate({inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0]}),
    transform: [{scale: ring.interpolate({inputRange: [0, 1], outputRange: [0.7, 1.5]})}],
  };

  return (
    <View style={[styles.wrap, {width: size, height: size}]}>
      {animated ? (
        <Animated.View style={[styles.ring, {width: tile, height: tile, borderRadius: tile * 0.3, borderColor: color}, ringStyle]} />
      ) : null}
      <View style={[styles.tile, {width: tile, height: tile, borderRadius: tile * 0.3, backgroundColor: color}]}>
        <Svg width={tile * 0.74} height={(tile * 0.74 * 780) / 900} viewBox="170 245 900 780" fill="none">
          <Path d="M480 288H760C925 288 1025 420 1025 610C1025 810 905 933 740 933C650 933 560 925 470 898L300 980L338 832C255 770 217 695 217 610C217 430 330 288 480 288Z" stroke={colors.onPrimary} strokeWidth={74} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M325 630H430L490 565L550 745L640 450L722 735L785 635H910" stroke={colors.onPrimary} strokeWidth={60} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', borderWidth: 2},
  tile: {alignItems: 'center', justifyContent: 'center'},
}));

export default PulseLogo;
