import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {colors, spacing} from '@/theme/theme';
import {usePrefsStore} from '@/store/prefsStore';
import {Button} from './Button';
import {Icon} from './Icon';
import {Sheet} from './Sheet';
import {TextField} from './TextField';
import {Txt} from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The label every chosen chat already has (shows a tick), if they all share one. */
  current?: string | null;
  /** Pick a label, or null to remove the label. */
  onPick: (label: string | null) => void;
  title?: string;
};

/** Pick one of your labels (or make a new one) to tag chats like "Work" or "Family". */
export function LabelSheet({visible, onClose, current, onPick, title = 'Label'}: Props) {
  const labels = usePrefsStore(s => s.labels);
  const [name, setName] = useState('');

  const create = () => {
    const n = name.trim();
    if (!n) {
      return;
    }
    usePrefsStore.getState().addLabel(n);
    setName('');
    onPick(n.slice(0, 20));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scroll>
      {labels.map(l => (
        <Pressable key={l} style={styles.row} onPress={() => onPick(l)}>
          <Icon name="tag" size={18} color={colors.textSecondary} />
          <Txt variant="body" style={styles.name}>
            {l}
          </Txt>
          {current === l ? <Icon name="check" size={18} color={colors.text} /> : null}
        </Pressable>
      ))}
      {current ? (
        <Pressable style={styles.row} onPress={() => onPick(null)}>
          <Icon name="x" size={18} color={colors.textSecondary} />
          <Txt variant="body" style={styles.name}>
            Remove label
          </Txt>
        </Pressable>
      ) : null}
      <View style={styles.new}>
        <TextField label="New label" placeholder="Work, Family, Hiking…" value={name} onChangeText={t => setName(t.slice(0, 20))} />
        <Button label="Create and use" onPress={create} disabled={!name.trim()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md},
  name: {flex: 1},
  new: {marginTop: spacing.lg},
});

export default LabelSheet;
