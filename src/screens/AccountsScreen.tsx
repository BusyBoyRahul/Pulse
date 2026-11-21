import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {ActivityIndicator, Modal, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Button, IconButton, Avatar, Icon, Reveal, Pressy} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import accounts from '@/services/accounts';
import type {AccountMeta} from '@/services/storage';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const labelOf = (a: AccountMeta, n: number) => a.name || `Account ${n}`;

/**
 * Accounts on this phone. Each one is completely separate — its own name, keys,
 * chats and settings. Only the one in use is online; the others wait, switched off.
 */
export default function AccountsScreen() {
  const nav = useNavigation<Nav>();
  const [switching, setSwitching] = useState<AccountMeta | null>(null);
  // Re-read when this phone's profile changes (name / photo / verified badge).
  useSessionStore(s => s.profileName + String(s.phoneVerified));
  const {active, accounts: list} = accounts.list();

  const switchTo = (a: AccountMeta) => {
    setSwitching(a);
    void accounts.switchTo(a.id);
  };

  const remove = (a: AccountMeta, n: number) => {
    alertDialog(`Remove ${labelOf(a, n)}?`, 'Everything in this account is erased from this phone: its keys, chats and photos. This cannot be undone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void accounts.remove(a.id).then(() => nav.replace('Accounts'));
        },
      },
    ]);
  };

  const add = () => {
    setSwitching({id: 'new', name: 'a new account', createdAt: Date.now()});
    void accounts.addNew();
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false} footer={<Button label="Add account" onPress={add} />}>
      <View style={styles.intro} />

      {list.map((a, i) => {
        const isActive = a.id === active;
        return (
          <Reveal key={a.id} index={i}>
            <Pressy onPress={() => (isActive ? undefined : switchTo(a))} accessibilityRole="button" accessibilityLabel={`${labelOf(a, i + 1)}${isActive ? ', in use' : ''}`} scaleTo={0.98}>
              <View style={styles.row}>
                <Avatar name={labelOf(a, i + 1)} seed={isActive ? getIdentity().publicKey : a.id} uri={a.thumb ? `data:image/jpeg;base64,${a.thumb}` : undefined} size={52} ring={isActive} />
                <View style={styles.text}>
                  <View style={styles.nameRow}>
                    <Txt variant="bodyStrong" numberOfLines={1} style={styles.name}>
                      {labelOf(a, i + 1)}
                    </Txt>
                    {a.phoneVerified ? <Icon name="verified" size={15} color={colors.primaryBright} /> : null}
                  </View>
                  <Txt variant="caption" tone={isActive ? 'accent' : 'muted'}>
                    {isActive ? 'In use' : a.phoneVerified ? 'Verified number' : 'No phone number'}
                  </Txt>
                </View>
                {isActive ? <Icon name="check" size={20} color={colors.primaryBright} /> : <IconButton icon="trash" tone="danger" label={`Remove ${labelOf(a, i + 1)}`} onPress={() => remove(a, i + 1)} />}
              </View>
            </Pressy>
          </Reveal>
        );
      })}

      <Modal visible={!!switching} transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={styles.overlay}>
          {switching ? <Avatar name={switching.name || '?'} seed={switching.id} uri={switching.thumb ? `data:image/jpeg;base64,${switching.thumb}` : undefined} size={96} ring /> : null}
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
  intro: {height: spacing.md},
  overlay: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.glassBorder},
  text: {flex: 1},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  name: {flexShrink: 1},
}));
