import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, ToastAndroid, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {Screen, Txt, Button, Sheet, TextField, SettingRow, SettingGroup, SettingLabel} from '@/components';
import {spacing} from '@/theme/theme';
import {useChatStore, mediaUsage} from '@/store/chatStore';
import {mediaFiles, formatBytes} from '@/services/mediaFiles';
import {exportBackup, openBackup, readBackupFile, applyBackup, OpenResult} from '@/services/backup';

type BackupFlow = null | {kind: 'create'} | {kind: 'restore'; text: string};

export default function SettingsStorageScreen() {
  const byConversation = useChatStore(s => s.byConversation);
  const [, bump] = useState(0);
  const [files, setFiles] = useState({count: 0, bytes: 0});
  const [flow, setFlow] = useState<BackupFlow>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void mediaFiles.usage().then(setFiles);
    }, []),
  );

  const chats = Object.values(byConversation).filter(l => l.length > 0).length;
  const messages = Object.values(byConversation).reduce((n, l) => n + l.length, 0);
  const photos = mediaUsage();

  const refreshFiles = () => void mediaFiles.usage().then(setFiles);

  const clearPhotos = () =>
    Alert.alert('Delete saved photos?', 'Photos disappear from your chats on this phone. The text stays. This can’t be undone.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete photos', style: 'destructive', onPress: () => void useChatStore.getState().clearAllMedia().then(() => bump(n => n + 1))},
    ]);

  const clearFiles = () =>
    Alert.alert('Delete files and voice notes?', 'They disappear from your chats on this phone. This can’t be undone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete files',
        style: 'destructive',
        onPress: () =>
          void mediaFiles.clearAll().then(() => {
            refreshFiles();
            bump(n => n + 1);
          }),
      },
    ]);

  const clearChats = () =>
    Alert.alert('Delete every chat?', 'All messages, photos, files and voice notes on this phone are erased. People you’re connected to stay connected. This can’t be undone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete all chats',
        style: 'destructive',
        onPress: () =>
          void useChatStore
            .getState()
            .clearAllChats()
            .then(() => {
              refreshFiles();
              bump(n => n + 1);
            }),
      },
    ]);

  // ---- backup -------------------------------------------------------------------
  const closeFlow = () => {
    setFlow(null);
    setPass('');
    setPass2('');
    setProblem(null);
    setBusy(false);
  };

  const startRestore = async () => {
    const r = await mediaFiles.pick('*/*');
    if (!r.ok) {
      if (r.reason === 'too-large') {
        ToastAndroid.show('That file is too large to be a Pulse backup', ToastAndroid.SHORT);
      }
      return;
    }
    try {
      const text = await readBackupFile(r.file.path, r.file.size);
      void mediaFiles.remove(r.file.path);
      if (!text.startsWith('PULSEBAK1:')) {
        Alert.alert('Not a Pulse backup', 'That file isn’t a Pulse backup (.pulsebak).');
        return;
      }
      setFlow({kind: 'restore', text});
    } catch {
      Alert.alert('Couldn’t read that file');
    }
  };

  const runBackup = async () => {
    setProblem(null);
    if (pass.length < 8) {
      return setProblem('Use at least 8 characters.');
    }
    if (pass !== pass2) {
      return setProblem('The two passphrases don’t match.');
    }
    setBusy(true);
    // Let the spinner paint before the (CPU-heavy) encryption starts.
    await new Promise<void>(res => setTimeout(() => res(), 50));
    const ok = await exportBackup(pass);
    closeFlow();
    if (ok) {
      ToastAndroid.show('Backup saved', ToastAndroid.SHORT);
    }
  };

  const runRestore = async () => {
    if (!flow || flow.kind !== 'restore') {
      return;
    }
    setProblem(null);
    setBusy(true);
    await new Promise<void>(res => setTimeout(() => res(), 50));
    const r: OpenResult = openBackup(flow.text, pass);
    if (!r.ok) {
      setBusy(false);
      return setProblem(r.reason === 'wrong-passphrase' ? 'Wrong passphrase.' : 'This file is damaged.');
    }
    const when = new Date(r.at).toLocaleString();
    setFlow(null);
    setBusy(false);
    Alert.alert('Restore this backup?', `Made ${when}. It REPLACES your chats, connections, profile and settings on this phone, then Pulse restarts.`, [
      {text: 'Cancel', style: 'cancel', onPress: closeFlow},
      {text: 'Restore', style: 'destructive', onPress: () => void applyBackup(r.data)},
    ]);
  };

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false}>
      <SettingLabel>ON THIS PHONE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="chat" title="Chats" value={`${chats}`} noChevron />
        <SettingRow icon="database" title="Messages" value={`${messages}`} noChevron />
        <SettingRow icon="image" title="Saved photos" value={photos.count ? `${photos.count} · ${formatBytes(photos.bytes)}` : 'None'} noChevron />
        <SettingRow icon="file" title="Files & voice notes" value={files.count ? `${files.count} · ${formatBytes(files.bytes)}` : 'None'} noChevron />
      </SettingGroup>

      <SettingLabel>FREE UP SPACE</SettingLabel>
      <SettingGroup>
        <SettingRow icon="image" title="Delete saved photos" subtitle="Keeps the text of your chats" danger onPress={clearPhotos} disabled={photos.count === 0} />
        <SettingRow icon="file" title="Delete files and voice notes" subtitle="Keeps the text of your chats" danger onPress={clearFiles} disabled={files.count === 0} />
        <SettingRow icon="trash" title="Delete all chats" subtitle="Erases every message, photo and file" danger onPress={clearChats} disabled={messages === 0} />
      </SettingGroup>

      <SettingLabel>BACKUP</SettingLabel>
      <SettingGroup>
        <SettingRow icon="download" title="Back up chats & settings" subtitle="An encrypted file you keep. Needs a passphrase to open" onPress={() => setFlow({kind: 'create'})} />
        <SettingRow icon="database" title="Restore from a backup" subtitle="Pick a .pulsebak file" onPress={() => void startRestore()} />
      </SettingGroup>
      <Txt variant="caption" tone="muted" style={styles.note}>
        A backup holds your identity key, connections, groups, chat text, labels and settings. Photos, files and voice notes are not included. Keep the passphrase safe — nobody can recover it for you.
      </Txt>

      <Sheet visible={!!flow} onClose={closeFlow} title={flow?.kind === 'restore' ? 'Restore backup' : 'Back up'}>
        <Txt variant="caption" tone="secondary" style={styles.sheetNote}>
          {flow?.kind === 'restore'
            ? 'Enter the passphrase you chose when you made this backup.'
            : 'Choose a passphrase to lock the backup file. Pick something you will remember — it can’t be reset.'}
        </Txt>
        <TextField label="Passphrase" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        {flow?.kind === 'create' ? <TextField label="Repeat passphrase" value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" autoCorrect={false} /> : null}
        {problem ? (
          <Txt variant="caption" tone="danger" style={styles.sheetNote}>
            {problem}
          </Txt>
        ) : null}
        <View>
          <Button
            label={flow?.kind === 'restore' ? 'Open backup' : 'Create backup'}
            loading={busy}
            disabled={!pass}
            onPress={() => void (flow?.kind === 'restore' ? runRestore() : runBackup())}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {marginTop: spacing.lg, paddingHorizontal: spacing.xs},
  sheetNote: {marginBottom: spacing.md},
});
