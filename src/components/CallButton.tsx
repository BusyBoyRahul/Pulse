import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {colors} from '@/theme/theme';
import {themedStyles} from '@/theme/themed';
import {Icon, IconName} from './Icon';
import {Rim} from './Tile3D';
import {Txt} from './Text';

type Props = {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Switched on (muted, speaker on…): filled with the accent. */
  on?: boolean;
  /** The two big decisions: end / decline (red) and answer (green). */
  tone?: 'danger' | 'success';
  size?: number;
  /** Over a video picture: a see-through dark disc, and a white label with a soft shadow. */
  overVideo?: boolean;
  disabled?: boolean;
};

/**
 * THE call button: a round disc with the icon and a word underneath, so nobody has to guess what a symbol does. Red is only
 * for ending, green only for answering; everything else is a calm disc that fills with the accent while it is on.
 */
export function CallButton({icon, label, onPress, on, tone, size = 64, overVideo, disabled}: Props) {
  const bg = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : on ? colors.primary : overVideo ? 'rgba(0,0,0,0.45)' : colors.surfaceRaised;
  const fg = tone ? '#FFFFFF' : on ? colors.onPrimary : overVideo ? '#FFFFFF' : colors.text;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{selected: !!on, disabled: !!disabled}}
        style={({pressed}) => [
          styles.btn,
          {width: size, height: size, borderRadius: size / 2, backgroundColor: bg},
          !tone && !on && !overVideo && {borderWidth: 1, borderColor: colors.border},
          disabled && {opacity: 0.4},
          pressed && {opacity: 0.8, transform: [{scale: 0.96}]},
        ]}>
        <Icon name={icon} size={Math.round(size * 0.38)} color={fg} strokeWidth={2.2} />
        {tone || on ? <Rim size={size} /> : null}
      </Pressable>
      <Txt variant="caption" style={[styles.label, overVideo ? styles.labelVideo : {color: colors.textSecondary}]} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: {alignItems: 'center', width: 76},
    btn: {alignItems: 'center', justifyContent: 'center'},
    label: {marginTop: 8},
    labelVideo: {color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4, textShadowOffset: {width: 0, height: 1}},
  }),
);

export default CallButton;
