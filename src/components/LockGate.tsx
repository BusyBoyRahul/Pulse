import React, {useCallback, useEffect, useState} from 'react';
import {Alert, BackHandler, Pressable, StyleSheet, View} from 'react-native';
import {colors} from '@/theme/theme';
import {useLockStore} from '@/store/lockStore';
import {useChatStore} from '@/store/chatStore';
import {mediaFiles} from '@/services/mediaFiles';
import {PinPad} from './PinPad';
import {Txt} from './Text';

/**
 * Sits on top of the whole app. When "App lock" is on and Pulse was away long enough,
 * nothing is visible until the PIN (or fingerprint) is given.
 */
export function LockGate() {
  const locked = useLockStore(s => s.appLocked && !!s.saved?.appLock);
  const bio = useLockStore(s => !!(s.saved?.biometric && s.bioAvailable));
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const tryBiometric = useCallback(async () => {
    if (await mediaFiles.biometricAuth('Unlock Pulse')) {
      useLockStore.getState().unlockApp();
    }
  }, []);

  // Ask for the fingerprint straight away when the lock appears.
  useEffect(() => {
    if (locked && bio) {
      void tryBiometric();
    }
  }, [locked, bio, tryBiometric]);

  // While locked, the Android back button must not reveal what's underneath.
  useEffect(() => {
    if (!locked) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [locked]);

  if (!locked) {
    return null;
  }

  const submit = (pin: string) => {
    const lock = useLockStore.getState();
    const r = lock.verify(pin);
    if (r === 'ok') {
      setError(null);
      lock.unlockApp();
      return;
    }
    setError(r === 'wait' ? `Too many wrong tries. Wait ${lock.waitSeconds()} seconds.` : 'Wrong PIN');
    setResetKey(k => k + 1);
  };

  const forgot = () =>
    Alert.alert(
      'Forgot your PIN?',
      'The PIN can’t be recovered. The only way back in is to erase every chat on this phone and remove the lock. Your connections and profile stay.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Erase chats and unlock',
          style: 'destructive',
          onPress: () => {
            void useChatStore.getState().clearAllChats();
            useLockStore.getState().removePin();
          },
        },
      ],
    );

  return (
    <View style={styles.cover} pointerEvents="auto">
      <PinPad
        title="Pulse is locked"
        subtitle="Enter your PIN to continue."
        error={error}
        resetKey={resetKey}
        submitLabel="Unlock"
        onSubmit={submit}
        onBiometric={bio ? () => void tryBiometric() : undefined}
        footer={
          <Pressable onPress={forgot} hitSlop={10}>
            <Txt variant="caption" tone="muted">
              Forgot PIN?
            </Txt>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 100000, elevation: 100},
});

export default LockGate;
