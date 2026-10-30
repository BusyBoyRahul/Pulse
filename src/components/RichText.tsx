import React, {useMemo, useState} from 'react';
import {StyleProp, StyleSheet, Text, TextStyle} from 'react-native';
import {parseRichText} from '@/services/richText';
import {typography} from '@/theme/theme';

type Props = {
  text: string;
  /** Base text style (colour, size). */
  style?: StyleProp<TextStyle>;
  /** Colour of the text — also used for the blocks that hide a spoiler. */
  color: string;
};

/**
 * Message text with *bold*, _italic_, ~strikethrough~, `monospace` and ||spoiler||.
 * A spoiler is a solid block until the reader taps it.
 */
export function RichText({text, style, color}: Props) {
  const spans = useMemo(() => parseRichText(text), [text]);
  const [shown, setShown] = useState<Record<number, boolean>>({});

  return (
    <Text style={[typography.body, {color}, style]}>
      {spans.map((s, i) => {
        const hidden = s.spoiler && !shown[i];
        return (
          <Text
            key={i}
            onPress={s.spoiler ? () => setShown(prev => ({...prev, [i]: !prev[i]})) : undefined}
            style={[
              s.bold && styles.bold,
              s.italic && styles.italic,
              s.strike && styles.strike,
              s.mono && styles.mono,
              s.spoiler && (hidden ? {backgroundColor: color, color: 'transparent'} : styles.revealed),
            ]}>
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: {fontWeight: '800'},
  italic: {fontStyle: 'italic'},
  strike: {textDecorationLine: 'line-through'},
  mono: {fontFamily: 'monospace', backgroundColor: 'rgba(128,128,128,0.22)'},
  revealed: {backgroundColor: 'rgba(128,128,128,0.22)'},
});

export default RichText;
