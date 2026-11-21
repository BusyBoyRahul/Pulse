import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {KeyboardAvoidingView, Platform, Pressable, StyleSheet, ToastAndroid, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useHeaderHeight} from '@react-navigation/elements';

import {Screen, Button, Txt, TextField, Avatar, Icon, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {useSessionStore} from '@/store/sessionStore';
import {alertDialog} from '@/components/Dialog';
import {getIdentity} from '@/services/identity';
import {pickProfilePhoto} from '@/services/imagePicker';
import {smsVerify} from '@/services/smsVerify';

export default function EditProfileScreen() {
  const nav = useNavigation();
  const {profileName, phone, phoneVerified, bio, avatarUri, setProfile} = useSessionStore();
  const [name, setName] = useState(profileName ?? '');
  const [about, setAbout] = useState(bio ?? '');
  const [avatar, setAvatar] = useState<string | null>(avatarUri ?? null);
  const [thumb, setThumb] = useState<string | null>(null);
  const headerHeight = useHeaderHeight();

  const valid = name.trim().length > 0;

  const changePhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setAvatar(picked.uri);
      setThumb(picked.thumb);
    }
  };

  // The number is chosen from the phone's own list (no typing), and saved the moment it is chosen.
  const chooseNumber = async () => {
    const r = await smsVerify.pick();
    if (r.ok) {
      if (!useSessionStore.getState().markPhoneVerified({phone: r.number})) {
        alertDialog('Number already in use', 'This number is already on another account on this phone. Choose a different number, or continue without one.');
      }
    } else if (r.reason === 'none') {
      ToastAndroid.show('No number found on this phone. Some SIM cards do not store it.', ToastAndroid.LONG);
    } else if (r.reason === 'unavailable') {
      ToastAndroid.show('This needs an Android phone with Google Play services.', ToastAndroid.LONG);
    }
  };

  const save = () => {
    setProfile({
      name: name.trim(),
      bio: about.trim(),
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
      <SettingLabel>PHONE NUMBER</SettingLabel>
      <SettingGroup>
        <SettingRow
          icon={phoneVerified ? 'verified' : 'phone'}
          title={phone ? phone : 'Add my number'}
          subtitle={phone ? 'Chosen from this phone · tap to change' : 'Optional · choose it from your phone, nothing is typed'}
          onPress={() => void chooseNumber()}
        />
        {phone ? <SettingRow icon="trash" title="Remove number" danger onPress={() => setProfile({phone: ''})} /> : null}
      </SettingGroup>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
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
}));
