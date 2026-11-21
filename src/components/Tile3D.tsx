import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Circle, Defs, LinearGradient, Stop} from 'react-native-svg';
import {Icon, IconName} from './Icon';

/**
 * Every icon gets a vivid, solid colour tile with a white symbol (no grey, no tint), so lists read at a glance.
 * The colour follows the kind of thing the icon is about.
 */
export const BLUE = '#2F8BFF';
const TILE: Partial<Record<IconName, string>> = {
  user: BLUE, userPlus: BLUE, edit: BLUE, at: BLUE, globe: BLUE, plus: BLUE, verified: BLUE, check: BLUE, checkAll: BLUE, chatPlus: BLUE, info: '#0EA5E9', copy: '#0EA5E9', database: '#0EA5E9',
  qr: '#5B6CFF', bluetooth: '#5B6CFF', moon: '#5B6CFF', key: '#8B5CF6', swap: '#8B5CF6', status: '#8B5CF6', eye: '#8B5CF6', eyeOff: '#8B5CF6',
  lock: '#22C55E', phone: '#22C55E', battery: '#22C55E', fingerprint: '#22C55E',
  image: '#FF9F1C', wallpaper: '#FF9F1C', clock: '#FF9F1C', pin: '#FF9F1C', star: '#F5A524', note: '#F5A524', archive: '#8B5CF6',
  bell: '#F0457E', speaker: '#F0457E', palette: '#EC4899', tag: '#EC4899', camera: '#F0457E',
  users: '#14B8A6', radar: '#14B8A6', shield: '#14B8A6', video: '#14B8A6', chat: '#14B8A6',
  sos: '#EF4444', ban: '#EF4444', trash: '#EF4444', userX: '#EF4444', mic: '#EF4444',
};
export const tileColor = (icon?: IconName): string => (icon && TILE[icon]) || BLUE;

/**
 * Only the edge catches a little light: bright at the top, fading round, a touch darker at the bottom.
 * Lay it over any round, solid-colour element (a tile, a floating button) to give it the same raised feel.
 */
export function Rim({size}: {size: number}) {
  const id = 'rim' + Math.round(size);
  const r = size / 2;
  return (
    <View style={[styles.rim, {width: size, height: size}]} pointerEvents="none">
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.14" />
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r - 0.75} fill="none" stroke={`url(#${id})`} strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

type Props = {
  /** The one flat colour of the tile. */
  color: string;
  size?: number;
  children?: React.ReactNode;
};

/** A single flat colour round tile with a lit edge and a very soft shadow in its own colour. */
export function Tile3D({color, size = 38, children}: Props) {
  return (
    <View style={[styles.base, {width: size, height: size, borderRadius: size / 2, backgroundColor: color, shadowColor: color}]}>
      <Rim size={size} />
      <View style={styles.glyph}>{children}</View>
    </View>
  );
}

/** A coloured tile with a white symbol inside, the colour chosen from the symbol. */
export function IconTile({icon, size = 38, color, strokeWidth = 2.1}: {icon: IconName; size?: number; color?: string; strokeWidth?: number}) {
  const g = Math.round(size * 0.53);
  return (
    <Tile3D color={color ?? tileColor(icon)} size={size}>
      {/* a faint dark copy just below the white symbol makes it look raised */}
      <View style={styles.glyphShadow}>
        <Icon name={icon} size={g} color="#000000" strokeWidth={strokeWidth} />
      </View>
      <Icon name={icon} size={g} color="#FFFFFF" strokeWidth={strokeWidth} />
    </Tile3D>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 1,
  },
  rim: {position: 'absolute', top: 0, left: 0},
  glyph: {alignItems: 'center', justifyContent: 'center'},
  glyphShadow: {position: 'absolute', top: 1.5, opacity: 0.12},
}));

export default Tile3D;
