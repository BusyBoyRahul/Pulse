import React, {useState} from 'react';
import {LayoutChangeEvent, StyleSheet, View, ViewStyle, StyleProp} from 'react-native';
import Svg, {Defs, LinearGradient, Stop, Rect} from 'react-native-svg';

type Props = {
  colors: [string, string] | [string, string, string];
  style?: StyleProp<ViewStyle>;
  radius?: number;
  children?: React.ReactNode;
  angle?: 'horizontal' | 'vertical' | 'diagonal';
};

let uid = 0;

/**
 * A gradient fill behind arbitrary children (react-native-svg based, no extra
 * native dependency). Measures its own size via onLayout so the fill always
 * covers the full content — including when text wraps and the box grows.
 */
export function Gradient({colors, style, radius = 0, children, angle = 'diagonal'}: Props) {
  const id = React.useMemo(() => `grad-${uid++}`, []);
  const [size, setSize] = useState({w: 0, h: 0});

  const onLayout = (e: LayoutChangeEvent) => {
    const {width, height} = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) {
      setSize({w: width, h: height});
    }
  };

  const coords =
    angle === 'horizontal'
      ? {x1: '0', y1: '0', x2: '1', y2: '0'}
      : angle === 'vertical'
      ? {x1: '0', y1: '0', x2: '0', y2: '1'}
      : {x1: '0', y1: '0', x2: '1', y2: '1'};

  return (
    <View style={[{borderRadius: radius, overflow: 'hidden'}, style]} onLayout={onLayout}>
      {size.w > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={id} {...coords}>
              {colors.map((c, i) => (
                <Stop key={i} offset={`${i / (colors.length - 1)}`} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      ) : (
        // First paint before measurement: a solid fallback so there's never a gap.
        <View style={[StyleSheet.absoluteFill, {backgroundColor: colors[colors.length - 1]}]} />
      )}
      {children}
    </View>
  );
}

export default Gradient;
