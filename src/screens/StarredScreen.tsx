import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Icon, Card} from '@/components';
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

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {starred.length === 0 ? (
        <Card raised style={styles.empty}>
          <Icon name="star" size={26} color={colors.textMuted} />
          <Txt variant="subtitle" center>
            No starred messages
          </Txt>
          <Txt variant="caption" tone="muted" center>
            Press and hold a message in a chat, then tap Star, to keep it here.
          </Txt>
        </Card>
      ) : (
        <View style={styles.list}>
          {starred.map(m => {
            const title = titleOf(m.conversationId, m.convKind);
            return (
              <Card key={m.id} style={styles.row}>
                <Pressable
                  style={styles.body}
                  onPress={() => nav.navigate('Conversation', {conversationId: m.conversationId, kind: m.convKind, title})}>
                  <Txt variant="label" tone="secondary">
                    {m.mine ? 'You' : m.fromName} · {title} · {when(m.timestamp)}
                  </Txt>
                  <Txt variant="body" numberOfLines={3} style={styles.text}>
                    {m.type === 'image' ? 'Photo' : m.type === 'poll' ? `Poll: ${m.poll?.question ?? ''}` : m.text}
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

const styles = StyleSheet.create({
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, marginTop: spacing.xl},
  list: {gap: spacing.sm, marginTop: spacing.lg},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  body: {flex: 1},
  text: {marginTop: spacing.xs},
});
