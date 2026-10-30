import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';
import {colors} from '@/theme/theme';
import {useLockStore} from '@/store/lockStore';
import {usePrefsStore} from '@/store/prefsStore';
import {mediaFiles} from '@/services/mediaFiles';
import {PinFlow, PinFlowMode} from './PinFlow';
import {PinPad} from './PinPad';
import {Txt} from './Text';

/**
 * The PIN screen shown in place of a locked chat. Calls onUnlocked once the PIN or fingerprint
 * is accepted — and remembers it until the app has been away for a while.
 */
export function ChatUnlock({chatId, title, onUnlocked, onCancel}: {chatId: string; title: string; onUnlocked: () => void; onCancel?: () => void}) {
  const bio = useLockStore(s => !!(s.saved?.biometric && s.bioAvailable));
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const unlock = useCallback(() => {
    useLockStore.getState().unlockChat(chatId);
    onUnlocked();
  }, [chatId, onUnlocked]);

  const tryBiometric = useCallback(async () => {
    if (await mediaFiles.biometricAuth(`Open ${title}`)) {
      unlock();
    }
  }, [title, unlock]);

  useEffect(() => {
    if (bio) {
      void tryBiometric();
    }
    // only when the screen first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (pin: string) => {
    const lock = useLockStore.getState();
    const r = lock.verify(pin);
    if (r === 'ok') {
      return unlock();
    }
    setError(r === 'wait' ? `Too many wrong tries. Wait ${lock.waitSeconds()} seconds.` : 'Wrong PIN');
    setResetKey(k => k + 1);
  };

  return (
    <View style={styles.fill}>
      <PinPad
        title="Locked chat"
        subtitle={`Enter your PIN to open ${title}.`}
        error={error}
        resetKey={resetKey}
        submitLabel="Open"
        onSubmit={submit}
        onBiometric={bio ? () => void tryBiometric() : undefined}
        onCancel={bio ? undefined : onCancel}
        footer={
          bio && onCancel ? (
            <Pressable onPress={onCancel} hitSlop={10}>
              <Txt variant="caption" tone="muted">
                Cancel
              </Txt>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}

/**
 * Lock / unlock one chat. Locking needs a PIN to exist (it offers to create one);
 * unlocking asks for the PIN so nobody can switch the lock off over your shoulder.
 * Render `modal` somewhere in the screen.
 */
export function useChatLock(chatId: string) {
  const locked = usePrefsStore(s => !!s.prefs[chatId]?.locked);
  const [flow, setFlow] = useState<{mode: PinFlowMode; then: 'lock' | 'unlock'} | null>(null);

  const toggle = useCallback(() => {
    const hasPin = useLockStore.getState().hasPin();
    if (locked) {
      setFlow({mode: 'verify', then: 'unlock'});
    } else if (!hasPin) {
      Alert.alert('Set a PIN first', 'Locked chats open with a PIN (or your fingerprint). Choose one now?', [
        {text: 'Not now', style: 'cancel'},
        {text: 'Set PIN', onPress: () => setFlow({mode: 'set', then: 'lock'})},
      ]);
    } else {
      usePrefsStore.getState().patch(chatId, {locked: true});
    }
  }, [locked, chatId]);

  const modal = (
    <PinFlow
      visible={!!flow}
      mode={flow?.mode ?? 'verify'}
      onClose={() => setFlow(null)}
      onDone={() => {
        usePrefsStore.getState().patch(chatId, {locked: flow?.then === 'lock'});
        if (flow?.then === 'lock') {
          useLockStore.getState().unlockChat(chatId); // you just set it; don't ask again right now
        }
        setFlow(null);
      }}
    />
  );

  return {locked, toggle, modal};
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: colors.bg},
});
