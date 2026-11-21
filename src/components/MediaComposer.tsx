import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Image, Keyboard, Modal, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, elevation, spacing, themeInfo} from '@/theme/theme';
import {Icon, IconName} from './Icon';
import {Popover, PopoverItem} from './Popover';
import {Txt} from './Text';
import {IconTile, Rim} from './Tile3D';

export type OutItem = {key: string} & ({kind: 'photo'; base64: string} | {kind: 'file'; file: {name: string; size: number; mime: string}});

/** How long a photo lives once the other person opens it: 0 = no limit, -1 = one look, otherwise seconds. */
export const PHOTO_TIMERS: {v: number; label: string}[] = [
  {v: 0, label: 'Off'},
  {v: -1, label: 'Once'},
  {v: 5, label: '5 sec'},
  {v: 10, label: '10 sec'},
  {v: 30, label: '30 sec'},
  {v: 60, label: '1 min'},
];

export function timerNote(v: number): string {
  if (v === 0) {
    return 'Stays in the chat like any other photo.';
  }
  if (v === -1) {
    return 'They can open it one time, then it is deleted from both phones.';
  }
  return `It closes and is deleted ${v >= 60 ? v / 60 + ' minute' : v + ' seconds'} after they open it.`;
}

type Props = {
  visible: boolean;
  items: OutItem[];
  /** Who it is going to. */
  title: string;
  maxItems: number;
  spoiler: boolean;
  onSpoiler: (v: boolean) => void;
  /** undefined = photo timers are not available here (groups). */
  timer?: number;
  onTimer: (v: number) => void;
  caption: string;
  onCaption: (v: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  onRotate: (key: string) => void;
  /** Open the photo editor (draw, text, crop) for this photo. */
  onEdit: (key: string) => void;
  onClose: () => void;
  onSend: () => void;
  sizeLabel: (bytes: number) => string;
  fileIcon: (mime: string) => IconName;
};

/** A round button in the theme's raised colour. `on` fills it with the accent. */
function Round({icon, label, on, onPress}: {icon: IconName; label: string; on?: boolean; onPress: () => void}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: !!on}}
      style={({pressed}) => [styles.round, on && styles.roundOn, pressed && {opacity: 0.75}]}>
      <Icon name={icon} size={20} color={on ? '#FFFFFF' : colors.text} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * Full-screen page before sending: the chosen picture (or file) large, a strip of everything picked, one caption, and
 * a round send button. Along the top: rotate, spoiler (blurred until tapped) and a photo timer (once, or a number of
 * seconds after they open it). The timer choices open as a strip right on the page, not as a pop-up, and the picture
 * blurs while a spoiler or timer is on so you see what the other person will see first.
 */
export function MediaComposer({visible, items, title, maxItems, spoiler, onSpoiler, timer, onTimer, caption, onCaption, onRemove, onAdd, onRotate, onEdit, onClose, onSend, sizeLabel, fileIcon}: Props) {
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState(0);
  const [kb, setKb] = useState(0);
  const [timerOpen, setTimerOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setTimerOpen(false);
    }
  }, [visible]);

  const index = Math.min(sel, Math.max(0, items.length - 1));
  const cur = items[index];
  const allPhotos = items.length > 0 && items.every(i => i.kind === 'photo');
  const t = timer ?? 0;
  const hidden = allPhotos && (spoiler || t !== 0);

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.root, {paddingTop: insets.top + spacing.sm, paddingBottom: (kb > 0 ? kb : insets.bottom) + spacing.md}]}>
        <View style={styles.top}>
          <Round icon="x" label="Discard" onPress={onClose} />
          <View style={styles.topRight}>
            {cur?.kind === 'photo' ? <Round icon="edit" label="Edit photo" onPress={() => onEdit(cur.key)} /> : null}
            {cur?.kind === 'photo' ? <Round icon="rotate" label="Rotate" onPress={() => onRotate(cur.key)} /> : null}
            {allPhotos ? <Round icon="spoiler" label="Hide as spoiler" on={spoiler} onPress={() => onSpoiler(!spoiler)} /> : null}
            {allPhotos && timer !== undefined ? <Round icon="timer" label="Photo timer" on={t !== 0} onPress={() => setTimerOpen(true)} /> : null}
          </View>
        </View>

        {/* The timer is a dropdown, like every other menu: the picture never moves */}
        <Popover visible={timerOpen && allPhotos && timer !== undefined} onClose={() => setTimerOpen(false)} align="right">
          {PHOTO_TIMERS.map(o => (
            <PopoverItem
              key={o.v}
              icon={o.v === 0 ? 'image' : o.v === -1 ? 'eye' : 'timer'}
              label={o.label}
              selected={t === o.v}
              onPress={() => {
                onTimer(o.v);
                setTimerOpen(false);
              }}
            />
          ))}
          <Txt variant="caption" tone="secondary" style={styles.timerNote}>
            {timerNote(t)}
          </Txt>
        </Popover>

        <View style={styles.stage}>
          {cur?.kind === 'photo' ? (
            <>
              <Image source={{uri: 'data:image/jpeg;base64,' + cur.base64}} style={StyleSheet.absoluteFill} resizeMode="contain" blurRadius={hidden ? 28 : 0} />
              {hidden ? (
                <View style={styles.hiddenChip} pointerEvents="none">
                  <Icon name={t !== 0 ? 'timer' : 'spoiler'} size={14} color="#FFFFFF" />
                  <Txt variant="caption" style={styles.white}>
                    {t === -1 ? 'One look · hidden until they open it' : t > 0 ? `${t >= 60 ? '1 min' : t + ' sec'} after opening · hidden until they open it` : 'Hidden until they tap it'}
                  </Txt>
                </View>
              ) : null}
            </>
          ) : cur ? (
            <View style={styles.fileCard}>
              <IconTile icon={fileIcon(cur.file.mime)} size={84} color={colors.primary} />
              <Txt variant="subtitle" center numberOfLines={2}>
                {cur.file.name}
              </Txt>
              <Txt variant="caption" tone="secondary">
                {sizeLabel(cur.file.size)}
              </Txt>
            </View>
          ) : null}
        </View>

        {items.length > 1 || items.length < maxItems ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
            {items.map((it, i) => (
              <Pressable key={it.key} onPress={() => setSel(i)} accessibilityRole="button" accessibilityLabel={`Item ${i + 1}`} style={[styles.thumb, i === index && styles.thumbOn]}>
                {it.kind === 'photo' ? (
                  <Image source={{uri: 'data:image/jpeg;base64,' + it.base64}} style={styles.thumbImg} resizeMode="cover" />
                ) : (
                  <View style={styles.thumbFile}>
                    <Icon name={fileIcon(it.file.mime)} size={22} color={colors.text} />
                  </View>
                )}
                {i === index && items.length > 1 ? (
                  <Pressable onPress={() => onRemove(it.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove" style={styles.thumbX}>
                    <Icon name="x" size={12} color={colors.text} strokeWidth={3} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
            {items.length < maxItems ? (
              <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add more" style={[styles.thumb, styles.thumbAdd]}>
                <Icon name="plus" size={22} color={colors.text} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}

        <View style={styles.captionBox}>
          <TextInput
            value={caption}
            onChangeText={onCaption}
            placeholder={items.length > 1 ? 'Add a caption to the first one…' : 'Add a caption…'}
            placeholderTextColor={colors.textMuted}
            maxLength={500}
            multiline
            style={styles.captionInput}
          />
        </View>

        <View style={styles.bottom}>
          <View style={styles.to}>
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              To {title}
            </Txt>
          </View>
          <Pressable onPress={onSend} accessibilityRole="button" accessibilityLabel={items.length > 1 ? `Send ${items.length}` : 'Send'} style={({pressed}) => [styles.send, pressed && {opacity: 0.85}]}>
            <Rim size={58} />
            <Icon name="send" size={24} color="#FFFFFF" />
            {items.length > 1 ? (
              <View style={styles.count}>
                <Txt variant="label" style={styles.countTxt}>
                  {items.length}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg},
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md},
  topRight: {flexDirection: 'row', gap: spacing.sm},
  round: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  roundOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  timerNote: {paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, maxWidth: 260},
  stage: {flex: 1, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface},
  hiddenChip: {position: 'absolute', bottom: spacing.md, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)'},
  fileCard: {alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl},
  white: {color: '#FFFFFF'},
  stripScroll: {flexGrow: 0, marginTop: spacing.md},
  strip: {gap: spacing.sm, alignItems: 'center', paddingVertical: 4},
  thumb: {width: 56, height: 56, borderRadius: 14, overflow: 'visible', borderWidth: 2, borderColor: 'transparent'},
  thumbOn: {borderColor: colors.primary},
  thumbImg: {width: '100%', height: '100%', borderRadius: 12},
  thumbFile: {flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised},
  thumbAdd: {alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderStyle: 'dashed'},
  thumbX: {position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1.5, borderColor: colors.border},
  captionBox: {marginTop: spacing.md, minHeight: 48, maxHeight: 110, borderRadius: 24, justifyContent: 'center', paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  captionInput: {color: colors.text, fontSize: 16, paddingVertical: 10},
  bottom: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md},
  to: {flex: 1, marginRight: spacing.md, height: 36, borderRadius: 18, justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignSelf: 'center'},
  send: {width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...elevation.floating},
  count: {position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, borderWidth: 2, borderColor: colors.bg},
  countTxt: {color: colors.bg, fontSize: 11, lineHeight: 14},
}));

export default MediaComposer;
