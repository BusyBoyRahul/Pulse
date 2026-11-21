import {themedStyles} from '@/theme/themed';
import React, {useEffect, useRef} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSequence, withTiming} from 'react-native-reanimated';
import {colors, radius, spacing} from '@/theme/theme';
import {Txt} from './Text';

type Props = {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  /** Increase this number to shake the boxes (wrong code). */
  shake?: number;
  autoFocus?: boolean;
};

/** One box per digit. A single hidden input does the typing, so paste and SMS autofill just work. */
export function CodeInput({value, onChange, length = 6, shake = 0, autoFocus = true}: Props) {
  const ref = useRef<TextInput>(null);
  const x = useSharedValue(0);
  useEffect(() => {
    if (shake > 0) {
      x.value = withSequence(withTiming(-10, {duration: 50}), withTiming(10, {duration: 80}), withTiming(-8, {duration: 70}), withTiming(0, {duration: 60}));
    }
  }, [shake, x]);
  const anim = useAnimatedStyle(() => ({transform: [{translateX: x.value}]}));

  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Verification code">
      <Animated.View style={[styles.row, anim]}>
        {Array.from({length}).map((_, i) => {
          const ch = value[i] ?? '';
          const active = i === Math.min(value.length, length - 1);
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, !!ch && styles.boxFilled]}>
              <Txt variant="title" style={styles.digit}>
                {ch}
              </Txt>
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={t => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm},
  box: {flex: 1, height: 62, borderRadius: radius.md, backgroundColor: colors.glass, borderWidth: 1.5, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center'},
  boxActive: {borderColor: colors.primary},
  boxFilled: {backgroundColor: colors.primaryDim},
  digit: {textAlign: 'center'},
  hidden: {position: 'absolute', opacity: 0, width: 1, height: 1},
}));

export default CodeInput;
