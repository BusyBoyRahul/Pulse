import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Keyboard, PanResponder, Platform, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, ToastAndroid, View, useWindowDimensions} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {Easing, FadeIn, cancelAnimation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';

import {Avatar, Txt, Icon, IconName, Popover, PopoverItem} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {useStatusStore} from '@/store/statusStore';
import {useChatStore} from '@/store/chatStore';
import {usePrefsStore} from '@/store/prefsStore';
import {usePeersStore} from '@/store/peersStore';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {Backdrop} from './StatusComposerScreen';
import {ago} from './StatusScreen';
import {alertDialog} from '@/components/Dialog';

type R = RouteProp<RootStackParamList, 'StatusViewer'>;

const DURATION = 5000;
const REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

const toast = (msg: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  }
};

function Segment({state, progress}: {state: 'done' | 'now' | 'todo'; progress: Animated.SharedValue<number>}) {
  const fill = useAnimatedStyle(() => ({width: `${(state === 'done' ? 1 : state === 'now' ? progress.value : 0) * 100}%`}));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

/** A round button that stays readable on any picture: dark glass, light edge, white icon. */
function RoundBtn({icon, label, onPress, danger, size = 40}: {icon: IconName; label: string; onPress: () => void; danger?: boolean; size?: number}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [styles.round, {width: size, height: size, borderRadius: size / 2}, pressed && {opacity: 0.7}]}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={danger ? '#FF8A8A' : '#FFFFFF'} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * Watch updates one after another, WhatsApp style. Tap right = next, left = back, hold = pause, swipe down = close.
 * Other people's updates: a reply bar and quick reactions (they arrive in your chat with them).
 * Your own: swipe up (or tap the eye) to see who watched.
 */
export default function StatusViewerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {author} = useRoute<R>().params;
  const insets = useSafeAreaInsets();
  const {width, height: winH} = useWindowDimensions();
  const isMine = author === 'me';
  const me = getIdentity().publicKey;

  const mine = useStatusStore(s => s.mine);
  const views = useStatusStore(s => s.views);
  const feed = useStatusStore(s => s.feeds[author]);
  const myName = useSessionStore(s => s.profileName);
  const myAvatar = useSessionStore(s => s.avatarUri);
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const peers = usePeersStore(s => s.peers);

  const items = isMine ? mine : (feed?.items ?? []).filter(i => i.exp > Date.now());
  const [index, setIndex] = useState(() => {
    if (isMine) {
      return 0;
    }
    const seen = useStatusStore.getState().seen;
    const firstNew = items.findIndex(i => !seen[i.id]);
    return firstNew < 0 ? 0 : firstNew;
  });
  const [viewersOpen, setViewersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [typing, setTyping] = useState(false);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  // The "Viewed by" panel: 0 = tucked away below the screen, 1 = fully pulled up. It follows the finger.
  const panel = useSharedValue(0);
  const panelH = Math.round(Math.min(560, winH * 0.62));
  const item = items[index];

  // The timer stops while anything needs attention (a finger held down, the keyboard, a menu, a list) and
  // carries on from the same place when the last of them lets go.
  const holds = useRef(new Set<string>());

  const close = useCallback(() => nav.goBack(), [nav]);
  const next = useCallback(() => {
    holds.current.clear();
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      close();
    }
  }, [index, items.length, close]);
  const back = useCallback(() => {
    holds.current.clear();
    setIndex(i => Math.max(0, i - 1));
  }, []);

  const run = useCallback(
    (from: number) => {
      progress.value = from;
      progress.value = withTiming(1, {duration: DURATION * (1 - from), easing: Easing.linear}, finished => {
        if (finished) {
          runOnJS(next)();
        }
      });
    },
    [progress, next],
  );

  const hold = useCallback(
    (why: string) => {
      if (holds.current.size === 0) {
        cancelAnimation(progress);
      }
      holds.current.add(why);
    },
    [progress],
  );
  const release = useCallback(
    (why: string) => {
      if (!holds.current.delete(why)) {
        return;
      }
      if (holds.current.size === 0) {
        run(progress.value);
      }
    },
    [progress, run],
  );

  // Each update starts its own timer, and tells the author it was seen.
  useEffect(() => {
    if (!item) {
      close();
      return;
    }
    if (!isMine) {
      useStatusStore.getState().markSeen(author, item.id);
    }
    run(0);
    return () => cancelAnimation(progress);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openViewers = useCallback(() => {
    hold('viewers');
    setViewersOpen(true);
    panel.value = withTiming(1, {duration: 260, easing: Easing.out(Easing.cubic)});
  }, [hold, panel]);
  const closeViewers = useCallback(() => {
    panel.value = withTiming(0, {duration: 220, easing: Easing.out(Easing.cubic)});
    setViewersOpen(false);
    release('viewers');
  }, [panel, release]);

  // Swipe down to close; swipe up (my own updates) to see who watched. Always the latest handlers.
  const act = useRef({close, openViewers, isMine});
  act.current = {close, openViewers, isMine};
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderGrant: () => hold('swipe'),
      onPanResponderMove: (_, g) => {
        if (g.dy < 0 && act.current.isMine) {
          panel.value = Math.min(1, -g.dy / panelH); // the list follows the finger up
          drag.value = 0;
        } else {
          drag.value = g.dy > 0 ? g.dy : g.dy * 0.25;
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120) {
          act.current.close();
          return;
        }
        drag.value = withTiming(0, {duration: 180});
        if (g.dy < 0 && act.current.isMine) {
          if (-g.dy > 70) {
            act.current.openViewers();
          } else {
            panel.value = withTiming(0, {duration: 180});
          }
        }
        release('swipe');
      },
      onPanResponderTerminate: () => {
        drag.value = withTiming(0, {duration: 180});
        if (!act.current.isMine || panel.value < 1) {
          panel.value = withTiming(0, {duration: 180});
        }
        release('swipe');
      },
    }),
  ).current;
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{translateY: drag.value}, {scale: interpolate(drag.value, [0, 400], [1, 0.9], 'clamp')}],
    opacity: interpolate(drag.value, [0, 300], [1, 0.4], 'clamp'),
    borderRadius: interpolate(drag.value, [0, 60], [0, 24], 'clamp'),
  }));

  const panelStyle = useAnimatedStyle(() => ({transform: [{translateY: (1 - panel.value) * panelH}]}));
  const scrimStyle = useAnimatedStyle(() => ({opacity: panel.value * 0.55}));

  if (!item) {
    return <View style={styles.flex} />;
  }

  const name = isMine ? myName || 'You' : prefs[author]?.nickname || feed?.name || 'Pulse user';
  const avatar = isMine ? myAvatar : peers[author]?.avatar ?? profiles[author]?.avatar;
  const viewers = views[item.id] ?? [];
  const nameOf = (k: string) => prefs[k]?.nickname || peers[k]?.name || profiles[k]?.name || k.slice(0, 8);

  const confirmDelete = () => {
    hold('dialog');
    alertDialog('Delete this update?', 'It is removed for everyone who could see it.', [
      {text: 'Cancel', style: 'cancel', onPress: () => release('dialog')},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          useStatusStore.getState().remove(item.id);
          if (items.length <= 1) {
            close();
          } else {
            release('dialog');
          }
        },
      },
    ]);
  };

  /** A reply or a reaction lands in the chat with the author, quoting this update. */
  const send = (text: string) => {
    const t = text.trim();
    if (!t || isMine) {
      return;
    }
    void useChatStore.getState().sendText(author, 'direct', t, {name: `${name}'s status`, text: item.text || (item.kind === 'photo' ? 'Photo' : 'Status')});
    setReply('');
    Keyboard.dismiss();
    toast('Sent');
  };

  const touchDown = () => hold('touch');
  const touchUp = () => release('touch');

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Animated.View style={[styles.flex, styles.page, dragStyle]} {...pan.panHandlers}>
        <Animated.View key={item.id} entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill}>
          <Backdrop bg={item.bg} photo={item.photo} />
          {item.text ? (
            <View style={[styles.textWrap, item.kind === 'photo' && styles.captionWrap]} pointerEvents="none">
              <Txt variant="title" center style={[styles.text, item.kind === 'photo' ? styles.captionText : {fontSize: item.text.length > 120 ? 22 : item.text.length > 50 ? 28 : 36, lineHeight: (item.text.length > 120 ? 22 : item.text.length > 50 ? 28 : 36) * 1.3}]}>
                {item.text}
              </Txt>
            </View>
          ) : null}
        </Animated.View>

        {/* tap zones: left third goes back, the rest goes forward; holding pauses */}
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.zones}>
            <Pressable
              style={{width: width * 0.33}}
              onPress={() => {
                Keyboard.dismiss();
                back();
              }}
              onLongPress={touchDown}
              onPressOut={touchUp}
              delayLongPress={180}
              accessibilityLabel="Previous update"
            />
            <Pressable
              style={styles.fillZone}
              onPress={() => {
                Keyboard.dismiss();
                next();
              }}
              onLongPress={touchDown}
              onPressOut={touchUp}
              delayLongPress={180}
              accessibilityLabel="Next update"
            />
          </View>
        </View>

        <View style={[styles.header, {paddingTop: insets.top + spacing.sm}]} pointerEvents="box-none">
          <View style={styles.segments}>
            {items.map((it, i) => (
              <Segment key={it.id} state={i < index ? 'done' : i === index ? 'now' : 'todo'} progress={progress} />
            ))}
          </View>
          <View style={styles.who} pointerEvents="box-none">
            <RoundBtn icon="chevronLeft" label="Close" onPress={close} />
            <Avatar name={name} seed={isMine ? me : author} uri={avatar} size={38} />
            <View style={styles.whoText}>
              <Txt variant="bodyStrong" style={styles.white} numberOfLines={1}>
                {name}
              </Txt>
              <Txt variant="caption" style={styles.whiteSoft}>
                {ago(item.at)}
              </Txt>
            </View>
            <RoundBtn
              icon="more"
              label="More"
              onPress={() => {
                hold('menu');
                setMenuOpen(true);
              }}
            />
          </View>
        </View>

        {isMine ? (
          <View style={[styles.footer, {paddingBottom: insets.bottom + spacing.md}]} pointerEvents="box-none">
            <View style={styles.footSide} />
            <Pressable onPress={openViewers} style={styles.viewsPill} accessibilityRole="button" accessibilityLabel={`${viewers.length} views, tap to see who`}>
              <Icon name="eye" size={18} color="#FFFFFF" />
              <Txt variant="bodyStrong" style={styles.white}>
                {viewers.length}
              </Txt>
            </Pressable>
            <View style={[styles.footSide, styles.footEnd]}>
              <RoundBtn icon="trash" label="Delete this update" onPress={confirmDelete} danger size={44} />
            </View>
          </View>
        ) : (
          <View style={[styles.footer, styles.footColumn, {paddingBottom: insets.bottom + spacing.md}]} pointerEvents="box-none">
            {typing ? (
              <View style={styles.reactions}>
                {REACTIONS.map(e => (
                  <Pressable key={e} onPress={() => send(e)} style={styles.reaction} accessibilityRole="button" accessibilityLabel={`React ${e}`}>
                    <Txt style={styles.emoji}>{e}</Txt>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.replyRow}>
              <View style={styles.replyBox}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => {
                    setTyping(true);
                    hold('input');
                  }}
                  onBlur={() => {
                    setTyping(false);
                    release('input');
                  }}
                  placeholder={`Reply to ${name}`}
                  placeholderTextColor="rgba(255,255,255,0.7)"
                  returnKeyType="send"
                  onSubmitEditing={() => send(reply)}
                  style={styles.replyInput}
                />
              </View>
              {reply.trim() ? <RoundBtn icon="send" label="Send reply" onPress={() => send(reply)} size={46} /> : null}
            </View>
          </View>
        )}
      </Animated.View>

      <Popover
        visible={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          release('menu');
        }}
        align="right">
        {isMine ? (
          <>
            <PopoverItem
              icon="edit"
              label="Edit"
              onPress={() => {
                setMenuOpen(false);
                release('menu');
                nav.replace('StatusComposer', {start: 'text', editId: item.id});
              }}
            />
            <PopoverItem
              icon="eye"
              label="Seen by"
              value={String(viewers.length)}
              onPress={() => {
                setMenuOpen(false);
                release('menu');
                openViewers();
              }}
            />
            <PopoverItem
              icon="trash"
              label="Delete"
              danger
              onPress={() => {
                setMenuOpen(false);
                release('menu');
                confirmDelete();
              }}
            />
          </>
        ) : (
          <PopoverItem
            icon="user"
            label="View profile"
            onPress={() => {
              setMenuOpen(false);
              release('menu');
              nav.navigate('Contact', {publicKey: author});
            }}
          />
        )}
      </Popover>

      {/* Pull up from the bottom (or tap the eye): everyone who has watched this update. */}
      {isMine ? (
        <>
          <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents={viewersOpen ? 'auto' : 'none'}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeViewers} accessibilityLabel="Close list" />
          </Animated.View>
          <Animated.View style={[styles.panel, {height: panelH, paddingBottom: insets.bottom + spacing.md}, panelStyle]} pointerEvents={viewersOpen ? 'auto' : 'none'}>
            <Pressable onPress={closeViewers} style={styles.handleZone} accessibilityRole="button" accessibilityLabel="Close list">
              <View style={styles.handle} />
            </Pressable>
            <View style={styles.panelHead}>
              <Icon name="eye" size={20} color={colors.text} />
              <Txt variant="subtitle">Viewed by {viewers.length}</Txt>
            </View>
            {viewers.length === 0 ? (
              <View style={styles.noViews}>
                <Icon name="eye" size={28} color={colors.textMuted} />
                <Txt variant="caption" tone="muted">
                  Nobody has opened this yet.
                </Txt>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.viewerList}>
                {viewers.map(k => (
                  <View key={k} style={styles.viewer}>
                    <Avatar name={nameOf(k)} seed={k} uri={peers[k]?.avatar ?? profiles[k]?.avatar} size={44} />
                    <Txt variant="bodyStrong">{nameOf(k)}</Txt>
                  </View>
                ))}
              </ScrollView>
            )}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  flex: {flex: 1, backgroundColor: '#000'},
  page: {overflow: 'hidden'},
  zones: {flex: 1, flexDirection: 'row'},
  fillZone: {flex: 1},
  header: {position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.sm},
  segments: {flexDirection: 'row', gap: 4},
  track: {flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden'},
  fill: {height: 3, backgroundColor: '#FFFFFF'},
  who: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  whoText: {flex: 1},
  white: {color: '#FFFFFF'},
  whiteSoft: {color: 'rgba(255,255,255,0.8)'},
  round: {alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)'},
  textWrap: {...StyleSheet.absoluteFillObject, justifyContent: 'center', paddingHorizontal: spacing.xl},
  captionWrap: {justifyContent: 'flex-end', paddingBottom: 130},
  text: {color: '#FFFFFF', fontWeight: '700'},
  captionText: {fontSize: 18, lineHeight: 24, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 18, padding: spacing.md, overflow: 'hidden'},
  footer: {position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg},
  footColumn: {flexDirection: 'column', alignItems: 'stretch', gap: spacing.md},
  footSide: {width: 64},
  footEnd: {alignItems: 'flex-end'},
  viewsPill: {flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)'},
  reactions: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs},
  reaction: {width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'},
  emoji: {fontSize: 22},
  replyRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  replyBox: {flex: 1, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', justifyContent: 'center', paddingHorizontal: spacing.lg},
  replyInput: {color: '#FFFFFF', fontSize: 16, padding: 0},
  viewer: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm},
  scrim: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
  panel: {position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg},
  handleZone: {alignItems: 'center', paddingVertical: spacing.md},
  handle: {width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border},
  panelHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md},
  viewerList: {paddingBottom: spacing.lg},
  noViews: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg},
}));
