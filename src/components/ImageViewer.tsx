import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Image, Keyboard, Modal, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, themeInfo} from '@/theme/theme';
import {notifier} from '@/services/notifier';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';

type Props = {
  /** base64 JPEG (no data: prefix), or null to hide the viewer. */
  image: string | null;
  caption?: string;
  onClose: () => void;
  /** Shows a Save button (to the gallery). Leave out for view-once photos. */
  onSave?: () => void;
  /** Extra things you can do with the photo, in a ⋮ menu (save, use as background…). */
  actions?: {icon: IconName; label: string; onPress: () => void}[];
  /** Shows a reply bar with two quick reactions; the text (or emoji) is sent to the chat. */
  onReply?: (text: string) => void;
  /** Several photos from one album: swipe between them, with a counter and a thumbnail strip. `image` is the current one. */
  gallery?: {images: string[]; index: number; onIndex: (i: number) => void};
  /** Accessibility label for the Save button ("Save all 4 photos"). */
  saveLabel?: string;
};

const QUICK = ['❤️', '🙏'];

const MAX_ZOOM = 5;

/**
 * Full-screen photo on black. Tap the photo to hide or show the buttons (the status bar goes too),
 * double-tap or pinch to zoom, drag to move around when zoomed. The buttons sit on dark discs with a
 * light edge, so they stay visible even over a white photo.
 */
export function ImageViewer({image, caption, onClose, onSave, actions, onReply, gallery, saveLabel}: Props) {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [reply, setReply] = useState('');
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const count = gallery?.images.length ?? 0;
  const paged = count > 1;
  const step = (dir: number) => {
    if (gallery) {
      const next = Math.min(count - 1, Math.max(0, gallery.index + dir));
      if (next !== gallery.index) {
        gallery.onIndex(next);
      }
    }
  };

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  useEffect(() => {
    if (image) {
      setChrome(true);
      setMenu(false);
      setReply('');
      scale.value = 1;
      savedScale.value = 1;
      x.value = 0;
      y.value = 0;
      savedX.value = 0;
      savedY.value = 0;
    }
  }, [image, scale, savedScale, x, y, savedX, savedY]);

  // Black behind the navigation bar too while a photo is open.
  useEffect(() => {
    if (!image) {
      return undefined;
    }
    notifier.setWindowColor(colors.bg);
    return () => notifier.setWindowColor(colors.bg);
  }, [image]);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1, {duration: 160});
    savedScale.value = 1;
    x.value = withTiming(0, {duration: 160});
    y.value = withTiming(0, {duration: 160});
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(MAX_ZOOM, Math.max(0.8, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        reset();
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate(e => {
      if (savedScale.value > 1) {
        const mx = (width * scale.value - width) / 2;
        const my = (height * scale.value - height) / 2;
        x.value = Math.max(-mx, Math.min(mx, savedX.value + e.translationX));
        y.value = Math.max(-my, Math.min(my, savedY.value + e.translationY));
      } else if (paged) {
        x.value = e.translationX * 0.6; // not zoomed: the photo follows the finger as you page
      }
    })
    .onEnd(e => {
      if (savedScale.value <= 1) {
        if (paged && Math.abs(e.translationX) > 70 && Math.abs(e.translationX) > Math.abs(e.translationY)) {
          runOnJS(step)(e.translationX < 0 ? 1 : -1);
        }
        x.value = withTiming(0, {duration: 160});
        return;
      }
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        reset();
      } else {
        scale.value = withTiming(2.5, {duration: 180});
        savedScale.value = 2.5;
      }
    });

  const singleTap = Gesture.Tap()
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      runOnJS(setChrome)(!chrome);
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, singleTap));

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{translateX: x.value}, {translateY: y.value}, {scale: scale.value}],
  }));

  return (
    <Modal visible={!!image} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} hidden={!chrome} />
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{width, height}, photoStyle]}>
            {image ? <Image source={{uri: `data:image/jpeg;base64,${image}`}} style={{width, height}} resizeMode="contain" /> : null}
          </Animated.View>
        </GestureDetector>

        {chrome ? (
          <>
            <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.top, {paddingTop: insets.top + 8}]} pointerEvents="box-none">
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close photo" style={styles.btn}>
                <Icon name="x" size={22} color={colors.text} />
              </Pressable>
              <View style={styles.topRight}>
                {onSave ? (
                  <Pressable onPress={onSave} hitSlop={12} accessibilityRole="button" accessibilityLabel={saveLabel ?? 'Save photo to gallery'} style={styles.btn}>
                    <Icon name="download" size={22} color={colors.text} />
                  </Pressable>
                ) : null}
                {actions && actions.length ? (
                  <Pressable onPress={() => setMenu(m => !m)} hitSlop={12} accessibilityRole="button" accessibilityLabel="More" style={styles.btn}>
                    <Icon name="more" size={22} color={colors.text} />
                  </Pressable>
                ) : null}
              </View>
            </Animated.View>
            {paged && gallery ? (
              <>
                <View style={[styles.counter, {top: insets.top + 8 + 9}]} pointerEvents="none">
                  <Txt variant="label" style={{color: colors.text}}>
                    {gallery.index + 1} / {count}
                  </Txt>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.strip, {top: insets.top + 8 + 54}]} contentContainerStyle={styles.stripRow}>
                  {gallery.images.map((img, i) => (
                    <Pressable key={i} onPress={() => gallery.onIndex(i)} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1}`} style={[styles.thumb, i === gallery.index && styles.thumbOn]}>
                      <Image source={{uri: `data:image/jpeg;base64,${img}`}} style={styles.thumbImg} resizeMode="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            {menu && actions ? (
              <>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} accessibilityLabel="Close menu" />
                <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(90)} style={[styles.menu, {top: insets.top + 64}]}>
                  {actions.map(a => (
                    <Pressable
                      key={a.label}
                      onPress={() => {
                        setMenu(false);
                        a.onPress();
                      }}
                      style={({pressed}) => [styles.menuItem, pressed && {backgroundColor: colors.surfaceHover}]}>
                      <Icon name={a.icon} size={20} color={colors.textSecondary} />
                      <Txt variant="body" style={styles.menuTxt}>
                        {a.label}
                      </Txt>
                    </Pressable>
                  ))}
                </Animated.View>
              </>
            ) : null}
            {onReply ? (
              <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.replyBar, {bottom: kb > 0 ? kb + 8 : insets.bottom + 12}]}>
                <View style={styles.replyBox}>
                  <TextInput
                    value={reply}
                    onChangeText={setReply}
                    placeholder="Reply"
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="send"
                    onSubmitEditing={() => {
                      if (reply.trim()) {
                        onReply(reply.trim());
                        setReply('');
                      }
                    }}
                    style={styles.replyInput}
                  />
                </View>
                {reply.trim() ? (
                  <Pressable
                    onPress={() => {
                      onReply(reply.trim());
                      setReply('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Send reply"
                    style={styles.btn}>
                    <Icon name="send" size={20} color={colors.text} />
                  </Pressable>
                ) : (
                  QUICK.map(e => (
                    <Pressable key={e} onPress={() => onReply(e)} accessibilityRole="button" accessibilityLabel={`React ${e}`} style={styles.btn}>
                      <Txt style={styles.emoji}>{e}</Txt>
                    </Pressable>
                  ))
                )}
              </Animated.View>
            ) : null}
            {caption ? (
              <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.caption, onReply ? {bottom: (kb > 0 ? kb + 8 : insets.bottom + 12) + 58, paddingBottom: 12} : {paddingBottom: insets.bottom + 16}]} pointerEvents="none">
                <Txt variant="caption" center style={styles.captionTxt}>
                  {caption}
                </Txt>
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: {flexDirection: 'row', gap: 10},
  counter: {position: 'absolute', alignSelf: 'center', height: 26, paddingHorizontal: 12, borderRadius: 13, justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  strip: {position: 'absolute', left: 0, right: 0, height: 54},
  stripRow: {gap: 8, paddingHorizontal: 16, alignItems: 'center'},
  thumb: {width: 46, height: 46, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', opacity: 0.7},
  thumbOn: {borderColor: colors.primary, opacity: 1},
  thumbImg: {width: '100%', height: '100%'},
  menu: {position: 'absolute', left: 0, right: 0, paddingVertical: 4, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  menuItem: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 52},
  menuTxt: {color: colors.text},
  replyBar: {position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10},
  replyBox: {flex: 1, height: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 18, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  replyInput: {color: colors.text, fontSize: 16, padding: 0},
  emoji: {fontSize: 20},
  caption: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 24, backgroundColor: colors.surface},
  captionTxt: {color: colors.text},
}));

export default ImageViewer;
