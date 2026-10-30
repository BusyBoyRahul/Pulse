import React from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import {Screen, Txt, Card, Button, Icon, PulseLogo, Gradient} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import {sharePulseApp} from '@/services/appShare';

const WEBSITE = 'https://creoteck.com';

export default function AboutScreen() {
  const openSite = () => Linking.openURL(WEBSITE).catch(() => {});
  const share = () => {
    void sharePulseApp();
  };

  return (
    <Screen scroll padded={false} edges={['left', 'right']} bottomClear={false}>
      <Gradient colors={[colors.surfaceRaised, colors.bg]} angle="vertical" style={styles.hero}>
        <PulseLogo size={92} />
        <Txt variant="title" style={styles.name}>
          Pulse
        </Txt>
        <Txt variant="caption" tone="muted">
          Offline mesh safety
        </Txt>
        <View style={styles.badge}>
          <Icon name="lock" size={13} color={colors.success} />
          <Txt variant="label" tone="success">
            100% OFFLINE · NO SERVER
          </Txt>
        </View>
      </Gradient>

      <View style={styles.body}>
        <Pressable onPress={openSite}>
          <Card padded={false} style={styles.card}>
            <View style={styles.makerRow}>
              <View style={styles.linkIcon}>
                <Icon name="radar" size={22} color={colors.primaryBright} />
              </View>
              <View style={styles.makerText}>
                <Txt variant="caption" tone="muted">
                  Made by
                </Txt>
                <Txt variant="subtitle">Creoteck</Txt>
                <Txt variant="caption" tone="accent">
                  creoteck.com
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color={colors.textMuted} />
            </View>
          </Card>
        </Pressable>

        <Button label="Visit creoteck.com" onPress={openSite} style={styles.cta} />
        <Button
          label="Share Pulse"
          variant="secondary"
          onPress={share}
          icon={<Icon name="send" size={18} color={colors.text} />}
        />

        <Txt variant="caption" tone="muted" center style={styles.version}>
          Pulse v1.0 · © {'2026'} Creoteck
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xl},
  name: {marginTop: spacing.md},
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  body: {paddingHorizontal: spacing.xl, marginTop: spacing.lg},
  card: {overflow: 'hidden', marginBottom: spacing.xl},
  makerRow: {flexDirection: 'row', alignItems: 'center', padding: spacing.lg},
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarTxt: {color: colors.primaryBright},
  makerText: {flex: 1},
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: colors.border},
  linkRow: {flexDirection: 'row', alignItems: 'center', padding: spacing.lg},
  linkIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cta: {marginBottom: spacing.md},
  version: {marginTop: spacing.xl},
});
