import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';

import {Icon, IconName, Txt} from '@/components';
import {colors, spacing} from '@/theme/theme';
import {useChatStore} from '@/store/chatStore';
import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';

const TABS: Record<string, {icon: IconName; label: string}> = {
  ChatsTab: {icon: 'chat', label: 'Chats'},
  NearbyTab: {icon: 'radar', label: 'Nearby'},
  SOSTab: {icon: 'sos', label: 'SOS'},
  NotesTab: {icon: 'note', label: 'Notes'},
  ProfileTab: {icon: 'user', label: 'You'},
};

/**
 * Floating monochrome tab bar. The selected tab lights up as a white capsule; the
 * SOS tab is the one splash of colour — always red, always one tap away.
 */
export function TabBar({state, navigation}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const byConversation = useChatStore(s => s.byConversation);
  const prefs = usePrefsStore(s => s.prefs);
  const paired = usePairingStore(s => s.paired);
  const groups = useGroupsStore(s => s.groups);

  // Unread messages in the chats you can actually see (not muted, not blocked).
  const unread = useMemo(() => {
    const shown = new Set([...paired.map(p => p.publicKey), ...groups.map(g => g.id)]);
    let n = 0;
    for (const [id, list] of Object.entries(byConversation)) {
      if (!shown.has(id)) {
        continue;
      }
      const p = prefs[id];
      if (p?.blocked || usePrefsStore.getState().isMuted(id)) {
        continue;
      }
      const lastRead = p?.lastRead ?? 0;
      n += list.filter(m => !m.mine && m.timestamp > lastRead).length;
    }
    return n;
  }, [byConversation, prefs, paired, groups]);

  return (
    <View style={[styles.wrap, {paddingBottom: Math.max(insets.bottom, spacing.md)}]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const {icon, label} = TABS[route.name] ?? {icon: 'home' as IconName, label: route.name};
          const isSos = route.name === 'SOSTab';

          const onPress = () => {
            const event = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const fg = isSos ? (focused ? colors.onDanger : colors.dangerBright) : focused ? colors.onPrimary : colors.textSecondary;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{selected: focused}}
              style={[styles.tab, focused && !isSos && styles.tabOn, isSos && (focused ? styles.tabSosOn : styles.tabSos)]}>
              <View>
                <Icon name={icon} size={21} color={fg} strokeWidth={focused || isSos ? 2.3 : 1.9} />
                {route.name === 'ChatsTab' && unread > 0 ? (
                  <View style={[styles.badge, focused && styles.badgeOnLight]}>
                    <Txt variant="label" style={[styles.badgeTxt, focused && {color: colors.primary}]}>
                      {unread > 99 ? '99+' : unread}
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

const styles = StyleSheet.create({
  wrap: {paddingHorizontal: 14, paddingTop: spacing.sm, backgroundColor: colors.bg},
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 5,
    gap: 3,
  },
  tab: {flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', gap: 2},
  tabOn: {backgroundColor: colors.primary},
  // Only ONE tab is ever filled: white for a normal tab, red for SOS. Resting SOS is just outlined.
  tabSos: {backgroundColor: colors.dangerDim, borderWidth: 1, borderColor: colors.danger},
  tabSosOn: {backgroundColor: colors.danger, borderWidth: 1, borderColor: colors.danger},
  label: {fontSize: 10, lineHeight: 12, letterSpacing: 0.3},
  badge: {position: 'absolute', top: -6, right: -12, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  badgeOnLight: {backgroundColor: colors.onPrimary},
  badgeTxt: {color: colors.onPrimary, fontSize: 10, lineHeight: 12},
});

export default TabBar;
