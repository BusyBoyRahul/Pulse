import {themedStyles} from '@/theme/themed';
import React, {useEffect, useMemo, useState} from 'react';
import {Keyboard, Modal, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, radius, spacing, themeInfo} from '@/theme/theme';
import type {PollData} from '@/types';
import {Icon} from './Icon';
import {IconButton} from './IconButton';
import {PollView} from './PollView';
import {SettingGroup, SettingRow} from './SettingRow';
import {Txt} from './Text';

const MAX_OPTIONS = 10;
const MAX_Q = 140;
const MAX_OPT = 60;
const CLOSE_CHOICES = [
  {label: 'Never', ms: 0},
  {label: '1 hour', ms: 3_600_000},
  {label: '8 hours', ms: 8 * 3_600_000},
  {label: '1 day', ms: 24 * 3_600_000},
  {label: '3 days', ms: 72 * 3_600_000},
  {label: '1 week', ms: 7 * 24 * 3_600_000},
];

/** What the person chose besides the question and answers. */
export type PollSettings = {multi: boolean; anon: boolean; quiz?: number; explain?: string; closeInMs?: number};

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[], settings: PollSettings) => void;
};

/** Always one empty row at the end (until the limit) so adding an answer is just typing; extra empty rows go away. */
function tidy(list: string[]): string[] {
  const out = list.slice(0, MAX_OPTIONS);
  while (out.length > 2 && out[out.length - 1].trim() === '' && out[out.length - 2].trim() === '') {
    out.pop();
  }
  if (out.length < MAX_OPTIONS && out[out.length - 1].trim() !== '') {
    out.push('');
  }
  return out;
}

/**
 * "New poll" as a full page: question, answers (just keep typing for more), a live preview of exactly what people will
 * see, and the options that make it a real poll: multiple answers, anonymous votes, quiz mode (mark the right answer,
 * add a note) and a closing time.
 */
export function PollCreator({visible, onClose, onCreate}: Props) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [anon, setAnon] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState<number | null>(null);
  const [explain, setExplain] = useState('');
  const [closeMs, setCloseMs] = useState(0);
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const reset = () => {
    setQ('');
    setOpts(['', '']);
    setMulti(false);
    setAnon(false);
    setQuiz(false);
    setCorrect(null);
    setExplain('');
    setCloseMs(0);
  };

  const keys = opts.map(o => o.trim().toLowerCase());
  const dupAt = (i: number) => keys[i] !== '' && keys.findIndex(k => k === keys[i]) !== i;
  const hasDup = opts.some((_, i) => dupAt(i));
  const filledIdx = opts.map((o, i) => (o.trim() ? i : -1)).filter(i => i >= 0);

  const problem = !q.trim()
    ? 'Write your question'
    : filledIdx.length < 2
    ? 'Add at least two answers'
    : hasDup
    ? 'Two answers are the same'
    : quiz && (correct === null || !opts[correct]?.trim())
    ? 'Tap the circle next to the right answer'
    : '';

  const draft: PollData = useMemo(
    () => ({
      question: q.trim(),
      options: filledIdx.map(i => opts[i].trim()),
      multi: multi && !quiz ? true : undefined,
      anon: anon || undefined,
      quiz: quiz && correct !== null && filledIdx.includes(correct) ? filledIdx.indexOf(correct) : quiz ? 0 : undefined,
      explain: quiz && explain.trim() ? explain.trim() : undefined,
      closesAt: closeMs ? Date.now() + closeMs : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, opts, multi, anon, quiz, correct, explain, closeMs],
  );

  const create = () => {
    if (problem) {
      return;
    }
    onCreate(draft.question, draft.options, {multi: !!draft.multi, anon: !!draft.anon, quiz: draft.quiz, explain: draft.explain, closeInMs: closeMs || undefined});
    reset();
  };

  const setOpt = (i: number, t: string) => setOpts(prev => tidy(prev.map((x, idx) => (idx === i ? t.slice(0, MAX_OPT) : x))));
  const removeOpt = (i: number) => {
    setOpts(prev => tidy(prev.filter((_, idx) => idx !== i)));
    setCorrect(c => (c === null ? null : c === i ? null : c > i ? c - 1 : c));
  };

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.root, {paddingTop: insets.top + spacing.sm}]}>
        <View style={styles.top}>
          <IconButton icon="x" label="Close" onPress={onClose} />
          <Txt variant="title">New poll</Txt>
        </View>

        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.labelRow}>
            <Txt variant="label" tone="secondary">
              QUESTION
            </Txt>
            <Txt variant="caption" tone="muted">
              {q.length}/{MAX_Q}
            </Txt>
          </View>
          <View style={styles.box}>
            <TextInput value={q} onChangeText={t => setQ(t.slice(0, MAX_Q))} placeholder="Ask something" placeholderTextColor={colors.textMuted} selectionColor={colors.primary} multiline style={styles.input} />
          </View>

          <View style={styles.labelRow}>
            <Txt variant="label" tone="secondary">
              ANSWERS
            </Txt>
            <Txt variant="caption" tone="muted">
              {quiz ? 'Tap a circle to mark the right one' : `${filledIdx.length} of ${MAX_OPTIONS}`}
            </Txt>
          </View>
          {opts.map((o, i) => (
            <View key={i}>
              <View style={styles.optRow}>
                {quiz ? (
                  <Pressable onPress={() => o.trim() && setCorrect(i)} hitSlop={8} accessibilityRole="radio" accessibilityLabel={`Mark answer ${i + 1} as the right one`} accessibilityState={{selected: correct === i}} style={[styles.radio, correct === i && styles.radioOn]}>
                    {correct === i ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                  </Pressable>
                ) : (
                  <View style={styles.num}>
                    <Txt variant="caption" tone="muted">
                      {i + 1}
                    </Txt>
                  </View>
                )}
                <View style={[styles.box, styles.optBox, dupAt(i) && styles.boxBad]}>
                  <TextInput value={o} onChangeText={t => setOpt(i, t)} placeholder={i === opts.length - 1 && o === '' && opts.length > 2 ? 'Add another answer' : `Answer ${i + 1}`} placeholderTextColor={colors.textMuted} selectionColor={colors.primary} style={styles.input} />
                </View>
                {opts.length > 2 && o !== '' ? <IconButton icon="x" label={`Remove answer ${i + 1}`} tone="plain" size="sm" onPress={() => removeOpt(i)} /> : <View style={styles.sm} />}
              </View>
              {dupAt(i) ? (
                <Txt variant="caption" tone="danger" style={styles.dup}>
                  Same as an answer above
                </Txt>
              ) : null}
            </View>
          ))}

          <View style={styles.labelRow}>
            <Txt variant="label" tone="secondary">
              SETTINGS
            </Txt>
          </View>
          <SettingGroup>
            <SettingRow
              title="Multiple answers"
              subtitle="People can pick more than one"
              icon="checkAll"
              disabled={quiz}
              toggle={{
                value: multi && !quiz,
                onChange: setMulti,
              }}
            />
            <SettingRow title="Anonymous votes" subtitle="Only counts are shown, never names" icon="shield" toggle={{value: anon, onChange: setAnon}} />
            <SettingRow
              title="Quiz mode"
              subtitle="One right answer, shown after they answer"
              icon="star"
              toggle={{
                value: quiz,
                onChange: v => {
                  setQuiz(v);
                  if (v) {
                    setMulti(false);
                  } else {
                    setCorrect(null);
                  }
                },
              }}
            />
          </SettingGroup>

          {quiz ? (
            <>
              <View style={styles.labelRow}>
                <Txt variant="label" tone="secondary">
                  EXPLANATION (OPTIONAL)
                </Txt>
                <Txt variant="caption" tone="muted">
                  {explain.length}/200
                </Txt>
              </View>
              <View style={styles.box}>
                <TextInput value={explain} onChangeText={t => setExplain(t.slice(0, 200))} placeholder="Shown after someone answers" placeholderTextColor={colors.textMuted} selectionColor={colors.primary} multiline style={styles.input} />
              </View>
            </>
          ) : null}

          <View style={styles.labelRow}>
            <Txt variant="label" tone="secondary">
              CLOSES
            </Txt>
            <Txt variant="caption" tone="muted">
              {closeMs ? 'Votes stop after this time' : 'Stays open'}
            </Txt>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {CLOSE_CHOICES.map(c => (
              <Pressable key={c.label} onPress={() => setCloseMs(c.ms)} accessibilityRole="button" accessibilityState={{selected: closeMs === c.ms}} style={({pressed}) => [styles.pill, closeMs === c.ms && styles.pillOn, pressed && {opacity: 0.85}]}>
                <Txt variant="bodyStrong" style={{color: closeMs === c.ms ? colors.onPrimary : colors.text}}>
                  {c.label}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.labelRow}>
            <Txt variant="label" tone="secondary">
              PREVIEW
            </Txt>
          </View>
          <View style={styles.previewBubble}>
            <PollView poll={draft} tally={{}} onVote={() => {}} mine preview />
          </View>
        </ScrollView>

        <View style={[styles.bottom, {paddingBottom: (kb > 0 ? kb : insets.bottom) + spacing.md}]}>
          {problem ? (
            <Txt variant="caption" tone="muted" center style={styles.problem}>
              {problem}
            </Txt>
          ) : null}
          <Pressable onPress={create} disabled={!!problem} accessibilityRole="button" accessibilityState={{disabled: !!problem}} style={({pressed}) => [styles.create, !!problem && styles.createOff, pressed && {opacity: 0.88}]}>
            <Txt variant="bodyStrong" style={styles.createTxt}>
              Create poll
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  flex: {flex: 1},
  root: {flex: 1, backgroundColor: colors.bg},
  top: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md},
  body: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xl},
  labelRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm},
  box: {minHeight: 52, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  boxBad: {borderColor: colors.danger},
  input: {color: colors.text, fontSize: 16, paddingVertical: 12},
  optRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm},
  optBox: {flex: 1},
  num: {width: 26, alignItems: 'center'},
  radio: {width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center'},
  radioOn: {backgroundColor: colors.success, borderColor: colors.success},
  sm: {width: 34},
  dup: {marginLeft: 34, marginTop: -4, marginBottom: spacing.sm},
  pillRow: {gap: spacing.sm, paddingVertical: 2},
  pill: {height: 40, paddingHorizontal: spacing.lg, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  pillOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  previewBubble: {alignSelf: 'flex-end', maxWidth: '88%', padding: spacing.md, borderRadius: 22, borderBottomRightRadius: 6, backgroundColor: colors.primary},
  bottom: {paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg, gap: spacing.sm},
  problem: {},
  create: {height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary},
  createOff: {opacity: 0.4},
  createTxt: {color: colors.onPrimary},
}));

export default PollCreator;
