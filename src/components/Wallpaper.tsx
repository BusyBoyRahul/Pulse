import React from 'react';
import {Image, StyleSheet, View} from 'react-native';
import Svg, {Circle, Defs, Pattern, Rect} from 'react-native-svg';
import {Gradient} from './Gradient';
import type {AppSettings} from '@/store/settingsStore';

export type WallpaperKind = AppSettings['wallpaper'];

export const WALLPAPERS: {kind: WallpaperKind; label: string}[] = [
  {kind: 'default', label: 'Default'},
  {kind: 'black', label: 'Pure black'},
  {kind: 'slate', label: 'Slate'},
  {kind: 'dusk', label: 'Dusk'},
  {kind: 'dots', label: 'Dots'},
];

/** The picture behind a chat. Fills its parent. */
export function Wallpaper({kind, photo}: {kind: WallpaperKind; photo?: string | null}) {
  switch (kind) {
    case 'black':
      return <View style={[StyleSheet.absoluteFill, {backgroundColor: '#000'}]} />;
    case 'slate':
      return <Gradient colors={['#1A1C21', '#0A0B0D']} angle="vertical" style={StyleSheet.absoluteFill} />;
    case 'dusk':
      return <Gradient colors={['#22202E', '#060609']} angle="vertical" style={StyleSheet.absoluteFill} />;
    case 'dots':
      return (
        <View style={[StyleSheet.absoluteFill, {backgroundColor: '#050505'}]}>
          <Svg width="100%" height="100%">
            <Defs>
              <Pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
                <Circle cx={11} cy={11} r={1.3} fill="#2B2B30" />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#dots)" />
          </Svg>
        </View>
      );
    case 'photo':
      return photo ? (
        <View style={StyleSheet.absoluteFill}>
          <Image source={{uri: `data:image/jpeg;base64,${photo}`}} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(0,0,0,0.55)'}]} />
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, {backgroundColor: '#000'}]} />
      );
    default:
      return <Gradient colors={['#0C0C0E', '#000000']} angle="vertical" style={StyleSheet.absoluteFill} />;
  }
}

export default Wallpaper;
