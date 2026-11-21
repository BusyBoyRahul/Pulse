import {themedStyles} from '@/theme/themed';
import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Icon, Card, useHeaderSearch} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePrefsStore} from '@/store/prefsStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const when = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

export default function StarredScreen() {
  const nav = useNavigation<Nav>();
  const byConversation = useChatStore(s => s.byConversation);
  const groups = useGroupsStore(s => s.groups);
  const paired = usePairingStore(s => s.paired);
  const prefs = usePrefsStore(s => s.prefs);
  // Search is a header icon, like on every other page.
  const {q} = useHeaderSearch(nav, 'Search starred messages', 'Search starred messages');

  const starred = useMemo(
    () =>
      Object.values(byConversation)
        .flat()
        .filter(m => m.starred)
        .sort((a, b) => b.timestamp - a.timestamp),
    [byConversation],
  );

  const titleOf = (conversationId: string, kind: string) =>
    kind === 'group'
      ? groups.find(g => g.id === conversationId)?.name ?? 'Group'
      : prefs[conversationId]?.nickname || paired.find(p => p.publicKey === conversationId)?.name || 'Chat';

  const textOf = (m: (typeof starred)[number]) =>
    m.type === 'image' ? 'Photo' : m.type === 'poll' ? `Poll: ${m.poll?.question ?? ''}` : m.type === 'contact' ? `Contact: ${m.contact?.name ?? ''}` : m.text ?? '';
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? starred.filter(m => (textOf(m) + ' ' + (m.caption ?? '') + ' ' + m.fromName + ' ' + titleOf(m.conversationId, m.convKind)).toLowerCase().includes(needle))
    : starred;

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {shown.length === 0 ? (
        <Card raised flat style={styles.empty}>
          <Icon name="star" size={26} color={colors.textMuted} />
          <Txt variant="subtitle" center>
            {starred.length === 0 ? 'No starred messages' : 'Nothing matches that'}
          </Txt>
          <Txt variant="caption" tone="muted" center>
            {starred.length === 0 ? 'Press and hold a message in a chat, then tap Star, to keep it here.' : 'Try another word, a name or a chat.'}
          </Txt>
        </Card>
      ) : (
        <View style={styles.list}>
          {shown.map(m => {
            const title = titleOf(m.conversationId, m.convKind);
            return (
              <Card key={m.id} flat style={styles.row}>
                <Pressable
                  style={styles.body}
                  onPress={() => nav.navigate('Conversation', {conversationId: m.conversationId, kind: m.convKind, title})}>
                  <Txt variant="label" tone="secondary">
                    {m.mine ? 'You' : m.fromName} · {title} · {when(m.timestamp)}
                  </Txt>
                  <Txt variant="body" numberOfLines={3} style={styles.text}>
                    {textOf(m)}
                  </Txt>
                </Pressable>
                <Pressable
                  hitSlop={10}
                  accessibilityLabel="Remove star"
                  onPress={() => useChatStore.getState().toggleStar(m.conversationId, m.id)}>
                  <Icon name="star" size={20} color={colors.text} fill={colors.text} />
                </Pressable>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, marginTop: spacing.xl},
  list: {gap: spacing.sm, marginTop: spacing.lg},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  body: {flex: 1},
  text: {marginTop: spacing.xs},
}));
