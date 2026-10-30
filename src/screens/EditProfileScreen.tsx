import React, {useState} from 'react';
import {KeyboardAvoidingView, Platform, Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useHeaderHeight} from '@react-navigation/elements';

import {Screen, Button, Txt, TextField, Avatar, Icon} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {pickProfilePhoto} from '@/services/imagePicker';
import {isValidOptionalPhone, normalizeOptionalPhone} from '@/services/privacy';

export default function EditProfileScreen() {
  const nav = useNavigation();
  const {profileName, phone, bio, avatarUri, setProfile} = useSessionStore();
  const [name, setName] = useState(profileName ?? '');
  const [num, setNum] = useState(phone ?? '');
  const [about, setAbout] = useState(bio ?? '');
  const [avatar, setAvatar] = useState<string | null>(avatarUri ?? null);
  const [thumb, setThumb] = useState<string | null>(null);
  const headerHeight = useHeaderHeight();

  const valid = name.trim().length > 0 && isValidOptionalPhone(num);

  const changePhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setAvatar(picked.uri);
      setThumb(picked.thumb);
    }
  };

  const save = () => {
    setProfile({
      name: name.trim(),
      bio: about.trim(),
      phone: normalizeOptionalPhone(num),
      avatarUri: avatar,
      // Only overwrite the broadcast thumb if a new photo was picked this session.
      ...(thumb !== null ? {avatarThumb: thumb} : {}),
    });
    nav.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      <Screen scroll edges={['left', 'right']} bottomClear={false} footer={<Button label="Save" onPress={save} disabled={!valid} />}>
      <View style={styles.avatarSection}>
        <Pressable onPress={changePhoto} style={styles.avatarWrap}>
          <Avatar name={name || 'You'} uri={avatar} seed={getIdentity().publicKey} size={100} ring />
          <View style={styles.cameraBadge}>
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressable>
        <View style={styles.photoActions}>
          <Txt variant="caption" tone="accent" onPress={changePhoto}>
            Change photo
          </Txt>
          {avatar ? (
            <Txt variant="caption" tone="muted" onPress={() => setAvatar(null)}>
              Remove
            </Txt>
          ) : null}
        </View>
      </View>

      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <TextField
        label="About (optional)"
        placeholder="Hiker · Seattle · O+ blood type"
        value={about}
        onChangeText={t => setAbout(t.slice(0, 80))}
        hint="A short line people nearby see on your profile. Don't put private details here."
      />
      <TextField
        label="Phone number (optional)"
        placeholder="+15551234567"
        value={num}
        onChangeText={setNum}
        keyboardType="phone-pad"
        hint="Optional. Kept encrypted on this phone and never sent to anyone. Chats and calls use your Pulse name, not your number."
      />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  avatarSection: {alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl},
  avatarWrap: {marginBottom: spacing.md},
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  photoActions: {flexDirection: 'row', gap: spacing.lg},
});
