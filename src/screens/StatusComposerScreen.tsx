import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Image, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, TextInput, View} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '@/navigation/types';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {IconButton, Pressy, Icon, Txt, Rim} from '@/components';
import {colors, elevation, spacing} from '@/theme/theme';
import {photos, PhotoKey, STATUS_BACKGROUNDS} from '@/assets/images';
import {pickStatusPhoto, takeStatusPhoto} from '@/services/imagePicker';
import {useStatusStore} from '@/store/statusStore';
import {alertDialog} from '@/components/Dialog';

const COLOURS = ['#2F8BFF', '#7C5CFF', '#12B981', '#F0457E', '#F5A524', '#14B8C6', '#FF6B5B', '#1F2937'];

/** Background -> what to draw behind the text. */
export function Backdrop({bg, photo, dim = true}: {bg: string; photo?: string; dim?: boolean}) {
  if (photo) {
    return (
      <>
        <View style={[StyleSheet.absoluteFill, {backgroundColor: '#000'}]} />
        <Image source={{uri: `data:image/jpeg;base64,${photo}`}} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </>
    );
  }
  if (bg.startsWith('p:')) {
    const key = bg.slice(2) as PhotoKey;
    return (
      <>
        <Image source={photos[key] ?? photos.sunset} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {dim ? <View style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(0,0,0,0.28)'}]} /> : null}
      </>
    );
  }
  return <View style={[StyleSheet.absoluteFill, {backgroundColor: bg.slice(2) || '#2F8BFF'}]} />;
}

/** Write a status: words on a colour or picture, or a photo. Goes to everyone you are connected to. */
export default function StatusComposerScreen() {
  const nav = useNavigation();
  const params = useRoute<RouteProp<RootStackParamList, 'StatusComposer'>>().params;
  const start = params?.start ?? 'text';
  // Editing one of my own updates: it opens with its words, colour or picture, and sharing replaces it.
  const editId = params?.editId;
  const editing = editId ? useStatusStore.getState().mine.find(i => i.id === editId) : undefined;
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(editing?.text ?? '');
  const [bg, setBg] = useState(editing?.bg ?? `c:${COLOURS[0]}`);
  const [photo, setPhoto] = useState<string | null>(editing?.photo ?? null);
  const post = useStatusStore(s => s.post);

  const cycle = () => {
    const all = [...COLOURS.map(c => `c:${c}`), ...STATUS_BACKGROUNDS.map(p => `p:${p}`)];
    setPhoto(null);
    setBg(all[(all.indexOf(bg) + 1) % all.length]);
  };

  const pick = async (camera = false, closeIfNone = false) => {
    const r = camera ? await takeStatusPhoto() : await pickStatusPhoto();
    if (r.ok) {
      setPhoto(r.base64);
    } else if (r.reason === 'too-large') {
      alertDialog('That picture is too detailed', 'Status pictures are kept small so they arrive even without internet. Try another one, or a simpler picture.');
    } else if (closeIfNone) {
      nav.goBack();
    }
  };

  // Coming from the camera / gallery button: go straight to it.
  useEffect(() => {
    if (start === 'camera') {
      void pick(true, true);
    } else if (start === 'gallery') {
      void pick(false, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = () => {
    const t = text.trim();
    if (!photo && !t) {
      return;
    }
    if (editId) {
      useStatusStore.getState().remove(editId);
    }
    post(photo ? {kind: 'photo', text: t, bg, photo} : {kind: 'text', text: t, bg});
    nav.goBack();
  };

  const size = text.length > 120 ? 22 : text.length > 50 ? 28 : 36;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Backdrop bg={bg} photo={photo ?? undefined} />

      <View style={[styles.top, {paddingTop: insets.top + spacing.sm}]}>
        <IconButton icon="x" label="Close" onPress={() => nav.goBack()} />
        <View style={styles.topRight}>
          <IconButton icon="camera" label="Take a photo" onPress={() => void pick(true)} />
          <IconButton icon="image" label="Add a picture" onPress={() => void pick(false)} />
          <IconButton icon="palette" label="Change background" onPress={cycle} />
        </View>
      </View>

      <View style={styles.middle}>
        <TextInput
          value={text}
          onChangeText={t => setText(t.slice(0, 600))}
          placeholder={photo ? 'Add a caption' : 'Type a status'}
          placeholderTextColor="rgba(255,255,255,0.6)"
          multiline
          autoFocus={start === 'text' && !photo}
          textAlign="center"
          style={[styles.input, {fontSize: photo ? 18 : size, lineHeight: (photo ? 18 : size) * 1.3}, photo && styles.caption]}
        />
      </View>

      <View style={[styles.bottom, {paddingBottom: insets.bottom + spacing.md}]}>
        <View style={styles.bottomRow}>
          {photo ? (
            <View style={styles.flexFill} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flexFill} contentContainerStyle={styles.swatches}>
              {COLOURS.map(col => (
                <Pressy key={col} onPress={() => setBg(`c:${col}`)} accessibilityRole="button" accessibilityLabel={`Colour ${col}`} accessibilityState={{selected: bg === `c:${col}`}} style={[styles.swatch, {backgroundColor: col}, bg === `c:${col}` && styles.swatchOn]}>
                  {bg === `c:${col}` ? <Icon name="check" size={16} color="#FFFFFF" strokeWidth={3} /> : null}
                </Pressy>
              ))}
              {STATUS_BACKGROUNDS.map(p => (
                <Pressy key={p} onPress={() => setBg(`p:${p}`)} accessibilityRole="button" accessibilityLabel={`Picture ${p}`} accessibilityState={{selected: bg === `p:${p}`}} style={[styles.swatch, bg === `p:${p}` && styles.swatchOn]}>
                  <Image source={photos[p]} style={styles.swatchImg} />
                </Pressy>
              ))}
            </ScrollView>
          )}
          {/* Same kind of round button as the others: lit edge and a soft shadow. Disabled until there is something to share. */}
          <Pressy
            onPress={share}
            disabled={!photo && !text.trim()}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel="Share with my connections"
            style={[styles.shareFab, !photo && !text.trim() && styles.shareOff]}>
            <Rim size={58} />
            <Icon name="send" size={24} color={colors.primary} />
          </Pressy>
        </View>
        <Txt variant="caption" style={styles.hint}>
          Shared with your connections
        </Txt>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  flex: {flex: 1, backgroundColor: '#000'},
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg},
  topRight: {flexDirection: 'row', gap: spacing.sm},
  middle: {flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl},
  input: {color: '#FFFFFF', fontWeight: '700', textAlign: 'center', padding: 0},
  caption: {position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: spacing.lg, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, padding: spacing.md},
  bottom: {paddingHorizontal: spacing.lg, gap: spacing.sm},
  bottomRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  flexFill: {flex: 1},
  swatches: {gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.sm},
  swatch: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)'},
  swatchOn: {borderColor: '#FFFFFF', borderWidth: 3},
  swatchImg: {width: '100%', height: '100%'},
  shareFab: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...elevation.floating},
  shareOff: {opacity: 0.5},
  hint: {color: 'rgba(255,255,255,0.85)', textAlign: 'center'},
}));
