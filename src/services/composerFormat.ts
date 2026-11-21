import {parseRichText} from './richText';

/**
 * Formatting while typing, shown live in the message box (no stars and underscores on screen).
 * The box keeps plain text plus one small number per character telling which styles it has.
 * When the message is sent, the styles are turned back into the usual marks (*bold* _italic_ …)
 * that every Pulse phone already understands.
 */
export type Mark = 'bold' | 'italic' | 'strike' | 'mono' | 'spoiler';

export const BIT: Record<Mark, number> = {bold: 1, italic: 2, strike: 4, mono: 8, spoiler: 16};

/** Outermost first. Monospace is innermost because nothing inside it is formatted. */
const ORDER: {mark: Mark; open: string}[] = [
  {mark: 'spoiler', open: '||'},
  {mark: 'bold', open: '*'},
  {mark: 'italic', open: '_'},
  {mark: 'strike', open: '~'},
  {mark: 'mono', open: '`'},
];

export type Run = {text: string; mask: number};

/** Styles for the text after the user typed, deleted or pasted: unchanged text keeps its look. */
export function shiftMasks(oldText: string, newText: string, masks: number[]): number[] {
  const a = oldText;
  const b = newText;
  let p = 0;
  const maxP = Math.min(a.length, b.length);
  while (p < maxP && a[p] === b[p]) {
    p++;
  }
  let q = 0;
  const maxQ = Math.min(a.length, b.length) - p;
  while (q < maxQ && a[a.length - 1 - q] === b[b.length - 1 - q]) {
    q++;
  }
  const removed = a.length - p - q;
  const inserted = b.length - p - q;
  // What the new characters look like: the replaced text's style, or the character before the cursor.
  const inherit = removed > 0 ? masks[p] ?? 0 : p > 0 ? masks[p - 1] ?? 0 : 0;
  const out = masks.slice(0, p);
  for (let i = 0; i < inserted; i++) {
    out.push(inherit);
  }
  return out.concat(masks.slice(a.length - q, a.length));
}

/** Make [start,end) bold/italic/…; if all of it already is, take that style off instead. */
export function toggleMark(text: string, masks: number[], start: number, end: number, mark: Mark): number[] {
  const a = Math.max(0, Math.min(start, end));
  const z = Math.min(text.length, Math.max(start, end));
  if (a >= z) {
    return masks;
  }
  const bit = BIT[mark];
  let all = true;
  for (let i = a; i < z; i++) {
    if (text[i] !== '\n' && text[i] !== ' ' && !((masks[i] ?? 0) & bit)) {
      all = false;
      break;
    }
  }
  const out = masks.slice();
  while (out.length < text.length) {
    out.push(0);
  }
  for (let i = a; i < z; i++) {
    out[i] = all ? (out[i] ?? 0) & ~bit : (out[i] ?? 0) | bit;
  }
  return out;
}

/** The text cut into stretches that share one look (for showing it in the box). */
export function toRuns(text: string, masks: number[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < text.length; i++) {
    const m = masks[i] ?? 0;
    const last = runs[runs.length - 1];
    if (last && last.mask === m) {
      last.text += text[i];
    } else {
      runs.push({text: text[i], mask: m});
    }
  }
  return runs;
}

/** Plain text + styles → the message as it travels (with marks). */
export function serialize(text: string, masks: number[]): string {
  let out = '';
  for (const run of toRuns(text, masks)) {
    if (!run.mask) {
      out += run.text;
      continue;
    }
    // Marks must hug the words, not the spaces around them.
    const lead = run.text.length - run.text.trimStart().length;
    const trail = run.text.length - run.text.trimEnd().length;
    const core = run.text.trim();
    if (!core) {
      out += run.text;
      continue;
    }
    let open = '';
    let close = '';
    for (const {mark, open: m} of ORDER) {
      if (run.mask & BIT[mark]) {
        open += m;
        close = m + close;
      }
    }
    out += run.text.slice(0, lead) + open + core + close + run.text.slice(run.text.length - trail);
  }
  return out;
}

/** A received/stored message with marks → plain text + styles (to edit it in the box). */
export function fromMarked(marked: string): {text: string; masks: number[]} {
  let text = '';
  const masks: number[] = [];
  for (const s of parseRichText(marked)) {
    const mask = (s.bold ? BIT.bold : 0) | (s.italic ? BIT.italic : 0) | (s.strike ? BIT.strike : 0) | (s.mono ? BIT.mono : 0) | (s.spoiler ? BIT.spoiler : 0);
    text += s.text;
    for (let i = 0; i < s.text.length; i++) {
      masks.push(mask);
    }
  }
  return {text, masks};
}
