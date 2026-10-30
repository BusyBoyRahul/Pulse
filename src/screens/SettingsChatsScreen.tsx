import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, ToastAndroid, View} from 'react-native';

import {Screen, Txt, Button, Wallpaper, WALLPAPERS, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {saveBlob, loadBlob} from '@/services/storage';
import {pickChatPhoto} from '@/services/imagePicker';

export default function SettingsChatsScreen() {
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    void loadBlob('wallpaper').then(setPhoto);
  }, []);

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
      <SettingLabel>CHAT WALLPAPER</SettingLabel>
      <View style={styles.grid}>
        {WALLPAPERS.map(w => (
          <Pressable key={w.kind} onPress={() => setApp({wallpaper: w.kind})} style={styles.cell} accessibilityRole="button" accessibilityState={{selected: app.wallpaper === w.kind}} accessibilityLabel={w.label}>
            <View style={[styles.swatch, app.wallpaper === w.kind && styles.swatchOn]}>
              <Wallpaper kind={w.kind} />
            </View>
            <Txt variant="caption" tone={app.wallpaper === w.kind ? 'primary' : 'muted'}>
              {w.label}
            </Txt>
          </Pressable>
        ))}
        <Pressable onPress={() => (photo ? setApp({wallpaper: 'photo'}) : void choosePhoto())} style={styles.cell} accessibilityRole="button" accessibilityLabel="My photo">
          <View style={[styles.swatch, app.wallpaper === 'photo' && styles.swatchOn]}>
            <Wallpaper kind="photo" photo={photo} />
          </View>
          <Txt variant="caption" tone={app.wallpaper === 'photo' ? 'primary' : 'muted'}>
            My photo
          </Txt>
        </Pressable>
      </View>
      <Button label={photo ? 'Choose a different photo' : 'Choose a photo'} variant="secondary" onPress={() => void choosePhoto()} />

      <SettingLabel>TYPING</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon="edit"
          title="Typing indicator"
          subtitle="Show “typing…” to people you chat with and see theirs. Turn off to do neither."
          toggle={{value: app.typingIndicator, onChange: v => setApp({typingIndicator: v})}}
        />
      </SettingGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg},
  cell: {width: '30%', alignItems: 'center', gap: 6},
  swatch: {width: '100%', aspectRatio: 0.62, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: colors.border},
  swatchOn: {borderColor: colors.text},
});
