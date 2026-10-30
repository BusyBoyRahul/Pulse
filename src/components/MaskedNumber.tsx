import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, TextStyle, View} from 'react-native';
import {maskPhone} from '@/services/privacy';
import {Txt} from './Text';
import {Icon} from './Icon';

type Props = {
  value: string;
  style?: TextStyle;
  tone?: 'muted' | 'secondary' | 'primary';
};

/**
 * A phone number that stays hidden ("••••• 4567") until you tap the eye, then
 * hides itself again after a few seconds — so it can't be read off your screen
 * by accident or over your shoulder.
 */
export function MaskedNumber({value, style, tone = 'muted'}: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown) {
      return;
    }
    const t = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <Pressable onPress={() => setShown(s => !s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={shown ? 'Hide number' : 'Show number'}>
      <View style={styles.row}>
        <Txt variant="caption" tone={tone} style={style}>
          {shown ? value : maskPhone(value)}
        </Txt>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={13} color="#6E6E76" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 6},
});

export default MaskedNumber;
