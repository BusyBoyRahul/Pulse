import React, {useState} from 'react';
import {useNavigation} from '@react-navigation/native';

import {Screen, PinFlow, PinFlowMode, ChatUnlock, SettingRow, SettingGroup} from '@/components';
import {useLockStore} from '@/store/lockStore';
import {usePrefsStore} from '@/store/prefsStore';

/**
 * Chat lock settings. They are behind the chat code themselves: Settings only has one plain "Chat lock" row that looks the
 * same whether or not you use it, and nothing here (how many chats are locked, whether they are hidden) shows until the
 * code has been given. So nobody looking through your Settings can tell that you have locked or hidden chats.
 */
export default function SettingsChatLockScreen() {
  const nav = useNavigation();
  const chatLock = useLockStore(s => s.saved.chat);
  const unlocked = useLockStore(s => s.chatsUnlocked);
  const bioAvailable = useLockStore(s => s.bioAvailable);
  const lockedCount = usePrefsStore(s => Object.values(s.prefs).filter(p => p.locked).length);
  const [flow, setFlow] = useState<PinFlowMode | null>(null);
  const lock = useLockStore.getState();

  // A chat code exists and hasn't been given yet (or the app was away and it locked again): the code screen, nothing else.
  if (chatLock && !unlocked) {
    return (
      <Screen padded={false} edges={['left', 'right']} bottomClear={false} aurora={false}>
        <ChatUnlock onUnlocked={() => undefined} onCancel={() => nav.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingGroup>
        {chatLock ? (
          <>
            <SettingRow icon="chat" title="Locked chats" value={lockedCount ? String(lockedCount) : 'None'} subtitle="Select a chat in the list, then ⋮ › Lock chat" noChevron />
            <SettingRow icon="eyeOff" title="Hide locked chats" subtitle="Type your chat code in chat search to open them" toggle={{value: chatLock.hidden, onChange: v => lock.setHidden(v)}} />
            {bioAvailable ? <SettingRow icon="fingerprint" title="Use fingerprint or face" toggle={{value: chatLock.biometric, onChange: v => lock.setBiometric('chat', v)}} /> : null}
            <SettingRow icon="key" title="Change chat code" onPress={() => setFlow('change')} />
            <SettingRow icon="trash" title="Remove chat lock" subtitle="Moves every locked chat back to your list" danger onPress={() => setFlow('remove')} />
          </>
        ) : (
          <SettingRow icon="lock" title="Set a chat code" subtitle="One code for all your locked chats" onPress={() => setFlow('set')} />
        )}
      </SettingGroup>

      <PinFlow visible={!!flow} kind="chat" mode={flow ?? 'set'} onClose={() => setFlow(null)} onDone={() => setFlow(null)} />
    </Screen>
  );
}
