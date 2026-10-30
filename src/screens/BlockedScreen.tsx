import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Avatar, Icon, Card} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function BlockedScreen() {
  const nav = useNavigation<Nav>();
  const prefs = usePrefsStore(s => s.prefs);
  const profiles = usePrefsStore(s => s.profiles);
  const paired = usePairingStore(s => s.paired);
  const keys = Object.keys(prefs).filter(k => prefs[k].blocked);

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {keys.length === 0 ? (
        <Card raised style={styles.empty}>
          <Icon name="ban" size={26} color={colors.textMuted} />
          <Txt variant="subtitle" center>
            No one is blocked
          </Txt>
          <Txt variant="caption" tone="muted" center>
            Blocked people can’t message or call you and don’t appear in Nearby. Block someone from their profile.
          </Txt>
        </Card>
      ) : (
        <View style={styles.list}>
          {keys.map(key => {
            const name = prefs[key].nickname || paired.find(p => p.publicKey === key)?.name || profiles[key]?.name || 'Pulse user';
            return (
              <Card key={key} style={styles.row}>
                <Pressable style={styles.who} onPress={() => nav.navigate('Contact', {publicKey: key})}>
                  <Avatar name={name} seed={key} uri={profiles[key]?.avatar} size={42} />
                  <Txt variant="bodyStrong" numberOfLines={1} style={styles.name}>
                    {name}
                  </Txt>
                </Pressable>
                <Pressable onPress={() => usePrefsStore.getState().patch(key, {blocked: false})} style={styles.unblock} hitSlop={8}>
                  <Txt variant="caption">Unblock</Txt>
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
  row: {flexDirection: 'row', alignItems: 'center'},
  who: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  name: {marginLeft: spacing.md, flex: 1},
  unblock: {paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
});
