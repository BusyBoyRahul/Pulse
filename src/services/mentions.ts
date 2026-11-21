/**
 * @mentions in group messages. A mention is just text — "@Rahul" — so it travels like any other message and works for
 * every version of the app. The person's FIRST name is used (letters, numbers, "_"), because that is quick to type.
 */
const WORD = '[\\p{L}\\p{N}_]';

/** The first word of a name, cleaned: "Maya Q." → "Maya". */
export const firstWord = (name: string): string => (name.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}_]/gu, '');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this text mention a person with this name? (Case doesn't matter; "@Maya" doesn't count inside "x@Mayaa".) */
export function mentions(text: string, name: string): boolean {
  const first = firstWord(name);
  if (!first || !text.includes('@')) {
    return false;
  }
  return new RegExp(`(^|[^\\p{L}\\p{N}_])@${esc(first)}(?!${WORD})`, 'iu').test(text);
}

/** The @word being typed right at the cursor, if any: where it starts and what has been typed after the "@". */
export function activeMention(text: string, cursor: number): {start: number; query: string} | null {
  const before = text.slice(0, cursor);
  const m = new RegExp(`(^|[^\\p{L}\\p{N}_])@(${WORD}{0,20})$`, 'u').exec(before);
  if (!m) {
    return null;
  }
  return {start: before.length - m[2].length - 1, query: m[2]};
}

/** Put the chosen name in place of the @word being typed, followed by a space. */
export function applyMention(text: string, start: number, cursor: number, first: string): {text: string; cursor: number} {
  const insert = `@${first} `;
  return {text: text.slice(0, start) + insert + text.slice(cursor), cursor: start + insert.length};
}

/** Cut a piece of text into plain parts and @mentions (for drawing the mentions differently). */
export function splitMentions(text: string): {text: string; mention: boolean}[] {
  if (!text.includes('@')) {
    return [{text, mention: false}];
  }
  const out: {text: string; mention: boolean}[] = [];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])(@${WORD}{1,20})`, 'gu');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) {
      out.push({text: text.slice(last, start), mention: false});
    }
    out.push({text: m[2], mention: true});
    last = start + m[2].length;
  }
  if (last < text.length) {
    out.push({text: text.slice(last), mention: false});
  }
  return out;
}
