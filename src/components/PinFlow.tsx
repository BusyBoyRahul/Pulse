import React, {useEffect, useState} from 'react';
import {Modal, StatusBar} from 'react-native';
import {useLockStore} from '@/store/lockStore';
import {PinPad} from './PinPad';

export type PinFlowMode =
  | 'set' // choose a new PIN
  | 'change' // enter the old PIN, then choose a new one
  | 'remove' // enter the PIN to switch the lock off
  | 'verify'; // just prove you know it

type Props = {
  visible: boolean;
  mode: PinFlowMode;
  onClose: () => void;
  /** The PIN was set / changed / removed / verified. */
  onDone: () => void;
};

type Step = 'old' | 'new' | 'confirm';

/** The full set-a-PIN / change / remove / verify conversation, in a full-screen sheet. */
export function PinFlow({visible, mode, onClose, onDone}: Props) {
  const start: Step = mode === 'set' ? 'new' : 'old';
  const [step, setStep] = useState<Step>(start);
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

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
      const r = lock.verify(pin);
      if (r === 'wait') {
        return fail(`Too many wrong tries. Wait ${lock.waitSeconds()} seconds.`);
      }
      if (r === 'wrong') {
        return fail('Wrong PIN');
      }
      if (mode === 'remove') {
        lock.removePin();
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
      return fail('The two PINs didn’t match. Start again.');
    }
    lock.setPin(pin);
    onDone();
  };

  const title =
    step === 'old'
      ? mode === 'remove'
        ? 'Enter your PIN to turn the lock off'
        : mode === 'verify'
        ? 'Enter your PIN'
        : 'Enter your current PIN'
      : step === 'new'
      ? 'Choose a PIN'
      : 'Enter it once more';
  const subtitle =
    step === 'new'
      ? '4 to 8 digits. You’ll use it to open locked chats and the app.'
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
        submitLabel={step === 'new' ? 'Next' : step === 'confirm' ? 'Save PIN' : 'Confirm'}
        onSubmit={submit}
        onCancel={onClose}
      />
    </Modal>
  );
}

export default PinFlow;
