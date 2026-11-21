import React, {useEffect, useLayoutEffect, useState} from 'react';
import {BackHandler, StyleSheet, TextInput, View} from 'react-native';
import {colors, spacing} from '@/theme/theme';
import {themedStyles} from '@/theme/themed';
import {Icon} from './Icon';
import {IconButton} from './IconButton';
import {Txt} from './Text';

/** The search box that sits in a page's header: a magnifier, the text, and (optionally) a short note such as "3 found". */
export function HeaderSearchField({value, onChange, placeholder, note, onSubmit}: {value: string; onChange: (v: string) => void; placeholder: string; note?: string; onSubmit?: () => void}) {
  return (
    <View style={styles.box}>
      <Icon name="search" size={16} color={colors.textMuted} />
      <TextInput
        autoFocus
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={styles.input}
      />
      {note ? (
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * The one way search works on every page: a search icon at the right of the header; tapping it turns the title into a
 * search field with a close button, and the Android Back button closes the search first. The page filters its list
 * with the returned `q`.
 */
export function useHeaderSearch(nav: {setOptions: (o: object) => void}, placeholder: string, label = 'Search', onSubmit?: () => void) {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const close = () => {
    setQ('');
    setSearching(false);
  };

  useLayoutEffect(() => {
    nav.setOptions(
      searching
        ? {
            headerTitle: () => <HeaderSearchField value={q} onChange={setQ} placeholder={placeholder} onSubmit={onSubmit} />,
            headerRight: () => <IconButton icon="x" label="Close search" onPress={close} />,
          }
        : {headerTitle: undefined, headerRight: () => <IconButton icon="search" label={label} onPress={() => setSearching(true)} />},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, searching, q, placeholder, label]);

  useEffect(() => {
    if (!searching) {
      return undefined;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [searching]);

  return {q, searching, close};
}

const styles = themedStyles(() =>
  StyleSheet.create({
    box: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, minWidth: 220, paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
    input: {flex: 1, color: colors.text, padding: 0, fontSize: 15},
  }),
);
