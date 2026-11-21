import {themedStyles, useThemeVersion} from '@/theme/themed';
import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import Animated, {FadeIn, ZoomIn} from 'react-native-reanimated';
import {create} from 'zustand';
import {colors, elevation, radius, spacing} from '@/theme/theme';
import {Button} from './Button';
import {Txt} from './Text';

export type DialogButton = {text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void};

type Spec = {title: string; message?: string; buttons: DialogButton[]};
type State = {dialog: Spec | null; show: (d: Spec) => void; hide: () => void};

const useDialog = create<State>(set => ({
  dialog: null,
  show: dialog => set({dialog}),
  hide: () => set({dialog: null}),
}));

/**
 * Pulse's own confirm / notice pop-up, used instead of the grey Android system alert. Same call as
 * Alert.alert(title, message?, buttons?), so it is a drop-in. Needs <DialogHost/> once at the app root.
 */
export function alertDialog(title: string, message?: string, buttons?: DialogButton[]): void {
  useDialog.getState().show({title, message, buttons: buttons && buttons.length ? buttons : [{text: 'OK'}]});
}

/** Renders the pop-up above everything. Mount once, near the root. */
export function DialogHost() {
  useThemeVersion();
  const dialog = useDialog(s => s.dialog);
  const hide = useDialog(s => s.hide);

  const choose = (b: DialogButton) => {
    hide();
    // After the card has left, so a button that opens another pop-up or screen does not fight it.
    setTimeout(() => b.onPress?.(), 0);
  };
  const cancel = dialog?.buttons.find(b => b.style === 'cancel');
  const close = () => (cancel ? choose(cancel) : hide());

  const buttons = dialog?.buttons ?? [];
  const sideBySide = buttons.length <= 2;

  return (
    <Modal visible={!!dialog} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.wrap}>
        <Animated.View entering={FadeIn.duration(160)} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
        {dialog ? (
          <Animated.View entering={ZoomIn.duration(160)} style={styles.card}>
            <Txt variant="heading" style={styles.title}>
              {dialog.title}
            </Txt>
            {dialog.message ? (
              <Txt variant="body" tone="secondary" style={styles.message}>
                {dialog.message}
              </Txt>
            ) : null}
            <View style={sideBySide ? styles.rowBtns : styles.colBtns}>
              {buttons.map((b, i) => (
                <Button
                  key={`${b.text}-${i}`}
                  label={b.text ?? 'OK'}
                  variant={b.style === 'destructive' ? 'danger' : b.style === 'cancel' ? 'secondary' : 'primary'}
                  onPress={() => choose(b)}
                  style={sideBySide ? styles.half : undefined}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl},
  scrim: {backgroundColor: 'rgba(3,4,12,0.55)'},
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    padding: spacing.xl,
    ...elevation.floating,
  },
  title: {marginBottom: spacing.sm},
  message: {marginBottom: spacing.xl},
  rowBtns: {flexDirection: 'row', gap: spacing.md},
  colBtns: {gap: spacing.sm},
  half: {flex: 1, alignSelf: 'auto'},
}));

export default DialogHost;
