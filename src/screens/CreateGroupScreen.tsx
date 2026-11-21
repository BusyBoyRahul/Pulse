import {themedStyles} from '@/theme/themed';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, TextInput, ToastAndroid, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Screen, Button, Txt, Avatar, GroupAvatar, Icon, IconTile} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import type {RootStackParamList} from '@/navigation/types';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore, MAX_NAME, MAX_DESC, MAX_MEMBERS} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {pickProfilePhoto, takeProfilePhoto} from '@/services/imagePicker';
import {alertDialog} from '@/components/Dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Making a group in two steps, one thing at a time:
 *  1. choose people — search, tap to add, everyone chosen shows as a chip at the top (tap a chip to take them off);
 *  2. name it — the group picture, the name, and who is coming. Back goes to step 1, not out of the screen.
 */
export default function CreateGroupScreen() {
  const nav = useNavigation<Nav>();
  const paired = usePairingStore(s => s.paired);
  const peers = usePeersStore(s => s.peers);
  const known = usePrefsStore(s => s.profiles);
  const createGroup = useGroupsStore(s => s.create);

  const [step, setStep] = useState<'people' | 'name'>('people');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pic, setPic] = useState<string | null>(null);
  const leaving = useRef(false);

  const takePic = (thumb: string | null | undefined) => {
    if (thumb === undefined) {
      return; // cancelled
    }
    if (!thumb) {
      ToastAndroid.show('That photo is too detailed. Try another.', ToastAndroid.SHORT);
      return;
    }
    setPic(thumb);
  };
  const choosePic = () =>
    alertDialog('Group picture', undefined, [
      {text: 'Choose a photo', onPress: () => void pickProfilePhoto().then(p => p && takePic(p.thumb))},
      {text: 'Take a photo', onPress: () => void takeProfilePhoto().then(p => p && takePic(p.thumb))},
      ...(pic ? [{text: 'Remove picture', style: 'destructive' as const, onPress: () => setPic(null)}] : []),
      {text: 'Cancel', style: 'cancel' as const},
    ]);

  const nameOf = (key: string, fallback: string) => usePrefsStore.getState().nameFor(key, fallback);
  const people = useMemo(
    () =>
      paired
        .map(p => ({key: p.publicKey, name: nameOf(p.publicKey, p.name)}))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [paired],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? people.filter(p => p.name.toLowerCase().includes(q)) : people;
  const chosen = selected.map(k => people.find(p => p.key === k)).filter((p): p is {key: string; name: string} => !!p);
  const avatarOf = (key: string) => peers[key]?.avatar ?? known[key]?.avatar;

  const toggle = (key: string) =>
    setSelected(s => {
      if (s.includes(key)) {
        return s.filter(k => k !== key);
      }
      if (s.length >= MAX_MEMBERS - 1) {
        ToastAndroid.show(`A group can have up to ${MAX_MEMBERS} people`, ToastAndroid.SHORT);
        return s;
      }
      return [...s, key];
    });

  // The header says where you are, and Back (the arrow or the phone's button) goes from step 2 to step 1.
  useEffect(() => {
    nav.setOptions({title: step === 'people' ? 'New group' : 'Name your group'});
  }, [nav, step]);
  useEffect(() => {
    return nav.addListener('beforeRemove', e => {
      if (step === 'name' && !leaving.current) {
        e.preventDefault();
        setStep('people');
      }
    });
  }, [nav, step]);

  const create = () => {
    const group = createGroup(name.trim(), selected, {desc: desc.trim() || undefined, pic: pic ?? undefined});
    leaving.current = true;
    nav.replace('Conversation', {conversationId: group.id, kind: 'group', title: group.name});
  };

  if (step === 'people') {
    return (
      <Screen
        scroll
        edges={['left', 'right']}
        bottomClear={false}
        footer={<Button label={selected.length ? `Next · ${selected.length} chosen` : 'Next'} onPress={() => setStep('name')} disabled={selected.length === 0} />}>
        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your connections"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Icon name="x" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {chosen.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chips}>
            {chosen.map(p => (
              <Pressable key={p.key} onPress={() => toggle(p.key)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
                <View>
                  <Avatar name={p.name} seed={p.key} uri={avatarOf(p.key)} size={52} />
                  <View style={styles.chipX}>
                    <Icon name="x" size={11} color={colors.onPrimary} strokeWidth={3.5} />
                  </View>
                </View>
                <Txt variant="caption" tone="secondary" numberOfLines={1} style={styles.chipName}>
                  {p.name.split(' ')[0]}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {people.length === 0 ? (
          <View style={styles.empty}>
            <IconTile icon="users" size={56} color={colors.primary} />
            <Txt variant="subtitle" center>
              No connections yet
            </Txt>
            <Txt variant="caption" tone="muted" center>
              Connect with someone first, then you can add them to a group.
            </Txt>
          </View>
        ) : (
          <>
            <Txt variant="label" tone="muted" style={styles.section}>
              {`YOUR CONNECTIONS · ${people.length}`}
            </Txt>
            {shown.length === 0 ? (
              <Txt variant="caption" tone="muted" center style={{marginTop: spacing.lg}}>
                No one called “{query.trim()}”
              </Txt>
            ) : (
              shown.map(p => {
                const on = selected.includes(p.key);
                return (
                  <Pressable key={p.key} onPress={() => toggle(p.key)} style={({pressed}) => [styles.row, pressed && {backgroundColor: colors.surfaceHover}]} accessibilityRole="checkbox" accessibilityState={{checked: on}}>
                    <Avatar name={p.name} seed={p.key} uri={avatarOf(p.key)} size={44} />
                    <Txt variant="bodyStrong" style={styles.rowName} numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={14} color={colors.onPrimary} strokeWidth={3} /> : null}</View>
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['left', 'right']} bottomClear={false} footer={<Button label="Create group" onPress={create} disabled={name.trim().length === 0} />}>
      <View style={styles.hero}>
        <Pressable onPress={choosePic} accessibilityRole="button" accessibilityLabel="Choose a group picture">
          <GroupAvatar pic={pic} size={104} />
          <View style={styles.camera}>
            <Icon name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressable>
        <View style={styles.nameBox}>
          <TextInput
            value={name}
            onChangeText={t => setName(t.slice(0, MAX_NAME))}
            placeholder="Group name"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            autoFocus
            returnKeyType="done"
            style={styles.nameInput}
          />
          <Txt variant="caption" tone="muted" style={styles.counter}>
            {name.length}/{MAX_NAME}
          </Txt>
        </View>
      </View>

      <Txt variant="label" tone="muted" style={styles.section}>
        ABOUT (OPTIONAL)
      </Txt>
      <View style={styles.descBox}>
        <TextInput
          value={desc}
          onChangeText={t => setDesc(t.slice(0, MAX_DESC))}
          multiline
          placeholder="What is this group for?"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          style={styles.descInput}
        />
        <Txt variant="caption" tone="muted" style={styles.counter}>
          {desc.length}/{MAX_DESC}
        </Txt>
      </View>

      <Txt variant="label" tone="muted" style={styles.section}>
        {`WHO’S COMING · ${chosen.length}`}
      </Txt>
      <View style={styles.summary}>
        {chosen.map(p => (
          <View key={p.key} style={styles.sumItem}>
            <Avatar name={p.name} seed={p.key} uri={avatarOf(p.key)} size={44} />
            <Txt variant="caption" tone="secondary" numberOfLines={1} style={styles.sumName}>
              {p.name.split(' ')[0]}
            </Txt>
          </View>
        ))}
      </View>

      <View style={styles.note}>
        <Icon name="lock" size={14} color={colors.textMuted} />
        <Txt variant="caption" tone="muted" style={{flex: 1}}>
          End-to-end encrypted. Each person has to accept before they join.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  search: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, borderRadius: radius.pill, paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md},
  searchInput: {flex: 1, color: colors.text, fontSize: 15, padding: 0},
  bleed: {marginHorizontal: -spacing.xl, marginTop: spacing.lg, flexGrow: 0},
  chips: {gap: spacing.md, paddingHorizontal: spacing.xl},
  chip: {alignItems: 'center', width: 60, gap: 4},
  chipX: {position: 'absolute', right: -2, top: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg},
  chipName: {maxWidth: 60},
  section: {marginTop: spacing.xl, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md},
  rowName: {flex: 1},
  check: {width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  empty: {alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl},
  hero: {alignItems: 'center', paddingTop: spacing.xl},
  camera: {position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg},
  descBox: {padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  descInput: {minHeight: 64, maxHeight: 160, color: colors.text, fontSize: 15, padding: 0, textAlignVertical: 'top'},
  nameBox: {width: '100%', marginTop: spacing.xl},
  nameInput: {height: 54, borderRadius: radius.pill, paddingHorizontal: spacing.xl, color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, fontSize: 17, textAlign: 'center'},
  counter: {alignSelf: 'flex-end', marginTop: spacing.xs, marginRight: spacing.md},
  summary: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg},
  sumItem: {alignItems: 'center', width: 56, gap: 4},
  sumName: {maxWidth: 56},
  note: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl},
}));
