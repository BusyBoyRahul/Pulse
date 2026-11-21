import React from 'react';
import {ImageBackground, StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {photos, PhotoKey} from '@/assets/images';

type Props = {
  photo: PhotoKey;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** 0..1 darkness laid over the picture so text stays readable. */
  dim?: number;
  /** Fade to this colour at the bottom (usually the screen background). */
  fadeTo?: string;
  blurRadius?: number;
};

let uid = 0;

/** A bundled photo as a backdrop, with a readable dim layer and an optional bottom fade. */
export function PhotoBackdrop({photo, children, style, radius = 0, dim = 0.35, fadeTo, blurRadius}: Props) {
  const id = React.useMemo(() => `pb-${uid++}`, []);
  return (
    <ImageBackground
      source={photos[photo]}
      resizeMode="cover"
      blurRadius={blurRadius}
      style={[{overflow: 'hidden', borderRadius: radius}, style]}
      imageStyle={{borderRadius: radius}}>
      <View style={[StyleSheet.absoluteFill, {backgroundColor: `rgba(4,5,14,${dim})`}]} />
      {fadeTo ? (
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.45" stopColor={fadeTo} stopOpacity={0} />
              <Stop offset="1" stopColor={fadeTo} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      ) : null}
      {children}
    </ImageBackground>
  );
}

export default PhotoBackdrop;
