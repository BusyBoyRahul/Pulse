import React, {useRef, useState} from 'react';
import {Animated, Easing, Pressable, StyleSheet, View} from 'react-native';
import {colors, radius} from '@/theme/theme';
import {Txt} from './Text';

type Props = {
  label: string;
  sublabel?: string;
  holdMs: number;
  onComplete: () => void;
  size?: number;
  color?: string;
};

/**
 * A large circular press-and-hold control. The ring fills over `holdMs`; only a
 * completed hold fires `onComplete`, preventing accidental SOS triggers.
 */
export function HoldButton({
  label,
  sublabel,
  holdMs,
  onComplete,
  size = 240,
  color = colors.danger,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const completedRef = useRef(false);

  const start = () => {
    completedRef.current = false;
    setHolding(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({finished}) => {
      if (finished && !completedRef.current) {
        completedRef.current = true;
        setHolding(false);
        progress.setValue(0);
        onComplete();
      }
    });
  };

  const cancel = () => {
    if (completedRef.current) {
      return;
    }
    setHolding(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  };

  const ringScale = progress.interpolate({inputRange: [0, 1], outputRange: [1, 1.08]});
  const fillHeight = progress.interpolate({inputRange: [0, 1], outputRange: ['0%', '100%']});

  return (
    <Pressable onPressIn={start} onPressOut={cancel} accessibilityRole="button">
      <Animated.View
        style={[
          styles.outer,
          {width: size, height: size, borderRadius: size / 2, borderColor: color, transform: [{scale: ringScale}]},
          holding && {shadowColor: color, shadowOpacity: 0.6, shadowRadius: 30, elevation: 20},
        ]}>
        <View style={[styles.fillClip, {borderRadius: size / 2}]}>
          <Animated.View style={[styles.fill, {height: fillHeight, backgroundColor: color}]} />
        </View>
        <View style={styles.content}>
          <Txt variant="title" tone="primary" center style={styles.label}>
            {label}
          </Txt>
          {sublabel ? (
            <Txt variant="caption" tone="secondary" center>
              {sublabel}
            </Txt>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fillClip: {...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', overflow: 'hidden'},
  fill: {width: '100%', opacity: 0.35, borderRadius: radius.sm},
  content: {alignItems: 'center', paddingHorizontal: 16},
  label: {marginBottom: 4},
});

export default HoldButton;
