import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {sharedMedia, MediaVisual} from '@/services/sharedMedia';
import type {ChatMessage} from '@/types';
import {Icon} from './Icon';
import {SettingLabel, SettingRow, SettingGroup} from './SettingRow';
import {Txt} from './Text';

const THUMB = 76;
const SHOWN = 12;

type Props = {
  messages: ChatMessage[];
  /** A photo or video in the strip was tapped. */
  onOpen: (item: MediaVisual) => void;
  /** "See all": the Media screen. */
  onSeeAll: () => void;
};

/**
 * Shared media in a profile or group: a small row of the newest photos and videos that slides sideways, and "See all"
 * for the Media screen. Shows nothing at all when nothing was shared (no empty box, no empty heading).
 */
export function MediaStrip({messages, onOpen, onSeeAll}: Props) {
  const media = useMemo(() => sharedMedia(messages), [messages]);
  const total = media.visual.length + media.files.length + media.links.length;
  if (total === 0) {
    return null;
  }
  const shown = media.visual.slice(0, SHOWN);
  const more = media.visual.length - shown.length;

  return (
    <View>
      <View style={styles.head}>
        <SettingLabel>{media.visual.length ? `MEDIA · ${media.visual.length}` : 'FILES AND LINKS'}</SettingLabel>
        <Pressable onPress={onSeeAll} hitSlop={10} style={styles.seeAll} accessibilityRole="button" accessibilityLabel="See all media">
          <Txt variant="bodyStrong" tone="accent">
            See all
          </Txt>
          <Icon name="chevronRight" size={16} color={colors.primaryBright} />
        </Pressable>
      </View>

      {shown.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row}>
          {shown.map(it => (
            <Pressable key={it.id} onPress={() => onOpen(it)} style={styles.thumb} accessibilityRole="button" accessibilityLabel={it.kind === 'video' ? 'Video' : 'Photo'}>
              {it.kind === 'photo' ? (
                <Image source={{uri: `data:image/jpeg;base64,${it.image}`}} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : it.thumb ? (
                <Image source={{uri: `data:image/jpeg;base64,${it.thumb}`}} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : null}
              {it.kind === 'video' ? (
                <View style={styles.play}>
                  <Icon name="play" size={14} color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          ))}
          <Pressable onPress={onSeeAll} style={[styles.thumb, styles.more]} accessibilityRole="button" accessibilityLabel="See all media">
            {more > 0 ? (
              <Txt variant="subtitle" tone="secondary">
                +{more}
              </Txt>
            ) : (
              <Icon name="chevronRight" size={22} color={colors.textSecondary} />
            )}
          </Pressable>
        </ScrollView>
      ) : (
        <SettingGroup>
          <SettingRow icon="file" title="Files and links" value={String(media.files.length + media.links.length)} onPress={onSeeAll} />
        </SettingGroup>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: {flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'},
  seeAll: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: spacing.xs},
  // runs to the screen edges (the page has a side margin), so thumbnails slide off the edge instead of being cut short
  bleed: {marginHorizontal: -spacing.xl},
  row: {gap: spacing.sm, paddingHorizontal: spacing.xl},
  thumb: {width: THUMB, height: THUMB, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  more: {alignItems: 'center', justifyContent: 'center'},
  play: {position: 'absolute', right: 5, bottom: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'},
}));

export default MediaStrip;
