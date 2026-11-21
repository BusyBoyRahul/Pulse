import {themedStyles} from '@/theme/themed';
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {RouteProp, useRoute} from '@react-navigation/native';

import {Screen, Txt, Icon, IconName, Avatar, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {colors, elevation, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useChatStore} from '@/store/chatStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {getIdentity} from '@/services/identity';
import {previewOf, dayLabel, relayWord} from './ConversationScreen';

/**
 * Everything about one message, as a page of its own: the message, what happened to it (sent, delivered, read — the same
 * ticks as in the chat), and how it travelled.
 */
export default function MessageInfoScreen() {
  const {params} = useRoute<RouteProp<RootStackParamList, 'MessageInfo'>>();
  const msg = useChatStore(s => (s.byConversation[params.conversationId] ?? []).find(m => m.id === params.messageId));
  const group = useGroupsStore(s => (params.kind === 'group' ? s.groups.find(g => g.id === params.conversationId) : undefined));
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);

  if (!msg) {
    return (
      <Screen edges={['left', 'right']} bottomClear={false}>
        <View style={styles.gone}>
          <Icon name="info" size={26} color={colors.textMuted} />
          <Txt variant="subtitle" center>
            This message is no longer here
          </Txt>
        </View>
      </Screen>
    );
  }

  const relayed = !!msg.hops && msg.hops > 0;
  const showRoute = relayed || params.kind === 'direct';

  // A group message of mine: who has it, who read it, who hasn't got it yet.
  const me = getIdentity().publicKey;
  const recipients = group && msg.mine ? group.joined.filter(k => k !== me) : [];
  const nameOf = (k: string) => usePrefsStore.getState().nameFor(k, paired.find(p => p.publicKey === k)?.name || peers[k]?.name || known[k]?.name || 'Pulse user');
  const readBy = recipients.filter(k => msg.acks?.[k]?.s);
  const gotIt = recipients.filter(k => msg.acks?.[k]?.d && !msg.acks?.[k]?.s);
  const waiting = recipients.filter(k => !msg.acks?.[k]?.d);
  // Invited but haven't accepted: they don't get messages until they join.
  const notJoined = group && msg.mine ? group.members.filter(k => k !== me && !group.joined.includes(k)) : [];
  const whenOf = (at?: number) => (at ? new Date(at).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) + ' · ' + dayLabel(at) : '');
  const who = (title: string, keys: string[], field: 'd' | 's' | null) =>
    keys.length === 0 ? null : (
      <>
        <SettingLabel>{`${title} · ${keys.length}`}</SettingLabel>
        <SettingGroup>
          {keys.map(k => (
            <View key={k} style={styles.who}>
              <Avatar name={nameOf(k)} seed={k} uri={peers[k]?.avatar ?? known[k]?.avatar} size={38} />
              <Txt variant="bodyStrong" numberOfLines={1} style={styles.whoName}>
                {nameOf(k)}
              </Txt>
              {field ? (
                <Txt variant="caption" tone="muted">
                  {whenOf(msg.acks?.[k]?.[field])}
                </Txt>
              ) : null}
            </View>
          ))}
        </SettingGroup>
      </>
    );

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {/* the message, as it looks in the chat: mine on the right, theirs on the left */}
      <View style={[styles.bubble, msg.mine ? styles.mine : styles.their, {alignSelf: msg.mine ? 'flex-end' : 'flex-start'}]}>
        <Txt variant="body" style={msg.mine ? styles.mineText : undefined} numberOfLines={8}>
          {previewOf(msg)}
        </Txt>
      </View>

      <SettingLabel>STATUS</SettingLabel>
      <View style={styles.card}>
        {msg.mine && group ? (
          // A group message: "delivered" and "read" are different for each person, so they are listed by name below.
          <Step icon="check" title="Sent" at={msg.timestamp} done last />
        ) : msg.mine ? (
          <>
            <Step icon="check" title="Sent" at={msg.timestamp} done />
            <Step icon="checkAll" title="Delivered" at={msg.deliveredAt} done={!!msg.deliveredAt || msg.status === 'delivered' || msg.status === 'seen'} />
            <Step icon="checkAll" title="Read" at={msg.seenAt} done={!!msg.seenAt || msg.status === 'seen'} green last />
          </>
        ) : (
          <Step icon="check" title="Received" at={msg.timestamp} done last />
        )}
      </View>

      {who('READ BY', readBy, 's')}
      {who('DELIVERED TO', gotIt, 'd')}
      {who('NOT DELIVERED YET', waiting, null)}
      {who('NOT JOINED YET', notJoined, null)}

      {showRoute || msg.edited || msg.starred ? (
        <>
          <SettingLabel>DETAILS</SettingLabel>
          <SettingGroup>
            {showRoute ? <SettingRow icon={relayed ? 'swap' : 'radar'} title="Route" value={relayed ? `Via ${relayWord(msg.hops ?? 0)}` : 'Direct'} noChevron /> : null}
            {msg.edited ? <SettingRow icon="edit" title="Edited" value="Yes" noChevron /> : null}
            {msg.starred ? <SettingRow icon="star" title="Starred" value="Yes" noChevron /> : null}
          </SettingGroup>
        </>
      ) : null}
    </Screen>
  );
}

/**
 * One step in a message's story: a round tick on a thin line that joins the steps. A step that has happened is coloured and
 * shows when; one that hasn't is grey and says "Not yet".
 */
function Step({icon, title, at, done, green, last}: {icon: IconName; title: string; at?: number; done: boolean; green?: boolean; last?: boolean}) {
  return (
    <View style={[styles.stepRow, last && styles.stepRowLast]}>
      <View style={styles.stepRail}>
        <View style={[styles.stepDot, done && (green ? styles.stepGreen : styles.stepBlue)]}>
          <Icon name={icon} size={18} color={done ? '#FFFFFF' : colors.textMuted} strokeWidth={2.6} />
        </View>
        {last ? null : <View style={[styles.stepLine, done && styles.stepLineOn]} />}
      </View>
      <Txt variant="bodyStrong" tone={done ? 'primary' : 'muted'} style={styles.stepTitle}>
        {title}
      </Txt>
      <View style={[styles.stepWhen, !at && styles.stepNot]}>
        {at ? (
          <>
            <Txt variant="bodyStrong">{new Date(at).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}</Txt>
            <Txt variant="caption" tone="muted">
              {dayLabel(at)}
            </Txt>
          </>
        ) : (
          <Txt variant="caption" tone="muted">
            {done ? 'Yes' : 'Not yet'}
          </Txt>
        )}
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  gone: {alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl},
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  whoName: {flex: 1},
  bubble: {maxWidth: '88%', minWidth: 78, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.sm},
  mine: {backgroundColor: colors.bubbleMine, borderBottomRightRadius: 6},
  their: {backgroundColor: colors.bubbleTheirs, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.glassBorder},
  mineText: {color: colors.onBubbleMine},
  card: {backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, ...elevation.card},
  stepRow: {flexDirection: 'row', gap: spacing.md, minHeight: 64},
  // The last step has no line below it, so it needn't leave room for one.
  stepRowLast: {minHeight: 44, paddingBottom: spacing.xs},
  stepRail: {alignItems: 'center', width: 40},
  stepDot: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center'},
  stepBlue: {backgroundColor: colors.primary},
  stepGreen: {backgroundColor: '#22C55E'},
  stepLine: {width: 2, flex: 1, marginVertical: 3, borderRadius: 1, backgroundColor: colors.border},
  stepLineOn: {backgroundColor: colors.primary},
  stepTitle: {flex: 1, paddingTop: 9},
  stepWhen: {alignItems: 'flex-end', paddingTop: 0},
  // "Not yet" is one short line: centre it on the round tick, level with the step's name.
  stepNot: {paddingTop: 11},
}));
