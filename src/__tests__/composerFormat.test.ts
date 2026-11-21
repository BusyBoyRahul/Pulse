import {BIT, fromMarked, serialize, shiftMasks, toggleMark, toRuns} from '@/services/composerFormat';
import {stripFormatting} from '@/services/richText';

describe('composer formatting', () => {
  it('turns styles back into marks hugging the words', () => {
    const text = 'hello big world';
    const masks = toggleMark(text, new Array(text.length).fill(0), 5, 10, 'bold'); // " big "
    expect(serialize(text, masks)).toBe('hello *big* world');
  });

  it('nests styles and keeps plain text untouched', () => {
    const text = 'a wow b';
    let m = new Array(text.length).fill(0);
    m = toggleMark(text, m, 2, 5, 'bold');
    m = toggleMark(text, m, 2, 5, 'italic');
    expect(serialize(text, m)).toBe('a *_wow_* b');
    expect(stripFormatting(serialize(text, m))).toBe(text);
  });

  it('toggles a style off again', () => {
    const text = 'make bold';
    const on = toggleMark(text, new Array(text.length).fill(0), 5, 9, 'bold');
    const off = toggleMark(text, on, 5, 9, 'bold');
    expect(off.every(x => x === 0)).toBe(true);
  });

  it('keeps styles in place when typing before, inside and after', () => {
    const old = 'ab cd';
    const masks = toggleMark(old, new Array(5).fill(0), 3, 5, 'bold'); // "cd" bold
    expect(shiftMasks(old, 'Xab cd', masks)).toEqual([0, 0, 0, 0, BIT.bold, BIT.bold]);
    expect(shiftMasks(old, 'ab cXd', masks)).toEqual([0, 0, 0, BIT.bold, BIT.bold, BIT.bold]);
    expect(shiftMasks(old, 'ab cdE', masks)).toEqual([0, 0, 0, BIT.bold, BIT.bold, BIT.bold]);
    expect(shiftMasks(old, 'ab c', masks)).toEqual([0, 0, 0, BIT.bold]);
    expect(shiftMasks(old, '', masks)).toEqual([]);
  });

  it('loads a marked message for editing and sends the same thing back', () => {
    const marked = 'see *this* and ||that||';
    const {text, masks} = fromMarked(marked);
    expect(text).toBe('see this and that');
    expect(toRuns(text, masks).map(r => r.mask)).toEqual([0, BIT.bold, 0, BIT.spoiler]);
    expect(serialize(text, masks)).toBe(marked);
  });
});
