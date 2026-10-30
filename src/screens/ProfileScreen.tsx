import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Icon, IconName, Gradient, MaskedNumber} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSessionStore} from '@/store/sessionStore';
import {useContactsStore} from '@/store/contactsStore';
import {getIdentity, shortId} from '@/services/identity';
import {pickProfilePhoto} from '@/services/imagePicker';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
  danger,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({pressed}) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <Icon name={icon} size={20} color={danger ? colors.dangerBright : colors.primaryBright} />
      </View>
      <View style={styles.menuText}>
        <Txt variant="bodyStrong" tone={danger ? 'danger' : 'primary'}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const {profileName, phone, bio, avatarUri, setProfile} = useSessionStore();
  const contacts = useContactsStore(s => s.contacts);
  const meshId = shortId(getIdentity().publicKey);

  const changePhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setProfile({avatarUri: picked.uri, avatarThumb: picked.thumb});
    }
  };

  return (
    <Screen scroll padded={false}>
      <Gradient colors={[colors.surfaceRaised, colors.bg]} angle="vertical" style={styles.hero}>
        <Pressable onPress={changePhoto} style={styles.avatarWrap}>
          <Avatar name={profileName || 'You'} uri={avatarUri} seed={getIdentity().publicKey} size={104} ring />
          <View style={styles.cameraBadge}>
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressable>
        <Txt variant="title" style={styles.name}>
          {profileName || 'You'}
        </Txt>
        {bio ? (
          <Txt variant="body" tone="secondary" center style={styles.bio}>
            {bio}
          </Txt>
        ) : null}
        {phone ? (
          <MaskedNumber value={phone} />
        ) : (
          <Txt variant="caption" tone="muted">
            No phone number on this profile
          </Txt>
        )}
        <Pressable onPress={() => nav.navigate('EditProfile')} style={styles.editBtn}>
          <Icon name="edit" size={14} color={colors.primaryBright} />
          <Txt variant="caption" tone="accent">
            Edit profile
          </Txt>
        </Pressable>
      </Gradient>

      <View style={styles.body}>
        <Card padded={false} style={styles.menuCard}>
          <MenuRow
            icon="shield"
            title="Trusted Circle"
            subtitle={`${contacts.length} emergency contact${contacts.length === 1 ? '' : 's'}`}
            onPress={() => nav.navigate('TrustedCircle')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="bell"
            title="Notifications"
            subtitle="Messages, calls, SOS, quiet hours"
            onPress={() => nav.navigate('SettingsNotifications')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="lock"
            title="Privacy & security"
            subtitle="Who finds you, read receipts, blocked people"
            onPress={() => nav.navigate('SettingsPrivacy')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="star"
            title="Starred messages"
            onPress={() => nav.navigate('Starred')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="settings"
            title="Settings"
            subtitle="Calls, storage, background, permissions"
            onPress={() => nav.navigate('Settings')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="info"
            title="About"
            subtitle="Made by Creoteck · creoteck.com"
            onPress={() => nav.navigate('About')}
          />
        </Card>

        <View style={styles.offlineNote}>
          <Icon name="lock" size={14} color={colors.textSecondary} />
          <Txt variant="caption" tone="secondary">
            100% offline · no account, no server, no phone number needed
          </Txt>
        </View>

        <View style={styles.meshIdRow}>
          <Icon name="bluetooth" size={14} color={colors.textMuted} />
          <Txt variant="caption" tone="muted">
            Mesh id {meshId}
          </Txt>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xl},
  avatarWrap: {marginBottom: spacing.md},
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  name: {marginTop: spacing.xs},
  bio: {marginTop: spacing.xs, marginBottom: spacing.xs, paddingHorizontal: spacing.xl},
  editBtn: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.md},
  body: {paddingHorizontal: spacing.xl, marginTop: spacing.lg},
  menuCard: {marginBottom: spacing.lg, overflow: 'hidden'},
  menuRow: {flexDirection: 'row', alignItems: 'center', padding: spacing.lg},
  pressed: {backgroundColor: colors.surfaceHover},
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuIconDanger: {backgroundColor: colors.dangerDim},
  menuText: {flex: 1},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 68},
  offlineNote: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xs},
  meshIdRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md},
});
