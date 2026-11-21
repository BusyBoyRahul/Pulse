import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {colors, spacing} from '@/theme/theme';
import {navigationRef} from '@/navigation/ref';
import {displayName} from '@/services/names';
import {useCallStore} from '@/store/callStore';
import {useInternetCallStore} from '@/net/internetCall';
import {Txt} from './Text';
import {Icon} from './Icon';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A call is still going but you are looking at something else (you pressed "Minimise"): a green pill at the top says so,
 * with the person's name and how long it has been, and a tap takes you back to the call.
 */
export function CallBar() {
  const insets = useSafeAreaInsets();
  const mesh = useCallStore(s => ({phase: s.phase, key: s.peerKey, name: s.peerName, startedAt: s.startedAt}));
  const net = useInternetCallStore(s => ({phase: s.phase, key: s.peerKey, name: s.name, startedAt: s.startedAt}));
  const [route, setRoute] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const read = () => setRoute(navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined);
    read();
    const off = navigationRef.addListener('state', read);
    return off;
  }, []);

  const netOn = net.phase === 'outgoing' || net.phase === 'connecting' || net.phase === 'active';
  const meshOn = mesh.phase === 'outgoing' || mesh.phase === 'active';
  const on = netOn || meshOn;
  useEffect(() => {
    if (!on) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);

  if (!on || route === 'Call' || route === 'InternetCall') {
    return null;
  }
  const call = netOn ? {...net, screen: 'InternetCall' as const, active: net.phase === 'active'} : {...mesh, screen: 'Call' as const, active: mesh.phase === 'active'};
  const name = call.key ? displayName(call.key, call.name) : call.name?.trim() || 'call';
  // A thin strip in the status-bar band at the very top, so it never covers a screen's own header or buttons.
  return (
    <View style={[styles.wrap, {height: Math.max(insets.top, 26)}]}>
      <Pressable onPress={() => navigationRef.isReady() && navigationRef.navigate(call.screen)} style={styles.strip} accessibilityRole="button" accessibilityLabel={`Back to your call with ${name}`}>
        <Icon name="phone" size={13} color="#FFFFFF" />
        <Txt variant="label" style={styles.text} numberOfLines={1}>
          {call.active ? `Call with ${name} · ${clock(now - (call.startedAt ?? now))}` : `Calling ${name}…`} · Tap to return
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, backgroundColor: colors.success},
  strip: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.lg},
  text: {color: '#FFFFFF', flexShrink: 1},
}));
