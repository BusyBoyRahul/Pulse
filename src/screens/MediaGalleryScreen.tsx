import {themedStyles} from '@/theme/themed';
import React, {useMemo, useState} from 'react';
import {FlatList, Image, Linking, Pressable, StyleSheet, ToastAndroid, View, useWindowDimensions} from 'react-native';
import {RouteProp, useRoute} from '@react-navigation/native';

import {Screen, Txt, Icon, IconTile, ImageViewer} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {sharedMedia, MediaFile, MediaLink, MediaVisual, MediaPhoto} from '@/services/sharedMedia';
import {formatBytes, formatDuration, mediaFiles} from '@/services/mediaFiles';
import {dayLabel} from './ConversationScreen';

type R = RouteProp<RootStackParamList, 'Media'>;
type Tab = 'visual' | 'files' | 'links';
const GAP = 2;
const COLS = 3;

/**
 * Everything shared in one chat, in one place: photos and videos in a grid (swipe through the photos full screen),
 * files and voice notes, and the links people wrote. Reached from "See all" in a profile or a group.
 */
export default function MediaGalleryScreen() {
  const {conversationId} = useRoute<R>().params;
  const messages = useChatStore(s => s.byConversation[conversationId]);
  const media = useMemo(() => sharedMedia(messages ?? []), [messages]);
  const {width} = useWindowDimensions();
  const [tab, setTab] = useState<Tab | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const counts: Record<Tab, number> = {visual: media.visual.length, files: media.files.length, links: media.links.length};
  const labels: Record<Tab, string> = {visual: 'Photos & videos', files: 'Files', links: 'Links'};
  const tabs = (['visual', 'files', 'links'] as Tab[]).filter(t => counts[t] > 0);
  const current: Tab | null = tab && counts[tab] > 0 ? tab : tabs[0] ?? null;

  const photos = media.visual.filter((v): v is MediaPhoto => v.kind === 'photo');
  const size = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const openVisual = (v: MediaVisual) => {
    if (v.kind === 'photo') {
      setViewing(photos.findIndex(p => p.id === v.id));
    } else if (v.msg.file?.path) {
      void mediaFiles.open(v.msg.file.path, v.msg.file.mime).then(err => err && ToastAndroid.show('Can’t open this video', ToastAndroid.SHORT));
    } else {
      ToastAndroid.show('Still arriving…', ToastAndroid.SHORT);
    }
  };
  const openFile = (f: MediaFile) => {
    const file = f.msg.file;
    if (!file?.path || !file.done) {
      ToastAndroid.show('Still arriving…', ToastAndroid.SHORT);
      return;
    }
    void mediaFiles.open(file.path, file.mime).then(err => err && ToastAndroid.show('Can’t open this file', ToastAndroid.SHORT));
  };

  if (!current) {
    return (
      <Screen edges={['left', 'right']} bottomClear={false}>
        <View style={styles.empty}>
          <IconTile icon="image" size={56} color={colors.primary} />
          <Txt variant="subtitle" center>
            Nothing shared yet
          </Txt>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={['left', 'right']} bottomClear={false}>
      {tabs.length > 1 ? (
        <View style={styles.chips}>
          {tabs.map(t => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.chip, current === t && styles.chipOn]} accessibilityRole="button" accessibilityState={{selected: current === t}}>
              <Txt variant="bodyStrong" style={{color: current === t ? colors.onPrimary : colors.text}}>
                {labels[t]} · {counts[t]}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      {current === 'visual' ? (
        <FlatList
          key="grid"
          data={media.visual}
          numColumns={COLS}
          keyExtractor={v => v.id}
          columnWrapperStyle={{gap: GAP}}
          ItemSeparatorComponent={() => <View style={{height: GAP}} />}
          initialNumToRender={18}
          windowSize={7}
          contentContainerStyle={styles.gridPad}
          renderItem={({item}) => (
            <Pressable onPress={() => openVisual(item)} style={[styles.cell, {width: size, height: size}]} accessibilityRole="button" accessibilityLabel={item.kind === 'video' ? 'Video' : 'Photo'}>
              {item.kind === 'photo' ? (
                <Image source={{uri: `data:image/jpeg;base64,${item.image}`}} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" />
              ) : item.thumb ? (
                <Image source={{uri: `data:image/jpeg;base64,${item.thumb}`}} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" />
              ) : null}
              {item.kind === 'video' ? (
                <View style={styles.videoBadge}>
                  <Icon name="play" size={12} color="#FFFFFF" />
                  <Txt variant="caption" style={styles.videoTxt}>
                    {formatDuration(item.msg.file?.dur)}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      ) : current === 'files' ? (
        <FlatList
          key="files"
          data={media.files}
          keyExtractor={f => f.id}
          contentContainerStyle={styles.listPad}
          renderItem={({item}) => (
            <Pressable onPress={() => openFile(item)} style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfaceHover}]} accessibilityRole="button">
              <IconTile icon={item.kind === 'voice' || item.kind === 'audio' ? 'mic' : 'file'} size={44} color={colors.primary} />
              <View style={styles.rowText}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {item.kind === 'voice' ? 'Voice message' : item.msg.file?.name ?? 'File'}
                </Txt>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {item.kind === 'voice' ? formatDuration(item.msg.file?.dur) : formatBytes(item.msg.file?.size ?? 0)} · {dayLabel(item.at)}
                </Txt>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          key="links"
          data={media.links}
          keyExtractor={l => l.id}
          contentContainerStyle={styles.listPad}
          renderItem={({item}: {item: MediaLink}) => (
            <Pressable
              onPress={() => void Linking.openURL(item.url).catch(() => ToastAndroid.show('Can’t open this link', ToastAndroid.SHORT))}
              style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfaceHover}]}
              accessibilityRole="link">
              <IconTile icon="globe" size={44} color={colors.primary} />
              <View style={styles.rowText}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {item.url.replace(/^https?:\/\//i, '')}
                </Txt>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {item.msg.mine ? 'You' : item.msg.fromName} · {dayLabel(item.at)}
                </Txt>
              </View>
            </Pressable>
          )}
        />
      )}

      <ImageViewer
        image={viewing !== null && photos[viewing] ? photos[viewing].image : null}
        onClose={() => setViewing(null)}
        gallery={viewing !== null ? {images: photos.map(p => p.image), index: viewing, onIndex: setViewing} : undefined}
      />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  empty: {alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl},
  chips: {flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  chip: {height: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  gridPad: {paddingBottom: spacing.xxl},
  cell: {backgroundColor: colors.surfaceRaised, overflow: 'hidden'},
  videoBadge: {position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)'},
  videoTxt: {color: '#FFFFFF', fontSize: 11, lineHeight: 14},
  listPad: {paddingBottom: spacing.xxl},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  rowText: {flex: 1},
}));
