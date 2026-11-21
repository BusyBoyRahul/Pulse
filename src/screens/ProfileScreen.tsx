import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {ActivityIndicator, Modal, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {
  Screen,
  Txt,
  Avatar,
  Icon,
  Pressy,
  Reveal,
  MaskedNumber,
  SettingRow,
  SettingGroup,
  SettingLabel,
} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSessionStore} from '@/store/sessionStore';
import {useSettingsStore} from '@/store/settingsStore';
import {getIdentity, shortId} from '@/services/identity';
import {pickProfilePhoto} from '@/services/imagePicker';
import {isUsername, cleanUsername} from '@/net/directory';
import accounts from '@/services/accounts';
import type {AccountMeta} from '@/services/storage';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const labelOf = (a: AccountMeta, n: number) => a.name || `Account ${n}`;
const thumbOf = (a: AccountMeta) => (a.thumb ? `data:image/jpeg;base64,${a.thumb}` : undefined);

/**
 * My profile: my picture and details, every account on this phone (tap one to switch), then
 * shortcuts. Flat lists on the page, no boxes.
 */
export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const {profileName, phone, phoneVerified, bio, avatarUri, setProfile} = useSessionStore();
  const app = useSettingsStore(s => s.app);
  const [switching, setSwitching] = useState<AccountMeta | null>(null);
  const me = getIdentity().publicKey;
  const meshId = shortId(me);
  const {active, accounts: list} = accounts.list();
  const handle = app.findByUsername && isUsername(app.username) ? `@${cleanUsername(app.username)}` : null;

  const changePhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) {
      setProfile({avatarUri: picked.uri, avatarThumb: picked.thumb});
    }
  };

  const switchTo = (a: AccountMeta) => {
    setSwitching(a);
    void accounts.switchTo(a.id);
  };

  const add = () => {
    setSwitching({id: 'new', name: 'a new account', createdAt: Date.now()});
    void accounts.addNew();
  };

  return (
    <Screen scroll padded={false} edges={['left', 'right']} bottomClear={false}>
      <View style={styles.hero}>
        <Pressy onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo" scaleTo={0.94}>
          <Avatar name={profileName || 'You'} uri={avatarUri} seed={me} size={104} ring />
          <View style={styles.cameraBadge}>
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressy>
        <View style={styles.nameRow}>
          <Txt variant="title" style={styles.nameTxt} numberOfLines={1}>
            {profileName || 'You'}
          </Txt>
          {phoneVerified ? <Icon name="verified" size={20} color={colors.primary} /> : null}
        </View>
        {bio ? (
          <Txt variant="body" tone="secondary" center numberOfLines={2}>
            {bio}
          </Txt>
        ) : null}
        <View style={styles.subRow}>
          {phone ? (
            <MaskedNumber value={phone} />
          ) : (
            <Txt variant="caption" tone="muted">
              No phone number
            </Txt>
          )}
          {handle ? (
            <Txt variant="caption" tone="accent">
              · {handle}
            </Txt>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <SettingLabel>ACCOUNTS</SettingLabel>
        <Reveal>
          <SettingGroup>
          {list.map((a, i) => {
            const isActive = a.id === active;
            return (
              <Pressy
                key={a.id}
                onPress={() => (isActive ? undefined : switchTo(a))}
                accessibilityRole="button"
                accessibilityLabel={`${labelOf(a, i + 1)}${isActive ? ', in use' : ''}`}
                scaleTo={0.985}
                style={styles.acc}>
                <Avatar name={labelOf(a, i + 1)} seed={isActive ? me : a.id} uri={thumbOf(a)} size={40} ring={isActive} />
                <View style={styles.accText}>
                  <View style={styles.accNameRow}>
                    <Txt variant="bodyStrong" numberOfLines={1} style={styles.accName}>
                      {labelOf(a, i + 1)}
                    </Txt>
                    {a.phoneVerified ? <Icon name="verified" size={15} color={colors.primaryBright} /> : null}
                  </View>
                  <Txt variant="caption" tone={isActive ? 'accent' : 'muted'}>
                    {isActive ? 'In use' : a.phoneVerified ? 'Verified number' : 'No phone number'}
                  </Txt>
                </View>
                <Icon name={isActive ? 'check' : 'chevronRight'} size={isActive ? 20 : 18} color={isActive ? colors.primaryBright : colors.textMuted} />
              </Pressy>
            );
          })}
            <SettingRow icon="plus" title="Add account" onPress={add} noChevron />
            {list.length > 1 ? <SettingRow icon="settings" title="Manage accounts" subtitle="Remove an account from this phone" onPress={() => nav.navigate('Accounts')} /> : null}
          </SettingGroup>
        </Reveal>

        <SettingLabel>PROFILE</SettingLabel>
        <Reveal index={2}>
          <SettingGroup>
            <SettingRow icon="edit" title="Edit profile" subtitle="Name, photo, about and phone number" onPress={() => nav.navigate('EditProfile')} />
            <SettingRow icon="qr" title="My code and username" onPress={() => nav.navigate('MyCode')} />
            <SettingRow icon="star" title="Starred messages" onPress={() => nav.navigate('Starred')} />
            <SettingRow icon="settings" title="Settings" subtitle="Privacy, alerts, internet, look" onPress={() => nav.navigate('Settings')} />
            <SettingRow icon="info" title="About Pulse" subtitle="Made by Creoteck" onPress={() => nav.navigate('About')} />
          </SettingGroup>
        </Reveal>

        <View style={styles.idRow}>
          <Icon name="key" size={13} color={colors.textMuted} />
          <Txt variant="caption" tone="muted">
            Pulse ID {meshId}
          </Txt>
        </View>
      </View>

      <Modal visible={!!switching} transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={styles.overlay}>
          {switching ? <Avatar name={switching.name || '?'} seed={switching.id} uri={thumbOf(switching)} size={96} ring /> : null}
          <Txt variant="title" center>
            {switching?.id === 'new' ? 'Setting up a new account…' : `Switching to ${switching?.name || 'your account'}…`}
          </Txt>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl, gap: 6},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, maxWidth: '90%'},
  nameTxt: {flexShrink: 1},
  subRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  cameraBadge: {position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg},
  body: {paddingHorizontal: spacing.xl},
  acc: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg},
  accText: {flex: 1},
  accNameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  accName: {flexShrink: 1},
  idRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xl},
  overlay: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl},
}));
