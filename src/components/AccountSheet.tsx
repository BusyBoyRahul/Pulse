import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {ActivityIndicator, Modal, StyleSheet, View} from 'react-native';
import {colors, spacing} from '@/theme/theme';
import accounts from '@/services/accounts';
import {getIdentity} from '@/services/identity';
import type {AccountMeta} from '@/services/storage';
import {Avatar} from './Avatar';
import {Popover, PopoverItem, PopoverDivider} from './Popover';
import {Txt} from './Text';

const labelOf = (a: AccountMeta, n: number) => a.name || `Account ${n}`;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** "Manage accounts" (remove, details). */
  onManage?: () => void;
};

/**
 * Account switcher, a small dropdown from the top-left (long-press my picture): tap an account and you are in it. No questions,
 * no confirmation — a short "Switching…" screen covers the second the app takes to reopen.
 * Everything in the other account stays exactly as you left it.
 */
export function AccountSheet({visible, onClose, onManage}: Props) {
  const [switching, setSwitching] = useState<AccountMeta | null>(null);
  const {active, accounts: list} = accounts.list();

  const go = (a: AccountMeta) => {
    onClose();
    setSwitching(a);
    void accounts.switchTo(a.id);
  };

  const add = () => {
    onClose();
    setSwitching({id: 'new', name: 'a new account', createdAt: Date.now()});
    void accounts.addNew();
  };

  return (
    <>
      <Popover visible={visible} onClose={onClose} align="left">
        {list.map((a, i) => {
          const isActive = a.id === active;
          return (
            <PopoverItem
              key={a.id}
              icon="user"
              label={labelOf(a, i + 1)}
              selected={isActive}
              onPress={() => (isActive ? onClose() : go(a))}
              lead={<Avatar name={labelOf(a, i + 1)} seed={isActive ? getIdentity().publicKey : a.id} uri={a.thumb ? `data:image/jpeg;base64,${a.thumb}` : undefined} size={32} />}
            />
          );
        })}
        <PopoverDivider />
        <PopoverItem icon="plus" label="Add account" onPress={add} />
        {onManage && list.length > 1 ? (
          <PopoverItem
            icon="settings"
            label="Manage accounts"
            onPress={() => {
              onClose();
              onManage();
            }}
          />
        ) : null}
      </Popover>

      <Modal visible={!!switching} transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={styles.overlay}>
          {switching ? <Avatar name={switching.name || '?'} seed={switching.id} uri={switching.thumb ? `data:image/jpeg;base64,${switching.thumb}` : undefined} size={96} ring /> : null}
          <Txt variant="title" center style={styles.overlayTitle}>
            {switching?.id === 'new' ? 'Setting up a new account…' : `Switching to ${switching?.name || 'your account'}…`}
          </Txt>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Modal>
    </>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  overlay: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl},
  overlayTitle: {marginTop: spacing.md},
}));

export default AccountSheet;
