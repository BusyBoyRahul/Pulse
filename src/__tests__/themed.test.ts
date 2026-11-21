import {StyleSheet} from 'react-native';
import {applyThemeLive, colors, themeInfo} from '@/theme/theme';
import React from 'react';
import {bumpTheme, subscribeTheme, themed, themedStyles, themeVersion} from '@/theme/themed';

describe('live theme switching', () => {
  const restore = {...themeInfo.prefs};
  afterAll(() => applyThemeLive(restore));

  it('a themed style is rebuilt with the new colours after the theme changes, and listeners are told', () => {
    const styles = themedStyles(() => StyleSheet.create({box: {backgroundColor: colors.bg}, other: {color: colors.text}}));
    const before = styles.box.backgroundColor;
    const seen = jest.fn();
    const off = subscribeTheme(seen);
    const v = themeVersion();

    (colors as {bg: string}).bg = '#123456';
    bumpTheme();

    expect(styles.box.backgroundColor).toBe('#123456');
    expect(before).not.toBe('#123456');
    expect(themeVersion()).toBe(v + 1);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(Object.keys(styles)).toEqual(['box', 'other']);
    off();
    bumpTheme();
    expect(seen).toHaveBeenCalledTimes(1); // stopped listening
  });

  it('themed() hands back the very same component each time, so a navigator never mounts a second copy', () => {
    const Screen = () => null;
    expect(themed(Screen)).toBe(themed(Screen));
    expect(React.isValidElement(React.createElement(themed(Screen)))).toBe(true);
  });

  it('applyThemeLive switches light / dark and every themed style follows', () => {
    const styles = themedStyles(() => StyleSheet.create({page: {backgroundColor: colors.bg}}));
    applyThemeLive({mode: 'dark', accent: 'violet', dark: 'midnight'});
    const dark = styles.page.backgroundColor;
    expect(themeInfo.isDark).toBe(true);
    applyThemeLive({mode: 'light', accent: 'violet', dark: 'midnight'});
    expect(themeInfo.isDark).toBe(false);
    expect(styles.page.backgroundColor).not.toBe(dark);
    expect(styles.page.backgroundColor).toBe(colors.bg);
  });
});
