import React, {useEffect, useState} from 'react';
import {Modal, StatusBar} from 'react-native';
import {useLockStore, LockKind} from '@/store/lockStore';
import {PinPad} from './PinPad';

export type PinFlowMode =
  | 'set' // choose a new PIN
  | 'change' // enter the old PIN, then choose a new one
  | 'remove' // enter the PIN to switch the lock off
  | 'verify'; // just prove you know it

type Props = {
  visible: boolean;
  /** Which lock this PIN belongs to: the whole app, or the locked chats. */
  kind: LockKind;
  mode: PinFlowMode;
  onClose: () => void;
  /** The PIN was set / changed / removed / verified. */
  onDone: () => void;
};

type Step = 'old' | 'new' | 'confirm';

/** The full set-a-PIN / change / remove / verify conversation, in a full-screen sheet. */
export function PinFlow({visible, kind, mode, onClose, onDone}: Props) {
  const start: Step = mode === 'set' ? 'new' : 'old';
  const [step, setStep] = useState<Step>(start);
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const word = kind === 'chat' ? 'code' : 'PIN';

  useEffect(() => {
    if (visible) {
      setStep(start);
      setFirst('');
      setError(null);
      setResetKey(k => k + 1);
    }
  }, [visible, start]);

  const fail = (msg: string) => {
    setError(msg);
    setResetKey(k => k + 1);
  };

  const submit = (pin: string) => {
    const lock = useLockStore.getState();
    setError(null);
    if (step === 'old') {
      const r = lock.verify(kind, pin);
      if (r === 'wait') {
        return fail(`Too many wrong tries. Wait ${lock.waitSeconds(kind)} seconds.`);
      }
      if (r === 'wrong') {
        return fail(`Wrong ${word}`);
      }
      if (mode === 'remove') {
        lock.removePin(kind);
        return onDone();
      }
      if (mode === 'verify') {
        return onDone();
      }
      setResetKey(k => k + 1);
      return setStep('new');
    }
    if (step === 'new') {
      setFirst(pin);
      setResetKey(k => k + 1);
      return setStep('confirm');
    }
    if (pin !== first) {
      setStep('new');
      return fail(`The two ${word}s didn’t match. Start again.`);
    }
    lock.setPin(kind, pin);
    onDone();
  };

  const title =
    step === 'old'
      ? mode === 'remove'
        ? `Enter your ${word} to turn the lock off`
        : mode === 'verify'
        ? `Enter your ${word}`
        : `Enter your current ${word}`
      : step === 'new'
      ? `Choose a ${word}`
      : 'Enter it once more';
  const subtitle =
    step === 'new'
      ? kind === 'chat'
        ? '4 to 8 digits. Opens all your locked chats.'
        : '4 to 8 digits. Opens Pulse.'
      : step === 'confirm'
      ? 'To make sure you typed it right.'
      : undefined;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <PinPad
        title={title}
        subtitle={subtitle}
        error={error}
        resetKey={resetKey}
        submitLabel={step === 'new' ? 'Next' : step === 'confirm' ? `Save ${word}` : 'Confirm'}
        onSubmit={submit}
        onCancel={onClose}
      />
    </Modal>
  );
}

export default PinFlow;
