import {themedStyles} from '@/theme/themed';
import React from 'react';
import {Image, Pressable, StyleSheet, View, ViewStyle} from 'react-native';
import {colors} from '@/theme/theme';
import type {ChatMessage} from '@/types';
import {Icon} from './Icon';
import {Txt} from './Text';

type Props = {
  /** The photos that have started arriving (or been sent), in order. */
  members: ChatMessage[];
  /** How many photos the album will have in the end. */
  total: number;
  /** Blurred until tapped (spoiler, and it is not mine). */
  hidden: boolean;
  /** A tile was tapped: open the gallery at this photo (index into `members`). */
  onOpen: (index: number) => void;
  /** Tapped while hidden: show them. */
  onReveal: () => void;
  /** The chat is in select mode: a tap selects the whole album instead of opening it. */
  selecting?: boolean;
  onToggle?: () => void;
  /** Long press on a tile = the same message menu as anywhere else on the bubble. */
  onLongPress?: () => void;
  /** Corner rounding that lines up with the bubble around it. */
  corners?: ViewStyle;
};

export const ALBUM_W = 240;
const W = ALBUM_W;
const GAP = 2;
const MAX_TILES = 4;

type Box = {x: number; y: number; w: number; h: number};

/** Where each tile goes: 2 side by side, 3 = one big and two small, 4 = a square of four. */
function layout(n: number): {boxes: Box[]; height: number} {
  const half = (W - GAP) / 2;
  if (n <= 2) {
    const h = 168;
    return {boxes: [{x: 0, y: 0, w: half, h}, {x: half + GAP, y: 0, w: half, h}].slice(0, n), height: h};
  }
  if (n === 3) {
    const big = Math.round(W * 0.62);
    const small = W - big - GAP;
    const h = 210;
    const sh = (h - GAP) / 2;
    return {boxes: [{x: 0, y: 0, w: big, h}, {x: big + GAP, y: 0, w: small, h: sh}, {x: big + GAP, y: sh + GAP, w: small, h: sh}], height: h};
  }
  return {
    boxes: [
      {x: 0, y: 0, w: half, h: half},
      {x: half + GAP, y: 0, w: half, h: half},
      {x: 0, y: half + GAP, w: half, h: half},
      {x: half + GAP, y: half + GAP, w: half, h: half},
    ],
    height: half * 2 + GAP,
  };
}

/**
 * Photos sent together, shown as one picture block in a chat bubble (like a photo album): a tidy grid, a "+N" on the
 * last tile when there are more than four, and a live percentage on any tile still arriving. Tapping a tile opens the
 * swipeable gallery.
 */
export function AlbumGrid({members, total, hidden, onOpen, onReveal, selecting, onToggle, onLongPress, corners}: Props) {
  const shown = Math.min(Math.max(total, members.length), MAX_TILES);
  const {boxes, height} = layout(shown);
  const extra = Math.max(total, members.length) - MAX_TILES;

  return (
    <View style={[styles.grid, {width: W, height}, corners]}>
      {boxes.map((b, i) => {
        const m = members[i];
        const pct = m && m.progress !== undefined && m.progress < 1 ? Math.round(m.progress * 100) : null;
        const failed = m?.status === 'failed';
        return (
          <Pressable
            key={i}
            disabled={!selecting && !m?.image && !hidden}
            onPress={() => (selecting ? onToggle?.() : hidden ? onReveal() : m?.image ? onOpen(i) : undefined)}
            onLongPress={onLongPress}
            delayLongPress={220}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Spoiler photos, tap to reveal' : `Photo ${i + 1} of ${total}`}
            style={[styles.tile, {left: b.x, top: b.y, width: b.w, height: b.h}]}>
            {m?.image ? (
              <Image source={{uri: `data:image/jpeg;base64,${m.image}`}} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={hidden ? 40 : 0} />
            ) : (
              <View style={styles.waiting}>
                {failed ? <Icon name="info" size={20} color={colors.textMuted} /> : <Icon name="image" size={22} color={colors.textMuted} />}
                <Txt variant="caption" tone="muted">
                  {failed ? 'Didn’t arrive' : m ? (pct !== null ? `${pct}%` : 'Loading…') : 'Waiting…'}
                </Txt>
              </View>
            )}
            {m?.image && pct !== null ? (
              <View style={styles.pct}>
                <Txt variant="label" style={styles.pctTxt}>
                  {pct}%
                </Txt>
              </View>
            ) : null}
            {i === MAX_TILES - 1 && extra > 0 ? (
              <View style={styles.more}>
                <Txt variant="title" style={styles.moreTxt}>
                  +{extra}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {hidden ? (
        <View style={styles.veil} pointerEvents="none">
          <Icon name="spoiler" size={24} color="#FFFFFF" />
          <Txt variant="caption" style={styles.pctTxt}>
            Spoiler · tap to reveal
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  grid: {borderRadius: 16, overflow: 'hidden'},
  tile: {position: 'absolute', overflow: 'hidden', backgroundColor: colors.surface},
  waiting: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4},
  pct: {position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 7, height: 20, borderRadius: 10, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)'},
  pctTxt: {color: '#FFFFFF'},
  more: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)'},
  moreTxt: {color: '#FFFFFF'},
  veil: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)'},
}));

export default AlbumGrid;
