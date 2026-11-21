import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, ToastAndroid, View} from 'react-native';

import {Screen, Txt, Icon, IconTile, Button, Slider, Wallpaper, WALLPAPERS, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, elevation, radius, spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {saveBlob, loadBlob} from '@/services/storage';
import {pickChatPhoto} from '@/services/imagePicker';

const MAX_BLUR = 25;
const MIN_OPACITY = 10; // percent

/** One swatch in the strip: the wallpaper itself, a tick when picked. */
function Swatch({label, on, onPress, children}: {label: string; on: boolean; onPress: () => void; children: React.ReactNode}) {
  return (
    <Pressable onPress={onPress} style={styles.cell} accessibilityRole="button" accessibilityState={{selected: on}} accessibilityLabel={label}>
      <View style={[styles.swatch, on && styles.swatchOn]}>
        {children}
        {on ? (
          <View style={styles.swatchTick}>
            <Icon name="check" size={12} color={colors.onPrimary} strokeWidth={3.5} />
          </View>
        ) : null}
      </View>
      <Txt variant="caption" tone={on ? 'primary' : 'muted'} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** A slider with its title and current value above it. */
function Adjust({icon, title, valueText, children}: {icon: 'eye' | 'image'; title: string; valueText: string; children: React.ReactNode}) {
  return (
    <View style={styles.adjRow}>
      <View style={styles.adjHead}>
        <IconTile icon={icon} size={32} />
        <Txt variant="bodyStrong" style={styles.adjTitle}>
          {title}
        </Txt>
        <View style={styles.valuePill}>
          <Txt variant="label" tone="secondary">
            {valueText}
          </Txt>
        </View>
      </View>
      {children}
    </View>
  );
}

export default function SettingsChatsScreen() {
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const [photo, setPhoto] = useState<string | null>(null);
  // While a slider is being dragged the preview follows the finger; the choice is saved when the finger lifts.
  const [opacity, setOpacity] = useState(Math.round(app.wallpaperOpacity * 100));
  const [blur, setBlur] = useState(Math.round(app.wallpaperBlur));

  useEffect(() => {
    void loadBlob('wallpaper').then(setPhoto);
  }, []);
  useEffect(() => {
    setOpacity(Math.round(app.wallpaperOpacity * 100));
    setBlur(Math.round(app.wallpaperBlur));
  }, [app.wallpaperOpacity, app.wallpaperBlur]);

  const isPhoto = app.wallpaper === 'photo' && !!photo;
  const changed = opacity !== 100 || blur !== 0;

  const choosePhoto = async () => {
    const r = await pickChatPhoto();
    if (r.ok) {
      await saveBlob('wallpaper', r.base64);
      setPhoto(r.base64);
      setApp({wallpaper: 'photo'});
    } else if (r.reason === 'too-large') {
      ToastAndroid.show('That photo is too large', ToastAndroid.SHORT);
    }
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {/* A live preview first, so every choice below is seen straight away. */}
      <View style={styles.preview}>
        <Wallpaper kind={app.wallpaper} photo={photo} opacity={opacity / 100} blur={blur} />
        <View style={styles.previewBody}>
          <View style={styles.dateChip}>
            <Txt variant="label" tone="secondary">
              Today
            </Txt>
          </View>
          <View style={[styles.bubble, styles.bubbleTheirs]}>
            <Txt variant="body">Hi! How is it going?</Txt>
          </View>
          <View style={[styles.bubble, styles.bubbleMine]}>
            <Txt variant="body" style={{color: colors.onBubbleMine}}>
              Looks great
            </Txt>
          </View>
          <View style={[styles.bubble, styles.bubbleTheirs]}>
            <Txt variant="body">See you soon</Txt>
          </View>
        </View>
        <View style={styles.composer}>
          <View style={styles.composerField}>
            <Txt variant="caption" tone="muted">
              Message
            </Txt>
          </View>
          <View style={styles.composerSend}>
            <Icon name="chevronRight" size={16} color={colors.onPrimary} />
          </View>
        </View>
      </View>

      <SettingLabel>WALLPAPER</SettingLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripBleed} contentContainerStyle={styles.strip}>
        {WALLPAPERS.map(w => (
          <Swatch key={w.kind} label={w.label} on={app.wallpaper === w.kind} onPress={() => setApp({wallpaper: w.kind})}>
            <Wallpaper kind={w.kind} />
          </Swatch>
        ))}
        <Swatch label="My photo" on={app.wallpaper === 'photo'} onPress={() => (photo ? setApp({wallpaper: 'photo'}) : void choosePhoto())}>
          <Wallpaper kind="photo" photo={photo} />
          {!photo ? (
            <View style={styles.addPhoto}>
              <Icon name="plus" size={22} color={colors.textSecondary} />
            </View>
          ) : null}
        </Swatch>
      </ScrollView>

      <View style={styles.adjustHead}>
        <SettingLabel>ADJUST</SettingLabel>
        {isPhoto && changed ? (
          <Button
            label="Reset"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => {
              setOpacity(100);
              setBlur(0);
              setApp({wallpaperOpacity: 1, wallpaperBlur: 0});
            }}
          />
        ) : null}
      </View>
      <View style={styles.adjustCard}>
        <View style={!isPhoto && styles.off} pointerEvents={isPhoto ? 'auto' : 'none'}>
          <Adjust icon="eye" title="Opacity" valueText={`${opacity}%`}>
            <Slider label="Opacity" min={MIN_OPACITY} max={100} value={opacity} onChange={setOpacity} onCommit={v => setApp({wallpaperOpacity: v / 100})} format={v => `${v}%`} disabled={!isPhoto} />
          </Adjust>
          <View style={styles.adjDivider} />
          <Adjust icon="image" title="Blur" valueText={blur === 0 ? 'Off' : String(blur)}>
            <Slider label="Blur" min={0} max={MAX_BLUR} value={blur} onChange={setBlur} onCommit={v => setApp({wallpaperBlur: v})} format={v => (v === 0 ? 'Off' : String(v))} disabled={!isPhoto} />
          </Adjust>
        </View>
        {!isPhoto ? (
          <View style={styles.adjustHint}>
            <Txt variant="caption" tone="muted" center>
              Opacity and blur are for your own photo
            </Txt>
            <Button label={photo ? 'Use my photo' : 'Choose a photo'} size="sm" fullWidth={false} onPress={() => (photo ? setApp({wallpaper: 'photo'}) : void choosePhoto())} />
          </View>
        ) : null}
      </View>
      {isPhoto ? (
        <View style={styles.changePhoto}>
          <Button label="Choose a different photo" variant="secondary" size="sm" fullWidth={false} onPress={() => void choosePhoto()} />
        </View>
      ) : null}

      <SettingLabel>TYPING</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="edit"
          title="Typing indicator"
          subtitle="Show “typing…” to your chats, and see theirs"
          toggle={{value: app.typingIndicator, onChange: v => setApp({typingIndicator: v})}}
        />
      </SettingGroup>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  preview: {height: 260, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.card},
  previewBody: {flex: 1, justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 56},
  dateChip: {alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginBottom: 2},
  bubble: {maxWidth: '72%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg},
  bubbleTheirs: {alignSelf: 'flex-start', backgroundColor: colors.bubbleTheirs, borderWidth: 1, borderColor: colors.glassBorder},
  bubbleMine: {alignSelf: 'flex-end', backgroundColor: colors.bubbleMine},
  composer: {position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  composerField: {flex: 1, height: 38, borderRadius: 19, paddingHorizontal: spacing.lg, justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  composerSend: {width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},

  // The row runs to the screen edges (the page has a side margin), so swatches slide off the edge instead of being cut short.
  stripBleed: {marginHorizontal: -spacing.xl},
  strip: {gap: spacing.md, paddingVertical: 4, paddingHorizontal: spacing.xl},
  cell: {width: 66, alignItems: 'center', gap: 6},
  swatch: {width: 66, height: 100, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: colors.border},
  swatchOn: {borderColor: colors.primary},
  swatchTick: {position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  addPhoto: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised},

  // Fixed height: the Reset button appearing must not push the card down, and it keeps a gap above the card.
  adjustHead: {flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', minHeight: 64, paddingBottom: spacing.sm},
  adjustCard: {borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, ...elevation.card},
  off: {opacity: 0.35},
  adjRow: {paddingVertical: spacing.xs},
  adjHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs},
  adjTitle: {flex: 1},
  valuePill: {minWidth: 52, height: 28, paddingHorizontal: spacing.md, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHover},
  adjDivider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.glassBorder, marginVertical: spacing.sm},
  adjustHint: {alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.md},
  changePhoto: {alignItems: 'flex-start', marginTop: spacing.md},
}));
