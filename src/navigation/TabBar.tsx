import {themedStyles, useThemeVersion} from '@/theme/themed';
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSpring} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';

import {Icon, IconName, Txt} from '@/components';
import {colors, motion, spacing, shadowTone} from '@/theme/theme';
import {useChatStore} from '@/store/chatStore';
import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {useCallLogStore} from '@/store/callLogStore';

const TABS: Record<string, {icon: IconName; label: string}> = {
  ChatsTab: {icon: 'chat', label: 'Chats'},
  NearbyTab: {icon: 'radar', label: 'Nearby'},
  SOSTab: {icon: 'sos', label: 'SOS'},
  StatusTab: {icon: 'status', label: 'Status'},
  CallsTab: {icon: 'phone', label: 'Calls'},
};

const BAR_PAD = 6;

/**
 * Floating glass tab bar. A single accent pill glides to the selected tab. Every
 * tab is equal — SOS is one feature among the others, not a special button.
 */
export function TabBar({state, navigation}: BottomTabBarProps) {
  useThemeVersion();
  const insets = useSafeAreaInsets();
  const byConversation = useChatStore(s => s.byConversation);
  const prefs = usePrefsStore(s => s.prefs);
  const paired = usePairingStore(s => s.paired);
  const groups = useGroupsStore(s => s.groups);
  const [barW, setBarW] = useState(0);
  const missedCalls = useCallLogStore(s => s.calls.filter(c => c.direction === 'incoming' && c.outcome === 'missed' && c.at > s.seenAt).length);

  // Unread messages in the chats you can actually see (not muted, not blocked).
  const unread = useMemo(() => {
    const shown = new Set([...paired.map(p => p.publicKey), ...groups.map(g => g.id)]);
    let n = 0;
    for (const [id, list] of Object.entries(byConversation)) {
      if (!shown.has(id)) {
        continue;
      }
      const p = prefs[id];
      if (p?.blocked || p?.locked || usePrefsStore.getState().isMuted(id)) {
        continue;
      }
      const lastRead = p?.lastRead ?? 0;
      n += list.filter(m => !m.mine && m.timestamp > lastRead).length;
    }
    return n;
  }, [byConversation, prefs, paired, groups]);

  const count = state.routes.length;
  const tabW = barW > 0 ? (barW - BAR_PAD * 2) / count : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring(state.index * tabW, motion.spring);
  }, [state.index, tabW, x]);
  const pill = useAnimatedStyle(() => ({transform: [{translateX: x.value}]}));

  return (
    <View style={[styles.wrap, {paddingBottom: Math.max(insets.bottom, spacing.md)}]} pointerEvents="box-none">
      <View style={styles.bar} onLayout={e => setBarW(e.nativeEvent.layout.width)}>
        {tabW > 0 ? (
          <Animated.View style={[styles.pill, {width: tabW}, pill]} />
        ) : null}
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const {icon, label} = TABS[route.name] ?? {icon: 'home' as IconName, label: route.name};

          const onPress = () => {
            const event = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const fg = focused ? colors.onPrimary : colors.text;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{selected: focused}}
              style={styles.tab}>
              <View>
                <Icon name={icon} size={21} color={fg} strokeWidth={focused ? 2.3 : 1.9} />
                {(route.name === 'ChatsTab' ? unread : route.name === 'CallsTab' ? missedCalls : 0) > 0 ? (
                  <View style={[styles.badge, focused && styles.badgeOnPill]}>
                    <Txt variant="label" style={[styles.badgeTxt, focused && {color: colors.primary}]}>
                      {(() => {
                        const n = route.name === 'ChatsTab' ? unread : missedCalls;
                        return n > 99 ? '99+' : n;
                      })()}
                    </Txt>
                  </View>
                ) : null}
              </View>
              <Txt variant="label" style={[styles.label, {color: fg}]}>
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: spacing.sm},
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: BAR_PAD,
    shadowColor: shadowTone(),
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 5,
  },
  pill: {position: 'absolute', left: BAR_PAD, top: BAR_PAD, bottom: BAR_PAD, borderRadius: 26, backgroundColor: colors.primary},
  tab: {flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', gap: 2},
  label: {fontSize: 10, lineHeight: 12, letterSpacing: 0.3},
  badge: {position: 'absolute', top: -6, right: -12, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center'},
  badgeOnPill: {backgroundColor: colors.onPrimary, borderColor: colors.primary},
  badgeTxt: {color: '#FFFFFF', fontSize: 10, lineHeight: 12},
}));

export default TabBar;
