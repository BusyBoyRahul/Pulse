import React, {useEffect, useState} from 'react';
import {FlatList, Linking, Pressable, StyleSheet, TextInput, View} from 'react-native';
import {Screen, Button, Txt, Card, Sheet, Icon} from '@/components';
import {colors, radius, spacing, typography} from '@/theme/theme';
import {useNotesStore} from '@/store/notesStore';
import type {SafetyNote} from '@/types';

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SafetyNotesScreen() {
  const {notes, init, hydrate, syncNearby, post, prune} = useNotesStore();
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
    init();
    prune();
    void syncNearby();
  }, [hydrate, init, prune, syncNearby]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await post(text);
      setText('');
      setComposing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderItem = ({item}: {item: SafetyNote}) => (
    <Card style={styles.note}>
      <Txt variant="body">{item.message}</Txt>
      <View style={styles.noteMeta}>
        <Txt variant="caption" tone="muted">
          {timeAgo(item.createdAt)}
        </Txt>
        {item.latitude || item.longitude ? (
          <Pressable
            onPress={() =>
              Linking.openURL(`https://maps.google.com/?q=${item.latitude},${item.longitude}`).catch(() => {})
            }
            style={styles.locPill}>
            <Icon name="mapPin" size={12} color={colors.primaryBright} />
            <Txt variant="caption" tone="accent">
              View location
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );

  return (
    <Screen padded={false} footer={<Button label="+ Leave a note here" onPress={() => setComposing(true)} />}>
      <FlatList
        data={notes}
        keyExtractor={n => n.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <Txt variant="title" style={styles.screenTitle}>
              Safety Notes
            </Txt>
            <Txt variant="body" tone="secondary" style={styles.intro}>
              Warnings and tips left by people who passed through here. Notes travel
              phone to phone and fade after 30 days.
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <Card style={styles.empty} raised>
            <Txt variant="subtitle" center>
              No notes nearby
            </Txt>
            <Txt variant="caption" tone="muted" center style={styles.emptySub}>
              Be the first to leave one for the next person.
            </Txt>
          </Card>
        }
      />

      <Sheet visible={composing} onClose={() => setComposing(false)} title="Leave a safety note" scroll>
        <Txt variant="caption" tone="muted" style={styles.sheetSub}>
          Tagged to your current location. Keep it useful and kind.
        </Txt>
        <TextInput
          style={styles.input}
          placeholder="e.g. Poorly lit underpass — take the main road at night."
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={280}
        />
        <Txt variant="caption" tone="muted" style={styles.counter}>
          {text.length}/280
        </Txt>
        {error ? (
          <Txt variant="caption" tone="danger" style={styles.err}>
            {error}
          </Txt>
        ) : null}
        <Button label="Post note" onPress={submit} loading={busy} disabled={!text.trim()} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {padding: spacing.xl, paddingBottom: spacing.xxxl},
  screenTitle: {marginTop: spacing.sm, marginBottom: spacing.md},
  intro: {marginBottom: spacing.lg},
  note: {marginBottom: spacing.md},
  noteMeta: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md},
  locPill: {flexDirection: 'row', alignItems: 'center', gap: 4},
  empty: {alignItems: 'center', paddingVertical: spacing.xl},
  emptySub: {marginTop: spacing.xs},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetSub: {marginTop: spacing.xs, marginBottom: spacing.lg},
  input: {
    minHeight: 100,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    color: colors.text,
    textAlignVertical: 'top',
    ...typography.body,
  },
  counter: {textAlign: 'right', marginTop: spacing.xs, marginBottom: spacing.sm},
  err: {marginBottom: spacing.sm},
});
