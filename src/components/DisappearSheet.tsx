import React from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {colors, spacing} from '@/theme/theme';
import {Icon} from './Icon';
import {Sheet} from './Sheet';
import {Txt} from './Text';

const CHOICES: {ms: number; label: string}[] = [
  {ms: 0, label: 'Off'},
  {ms: 24 * 3600_000, label: '24 hours'},
  {ms: 7 * 24 * 3600_000, label: '7 days'},
  {ms: 90 * 24 * 3600_000, label: '90 days'},
];

export const disappearText = (ms?: number): string => CHOICES.find(c => c.ms === (ms ?? 0))?.label ?? 'Off';

type Props = {
  visible: boolean;
  onClose: () => void;
  value?: number;
  onPick: (ms: number) => void;
};

/** Choose how long new messages in a chat last before they are deleted from both phones. */
export function DisappearSheet({visible, onClose, value, onPick}: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Disappearing messages">
      <Txt variant="caption" tone="secondary" style={styles.note}>
        New messages in this chat are deleted from both phones after the time you pick. Starred messages are kept.
      </Txt>
      {CHOICES.map(c => (
        <Pressable key={c.ms} style={styles.row} onPress={() => onPick(c.ms)}>
          <Txt variant="body">{c.label}</Txt>
          {(value ?? 0) === c.ms ? <Icon name="check" size={18} color={colors.text} /> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: {marginBottom: spacing.md},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md},
});

export default DisappearSheet;
