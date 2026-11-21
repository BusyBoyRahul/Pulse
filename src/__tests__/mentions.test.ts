import {firstWord, mentions, activeMention, applyMention, splitMentions} from '@/services/mentions';

describe('@mentions', () => {
  it('uses the first name, cleaned', () => {
    expect(firstWord('Maya Q.')).toBe('Maya');
    expect(firstWord('  Zoë-Anne Li ')).toBe('ZoëAnne');
    expect(firstWord('')).toBe('');
  });

  it('finds a mention of me, whatever the case, but not inside another word', () => {
    expect(mentions('hey @maya are you coming?', 'Maya Q.')).toBe(true);
    expect(mentions('@Maya', 'Maya')).toBe(true);
    expect(mentions('thanks, @MAYA!', 'Maya')).toBe(true);
    expect(mentions('mail me: sam@mayaa.com', 'Maya')).toBe(false);
    expect(mentions('@Mayala is here', 'Maya')).toBe(false); // a different name that starts the same
    expect(mentions('no mention here', 'Maya')).toBe(false);
    expect(mentions('@Maya', '')).toBe(false);
  });

  it('knows which @word is being typed at the cursor', () => {
    expect(activeMention('hello @ra', 9)).toEqual({start: 6, query: 'ra'});
    expect(activeMention('@', 1)).toEqual({start: 0, query: ''});
    expect(activeMention('hello @ra there', 9)).toEqual({start: 6, query: 'ra'}); // cursor in the middle
    expect(activeMention('hello there', 11)).toBeNull();
    expect(activeMention('a@b', 3)).toBeNull(); // an e-mail address is not a mention
    expect(activeMention('hello @ra ', 10)).toBeNull(); // already finished with a space
  });

  it('puts the chosen name in place of what was typed', () => {
    expect(applyMention('hello @ra', 6, 9, 'Rahul')).toEqual({text: 'hello @Rahul ', cursor: 13});
    expect(applyMention('@ and more', 0, 1, 'Sam')).toEqual({text: '@Sam  and more', cursor: 5});
  });

  it('cuts text into plain parts and mentions', () => {
    expect(splitMentions('hi @Rahul and @Sam!')).toEqual([
      {text: 'hi ', mention: false},
      {text: '@Rahul', mention: true},
      {text: ' and ', mention: false},
      {text: '@Sam', mention: true},
      {text: '!', mention: false},
    ]);
    expect(splitMentions('plain')).toEqual([{text: 'plain', mention: false}]);
    expect(splitMentions('a@b.com')).toEqual([{text: 'a@b.com', mention: false}]);
  });
});
