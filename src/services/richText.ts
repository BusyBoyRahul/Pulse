/**
 * Message formatting, typed with plain characters (like most chat apps):
 *   *bold*   _italic_   ~strikethrough~   `monospace`   ||spoiler||
 * A marker only counts when it hugs the words (no space just inside) and isn't
 * glued to other letters, so things like snake_case_names and 5*3*2 stay as typed.
 */
export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
  spoiler?: boolean;
};

type Style = Omit<Span, 'text'>;

const MARKS: {m: string; key: keyof Style}[] = [
  {m: '||', key: 'spoiler'},
  {m: '`', key: 'mono'},
  {m: '*', key: 'bold'},
  {m: '_', key: 'italic'},
  {m: '~', key: 'strike'},
];

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9À-￿]/.test(c);
const isSpace = (c: string | undefined) => !c || /\s/.test(c);

function parse(text: string, inherited: Style): Span[] {
  const out: Span[] = [];
  let plain = '';
  const flush = () => {
    if (plain) {
      out.push({text: plain, ...inherited});
      plain = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const {m, key} of MARKS) {
      if (!text.startsWith(m, i)) {
        continue;
      }
      // Opening marker: not glued to a word on the left, content must start with a non-space.
      if (isWordChar(text[i - 1]) || isSpace(text[i + m.length]) || text[i + m.length] === m[0]) {
        continue;
      }
      // Find a closing marker that hugs the content and isn't glued to a word on the right.
      let j = text.indexOf(m, i + m.length + 1);
      while (j !== -1) {
        if (!isSpace(text[j - 1]) && !isWordChar(text[j + m.length])) {
          break;
        }
        j = text.indexOf(m, j + 1);
      }
      if (j === -1) {
        continue;
      }
      const inner = text.slice(i + m.length, j);
      if (!inner.trim()) {
        continue;
      }
      flush();
      if (key === 'mono') {
        out.push({text: inner, ...inherited, mono: true});
      } else {
        out.push(...parse(inner, {...inherited, [key]: true}));
      }
      i = j + m.length;
      matched = true;
      break;
    }
    if (!matched) {
      plain += text[i];
      i += 1;
    }
  }
  flush();
  return out;
}

export function parseRichText(text: string): Span[] {
  return parse(text, {});
}

/** Text without the formatting marks (spoilers become dots) — for previews and notifications. */
export function stripFormatting(text: string): string {
  return parseRichText(text)
    .map(s => (s.spoiler ? '••••' : s.text))
    .join('');
}

/** Wrap [start, end) of a string in a marker, or insert an empty pair at the cursor. */
export function applyMark(text: string, start: number, end: number, marker: string): {text: string; start: number; end: number} {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.max(start, end);
  if (a === b) {
    return {text: text.slice(0, a) + marker + marker + text.slice(a), start: a + marker.length, end: a + marker.length};
  }
  const chosen = text.slice(a, b);
  // Already wrapped? Take the marks off again.
  if (chosen.startsWith(marker) && chosen.endsWith(marker) && chosen.length > marker.length * 2) {
    const inner = chosen.slice(marker.length, chosen.length - marker.length);
    return {text: text.slice(0, a) + inner + text.slice(b), start: a, end: a + inner.length};
  }
  // Keep the marks hugging the words, not the spaces around them.
  const lead = chosen.length - chosen.trimStart().length;
  const trail = chosen.length - chosen.trimEnd().length;
  const core = chosen.trim();
  if (!core) {
    return {text, start, end};
  }
  const wrapped = chosen.slice(0, lead) + marker + core + marker + chosen.slice(chosen.length - trail);
  return {text: text.slice(0, a) + wrapped + text.slice(b), start: a + lead + marker.length, end: a + lead + marker.length + core.length};
}
