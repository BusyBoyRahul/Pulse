import {themedStyles} from '@/theme/themed';
import React, {useRef, useState} from 'react';
import {LayoutChangeEvent, StyleSheet, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {colors, elevation} from '@/theme/theme';
import {Txt} from './Text';

const THUMB = 28;
const TRACK = 8;

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Called on every change while dragging (use it to update a live preview). */
  onChange: (v: number) => void;
  /** Called once when the finger lifts (use it to save). */
  onCommit?: (v: number) => void;
  /** The text shown in the bubble above the thumb while dragging. */
  format?: (v: number) => string;
  label: string;
  disabled?: boolean;
};

/**
 * A slider: drag the round thumb, or tap anywhere on the bar to jump there. While dragging, a small bubble above the
 * thumb shows the value. Built on gesture-handler (no extra library); a vertical swipe still scrolls the page.
 */
export function Slider({value, min, max, step = 1, onChange, onCommit, format, label, disabled}: Props) {
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const last = useRef(value);
  const usable = Math.max(1, width - THUMB);
  const span = max - min || 1;
  const clamped = Math.min(max, Math.max(min, value));
  const frac = (clamped - min) / span;
  const x = frac * usable;

  const valueAt = (px: number) => {
    const t = Math.min(1, Math.max(0, (px - THUMB / 2) / usable));
    const raw = min + t * span;
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };
  const move = (px: number) => {
    const v = valueAt(px);
    if (v !== last.current) {
      last.current = v;
      onChange(v);
    }
  };
  const done = () => {
    setDragging(false);
    onCommit?.(last.current);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!disabled)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart(e => {
      setDragging(true);
      move(e.x);
    })
    .onUpdate(e => move(e.x))
    .onEnd(done)
    .onFinalize(() => setDragging(false));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .enabled(!disabled)
    .onEnd((e, ok) => {
      if (ok) {
        move(e.x);
        onCommit?.(last.current);
      }
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const nudge = (dir: 1 | -1) => {
    const v = Math.min(max, Math.max(min, clamped + dir * step * Math.max(1, Math.round(span / 20))));
    last.current = v;
    onChange(v);
    onCommit?.(v);
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.hit}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{min, max, now: clamped, text: format ? format(clamped) : undefined}}
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        onAccessibilityAction={e => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
        <View style={styles.track}>
          <View style={[styles.fill, {width: x + THUMB / 2}]} />
        </View>
        {width > 0 ? (
          <View style={[styles.thumbWrap, {left: x}]} pointerEvents="none">
            {dragging && format ? (
              <View style={styles.bubble}>
                <Txt variant="label" style={styles.bubbleTxt}>
                  {format(clamped)}
                </Txt>
              </View>
            ) : null}
            <View style={[styles.thumb, dragging && styles.thumbDown]} />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hit: {height: 44, justifyContent: 'center'},
  track: {height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.surfaceHover, overflow: 'hidden'},
  fill: {height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.primary},
  thumbWrap: {position: 'absolute', top: 0, bottom: 0, width: THUMB, alignItems: 'center', justifyContent: 'center'},
  thumb: {width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, ...elevation.floating},
  thumbDown: {transform: [{scale: 1.15}]},
  bubble: {position: 'absolute', top: -22, minWidth: 38, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  bubbleTxt: {color: colors.onPrimary},
}));

export default Slider;
