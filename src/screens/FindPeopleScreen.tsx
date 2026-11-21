import {themedStyles} from '@/theme/themed';
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Txt, Card, Avatar, Button, Icon, Reveal, Sheet, SettingGroup, SettingRow, useHeaderSearch} from '@/components';
import {colors, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {directory, numberCheck} from '@/net/directoryService';
import {isUsername, cleanUsername, Candidate} from '@/net/directory';
import {useNetStore} from '@/net/netStore';
import {shortId} from '@/services/identity';
import {readContacts, scanQr} from '@/services/contactsScan';
import Clipboard from '@react-native-clipboard/clipboard';
import {parseLink, findInvite} from '@/services/inviteLink';
import {usePairingStore} from '@/store/pairingStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSettingsStore} from '@/store/settingsStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'FindPeople'>;

type Row = {key: string; name: string; sub: string; number?: string; contact?: string};

/** Find and connect with people: by @username, from your contacts, or with a scanned code or link. */
export default function FindPeopleScreen() {
  const nav = useNavigation<Nav>();
  const params = useRoute<R>().params;
  const mode = useSettingsStore(s => s.app.internetMode);
  const relays = useNetStore(s => s.relays);
  const paired = usePairingStore(s => s.paired);
  const incoming = usePairingStore(s => s.incoming);
  const outgoing = usePairingStore(s => s.outgoing);
  const profiles = usePrefsStore(s => s.profiles);

  // Search is a header icon, like on every other page; the keyboard's search key runs it.
  const submit = useRef<() => void>(() => undefined);
  const {q, searching} = useHeaderSearch(nav, 'Find by @username', 'Find by username', () => submit.current());
  const [busy, setBusy] = useState<null | 'search' | 'contacts'>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState<{key: string; name: string} | null>(params?.invite ?? null);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    if (params?.invite) {
      setInvite(params.invite);
    }
  }, [params?.invite]);

  const offline = mode === 'off';
  const statusOf = (key: string) => (paired.some(p => p.publicKey === key) ? 'paired' : incoming.some(r => r.publicKey === key) ? 'incoming' : outgoing.includes(key) ? 'outgoing' : 'none');

  const connect = (key: string, name: string) => {
    const st = statusOf(key);
    if (st === 'incoming') {
      const req = incoming.find(r => r.publicKey === key);
      if (req) {
        usePairingStore.getState().accept(req);
      }
    } else if (st === 'none') {
      usePairingStore.getState().request({publicKey: key, name, lastSeen: Date.now(), hops: 0});
    }
    usePrefsStore.getState().remember(key, {name});
  };

  const search = async () => {
    setMsg(null);
    if (offline) {
      setMsg('Searching needs the internet. Turn it on in Internet settings.');
      return;
    }
    if (!isUsername(q)) {
      setMsg('Type a username: 3–20 letters, numbers or _.');
      return;
    }
    setBusy('search');
    setTitle('Results');
    setRows(null);
    const found = await directory().findUsername(q);
    setBusy(null);
    // Only the owner of the name is listed (the oldest claim). The short code is part of who they are: the same name can look alike, the code can't.
    setRows(found.map((c: Candidate) => ({key: c.key, name: c.name || cleanUsername(q), sub: `@${cleanUsername(q)} · ${shortId(c.key)}`})));
  };

  submit.current = () => void search();

  const fromContacts = async () => {
    setMsg(null);
    setBusy('contacts');
    setTitle('Friends on Pulse');
    setRows(null);
    const list = await readContacts();
    if (!list) {
      setBusy(null);
      setMsg('Pulse needs permission to read your contacts. They are compared as one-way scrambles and never uploaded as numbers.');
      return;
    }
    const byNumber = await directory().findNumbers(list.map(c => c.number));
    const out: Row[] = [];
    for (const c of list) {
      for (const cand of byNumber.get(c.number) ?? []) {
        out.push({key: cand.key, name: cand.name || c.name, sub: `In your contacts as “${c.name}”`, number: c.number, contact: c.name});
      }
    }
    setBusy(null);
    setRows(out);
  };

  const scan = async () => {
    setMsg(null);
    const text = await scanQr();
    if (text === null) {
      return;
    }
    const inv = parseLink(text);
    if (!inv) {
      setMsg('That code is not a Pulse code.');
      return;
    }
    setInvite(inv);
  };

  /** A friend sent a message with their invite: copy it, tap here, done. */
  const pasteInvite = async () => {
    setMsg(null);
    const text = await Clipboard.getString();
    const inv = findInvite(text ?? '');
    if (!inv) {
      setMsg('No Pulse invite found. Copy your friend’s message first.');
      return;
    }
    setInvite(inv);
  };

  const confirmNumber = async (r: Row) => {
    if (!r.number) {
      return;
    }
    setChecking(r.key);
    const res = await numberCheck().check(r.key, r.number);
    setChecking(null);
    if (res === 'confirmed') {
      usePrefsStore.getState().remember(r.key, {numberOk: true});
    } else {
      setMsg(res === 'unavailable' ? 'Could not send the check text. Allow text messages and make sure you are online.' : `${r.name} could not prove that number. They may not really own it — be careful.`);
    }
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      {offline || relays === 0 ? (
        <Card style={styles.notice}>
          <Icon name="globe" size={20} color={colors.textMuted} />
          <View style={styles.noticeText}>
            <Txt variant="bodyStrong">{offline ? 'The internet is off' : 'Connecting to the internet…'}</Txt>
            <Txt variant="caption" tone="muted">
              {offline ? 'Searching needs the internet. Turn it on in Internet settings.' : 'Searching works once Pulse is connected.'}
            </Txt>
          </View>
          {offline ? <Button label="Settings" size="sm" variant="secondary" fullWidth={false} onPress={() => nav.navigate('SettingsInternet')} /> : null}
        </Card>
      ) : null}

      {!searching && !rows ? (
        <Txt variant="caption" tone="muted" style={styles.hint}>
          Tap the magnifier above to find someone by @username, or use one of these.
        </Txt>
      ) : null}

      <SettingGroup>
        <SettingRow icon="users" title="Find friends from my contacts" subtitle="Only people who chose to be found by number" onPress={() => void fromContacts()} disabled={offline} />
        <SettingRow icon="qr" title="Scan a code" subtitle="A friend’s QR code" onPress={() => void scan()} />
        <SettingRow icon="copy" title="Paste an invite" subtitle="From a message your friend sent" onPress={() => void pasteInvite()} />
        <SettingRow icon="user" title="My code and link" subtitle="Share it, and choose who can find you" onPress={() => nav.navigate('MyCode')} />
      </SettingGroup>

      {msg ? (
        <Txt variant="caption" tone="danger" style={styles.msg}>
          {msg}
        </Txt>
      ) : null}

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {rows ? (
        <>
          <Txt variant="label" tone="muted" style={styles.section}>
            {title.toUpperCase()}
          </Txt>
          {rows.length === 0 ? (
            <Card flat style={styles.empty}>
              <Icon name="search" size={24} color={colors.textMuted} />
              <Txt variant="caption" tone="muted" center>
                {title === 'Results' ? 'Nobody with that username. Check the spelling, or ask them for their code.' : 'None of your contacts are findable on Pulse yet.'}
              </Txt>
            </Card>
          ) : (
            rows.map((r, i) => {
              const st = statusOf(r.key);
              const ok = profiles[r.key]?.numberOk;
              return (
                <Reveal key={`${r.key}${r.number ?? ''}`} index={i}>
                  <Card flat style={styles.row}>
                    <Avatar name={r.name} seed={r.key} size={46} />
                    <View style={styles.rowText}>
                      <Txt variant="bodyStrong">{r.name}</Txt>
                      <Txt variant="caption" tone="muted" numberOfLines={2}>
                        {r.sub}
                      </Txt>
                      {r.number ? (
                        <Txt variant="caption" tone={ok ? 'accent' : 'muted'}>
                          {ok ? '✓ Number confirmed by a text check' : 'Number not confirmed yet'}
                        </Txt>
                      ) : null}
                    </View>
                    <View style={styles.actions}>
                      {r.number && !ok ? <Button label={checking === r.key ? 'Checking…' : 'Confirm'} size="sm" variant="secondary" fullWidth={false} loading={checking === r.key} onPress={() => void confirmNumber(r)} /> : null}
                      {st === 'paired' ? (
                        <Txt variant="caption" tone="muted">
                          Connected
                        </Txt>
                      ) : st === 'outgoing' ? (
                        <Txt variant="caption" tone="muted">
                          Requested…
                        </Txt>
                      ) : (
                        <Button label={st === 'incoming' ? 'Accept' : 'Connect'} size="sm" fullWidth={false} onPress={() => connect(r.key, r.name)} />
                      )}
                    </View>
                  </Card>
                </Reveal>
              );
            })
          )}
        </>
      ) : null}

      <Sheet visible={!!invite} onClose={() => setInvite(null)} title="Connect with this person?">
        {invite ? (
          <View style={styles.sheet}>
            <Avatar name={invite.name} seed={invite.key} size={72} />
            <Txt variant="title" center>
              {invite.name}
            </Txt>
            <Txt variant="caption" tone="muted" center>
              They will get a request and can accept.
            </Txt>
            <View style={styles.sheetBtns}>
              {statusOf(invite.key) === 'paired' ? (
                <Button label="Already connected" variant="secondary" disabled />
              ) : (
                <Button
                  label={statusOf(invite.key) === 'incoming' ? 'Accept' : 'Send request'}
                  onPress={() => {
                    connect(invite.key, invite.name);
                    setInvite(null);
                  }}
                />
              )}
              <Button label="Cancel" variant="ghost" onPress={() => setInvite(null)} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  notice: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md},
  noticeText: {flex: 1, gap: 2},
  hint: {marginBottom: spacing.md},
  msg: {marginTop: spacing.md},
  loading: {marginTop: spacing.xl, alignItems: 'center'},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm},
  rowText: {flex: 1, gap: 2},
  actions: {alignItems: 'flex-end', gap: spacing.xs},
  sheet: {alignItems: 'center', gap: spacing.sm},
  sheetBtns: {alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.md},
}));
