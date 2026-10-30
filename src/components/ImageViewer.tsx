import React from 'react';
import {Image, Modal, Pressable, StatusBar, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon} from './Icon';
import {Txt} from './Text';

type Props = {
  /** base64 JPEG (no data: prefix), or null to hide the viewer. */
  image: string | null;
  caption?: string;
  onClose: () => void;
  /** Shows a Save button (to the gallery). Leave out for view-once photos. */
  onSave?: () => void;
};

/** Full-screen photo on black. Back button or the X closes it. */
export function ImageViewer({image, caption, onClose, onSave}: Props) {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!image} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.root}>
        {image ? (
          <Image source={{uri: `data:image/jpeg;base64,${image}`}} style={{width, height}} resizeMode="contain" />
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={[styles.close, {top: insets.top + 12}]}>
          <Icon name="x" size={22} color="#fff" />
        </Pressable>
        {onSave ? (
          <Pressable
            onPress={onSave}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Save photo to gallery"
            style={[styles.close, styles.save, {top: insets.top + 12}]}>
            <Icon name="download" size={22} color="#fff" />
          </Pressable>
        ) : null}
        {caption ? (
          <View style={[styles.caption, {paddingBottom: insets.bottom + 16}]}>
            <Txt variant="caption" tone="secondary" center>
              {caption}
            </Txt>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  close: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  save: {left: undefined, right: 16},
  caption: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.5)'},
});

export default ImageViewer;
