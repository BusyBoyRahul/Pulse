import {themedStyles} from '@/theme/themed';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, Keyboard, Modal, PanResponder, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View, useWindowDimensions} from 'react-native';
import Svg, {Circle, Line, Path, Rect, Text as SvgText, TSpan} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing, themeInfo} from '@/theme/theme';
import {PhotoEdits, mediaFiles} from '@/services/mediaFiles';
import {Icon, IconName} from './Icon';
import {Txt} from './Text';

type Tool = 'draw' | 'text' | 'crop';
type Stroke = {c: string; w: number; p: number[]};
type TextObj = {id: string; t: string; c: string; x: number; y: number; s: number};
type Rect4 = {x: number; y: number; w: number; h: number};

const PALETTE = ['#FFFFFF', '#111111', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#0A84FF', '#AF52DE'];
const BRUSHES = [0.006, 0.012, 0.024];
const TEXT_SIZES = [
  {k: 'S', v: 0.05},
  {k: 'M', v: 0.08},
  {k: 'L', v: 0.12},
];
const RATIOS = [
  {k: 'Free', r: 0},
  {k: '1:1', r: 1},
  {k: '4:5', r: 0.8},
  {k: '3:4', r: 0.75},
  {k: '16:9', r: 16 / 9},
];
const FULL: Rect4 = {x: 0, y: 0, w: 1, h: 1};
const MIN = 0.12;
const HANDLE = 44;
const BOTTOM = 214;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The photo editor, a full page: draw with a finger (eight colours, three brush sizes, undo), add text (tap the picture,
 * drag it where you want, pick colour and size), and crop (drag the corners or the frame, or snap to a shape).
 * Everything is kept as fractions of the picture and baked in natively when you tap the tick, so what you see is what is
 * sent, at full quality.
 */
export function PhotoEditor({visible, base64, onCancel, onDone}: {visible: boolean; base64: string | null; onCancel: () => void; onDone: (b64: string) => void}) {
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const [nat, setNat] = useState<{w: number; h: number} | null>(null);
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState(PALETTE[0]);
  const [brush, setBrush] = useState(1);
  const [textSize, setTextSize] = useState(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextObj[]>([]);
  const [crop, setCrop] = useState<Rect4>(FULL);
  const [sel, setSel] = useState<string | null>(null);
  const [editor, setEditor] = useState<{id: string | null; value: string; x: number; y: number} | null>(null);
  const [kb, setKb] = useState(0);
  const [busy, setBusy] = useState(false);

  // Handlers read the latest values through refs, because the gesture objects are created once.
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushRef = useRef(brush);
  const strokesRef = useRef(strokes);
  const textsRef = useRef(texts);
  const cropRef = useRef(crop);
  const dispRef = useRef({w: 1, h: 1});
  toolRef.current = tool;
  colorRef.current = color;
  brushRef.current = brush;
  strokesRef.current = strokes;
  textsRef.current = texts;
  cropRef.current = crop;

  const putStrokes = useCallback((v: Stroke[]) => {
    strokesRef.current = v;
    setStrokes(v);
  }, []);
  const putTexts = useCallback((v: TextObj[]) => {
    textsRef.current = v;
    setTexts(v);
  }, []);
  const putCrop = useCallback((v: Rect4) => {
    cropRef.current = v;
    setCrop(v);
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible || !base64) {
      return;
    }
    setNat(null);
    setTool('draw');
    putStrokes([]);
    putTexts([]);
    putCrop(FULL);
    setSel(null);
    setEditor(null);
    setBusy(false);
    Image.getSize('data:image/jpeg;base64,' + base64, (w, h) => setNat({w, h}), () => setNat({w: 1, h: 1}));
  }, [visible, base64, putStrokes, putTexts, putCrop]);

  // The picture, fitted into the space between the top bar and the tools.
  const areaW = width - spacing.lg * 2;
  const areaH = Math.max(120, height - insets.top - insets.bottom - 64 - BOTTOM);
  const scale = nat ? Math.min(areaW / nat.w, areaH / nat.h) : 1;
  const dw = nat ? nat.w * scale : areaW;
  const dh = nat ? nat.h * scale : areaH;
  dispRef.current = {w: dw, h: dh};

  // ---- drawing ----
  const drawPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => toolRef.current === 'draw',
        onMoveShouldSetPanResponder: () => toolRef.current === 'draw',
        onPanResponderGrant: e => {
          const d = dispRef.current;
          const x = r3(clamp(e.nativeEvent.locationX / d.w, 0, 1));
          const y = r3(clamp(e.nativeEvent.locationY / d.h, 0, 1));
          putStrokes([...strokesRef.current, {c: colorRef.current, w: BRUSHES[brushRef.current], p: [x, y]}]);
        },
        onPanResponderMove: e => {
          const d = dispRef.current;
          const x = r3(clamp(e.nativeEvent.locationX / d.w, 0, 1));
          const y = r3(clamp(e.nativeEvent.locationY / d.h, 0, 1));
          const all = strokesRef.current;
          const last = all[all.length - 1];
          if (!last) {
            return;
          }
          const n = last.p.length;
          if (Math.abs(last.p[n - 2] - x) < 0.002 && Math.abs(last.p[n - 1] - y) < 0.002) {
            return;
          }
          putStrokes([...all.slice(0, -1), {...last, p: [...last.p, x, y]}]);
        },
      }),
    [putStrokes],
  );

  // ---- text ----
  const hitText = (px: number, py: number): TextObj | null => {
    const d = dispRef.current;
    const list = textsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const size = t.s * d.w;
      const lines = t.t.split('\n');
      const bw = Math.max(...lines.map(l => l.length), 1) * size * 0.6 + 24;
      const bh = lines.length * size * 1.2 + 16;
      if (Math.abs(px - t.x * d.w) <= bw / 2 && Math.abs(py - t.y * d.h) <= bh / 2) {
        return t;
      }
    }
    return null;
  };

  const textDrag = useRef<{id: string | null; sx: number; sy: number; ox: number; oy: number; moved: boolean}>({id: null, sx: 0, sy: 0, ox: 0, oy: 0, moved: false});
  const textPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => toolRef.current === 'text',
        onMoveShouldSetPanResponder: () => toolRef.current === 'text',
        onPanResponderGrant: e => {
          const hit = hitText(e.nativeEvent.locationX, e.nativeEvent.locationY);
          textDrag.current = {id: hit?.id ?? null, sx: e.nativeEvent.locationX, sy: e.nativeEvent.locationY, ox: hit?.x ?? 0, oy: hit?.y ?? 0, moved: false};
          if (hit) {
            setSel(hit.id);
          }
        },
        onPanResponderMove: e => {
          const g = textDrag.current;
          const d = dispRef.current;
          const dx = e.nativeEvent.locationX - g.sx;
          const dy = e.nativeEvent.locationY - g.sy;
          if (!g.moved && Math.abs(dx) + Math.abs(dy) < 8) {
            return;
          }
          g.moved = true;
          if (g.id) {
            putTexts(textsRef.current.map(t => (t.id === g.id ? {...t, x: r3(clamp(g.ox + dx / d.w, 0.02, 0.98)), y: r3(clamp(g.oy + dy / d.h, 0.02, 0.98))} : t)));
          }
        },
        onPanResponderRelease: e => {
          const g = textDrag.current;
          if (g.moved) {
            return;
          }
          const d = dispRef.current;
          if (g.id) {
            const t = textsRef.current.find(x => x.id === g.id);
            if (t) {
              setEditor({id: t.id, value: t.t, x: t.x, y: t.y});
            }
          } else {
            setEditor({id: null, value: '', x: clamp(e.nativeEvent.locationX / d.w, 0.1, 0.9), y: clamp(e.nativeEvent.locationY / d.h, 0.08, 0.92)});
            setSel(null);
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [putTexts],
  );

  const commitText = () => {
    if (!editor) {
      return;
    }
    const value = editor.value.trim();
    if (editor.id) {
      putTexts(value ? textsRef.current.map(t => (t.id === editor.id ? {...t, t: value} : t)) : textsRef.current.filter(t => t.id !== editor.id));
    } else if (value) {
      const id = 't' + Date.now();
      putTexts([...textsRef.current, {id, t: value, c: color, x: r3(editor.x), y: r3(editor.y), s: TEXT_SIZES[textSize].v}]);
      setSel(id);
    }
    setEditor(null);
    Keyboard.dismiss();
  };

  const pickColor = (c: string) => {
    setColor(c);
    if (tool === 'text' && sel) {
      putTexts(textsRef.current.map(t => (t.id === sel ? {...t, c} : t)));
    }
  };
  const pickTextSize = (i: number) => {
    setTextSize(i);
    if (sel) {
      putTexts(textsRef.current.map(t => (t.id === sel ? {...t, s: TEXT_SIZES[i].v} : t)));
    }
  };

  // ---- crop ----
  const startRect = useRef<Rect4>(FULL);
  const cropHandle = (corner: 'tl' | 'tr' | 'bl' | 'br' | 'move') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => toolRef.current === 'crop',
      onMoveShouldSetPanResponder: () => toolRef.current === 'crop',
      onPanResponderGrant: () => {
        startRect.current = cropRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const d = dispRef.current;
        const s = startRect.current;
        const dx = g.dx / d.w;
        const dy = g.dy / d.h;
        let {x, y, w, h} = s;
        if (corner === 'move') {
          x = clamp(s.x + dx, 0, 1 - s.w);
          y = clamp(s.y + dy, 0, 1 - s.h);
        } else {
          if (corner === 'tl' || corner === 'bl') {
            x = clamp(s.x + dx, 0, s.x + s.w - MIN);
            w = s.x + s.w - x;
          } else {
            w = clamp(s.w + dx, MIN, 1 - s.x);
          }
          if (corner === 'tl' || corner === 'tr') {
            y = clamp(s.y + dy, 0, s.y + s.h - MIN);
            h = s.y + s.h - y;
          } else {
            h = clamp(s.h + dy, MIN, 1 - s.y);
          }
        }
        putCrop({x, y, w, h});
      },
    });
  const handles = useMemo(
    () => ({tl: cropHandle('tl'), tr: cropHandle('tr'), bl: cropHandle('bl'), br: cropHandle('br'), move: cropHandle('move')}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const snapRatio = (r: number) => {
    if (!nat) {
      return;
    }
    if (r === 0) {
      return putCrop(FULL);
    }
    // largest rectangle of ratio r (width / height, in pixels) that fits the picture, centred
    let w = 1;
    let h = (nat.w / nat.h) / r;
    if (h > 1) {
      h = 1;
      w = (r * nat.h) / nat.w;
    }
    putCrop({x: (1 - w) / 2, y: (1 - h) / 2, w, h});
  };

  const changed = strokes.length > 0 || texts.length > 0 || crop.x > 0.001 || crop.y > 0.001 || crop.w < 0.999 || crop.h < 0.999;

  const undo = () => {
    if (tool === 'crop') {
      return putCrop(FULL);
    }
    if (tool === 'text' && texts.length) {
      putTexts(texts.slice(0, -1));
      return setSel(null);
    }
    if (strokes.length) {
      return putStrokes(strokes.slice(0, -1));
    }
    if (texts.length) {
      putTexts(texts.slice(0, -1));
    }
  };

  const done = async () => {
    if (!base64) {
      return;
    }
    if (!changed) {
      return onCancel();
    }
    setBusy(true);
    const spec: PhotoEdits = {
      crop: crop.w < 0.999 || crop.h < 0.999 || crop.x > 0.001 || crop.y > 0.001 ? {x: r3(crop.x), y: r3(crop.y), w: r3(crop.w), h: r3(crop.h)} : undefined,
      strokes: strokes.length ? strokes.map(s => ({c: s.c, w: s.w, p: s.p})) : undefined,
      texts: texts.length ? texts.map(t => ({t: t.t, c: t.c, x: t.x, y: t.y, s: t.s})) : undefined,
    };
    const out = await mediaFiles.composePhoto(base64, spec);
    setBusy(false);
    if (out) {
      onDone(out);
    } else {
      onCancel();
    }
  };

  const tools: {id: Tool; icon: IconName; label: string}[] = [
    {id: 'crop', icon: 'crop', label: 'Crop'},
    {id: 'text', icon: 'text', label: 'Text'},
    {id: 'draw', icon: 'brush', label: 'Draw'},
  ];

  const bar = (icon: IconName, label: string, onPress: () => void, on?: boolean, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: !!on, disabled: !!disabled}}
      style={({pressed}) => [styles.round, on && styles.roundOn, disabled && {opacity: 0.4}, pressed && {opacity: 0.75}]}>
      <Icon name={icon} size={20} color={on ? '#FFFFFF' : colors.text} strokeWidth={2.2} />
    </Pressable>
  );

  const textBlock = (t: TextObj) => {
    const size = t.s * dw;
    const lines = t.t.split('\n');
    const lh = size * 1.2;
    const top = t.y * dh - (lines.length * lh) / 2;
    return (
      <SvgText key={t.id} x={t.x * dw} fill={t.c} fontSize={size} fontWeight="bold" textAnchor="middle">
        {lines.map((l, i) => (
          <TSpan key={i} x={t.x * dw} y={top + lh * (i + 0.5) + size * 0.345}>
            {l}
          </TSpan>
        ))}
      </SvgText>
    );
  };

  const cx = crop.x * dw;
  const cy = crop.y * dh;
  const cw = crop.w * dw;
  const ch = crop.h * dh;
  const selText = texts.find(t => t.id === sel);

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <StatusBar barStyle={themeInfo.isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.root, {paddingTop: insets.top + spacing.sm}]}>
        <View style={styles.top}>
          {bar('x', 'Cancel editing', onCancel)}
          <View style={styles.topRight}>
            {bar('undo', tool === 'crop' ? 'Reset crop' : 'Undo', undo, false, tool === 'crop' ? !changed : strokes.length + texts.length === 0)}
            {bar('check', 'Apply', () => void done(), true, busy)}
          </View>
        </View>

        <View style={styles.stageWrap}>
          <View style={{width: dw, height: dh}}>
            {base64 ? <Image source={{uri: 'data:image/jpeg;base64,' + base64}} style={{width: dw, height: dh}} resizeMode="contain" /> : null}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-only" {...(tool === 'draw' ? drawPan.panHandlers : tool === 'text' ? textPan.panHandlers : {})}>
              <Svg width={dw} height={dh} pointerEvents="none">
                {strokes.map((s, i) => (
                  <Path key={i} d={'M' + s.p[0] * dw + ' ' + s.p[1] * dh + (s.p.length === 2 ? ' L' + (s.p[0] * dw + 0.1) + ' ' + s.p[1] * dh : s.p.slice(2).reduce((a, v, k) => a + (k % 2 === 0 ? ' L' + v * dw : ' ' + v * dh), ''))} stroke={s.c} strokeWidth={s.w * dw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                ))}
                {texts.map(textBlock)}
                {tool === 'text' && selText ? (
                  <Rect
                    x={selText.x * dw - (Math.max(...selText.t.split('\n').map(l => l.length), 1) * selText.s * dw * 0.6 + 24) / 2}
                    y={selText.y * dh - (selText.t.split('\n').length * selText.s * dw * 1.2 + 16) / 2}
                    width={Math.max(...selText.t.split('\n').map(l => l.length), 1) * selText.s * dw * 0.6 + 24}
                    height={selText.t.split('\n').length * selText.s * dw * 1.2 + 16}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    fill="none"
                    rx={8}
                  />
                ) : null}
                {tool === 'crop' ? (
                  <>
                    <Rect x={0} y={0} width={dw} height={cy} fill="rgba(0,0,0,0.55)" />
                    <Rect x={0} y={cy + ch} width={dw} height={Math.max(0, dh - cy - ch)} fill="rgba(0,0,0,0.55)" />
                    <Rect x={0} y={cy} width={cx} height={ch} fill="rgba(0,0,0,0.55)" />
                    <Rect x={cx + cw} y={cy} width={Math.max(0, dw - cx - cw)} height={ch} fill="rgba(0,0,0,0.55)" />
                    <Rect x={cx} y={cy} width={cw} height={ch} stroke="#FFFFFF" strokeWidth={1.5} fill="none" />
                    <Line x1={cx + cw / 3} y1={cy} x2={cx + cw / 3} y2={cy + ch} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
                    <Line x1={cx + (cw * 2) / 3} y1={cy} x2={cx + (cw * 2) / 3} y2={cy + ch} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
                    <Line x1={cx} y1={cy + ch / 3} x2={cx + cw} y2={cy + ch / 3} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
                    <Line x1={cx} y1={cy + (ch * 2) / 3} x2={cx + cw} y2={cy + (ch * 2) / 3} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
                    {([[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]] as [number, number][]).map(([px, py], i) => (
                      <Circle key={i} cx={px} cy={py} r={7} fill="#FFFFFF" />
                    ))}
                  </>
                ) : null}
              </Svg>
            </View>
            {tool === 'crop' ? (
              <>
                <View style={{position: 'absolute', left: cx + 18, top: cy + 18, width: Math.max(0, cw - 36), height: Math.max(0, ch - 36)}} {...handles.move.panHandlers} />
                <View style={[styles.handle, {left: cx - HANDLE / 2, top: cy - HANDLE / 2}]} {...handles.tl.panHandlers} />
                <View style={[styles.handle, {left: cx + cw - HANDLE / 2, top: cy - HANDLE / 2}]} {...handles.tr.panHandlers} />
                <View style={[styles.handle, {left: cx - HANDLE / 2, top: cy + ch - HANDLE / 2}]} {...handles.bl.panHandlers} />
                <View style={[styles.handle, {left: cx + cw - HANDLE / 2, top: cy + ch - HANDLE / 2}]} {...handles.br.panHandlers} />
              </>
            ) : null}
          </View>
        </View>

        <View style={[styles.bottom, {paddingBottom: insets.bottom + spacing.md}]}>
          <View style={styles.context}>
            {tool === 'crop' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                {RATIOS.map(r => (
                  <Pressable key={r.k} onPress={() => snapRatio(r.r)} accessibilityRole="button" style={({pressed}) => [styles.pill, pressed && {opacity: 0.8}]}>
                    <Txt variant="bodyStrong">{r.k}</Txt>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <>
                <View style={styles.swatches}>
                  {PALETTE.map(c => (
                    <Pressable key={c} onPress={() => pickColor(c)} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{selected: (tool === 'text' && selText ? selText.c : color) === c}} hitSlop={4} style={[styles.swatch, {backgroundColor: c}, (tool === 'text' && selText ? selText.c : color) === c && styles.swatchOn]} />
                  ))}
                </View>
                {tool === 'draw' ? (
                  <View style={styles.pillRow}>
                    {BRUSHES.map((b, i) => (
                      <Pressable key={b} onPress={() => setBrush(i)} accessibilityRole="button" accessibilityLabel={`Brush ${i + 1}`} accessibilityState={{selected: brush === i}} style={[styles.brush, brush === i && styles.brushOn]}>
                        <View style={{width: 6 + i * 6, height: 6 + i * 6, borderRadius: 10, backgroundColor: brush === i ? '#FFFFFF' : colors.text}} />
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={styles.pillRow}>
                    {TEXT_SIZES.map((s, i) => (
                      <Pressable key={s.k} onPress={() => pickTextSize(i)} accessibilityRole="button" accessibilityLabel={`Text size ${s.k}`} accessibilityState={{selected: (selText ? selText.s === s.v : textSize === i)}} style={[styles.brush, (selText ? selText.s === s.v : textSize === i) && styles.brushOn]}>
                        <Txt variant="bodyStrong" style={{color: (selText ? selText.s === s.v : textSize === i) ? '#FFFFFF' : colors.text, fontSize: 12 + i * 3}}>
                          A
                        </Txt>
                      </Pressable>
                    ))}
                    <Txt variant="caption" tone="secondary" numberOfLines={1} style={{flex: 1, marginLeft: spacing.sm}}>
                      Tap to add text · drag to move
                    </Txt>
                  </View>
                )}
              </>
            )}
          </View>
          <View style={styles.tools}>
            {tools.map(t => bar(t.icon, t.label, () => setTool(t.id), tool === t.id))}
          </View>
        </View>

        {editor ? (
          <View style={[styles.textBar, {bottom: kb > 0 ? kb : 0, paddingBottom: kb > 0 ? spacing.md : insets.bottom + spacing.md}]}>
            <View style={styles.textBox}>
              <TextInput
                autoFocus
                multiline
                value={editor.value}
                onChangeText={v => setEditor(e => (e ? {...e, value: v} : e))}
                placeholder="Type something"
                placeholderTextColor={colors.textMuted}
                selectionColor={colors.primary}
                maxLength={120}
                style={styles.textInput}
              />
            </View>
            {bar('check', 'Add text', commitText, true)}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, height: 64},
  topRight: {flexDirection: 'row', gap: spacing.sm},
  round: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  roundOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  stageWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  handle: {position: 'absolute', width: HANDLE, height: HANDLE},
  bottom: {height: BOTTOM, paddingHorizontal: spacing.lg, justifyContent: 'space-between'},
  context: {minHeight: 96, justifyContent: 'center', gap: spacing.md},
  swatches: {flexDirection: 'row', justifyContent: 'space-between'},
  swatch: {width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.border},
  swatchOn: {borderColor: colors.primary, borderWidth: 3},
  pillRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  pill: {height: 40, paddingHorizontal: spacing.lg, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  brush: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  brushOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  tools: {flexDirection: 'row', justifyContent: 'center', gap: spacing.xl},
  textBar: {position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  textBox: {flex: 1, minHeight: 48, maxHeight: 120, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: 24, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border},
  textInput: {color: colors.text, fontSize: 16, paddingVertical: 10},
}));

export default PhotoEditor;
