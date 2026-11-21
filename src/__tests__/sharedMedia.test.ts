import {sharedMedia} from '@/services/sharedMedia';
import type {ChatMessage} from '@/types';

let n = 0;
const msg = (p: Partial<ChatMessage>): ChatMessage => ({
  id: `m${++n}`,
  conversationId: 'c',
  convKind: 'direct',
  type: 'text',
  from: 'x',
  fromName: 'X',
  timestamp: n * 1000,
  mine: false,
  ...p,
});

describe('what the Media screen shows', () => {
  it('sorts a chat into photos and videos, files, and links — newest first', () => {
    const list = [
      msg({type: 'image', image: 'AAA'}),
      msg({type: 'file', file: {name: 'a.pdf', size: 10, mime: 'application/pdf', kind: 'file', done: true}}),
      msg({type: 'text', text: 'look https://example.com/page, nice'}),
      msg({type: 'file', file: {name: 'v.mp4', size: 10, mime: 'video/mp4', kind: 'video', thumb: 'T', done: true}}),
      msg({type: 'file', file: {name: 'v.m4a', size: 10, mime: 'audio/mp4', kind: 'voice', done: true}}),
      msg({type: 'image', image: 'BBB'}),
      msg({type: 'text', text: 'and (https://b.test/x).'}), // trailing punctuation is not part of the link
    ];
    const m = sharedMedia(list);
    expect(m.visual.map(v => v.kind)).toEqual(['photo', 'video', 'photo']); // newest first
    expect(m.files.map(f => f.kind)).toEqual(['voice', 'file']);
    expect(m.links.map(l => l.url)).toEqual(['https://b.test/x', 'https://example.com/page']);
  });

  it('leaves out view-once photos and photos that are no longer on the phone', () => {
    const m = sharedMedia([
      msg({type: 'image', image: 'AAA', viewOnce: true}),
      msg({type: 'image', image: 'BBB', mediaGone: true}),
      msg({type: 'image'}),
      msg({type: 'image', image: 'CCC'}),
    ]);
    expect(m.visual).toHaveLength(1);
  });

  it('is empty for a chat with nothing shared', () => {
    const m = sharedMedia([msg({text: 'hello'})]);
    expect(m.visual.length + m.files.length + m.links.length).toBe(0);
  });
});
