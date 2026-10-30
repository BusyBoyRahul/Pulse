import React, {useEffect} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {colors, radius, spacing} from '@/theme/theme';
import {useSettingsStore} from '@/store/settingsStore';
import {Txt} from './Text';
import {Icon} from './Icon';

/**
 * Incoming SOS alert. When someone nearby presses SOS, this drops a prominent
 * banner at the top of the app: who needs help and a tap-through to their
 * location on a map. Auto-clears after a while; tap the ✕ to dismiss.
 */
export function ResponderBanner() {
  const insets = useSafeAreaInsets();
  const alert = useSettingsStore(s => s.responderAlert);
  const dismiss = useSettingsStore(s => s.dismissResponderAlert);

  useEffect(() => {
    if (!alert) {
      return;
    }
    const t = setTimeout(dismiss, 60000);
    return () => clearTimeout(t);
  }, [alert, dismiss]);

  if (!alert) {
    return null;
  }

  const who = alert.name?.trim() || 'Someone nearby';
  const hasLocation = alert.lat != null && alert.lng != null;
  const openMap = () => {
    if (hasLocation) {
      Linking.openURL(`https://maps.google.com/?q=${alert.lat},${alert.lng}`).catch(() => {});
    }
  };

  return (
    <View style={[styles.wrap, {paddingTop: insets.top + spacing.sm}]} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <Icon name="sos" size={22} color={colors.dangerBright} />
          </View>
          <View style={styles.text}>
            <Txt variant="bodyStrong">{who} needs help</Txt>
            <Txt variant="caption" tone="muted">
              {alert.note?.trim()
                ? alert.note
                : hasLocation
                ? 'An SOS just came in from near you.'
                : 'An SOS just came in from near you (no location shared).'}
            </Txt>
          </View>
          <Pressable onPress={dismiss} hitSlop={10} style={styles.close}>
            <Icon name="x" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        {hasLocation ? (
          <Pressable onPress={openMap} style={styles.mapBtn}>
            <Icon name="mapPin" size={16} color={colors.onPrimary} />
            <Txt variant="bodyStrong" style={styles.mapTxt}>
              View location
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default ResponderBanner;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: 1000,
  },
  banner: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.danger,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 6},
    elevation: 10,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.dangerDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {flex: 1},
  close: {padding: 2},
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  mapTxt: {color: colors.onPrimary},
});
