import React from 'react';
import {Image, StyleSheet, View} from 'react-native';
import Svg, {Circle, Defs, Pattern, Rect} from 'react-native-svg';
import {colors, mix, themeInfo} from '@/theme/theme';
import {Gradient} from './Gradient';
import type {AppSettings} from '@/store/settingsStore';

export type WallpaperKind = AppSettings['wallpaper'];

export const WALLPAPERS: {kind: WallpaperKind; label: string}[] = [
  {kind: 'default', label: 'Default'},
  {kind: 'black', label: 'Plain'},
  {kind: 'slate', label: 'Slate'},
  {kind: 'dusk', label: 'Tint'},
  {kind: 'dots', label: 'Dots'},
];

/** The picture behind a chat. Fills its parent. Always matches the chosen theme. */
export function Wallpaper({kind, photo, opacity = 1, blur = 0}: {kind: WallpaperKind; photo?: string | null; opacity?: number; blur?: number}) {
  const plain = <View style={[StyleSheet.absoluteFill, {backgroundColor: colors.bg}]} />;
  switch (kind) {
    case 'black':
      return plain;
    case 'slate':
      return <Gradient colors={[colors.surfaceRaised, colors.bg]} angle="vertical" style={StyleSheet.absoluteFill} />;
    case 'dusk':
      return <Gradient colors={[mix(colors.primary, colors.bg, themeInfo.isDark ? 0.22 : 0.14), colors.bg]} angle="vertical" style={StyleSheet.absoluteFill} />;
    case 'dots':
      return (
        <View style={[StyleSheet.absoluteFill, {backgroundColor: colors.bg}]}>
          <Svg width="100%" height="100%">
            <Defs>
              <Pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
                <Circle cx={11} cy={11} r={1.3} fill={colors.border} />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#dots)" />
          </Svg>
        </View>
      );
    case 'photo':
      return photo ? (
        // The picture itself, as it is. How much of it shows (opacity) and how soft it is (blur) are the person's choice;
        // there is no tint laid over it.
        <View style={[StyleSheet.absoluteFill, {backgroundColor: colors.bg}]}>
          <Image source={{uri: `data:image/jpeg;base64,${photo}`}} style={[StyleSheet.absoluteFill, {opacity}]} resizeMode="cover" blurRadius={blur} />
        </View>
      ) : (
        plain
      );
    default:
      return plain;
  }
}

export default Wallpaper;
