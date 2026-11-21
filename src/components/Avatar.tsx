import {themedStyles} from '@/theme/themed';
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {colors} from '@/theme/theme';

// Vivid gradient pairs. Every person gets one, stable per identity, so a long
// list stays easy to scan — independent of the chosen accent.
const GRADIENTS: [string, string][] = [
  ['#7C5CFF', '#C25BFF'],
  ['#2F8BFF', '#27D3F5'],
  ['#12B981', '#7BE495'],
  ['#FF6B5B', '#FFA85B'],
  ['#F0457E', '#FF8FB1'],
  ['#14B8C6', '#5EE2B5'],
  ['#5B6CFF', '#8E5BFF'],
  ['#F5A524', '#FFD36B'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, ' ') // "Maya (You)" → the initials of Maya
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
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
  /** Small coloured dot at the corner (online / has a status). */
  dot?: string;
};

export function Avatar({name, seed, uri, size = 44, ring = false, dot}: Props) {
  const [g1] = GRADIENTS[hash(seed || name) % GRADIENTS.length];
  const r = size / 2;
  const fontSize = Math.round(size * 0.38);
  const dotSize = Math.max(10, Math.round(size * 0.27));

  const face = uri ? (
    <Image source={{uri}} style={[{width: size, height: size, borderRadius: r}, ring && styles.ring]} />
  ) : (
    <View style={[{width: size, height: size, borderRadius: r, backgroundColor: g1}, ring && styles.ring]}>
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

  if (!dot) {
    return face;
  }
  return (
    <View style={{width: size, height: size}}>
      {face}
      <View
        style={{
          position: 'absolute',
          right: -1,
          bottom: -1,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: dot,
          borderWidth: 2,
          borderColor: colors.bg,
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  center: {alignItems: 'center', justifyContent: 'center'},
  ring: {borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)'},
}));

export default Avatar;
