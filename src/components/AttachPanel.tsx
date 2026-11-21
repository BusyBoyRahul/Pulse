import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Animated as RNAnimated, FlatList, Image, PanResponder, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions} from 'react-native';
import Animated, {FadeIn} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, elevation, radius, spacing} from '@/theme/theme';
import {GalleryItem, StorageRoot, formatDuration, mediaFiles} from '@/services/mediaFiles';
import {hasGalleryAccess} from '@/services/permissions';
import {Avatar} from './Avatar';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';
import {IconTile} from './Tile3D';

type Tab = 'gallery' | 'files' | 'contact';
type Access = 'checking' | 'ok' | 'denied';
type Cell = {kind: 'camera'} | {kind: 'item'; item: GalleryItem};

type Person = {key: string; name: string};

type Props = {
  /** Height when collapsed: the keyboard's height, so the chat does not jump between the two. */
  height: number;
  /** Height when pulled all the way up. */
  maxHeight: number;
  /** Pulled up (true) or resting at keyboard height (false). Controlled by the screen so Back can collapse it. */
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  /** Pulled down from the resting height: put the panel away. */
  onClose: () => void;
  /** People from my contacts that can be shared as a card. */
  contacts: Person[];
  onContacts: (people: Person[]) => void;
  /** How many more things can still be added. */
  room: number;
  onCamera: () => void;
  /** The chosen photos and videos, in the order they were tapped. */
  onGallery: (items: GalleryItem[]) => void;
  /** Android's own photo picker, for when photo access is not given. */
  onSystemPicker: () => void;
  /** Open Android's file browser, at this place (undefined = wherever it was last). */
  onFiles: (startAt?: string) => void;
  onPoll: () => void;
  /** Tried to pick more than `room`. */
  onFull: () => void;
};

const GAP = 2;
const COLS = 3;
const TABS_H = 72;

/**
 * What you can add to a message, as part of the screen: it opens under the message box in place of the keyboard.
 * The top is a grid of your newest photos and videos (tap several, then Next), the camera is the first square, and
 * the row along the bottom switches between Gallery, Files and Poll. No pop-up, no dimming.
 */
function PlaceRow({icon, label, note, onPress}: {icon: IconName; label: string; note: string; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({pressed}) => [styles.fileRow, pressed && {backgroundColor: colors.surfaceHover}]}>
      <IconTile icon={icon} size={44} color={colors.primary} />
      <View style={styles.fileText}>
        <Txt variant="bodyStrong">{label}</Txt>
        <Txt variant="caption" tone="secondary">
          {note}
        </Txt>
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function AttachPanel({height, maxHeight, expanded, onExpandedChange, onClose, contacts, onContacts, room, onCamera, onGallery, onSystemPicker, onFiles, onPoll, onFull}: Props) {
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('gallery');
  const [access, setAccess] = useState<Access>('checking');
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [roots, setRoots] = useState<StorageRoot[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [q, setQ] = useState('');

  // ---- the puller ----
  const hAnim = useRef(new RNAnimated.Value(expanded ? maxHeight : height)).current;
  const cur = useRef(expanded ? maxHeight : height);
  const start = useRef(0);
  const live = useRef({height, maxHeight, expanded, onExpandedChange, onClose});
  live.current = {height, maxHeight, expanded, onExpandedChange, onClose};
  useEffect(() => {
    const id = hAnim.addListener(({value}) => {
      cur.current = value;
    });
    return () => hAnim.removeListener(id);
  }, [hAnim]);
  useEffect(() => {
    RNAnimated.timing(hAnim, {toValue: expanded ? maxHeight : height, duration: 220, useNativeDriver: false}).start();
  }, [expanded, height, maxHeight, hAnim]);

  const settle = (dy: number, vy: number) => {
    const L = live.current;
    if (!L.expanded) {
      if (dy > 70 || vy > 0.9) {
        return L.onClose();
      }
      if (dy < -40 || vy < -0.5) {
        return L.onExpandedChange(true);
      }
    } else if (dy > 90 || vy > 0.6) {
      return L.onExpandedChange(false);
    }
    // not far enough: spring back to where it was
    RNAnimated.timing(hAnim, {toValue: L.expanded ? L.maxHeight : L.height, duration: 160, useNativeDriver: false}).start();
  };
  const drag = (dy: number) => {
    const L = live.current;
    hAnim.setValue(Math.max(L.height * 0.55, Math.min(L.maxHeight, start.current - dy)));
  };
  // The grab bar drags both ways; the area under it drags up (when resting) so the list never fights the gesture.
  const handlePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = cur.current;
        },
        onPanResponderMove: (_e, g) => drag(g.dy),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
            // a tap on the bar toggles
            return live.current.onExpandedChange(!live.current.expanded);
          }
          settle(g.dy, g.vy);
        },
        onPanResponderTerminate: (_e, g) => settle(g.dy, g.vy),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const bodyPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => !live.current.expanded && g.dy < -10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
        onPanResponderGrant: () => {
          start.current = cur.current;
        },
        onPanResponderMove: (_e, g) => drag(g.dy),
        onPanResponderRelease: (_e, g) => settle(g.dy, g.vy),
        onPanResponderTerminate: (_e, g) => settle(g.dy, g.vy),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const load = useCallback(async () => {
    const list = await mediaFiles.recent(90);
    if (list === null) {
      setAccess('denied');
    } else {
      setItems(list);
      setAccess('ok');
    }
  }, []);

  useEffect(() => {
    void mediaFiles.roots().then(setRoots);
  }, []);

  // Access is asked once, by the paperclip, before this panel opens (askGalleryOnce) — never from in here.
  useEffect(() => {
    void hasGalleryAccess().then(ok => (ok ? load() : setAccess('denied')));
  }, [load]);

  const toggle = (id: string) => {
    setChosen(c => {
      if (c.includes(id)) {
        return c.filter(x => x !== id);
      }
      if (c.length >= room) {
        onFull();
        return c;
      }
      return [...c, id];
    });
  };

  const size = Math.floor((width - GAP * (COLS - 1)) / COLS);
  const cells: Cell[] = [{kind: 'camera'}, ...items.map(item => ({kind: 'item' as const, item}))];

  const renderCell = ({item: cell}: {item: Cell}) => {
    if (cell.kind === 'camera') {
      return (
        <Pressable onPress={onCamera} accessibilityRole="button" accessibilityLabel="Take a photo" style={({pressed}) => [styles.cell, styles.camera, {width: size, height: size}, pressed && {opacity: 0.8}]}>
          <Icon name="camera" size={30} color={colors.textSecondary} />
          <Txt variant="caption" tone="secondary">
            Camera
          </Txt>
        </Pressable>
      );
    }
    const g = cell.item;
    const n = chosen.indexOf(g.id);
    const on = n >= 0;
    return (
      <Pressable onPress={() => toggle(g.id)} accessibilityRole="button" accessibilityLabel={(g.kind === 'video' ? 'Video' : 'Photo') + (on ? ', selected' : '')} accessibilityState={{selected: on}} style={[styles.cell, {width: size, height: size}]}>
        <Image source={{uri: g.uri}} style={[StyleSheet.absoluteFill, on && {opacity: 0.7}]} resizeMode="cover" resizeMethod="resize" />
        {g.kind === 'video' ? (
          <View style={styles.dur}>
            <Icon name="video" size={12} color="#FFFFFF" />
            <Txt variant="caption" style={styles.durTxt}>
              {formatDuration(g.durationMs)}
            </Txt>
          </View>
        ) : null}
        <View style={[styles.tick, on && styles.tickOn]}>
          {on ? (
            <Txt variant="label" style={styles.tickTxt}>
              {n + 1}
            </Txt>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const shown = contacts.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggleWho = (key: string) => setWho(w => (w.includes(key) ? w.filter(x => x !== key) : [...w, key]));

  const tabs: {id: Tab | 'poll'; icon: IconName; label: string}[] = [
    {id: 'gallery', icon: 'image', label: 'Gallery'},
    {id: 'files', icon: 'file', label: 'Files'},
    {id: 'contact', icon: 'user', label: 'Contact'},
    {id: 'poll', icon: 'poll', label: 'Poll'},
  ];

  return (
    <Animated.View entering={FadeIn.duration(160)}>
    <RNAnimated.View style={[styles.panel, {height: hAnim, paddingBottom: insets.bottom}]}>
      <View style={styles.handleZone} {...handlePan.panHandlers} accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse' : 'Pull up for more'}>
        <View style={styles.grabber} />
      </View>
      <View style={styles.body} {...(expanded ? {} : bodyPan.panHandlers)}>
        {tab === 'gallery' ? (
          access === 'ok' ? (
            <>
              <FlatList
                data={cells}
                renderItem={renderCell}
                keyExtractor={c => (c.kind === 'camera' ? 'camera' : c.item.id)}
                numColumns={COLS}
                columnWrapperStyle={{gap: GAP}}
                ItemSeparatorComponent={() => <View style={{height: GAP}} />}
                showsVerticalScrollIndicator={false}
                scrollEnabled={expanded}
                initialNumToRender={15}
                windowSize={5}
              />
              {chosen.length > 0 ? (
                <Animated.View entering={FadeIn.duration(120)} style={styles.next} pointerEvents="box-none">
                  <Pressable
                    onPress={() => onGallery(chosen.map(id => items.find(i => i.id === id)).filter((i): i is GalleryItem => !!i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Next with ${chosen.length} selected`}
                    style={({pressed}) => [styles.nextBtn, pressed && {opacity: 0.85}]}>
                    <Txt variant="bodyStrong" style={styles.nextTxt}>
                      Next · {chosen.length}
                    </Txt>
                  </Pressable>
                </Animated.View>
              ) : null}
            </>
          ) : access === 'checking' ? null : (
            <View style={styles.center}>
              <IconTile icon="image" size={48} color={colors.primary} />
              <Txt variant="subtitle" center>
                Photo access is off
              </Txt>
              <Txt variant="caption" tone="secondary" center style={styles.centerNote}>
                Use Android’s own picker to add photos.
              </Txt>
              <View style={styles.centerRow}>
                <Pressable onPress={onSystemPicker} accessibilityRole="button" style={({pressed}) => [styles.pill, styles.pillOn, pressed && {opacity: 0.85}]}>
                  <Txt variant="bodyStrong" style={styles.nextTxt}>
                    Photo picker
                  </Txt>
                </Pressable>
              </View>
            </View>
          )
        ) : tab === 'contact' ? (
          <>
            <View style={styles.search}>
              <Icon name="search" size={16} color={colors.textMuted} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search your contacts" placeholderTextColor={colors.textMuted} selectionColor={colors.primary} style={styles.searchInput} />
            </View>
            {contacts.length === 0 ? (
              <View style={styles.center}>
                <IconTile icon="users" size={48} color={colors.primary} />
                <Txt variant="subtitle" center>
                  No contacts to share yet
                </Txt>
                <Txt variant="caption" tone="secondary" center style={styles.centerNote}>
                  People you connect with in Pulse show up here.
                </Txt>
              </View>
            ) : (
              <FlatList
                data={shown}
                keyExtractor={p => p.key}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={expanded}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{paddingBottom: who.length ? 72 : 8}}
                renderItem={({item: p}) => {
                  const on = who.includes(p.key);
                  return (
                    <Pressable onPress={() => toggleWho(p.key)} accessibilityRole="button" accessibilityLabel={p.name} accessibilityState={{selected: on}} style={({pressed}) => [styles.fileRow, pressed && {backgroundColor: colors.surfaceHover}]}>
                      <Avatar name={p.name} seed={p.key} size={44} />
                      <View style={styles.fileText}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {p.name}
                        </Txt>
                      </View>
                      <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                    </Pressable>
                  );
                }}
              />
            )}
            {who.length > 0 ? (
              <Animated.View entering={FadeIn.duration(120)} style={styles.next} pointerEvents="box-none">
                <Pressable
                  onPress={() => {
                    onContacts(contacts.filter(p => who.includes(p.key)));
                    setWho([]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${who.length} contact${who.length === 1 ? '' : 's'}`}
                  style={({pressed}) => [styles.nextBtn, pressed && {opacity: 0.85}]}>
                  <Txt variant="bodyStrong" style={styles.nextTxt}>
                    Send · {who.length}
                  </Txt>
                </Pressable>
              </Animated.View>
            ) : null}
          </>
        ) : (
          <ScrollView style={styles.files} scrollEnabled={expanded} showsVerticalScrollIndicator={false}>
            <Txt variant="label" tone="secondary" style={styles.groupLabel}>
              STORAGE
            </Txt>
            {roots.filter(r => r.kind === 'volume').map(r => (
              <PlaceRow key={r.key} icon="storage" label={r.label} note="Browse everything on it" onPress={() => onFiles(r.key)} />
            ))}
            <Txt variant="label" tone="secondary" style={styles.groupLabel}>
              FOLDERS
            </Txt>
            {roots.filter(r => r.kind === 'folder').map(r => (
              <PlaceRow key={r.key} icon="folder" label={r.label} note="Open this folder" onPress={() => onFiles(r.key)} />
            ))}
            <PlaceRow icon="folder" label="Other places" note="Google Drive and other apps" onPress={() => onFiles(undefined)} />
          </ScrollView>
        )}
      </View>

      <View style={styles.tabs}>
        {tabs.map(t => {
          const active = t.id === tab;
          return (
            <Pressable
              key={t.id}
              onPress={() => (t.id === 'poll' ? onPoll() : setTab(t.id))}
              accessibilityRole="button"
              accessibilityLabel={t.label}
              accessibilityState={{selected: active}}
              style={({pressed}) => [styles.tab, active && styles.tabOn, pressed && {opacity: 0.8}]}>
              <Icon name={t.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
              <Txt variant="caption" style={{color: active ? colors.primary : colors.textSecondary}}>
                {t.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </RNAnimated.View>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  panel: {backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  handleZone: {height: 24, alignItems: 'center', justifyContent: 'center'},
  grabber: {width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border},
  body: {flex: 1},
  search: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginVertical: spacing.sm, height: 42, paddingHorizontal: spacing.md, borderRadius: 21, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  searchInput: {flex: 1, color: colors.text, fontSize: 15, padding: 0},
  check: {width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.border},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  cell: {overflow: 'hidden', backgroundColor: colors.surfaceRaised},
  camera: {alignItems: 'center', justifyContent: 'center', gap: 6},
  dur: {position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)'},
  durTxt: {color: '#FFFFFF', fontSize: 11, lineHeight: 14},
  tick: {position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.18)'},
  tickOn: {backgroundColor: colors.primary, borderColor: '#FFFFFF'},
  tickTxt: {color: '#FFFFFF', fontSize: 12, lineHeight: 15},
  next: {position: 'absolute', left: 0, right: 0, bottom: spacing.md, alignItems: 'center'},
  nextBtn: {height: 44, paddingHorizontal: spacing.xl, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, ...elevation.floating},
  nextTxt: {color: colors.onPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl},
  centerNote: {maxWidth: 300},
  centerRow: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm},
  pill: {height: 42, paddingHorizontal: spacing.xl, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  pillOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  files: {flex: 1},
  groupLabel: {paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs},
  fileRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, height: 64},
  fileText: {flex: 1},
  tabs: {flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', height: TABS_H, paddingHorizontal: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  tab: {minWidth: 70, alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.lg},
  tabOn: {backgroundColor: colors.primaryDim},
}));

export default AttachPanel;
