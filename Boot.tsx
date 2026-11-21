/**
 * Startup gate. Loads the phone's saved data, resolves the theme (System / Light /
 * Dark + accent) and ONLY THEN loads the app. Screens build their StyleSheets the
 * moment they are imported, so the theme has to be known first.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Appearance, StyleSheet, View} from 'react-native';
import {isLaunchReady, onLaunchReady} from '@/theme/launch';
import {LaunchMark} from '@/components/LaunchMark';
import {initStorage} from '@/services/storage';
import {applyTheme, applyThemeLive, colors, themeInfo} from '@/theme/theme';
import {subscribeTheme} from '@/theme/themed';
import {notifier} from '@/services/notifier';

export default function Boot() {
  const [Root, setRoot] = useState<React.ComponentType | null>(null);
  useEffect(
    () =>
      subscribeTheme(() => {
        notifier.setWindowColor(colors.bg); // the phone's own bars; the app itself repaints in place
      }),
    [],
  );

  useEffect(() => {
    void initStorage()
      .catch(() => undefined)
      .then(() => {
        applyTheme();
        // The phone's navigation bar follows the PHONE's light/dark, not Pulse's: paint it in Pulse's colour from the start.
        notifier.setWindowColor(colors.bg);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const App = require('./App').default as React.ComponentType;
        setRoot(() => App);
      });
  }, []);

  // "Follow the phone": when the phone switches between light and dark, Pulse repaints to match, live.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({colorScheme}) => {
      if (themeInfo.prefs.mode !== 'system') {
        return;
      }
      if ((themeInfo.isDark ? 'dark' : 'light') !== (colorScheme === 'light' ? 'light' : 'dark')) {
        applyThemeLive();
      }
    });
    return () => sub.remove();
  }, []);

  // ONE start-up screen, from the very first frame: the app loads underneath it and, once its first screen is drawn, the
  // blue screen fades away. Nothing else ever draws a start-up picture.
  const fade = useRef(new Animated.Value(isLaunchReady() ? 0 : 1)).current;
  const [covered, setCovered] = useState(!isLaunchReady());
  useEffect(() => {
    const go = () => Animated.timing(fade, {toValue: 0, duration: 420, useNativeDriver: true}).start(() => setCovered(false));
    if (isLaunchReady()) {
      go();
      return undefined;
    }
    return onLaunchReady(go);
  }, [fade]);

  return (
    <View style={styles.fill}>
      {Root ? <Root /> : null}
      {covered ? (
        <Animated.View pointerEvents={Root ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, {opacity: fade}]}>
          <LaunchMark />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({fill: {flex: 1, backgroundColor: '#2F8BFF'}});
