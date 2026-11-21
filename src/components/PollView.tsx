import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {alpha, colors, radius, spacing} from '@/theme/theme';
import type {PollData} from '@/types';
import {Icon} from './Icon';
import {Txt} from './Text';

type Props = {
  poll: PollData;
  /** option index → names of the people who picked it ('You' is me). */
  tally: Record<number, string[]>;
  onVote: (i: number) => void;
  /** In a blue bubble of mine (text colours change). */
  mine?: boolean;
  /** Shown in the creator: nothing can be tapped. */
  preview?: boolean;
};

function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/**
 * A poll as it appears in the chat. Single answer, multiple answers, quiz (one right answer, shown once you have
 * answered, with a note) and anonymous votes (counts only), plus an optional closing time. The same view is used in
 * the creator as a live preview, so what you set up is exactly what people get.
 */
export function PollView({poll, tally, onVote, mine, preview}: Props) {
  const total = useMemo(() => Object.values(tally).reduce((s, v) => s + v.length, 0), [tally]);
  const people = useMemo(() => new Set(Object.values(tally).flat()).size, [tally]);
  const picked = poll.options.map((_, i) => !!tally[i]?.includes('You'));
  const answered = picked.some(Boolean);
  const closed = !!poll.closesAt && Date.now() > poll.closesAt;
  const quiz = poll.quiz !== undefined;
  const locked = closed || (quiz && answered) || !!preview;
  const fg = mine ? colors.onBubbleMine : colors.text;
  const soft = mine ? alpha(colors.onBubbleMine, 0.75) : colors.textSecondary;

  const chips: string[] = [];
  if (quiz) {
    chips.push('Quiz');
  } else if (poll.multi) {
    chips.push('Multiple answers');
  }
  if (poll.anon) {
    chips.push('Anonymous');
  }
  if (closed) {
    chips.push('Closed');
  } else if (poll.closesAt) {
    chips.push(`Closes in ${left(poll.closesAt - Date.now())}`);
  }

  return (
    <View style={styles.poll}>
      <View style={styles.head}>
        <Icon name="poll" size={16} color={fg} />
        <Txt variant="bodyStrong" style={[styles.q, {color: fg}]}>
          {poll.question || 'Your question'}
        </Txt>
      </View>
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map(c => (
            <View key={c} style={[styles.chip, {backgroundColor: mine ? alpha(colors.onBubbleMine, 0.2) : colors.primaryDim}]}>
              <Txt variant="caption" style={{color: mine ? colors.onBubbleMine : colors.primaryBright}}>
                {c}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      {poll.options.map((opt, i) => {
        const count = tally[i]?.length ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const on = picked[i];
        const showKey = quiz && answered; // the right answer is only revealed once you have answered
        const right = showKey && poll.quiz === i;
        const wrong = showKey && on && poll.quiz !== i;
        const barColor = right ? alpha(colors.success, 0.3) : wrong ? alpha(colors.danger, 0.25) : colors.primaryDim;
        return (
          <Pressable key={i} onPress={() => !locked && onVote(i)} disabled={locked} accessibilityRole="button" accessibilityState={{selected: on, disabled: locked}} accessibilityLabel={`${opt}${on ? ', your answer' : ''}`} style={({pressed}) => [styles.opt, pressed && !locked && {opacity: 0.85}]}>
            {answered || closed || preview ? <View style={[styles.fill, {width: `${pct}%`, backgroundColor: barColor}]} /> : null}
            <View style={[styles.mark, poll.multi && !quiz ? styles.markSquare : null, on && {backgroundColor: right ? colors.success : wrong ? colors.danger : colors.primary, borderColor: 'transparent'}]}>
              {on ? <Icon name={wrong ? 'x' : 'check'} size={13} color="#FFFFFF" strokeWidth={3} /> : right ? <Icon name="check" size={13} color={colors.success} strokeWidth={3} /> : null}
            </View>
            <Txt variant="body" style={styles.optText} numberOfLines={3}>
              {opt || '…'}
            </Txt>
            {answered || closed || preview ? (
              <Txt variant="caption" tone="secondary">
                {count > 0 || answered || closed ? `${pct}%` : ''}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}

      {quiz && answered && poll.explain ? (
        <View style={[styles.explain, {backgroundColor: mine ? alpha(colors.onBubbleMine, 0.16) : colors.surfaceRaised}]}>
          <Icon name="info" size={15} color={soft} />
          <Txt variant="caption" style={[styles.explainTxt, {color: fg}]}>
            {poll.explain}
          </Txt>
        </View>
      ) : null}

      <Txt variant="caption" style={{color: soft, marginTop: spacing.xs}}>
        {total === 0 && preview
          ? 'Nobody has answered yet'
          : `${people} ${people === 1 ? 'person' : 'people'} · ${total} vote${total === 1 ? '' : 's'}`}
        {closed ? ' · Closed' : quiz ? (answered ? '' : ' · Pick the right answer') : poll.multi ? ' · Pick any' : ' · Tap to vote'}
      </Txt>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  poll: {minWidth: 240},
  head: {flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: spacing.xs},
  q: {flex: 1},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm},
  chip: {paddingHorizontal: 9, height: 22, borderRadius: 11, justifyContent: 'center'},
  opt: {minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 8, marginBottom: spacing.xs, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  fill: {position: 'absolute', left: 0, top: 0, bottom: 0},
  mark: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center'},
  markSquare: {borderRadius: 6},
  optText: {flex: 1},
  explain: {flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.md, marginTop: spacing.xs},
  explainTxt: {flex: 1},
}));

export default PollView;
