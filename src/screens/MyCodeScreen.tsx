import {themedStyles} from '@/theme/themed';
import React, {useEffect, useState} from 'react';
import {Share, StyleSheet, ToastAndroid, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {Screen, Txt, Card, Button, QrCode, Reveal, SettingGroup, SettingLabel, SettingRow, TextField} from '@/components';
import {spacing} from '@/theme/theme';
import {getIdentity} from '@/services/identity';
import {makeLink} from '@/services/inviteLink';
import {isUsername, cleanUsername} from '@/net/directory';
import {directory, lostUsername, clearLostUsername} from '@/net/directoryService';
import {useNetStore} from '@/net/netStore';
import {useSessionStore} from '@/store/sessionStore';
import {useSettingsStore} from '@/store/settingsStore';

/** My QR code and link, and the switches for who can find me. Everything about being findable is off until you turn it on. */
export default function MyCodeScreen() {
  const me = getIdentity().publicKey;
  const name = useSessionStore(s => s.profileName) || 'Pulse user';
  const phoneVerified = useSessionStore(s => s.phoneVerified);
  const app = useSettingsStore(s => s.app);
  const setApp = useSettingsStore(s => s.setApp);
  const link = makeLink(me, name);
  const relays = useNetStore(s => s.relays);
  const [handle, setHandle] = useState(app.username);
  const [check, setCheck] = useState<'idle' | 'checking' | 'free' | 'taken' | 'unknown'>('idle');
  /** A name I had to give up because someone older already owned it. */
  const [lost, setLost] = useState<string | null>(() => lostUsername());

  const clean = cleanUsername(handle);
  const valid = isUsername(handle);
  const changed = clean !== app.username;

  // A name is only claimed when "Save" is pressed (not while typing). Before that, ask the network if it is already taken.
  useEffect(() => {
    if (!valid || !changed) {
      setCheck('idle');
      return undefined;
    }
    if (relays === 0) {
      setCheck('unknown');
      return undefined;
    }
    let stale = false;
    setCheck('checking');
    const t = setTimeout(() => {
      void directory()
        .isTakenByOthers(clean)
        .then(taken => {
          if (!stale) {
            setCheck(taken ? 'taken' : 'free');
          }
        });
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [clean, valid, changed, relays]);

  const empty = handle.trim() === '';
  const canSave = valid && changed && (check === 'free' || check === 'unknown');
  const canRemove = empty && !!app.username;
  const save = () => {
    setApp({username: canRemove ? '' : clean});
    clearLostUsername();
    setLost(null);
    setCheck('idle');
  };
  const handleErr =
    !empty && !valid
      ? 'Use 3–20 letters, numbers or _ (no spaces).'
      : check === 'taken'
      ? `@${clean} is taken. Choose another.`
      : empty && lost
      ? `@${lost} was taken by someone who claimed it first. Choose another.`
      : null;
  const handleHint =
    check === 'checking'
      ? 'Checking…'
      : check === 'free'
      ? '✓ Available'
      : check === 'unknown'
      ? 'Can’t check offline. If someone older has it, you’ll be told.'
      : 'Letters, numbers and _ only.';

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <Reveal kind="pop" style={styles.qrWrap}>
        <QrCode value={link} size={236} />
      </Reveal>
      <Txt variant="title" center>
        {name}
      </Txt>
      {app.findByUsername && isUsername(app.username) ? (
        <Txt variant="body" tone="accent" center>
          @{cleanUsername(app.username)}
        </Txt>
      ) : null}
      <Txt variant="caption" tone="muted" center style={styles.hint}>
        Scan this code or open the link to connect with me.
      </Txt>

      <View style={styles.buttons}>
        <Button label="Share my link" onPress={() => void Share.share({message: `Connect with me on Pulse: ${link}`})} />
        <Button
          label="Copy link"
          variant="secondary"
          onPress={() => {
            Clipboard.setString(link);
            ToastAndroid.show('Link copied', ToastAndroid.SHORT);
          }}
        />
      </View>

      <SettingLabel>WHO CAN FIND ME</SettingLabel>
      <SettingGroup>
        <SettingRow icon="at" title="By @username" subtitle="Anyone who types your username can find you" toggle={{value: app.findByUsername, onChange: v => setApp({findByUsername: v})}} />
        <SettingRow
          icon="phone"
          title="By phone number"
          subtitle={phoneVerified ? 'Friends who have your number can find you' : 'Confirm your phone number first (You tab)'}
          disabled={!phoneVerified}
          toggle={{value: app.findByNumber && phoneVerified, onChange: v => setApp({findByNumber: v})}}
        />
      </SettingGroup>

      {app.findByUsername ? (
        <Reveal kind="fade">
          <Card style={styles.handleCard}>
            <TextField label="Your username" placeholder="maya_q" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} error={handleErr ?? undefined} hint={handleHint} />
            {canSave || canRemove ? (
              <Button label={canRemove ? 'Remove username' : `Save @${clean}`} variant={canRemove ? 'secondary' : 'primary'} size="sm" fullWidth={false} onPress={save} />
            ) : null}
          </Card>
        </Reveal>
      ) : null}

      <Txt variant="caption" tone="muted" style={styles.note}>
        Being findable is optional and stays off until you switch it on.
      </Txt>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  qrWrap: {alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.lg},
  hint: {marginTop: spacing.sm, paddingHorizontal: spacing.lg},
  buttons: {gap: spacing.sm, marginTop: spacing.xl},
  handleCard: {marginTop: spacing.md},
  note: {marginTop: spacing.lg},
}));
