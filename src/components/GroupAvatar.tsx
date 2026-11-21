import React from 'react';
import {Image} from 'react-native';
import {colors} from '@/theme/theme';
import {IconTile} from './Tile3D';

/** A group's picture, round: the picture the group has, or the group icon in the app's colour. The same everywhere. */
export function GroupAvatar({pic, size = 44}: {pic?: string | null; size?: number}) {
  if (pic) {
    return <Image source={{uri: `data:image/jpeg;base64,${pic}`}} style={{width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceRaised}} />;
  }
  return <IconTile icon="users" size={size} color={colors.primary} />;
}

export default GroupAvatar;
