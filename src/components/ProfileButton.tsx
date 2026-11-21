import {themedStyles} from '@/theme/themed';
import React, {useState} from 'react';
import {StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '@/navigation/types';
import {useSessionStore} from '@/store/sessionStore';
import {getIdentity} from '@/services/identity';
import {Avatar} from './Avatar';
import {AccountSheet} from './AccountSheet';
import {Pressy} from './Pressy';

/**
 * My picture at the top-left of every main screen. Tap = my profile. Long-press = a small
 * dropdown to switch account or add one.
 */
export function ProfileButton({size = 38}: {size?: number}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const name = useSessionStore(s => s.profileName);
  const avatar = useSessionStore(s => s.avatarUri);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressy onPress={() => nav.navigate('Profile')} onLongPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="My profile" scaleTo={0.92} style={styles.btn}>
        <Avatar name={name || 'You'} seed={getIdentity().publicKey} uri={avatar ?? undefined} size={size} />
      </Pressy>
      <AccountSheet visible={open} onClose={() => setOpen(false)} onManage={() => nav.navigate('Accounts')} />
    </>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  btn: {alignItems: 'center', justifyContent: 'center'},
}));

export default ProfileButton;
