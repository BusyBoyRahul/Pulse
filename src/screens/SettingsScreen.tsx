import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Icon, IconName, Pressy, SettingRow, SettingGroup, SettingLabel, useHeaderSearch} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useSettingsStore} from '@/store/settingsStore';
import {useSessionStore} from '@/store/sessionStore';
import {usePrefsStore} from '@/store/prefsStore';
import {getIdentity, shortId} from '@/services/identity';
import {getAccounts} from '@/services/storage';
import {useRadioStore, RadioState} from '@/mesh/radioGate';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// The Bluetooth / Wi-Fi mesh as the person sees it: off until they switch it on on the Nearby tab.
const RADIO_LABEL: Record<RadioState, string> = {
  off: 'Off',
  starting: 'Starting…',
  on: 'On',
  'wifi-off': 'Wi-Fi is off',
  'bluetooth-off': 'Bluetooth is off',
  error: 'Unavailable',
  unsupported: 'Not supported',
};

type Entry = {
  id: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  /** Extra words that should find this setting in search. */
  keywords?: string;
  onPress?: () => void;
  toggle?: {value: boolean; onChange: (v: boolean) => void};
  danger?: boolean;
  noChevron?: boolean;
};
type Group = {label: string; entries: Entry[]};

/**
 * Settings, organised the way people think about them — Account, Privacy, Chats & calls,
 * Connection, Look, Safety, About — with a search box on top. Each thing lives in
 * exactly one place.
 */
export default function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const app = useSettingsStore(s => s.app);
  const responderMode = useSettingsStore(s => s.responderMode);
  const setResponderMode = useSettingsStore(s => s.setResponderMode);
  const radio = useRadioStore(s => s.state);
  const meshAuto = useSettingsStore(s => s.app.meshAutoOnWifi);
  const setApp = useSettingsStore(s => s.setApp);
  const profileName = useSessionStore(s => s.profileName);
  const avatarUri = useSessionStore(s => s.avatarUri);
  const phoneVerified = useSessionStore(s => s.phoneVerified);
  const resetProfile = useSessionStore(s => s.resetProfile);
  const blockedCount = usePrefsStore(s => Object.values(s.prefs).filter(p => p.blocked).length);
  // Search lives in the header, the same way on every page.
  const {q} = useHeaderSearch(nav, 'Search settings', 'Search settings');
  const accountCount = getAccounts().accounts.length;

  const confirmReset = () => {
    alertDialog('Reset this profile?', 'This clears the name, contacts and profile of THIS account from this phone. Your other accounts are not touched.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Reset', style: 'destructive', onPress: resetProfile},
    ]);
  };

  const modeText = app.internetMode === 'always' ? 'Always on' : app.internetMode === 'whenOpen' ? 'When open' : 'Off';

  const groups: Group[] = useMemo(
    () => [
      {
        label: 'ACCOUNT',
        entries: [
          {id: 'accounts', icon: 'swap', title: 'Accounts', subtitle: accountCount > 1 ? `${accountCount} accounts on this phone` : 'Switch or add an account', keywords: 'switch add account identity', onPress: () => nav.navigate('Accounts')},
          {id: 'profile', icon: 'edit', title: 'Edit profile', subtitle: 'Name, photo, about and phone number', keywords: 'name photo about bio picture phone number verify change', onPress: () => nav.navigate('EditProfile')},
          {id: 'code', icon: 'qr', title: 'My code and username', subtitle: 'Share your QR code, choose who can find you', keywords: 'qr invite link find username share', onPress: () => nav.navigate('MyCode')},
        ],
      },
      {
        label: 'PRIVACY & SECURITY',
        entries: [
          {id: 'privacy', icon: 'lock', title: 'Privacy', subtitle: 'Who sees your photo, about and status · who can reach you · read receipts', keywords: 'photo about status last seen calls read receipts typing block lock pin screenshot', onPress: () => nav.navigate('SettingsPrivacy')},
          {id: 'blocked', icon: 'ban', title: 'Blocked people', value: blockedCount ? String(blockedCount) : 'None', onPress: () => nav.navigate('Blocked')},
        ],
      },
      {
        label: 'CHATS & CALLS',
        entries: [
          {id: 'chats', icon: 'wallpaper', title: 'Chats', subtitle: 'Wallpaper, typing, formatting', keywords: 'wallpaper background font', onPress: () => nav.navigate('SettingsChats')},
          {id: 'notifs', icon: 'bell', title: 'Notifications', subtitle: 'Messages, calls, quiet hours', keywords: 'sound vibrate quiet hours do not disturb', onPress: () => nav.navigate('SettingsNotifications')},
          {id: 'calls', icon: 'phone', title: 'Calls', subtitle: 'Speaker, ringtone', keywords: 'ring speaker microphone video', onPress: () => nav.navigate('SettingsCalls')},
          {id: 'starred', icon: 'star', title: 'Starred messages', onPress: () => nav.navigate('Starred')},
          {id: 'storage', icon: 'database', title: 'Storage & backup', subtitle: 'Free up space · back up and restore', keywords: 'photos files delete clear backup restore export', onPress: () => nav.navigate('SettingsStorage')},
        ],
      },
      {
        label: 'CONNECTION',
        entries: [
          {id: 'internet', icon: 'globe', title: 'Internet', subtitle: 'When Pulse connects · relays · direct links', value: modeText, keywords: 'online wifi data relay turn always background', onPress: () => nav.navigate('SettingsInternet')},
          {id: 'mesh', icon: 'bluetooth', title: 'Bluetooth & Wi-Fi mesh', value: RADIO_LABEL[radio] ?? 'Off', keywords: 'nearby offline radio', noChevron: true},
          {id: 'meshDefault', icon: 'radar', title: 'Mesh on by default', subtitle: 'Mesh is on whenever Wi-Fi is on', keywords: 'nearby offline radio default automatic start wifi', toggle: {value: meshAuto, onChange: v => setApp({meshAutoOnWifi: v})}},
        ],
      },
      {
        label: 'LOOK',
        entries: [{id: 'look', icon: 'palette', title: 'Appearance', subtitle: 'System, light or dark · accent colour', keywords: 'theme dark light colour color', onPress: () => nav.navigate('SettingsAppearance')}],
      },
      {
        label: 'SAFETY',
        entries: [
          {id: 'sos', icon: 'sos', title: 'Nearby SOS alerts', subtitle: 'Alert me when someone near me sends an SOS', keywords: 'emergency help', toggle: {value: responderMode, onChange: setResponderMode}},
          {id: 'circle', icon: 'shield', title: 'Trusted Circle', subtitle: 'Who gets your SOS text', keywords: 'emergency contacts', onPress: () => nav.navigate('TrustedCircle')},
        ],
      },
      {
        label: 'ABOUT',
        entries: [
          {id: 'id', icon: 'key', title: 'Your Pulse ID', subtitle: 'The short handle other phones see. Never your phone number', value: shortId(getIdentity().publicKey), noChevron: true},
          {id: 'about', icon: 'info', title: 'About Pulse', onPress: () => nav.navigate('About')},
          {id: 'reset', icon: 'trash', title: 'Reset this profile', danger: true, onPress: confirmReset},
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountCount, phoneVerified, blockedCount, modeText, radio, meshAuto, responderMode],
  );

  const needle = q.trim().toLowerCase();
  const found = needle
    ? groups.flatMap(g => g.entries).filter(e => `${e.title} ${e.subtitle ?? ''} ${e.keywords ?? ''}`.toLowerCase().includes(needle))
    : [];

  const row = (e: Entry) => (
    <SettingRow key={e.id} icon={e.icon} title={e.title} subtitle={e.subtitle} value={e.value} onPress={e.onPress} toggle={e.toggle} danger={e.danger} noChevron={e.noChevron} />
  );

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <Pressy onPress={() => nav.navigate('EditProfile')} accessibilityRole="button" accessibilityLabel="Edit my profile" scaleTo={0.985}>
        <Card style={styles.me}>
          <Avatar name={profileName || 'You'} uri={avatarUri} seed={getIdentity().publicKey} size={56} />
          <View style={styles.meText}>
            <Txt variant="subtitle" numberOfLines={1}>
              {profileName || 'You'}
            </Txt>
            <Txt variant="caption" tone="muted">
              {phoneVerified ? 'Number confirmed' : 'Tap to edit your profile'}
            </Txt>
          </View>
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </Card>
      </Pressy>

      {needle ? (
        found.length === 0 ? (
          <Txt variant="caption" tone="muted" center style={styles.none}>
            No setting matches “{q.trim()}”.
          </Txt>
        ) : (
          <SettingGroup>{found.map(row)}</SettingGroup>
        )
      ) : (
        groups.map(g => (
          <View key={g.label}>
            <SettingLabel>{g.label}</SettingLabel>
            <SettingGroup>{g.entries.map(row)}</SettingGroup>
          </View>
        ))
      )}

    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  me: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.lg},
  meText: {flex: 1, gap: 2},
  none: {marginTop: spacing.xl},
}));
