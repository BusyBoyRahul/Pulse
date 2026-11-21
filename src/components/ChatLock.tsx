import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {colors} from '@/theme/theme';
import {useLockStore} from '@/store/lockStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useChatStore} from '@/store/chatStore';
import {mediaFiles} from '@/services/mediaFiles';
import {PinFlow, PinFlowMode} from './PinFlow';
import {PinPad} from './PinPad';
import {Txt} from './Text';
import {alertDialog} from './Dialog';

/** Forgot the chat code: the only way back is to erase the locked chats. The rest of the app is untouched. */
export function forgotChatCode() {
  alertDialog(
    'Forgot your chat code?',
    'It can’t be recovered. The only way is to erase the messages in your locked chats and remove the chat lock. Your other chats stay.',
    [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Erase locked chats',
        style: 'destructive',
        onPress: () => {
          const prefs = usePrefsStore.getState().prefs;
          Object.keys(prefs)
            .filter(id => prefs[id].locked)
            .forEach(id => void useChatStore.getState().clearConversation(id));
          useLockStore.getState().removePin('chat');
        },
      },
    ],
  );
}

/**
 * The code screen shown in place of the locked chats. One code (or fingerprint) opens all of them,
 * and they stay open until the app has been away for a while.
 */
export function ChatUnlock({onUnlocked, onCancel}: {onUnlocked: () => void; onCancel?: () => void}) {
  const bio = useLockStore(s => !!(s.saved.chat?.biometric && s.bioAvailable));
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const unlock = useCallback(() => {
    useLockStore.getState().unlockChats();
    onUnlocked();
  }, [onUnlocked]);

  const tryBiometric = useCallback(async () => {
    if (await mediaFiles.biometricAuth('Open locked chats')) {
      unlock();
    }
  }, [unlock]);

  useEffect(() => {
    if (bio) {
      void tryBiometric();
    }
    // only when the screen first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (pin: string) => {
    const lock = useLockStore.getState();
    const r = lock.verify('chat', pin);
    if (r === 'ok') {
      return unlock();
    }
    setError(r === 'wait' ? `Too many wrong tries. Wait ${lock.waitSeconds('chat')} seconds.` : 'Wrong code');
    setResetKey(k => k + 1);
  };

  return (
    <View style={styles.fill}>
      <PinPad
        title="Locked chats"
        subtitle="Enter your chat code."
        error={error}
        resetKey={resetKey}
        submitLabel="Open"
        onSubmit={submit}
        onBiometric={bio ? () => void tryBiometric() : undefined}
        onCancel={bio ? undefined : onCancel}
        footer={
          <View style={styles.footer}>
            {bio && onCancel ? (
              <Pressable onPress={onCancel} hitSlop={10}>
                <Txt variant="caption" tone="muted">
                  Cancel
                </Txt>
              </Pressable>
            ) : null}
            <Pressable onPress={forgotChatCode} hitSlop={10}>
              <Txt variant="caption" tone="muted">
                Forgot code?
              </Txt>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

/**
 * Lock / unlock one chat (or several at once). All locked chats share ONE chat lock. Locking needs a chat
 * code to exist (it offers to create one); unlocking asks for the code unless the locked chats are already open.
 * `onChange` runs after the chats were locked (they just left the list) or unlocked. Render `modal` somewhere in the screen.
 */
export function useChatLock(chatIds: string | string[], onChange?: (now: 'locked' | 'unlocked') => void) {
  const ids = Array.isArray(chatIds) ? chatIds : [chatIds];
  const key = ids.join('|');
  const locked = usePrefsStore(s => ids.length > 0 && ids.every(id => !!s.prefs[id]?.locked));
  const open = useLockStore(s => s.chatsUnlocked);
  /**
   * What a screen may SHOW: a locked chat looks "not locked" until the chat code has been given, so a person's profile
   * page (reachable without the code) never gives away that the chat is locked.
   */
  const shown = locked && open;
  const [flow, setFlow] = useState<{mode: PinFlowMode; then: 'lock' | 'unlock'} | null>(null);

  const lockNow = useCallback(() => {
    usePrefsStore.getState().patchMany(ids, {locked: true});
    onChange?.('locked');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onChange]);

  const unlockNow = useCallback(() => {
    usePrefsStore.getState().patchMany(ids, {locked: false});
    onChange?.('unlocked');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onChange]);

  const toggle = useCallback(() => {
    const lock = useLockStore.getState();
    if (locked) {
      if (lock.chatsUnlocked) {
        unlockNow();
      } else {
        setFlow({mode: 'verify', then: 'unlock'});
      }
    } else if (!lock.hasPin('chat')) {
      alertDialog('Set a chat code first', 'One code opens all your locked chats. Choose it now?', [
        {text: 'Not now', style: 'cancel'},
        {text: 'Set code', onPress: () => setFlow({mode: 'set', then: 'lock'})},
      ]);
    } else {
      lockNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, key, lockNow, unlockNow]);

  const modal = (
    <PinFlow
      visible={!!flow}
      kind="chat"
      mode={flow?.mode ?? 'verify'}
      onClose={() => setFlow(null)}
      onDone={() => {
        const then = flow?.then;
        setFlow(null);
        useLockStore.getState().unlockChats(); // you just gave the code; don't ask again right now
        if (then === 'lock') {
          lockNow();
        } else {
          unlockNow();
        }
      }}
    />
  );

  return {locked, shown, toggle, modal};
}

const styles = themedStyles(() => StyleSheet.create({
  fill: {flex: 1, backgroundColor: colors.bg},
  footer: {alignItems: 'center', gap: 14},
}));
