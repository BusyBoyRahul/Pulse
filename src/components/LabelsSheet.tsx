import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, radius, spacing} from '@/theme/theme';
import {usePrefsStore} from '@/store/prefsStore';
import {Button} from './Button';
import {Icon} from './Icon';
import {IconButton} from './IconButton';
import {Pressy} from './Pressy';
import {Sheet} from './Sheet';
import {TextField} from './TextField';
import {Txt} from './Text';
import {alertDialog} from './Dialog';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** How many chats carry each label. */
  counts: Record<string, number>;
  /** Show only the chats with this label. */
  onOpen: (label: string) => void;
  /** A label was deleted (so the list can stop filtering by it). */
  onDeleted?: (label: string) => void;
};

/**
 * Manage labels in one place: see them, open one, make a new one, rename, delete.
 * Nothing to read — every action is a button.
 */
export function LabelsSheet({visible, onClose, counts, onOpen, onDeleted}: Props) {
  const labels = usePrefsStore(s => s.labels);
  const [mode, setMode] = useState<{kind: 'list'} | {kind: 'new'} | {kind: 'rename'; from: string}>({kind: 'list'});
  const [text, setText] = useState('');

  const close = () => {
    setMode({kind: 'list'});
    setText('');
    onClose();
  };

  const save = () => {
    const n = text.trim();
    if (!n) {
      return;
    }
    if (mode.kind === 'rename') {
      usePrefsStore.getState().renameLabel(mode.from, n);
    } else {
      usePrefsStore.getState().addLabel(n);
    }
    setMode({kind: 'list'});
    setText('');
  };

  const remove = (l: string) =>
    alertDialog(`Delete “${l}”?`, 'The chats stay — they just lose this label.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          usePrefsStore.getState().removeLabel(l);
          onDeleted?.(l);
        },
      },
    ]);

  const editing = mode.kind !== 'list';

  return (
    <Sheet visible={visible} onClose={close} title={mode.kind === 'rename' ? 'Rename label' : mode.kind === 'new' ? 'New label' : 'Labels'} scroll>
      {editing ? (
        <View style={styles.form}>
          <TextField placeholder="Work, Family, Hiking…" value={text} onChangeText={t => setText(t.slice(0, 20))} autoFocus onSubmitEditing={save} returnKeyType="done" />
          <Button label={mode.kind === 'rename' ? 'Save' : 'Create label'} onPress={save} disabled={!text.trim()} />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setMode({kind: 'list'});
              setText('');
            }}
          />
        </View>
      ) : (
        <>
          {labels.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="tag" size={26} color={colors.textMuted} />
              <Txt variant="body" tone="muted" center>
                No labels yet
              </Txt>
            </View>
          ) : (
            labels.map(l => (
              <View key={l} style={styles.row}>
                <Pressy
                  style={styles.main}
                  accessibilityRole="button"
                  accessibilityLabel={`Show chats labelled ${l}`}
                  scaleTo={0.985}
                  onPress={() => {
                    onOpen(l);
                    close();
                  }}>
                  <Icon name="tag" size={18} color={colors.primaryBright} />
                  <Txt variant="bodyStrong" style={styles.name} numberOfLines={1}>
                    {l}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {counts[l] ?? 0}
                  </Txt>
                </Pressy>
                <IconButton
                  icon="edit"
                  label={`Rename ${l}`}
                  size="sm"
                  onPress={() => {
                    setText(l);
                    setMode({kind: 'rename', from: l});
                  }}
                />
                <IconButton icon="trash" label={`Delete ${l}`} size="sm" tone="danger" onPress={() => remove(l)} />
              </View>
            ))
          )}
          <Button label="New label" onPress={() => setMode({kind: 'new'})} style={styles.add} />
        </>
      )}
    </Sheet>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  form: {gap: spacing.xs},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs},
  main: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.glass},
  name: {flex: 1},
  add: {marginTop: spacing.md},
}));

export default LabelsSheet;
