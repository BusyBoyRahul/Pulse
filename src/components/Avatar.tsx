import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Defs, LinearGradient, Stop, Circle} from 'react-native-svg';

// Monochrome gradient pairs — every person gets a distinct steel/graphite tone,
// stable per identity, so the list stays scannable without any colour.
const GRADIENTS: [string, string][] = [
  ['#5A5A62', '#26262A'],
  ['#6E6E76', '#2E2E33'],
  ['#4A4A52', '#1C1C20'],
  ['#808088', '#38383E'],
  ['#3E3E45', '#17171A'],
  ['#8E8E96', '#42424A'],
  ['#55555D', '#202024'],
  ['#74747C', '#303035'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  name: string;
  seed?: string; // stable color source (e.g. public key); defaults to name
  uri?: string | null;
  size?: number;
  ring?: boolean;
};

export function Avatar({name, seed, uri, size = 44, ring = false}: Props) {
  const [g1, g2] = GRADIENTS[hash(seed || name) % GRADIENTS.length];
  const r = size / 2;
  const fontSize = Math.round(size * 0.38);

  if (uri) {
    return (
      <Image
        source={{uri}}
        style={[{width: size, height: size, borderRadius: r}, ring && styles.ring]}
      />
    );
  }

  return (
    <View style={[{width: size, height: size}, ring && [styles.ring, {borderRadius: r}]]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={`av-${g1}-${g2}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={g1} />
            <Stop offset="1" stopColor={g2} />
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#av-${g1}-${g2})`} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text
          allowFontScaling={false}
          style={{
            fontSize,
            lineHeight: fontSize * 1.15,
            fontWeight: '700',
            color: '#FFFFFF',
            textAlign: 'center',
            includeFontPadding: false,
          }}>
          {initials(name)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', justifyContent: 'center'},
  ring: {borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)'},
});

export default Avatar;
