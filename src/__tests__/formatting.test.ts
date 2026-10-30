import {parseRichText, stripFormatting, applyMark} from '@/services/richText';
import {usePrefsStore} from '@/store/prefsStore';

const plain = (t: string) => parseRichText(t).map(s => s.text).join('');

describe('message formatting', () => {
  it('parses bold, italic, strikethrough, monospace and spoiler', () => {
    const spans = parseRichText('a *bold* b _it_ c ~gone~ d `code` e ||secret||');
    const by = (k: string) => spans.filter(s => (s as Record<string, unknown>)[k]).map(s => s.text);
    expect(by('bold')).toEqual(['bold']);
    expect(by('italic')).toEqual(['it']);
    expect(by('strike')).toEqual(['gone']);
    expect(by('mono')).toEqual(['code']);
    expect(by('spoiler')).toEqual(['secret']);
    expect(plain('a *bold* b')).toBe('a bold b');
  });

  it('nests styles', () => {
    const [s] = parseRichText('*_both_*');
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.text).toBe('both');
  });

  it('leaves ordinary text alone: snake_case, maths, lone marks, marks with spaces inside', () => {
    expect(plain('use snake_case_names here')).toBe('use snake_case_names here');
    expect(plain('2*3*4 = 24')).toBe('2*3*4 = 24');
    expect(plain('5 * 3')).toBe('5 * 3');
    expect(plain('* not bold *')).toBe('* not bold *');
    expect(plain('unfinished *bold')).toBe('unfinished *bold');
    expect(plain('')).toBe('');
  });

  it('keeps monospace literal', () => {
    const spans = parseRichText('`*not bold*`');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({text: '*not bold*', mono: true});
    expect(spans[0].bold).toBeUndefined();
  });

  it('previews hide spoilers and drop the marks', () => {
    expect(stripFormatting('meet at *5* ||room 12||')).toBe('meet at 5 ••••');
  });

  it('the formatting bar wraps a selection, hugs the words, toggles off, and inserts a pair at the cursor', () => {
    expect(applyMark('hello world', 6, 11, '*')).toEqual({text: 'hello *world*', start: 7, end: 12});
    expect(applyMark('hello  world ', 5, 13, '_').text).toBe('hello  _world_ ');
    expect(applyMark('hello *world*', 6, 13, '*').text).toBe('hello world');
    expect(applyMark('hello', 5, 5, '||')).toEqual({text: 'hello||||', start: 7, end: 7});
  });
});

describe('labels and bulk edits', () => {
  beforeEach(() => usePrefsStore.setState({prefs: {}, profiles: {}, labels: [], hydrated: true}));

  it('creates labels (no duplicates, trimmed), tags many chats at once, and removing a label untags them', () => {
    const p = usePrefsStore.getState();
    p.addLabel('  Work ');
    p.addLabel('work');
    p.addLabel('');
    expect(usePrefsStore.getState().labels).toEqual(['Work']);

    p.patchMany(['a', 'b', 'c'], {label: 'Work', favorite: true});
    expect(usePrefsStore.getState().prefs.b).toEqual({label: 'Work', favorite: true});

    usePrefsStore.getState().removeLabel('Work');
    expect(usePrefsStore.getState().labels).toEqual([]);
    expect(usePrefsStore.getState().prefs.b).toEqual({favorite: true});
  });

  it('a chat with nothing special set leaves no trace', () => {
    const p = usePrefsStore.getState();
    p.patch('x', {favorite: true, label: 'A', disappear: 1000});
    p.patch('x', {favorite: false, label: '', disappear: undefined});
    expect(usePrefsStore.getState().prefs.x).toBeUndefined();
  });
});
