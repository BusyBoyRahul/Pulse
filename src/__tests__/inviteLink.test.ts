import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {makeLink, parseLink, findInvite, makeGroupLink, parseGroupLink, findGroupLink, LINK_BASE} from '@/services/inviteLink';

const key = () => naclUtil.encodeBase64(nacl.box.keyPair().publicKey);

describe('invite links', () => {
  it('round-trips a key and name, including tricky characters', () => {
    const k = key();
    const link = makeLink(k, 'Zoë & Co +1');
    expect(link.startsWith(`${LINK_BASE}/add#`)).toBe(true); // a web address, so chat apps make it tappable
    expect(parseLink(link)).toEqual({key: k, name: 'Zoë & Co +1'});
  });

  it('is short and clean: no percent-codes in the key', () => {
    for (let i = 0; i < 50; i++) {
      const link = makeLink(key(), 'Maya');
      const keyPart = link.slice(link.indexOf('k=') + 2, link.indexOf('&n='));
      expect(keyPart).not.toMatch(/[%+/=]/); // no escaped or padding characters in the key
      expect(link.length).toBeLessThan(110);
    }
  });

  it('carries nothing secret: only the public key and name', () => {
    const k = key();
    const link = makeLink(k, 'Maya');
    expect(link).toBe(`${LINK_BASE}/add#k=${k.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}&n=Maya`);
  });

  it('rejects anything that is not a good Pulse link', () => {
    expect(parseLink('https://example.com')).toBeNull();
    expect(parseLink('pulse://add?k=notakey&n=x')).toBeNull();
    expect(parseLink('pulse://add?n=NoKey')).toBeNull();
    expect(parseLink('')).toBeNull();
  });

  it('still opens links made by the older version (standard base64, percent-coded)', () => {
    const k = key();
    expect(parseLink(`pulse://add?k=${encodeURIComponent(k)}&n=Old`)).toEqual({key: k, name: 'Old'});
  });

  it('copes with a "+" in an old-style key turning into a space in transit', () => {
    let k = key();
    while (!k.includes('+')) {
      k = key();
    }
    expect(parseLink(`pulse://add?k=${k.replace(/\+/g, ' ')}&n=A`)?.key).toBe(k);
  });

  it('finds the invite inside a whole message someone pasted', () => {
    const k = key();
    const msg = `Hey! Connect with me on Pulse: ${makeLink(k, 'Sam')}\nSee you there 🙂`;
    expect(findInvite(msg)).toEqual({key: k, name: 'Sam'});
    expect(findInvite('no link here')).toBeNull();
    expect(findInvite('')).toBeNull();
  });
});

describe('group links', () => {
  it('round-trips the group, the admin to ask, and the name', () => {
    const k = key();
    const link = makeGroupLink('g_abc123xyz', k, 'Trail crew & friends');
    expect(link.startsWith(`${LINK_BASE}/join#`)).toBe(true);
    expect(parseGroupLink(link)).toEqual({id: 'g_abc123xyz', admin: k, name: 'Trail crew & friends'});
  });

  it('carries nothing secret: no group key anywhere in it', () => {
    const link = makeGroupLink('g_abc123xyz', key(), 'Crew');
    expect(link).not.toMatch(/key|secret/i);
    expect(Object.keys(Object.fromEntries(new URLSearchParams(link.split('#')[1])))).toEqual(['g', 'a', 'n']);
  });

  it('refuses anything that is not a proper group link', () => {
    const k = key();
    expect(parseGroupLink('pulse://add?k=' + k)).toBeNull();
    expect(parseGroupLink('pulse://group?g=bad id&a=' + k)).toBeNull();
    expect(parseGroupLink('pulse://group?g=g_abc123&a=notakey')).toBeNull();
    expect(parseGroupLink('pulse://group?a=' + k)).toBeNull();
    expect(parseGroupLink('')).toBeNull();
  });

  it('is found inside a whole shared message', () => {
    const k = key();
    const msg = `Join our group: ${makeGroupLink('g_abc123xyz', k, 'Crew')}\nsee you`;
    expect(findGroupLink(msg)?.id).toBe('g_abc123xyz');
    expect(findGroupLink('nothing here')).toBeNull();
  });
});

describe('web links and the older pulse:// links', () => {
  it('understands both forms, for a person and for a group, and finds them inside a message', () => {
    const k = key();
    const url = k.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseLink(`pulse://add?k=${url}&n=Old`)).toEqual({key: k, name: 'Old'});
    expect(parseLink(`${LINK_BASE}/add#k=${url}&n=New`)).toEqual({key: k, name: 'New'});
    expect(parseGroupLink(`pulse://group?g=g_abc123xyz&a=${url}&n=Old`)).toEqual({id: 'g_abc123xyz', admin: k, name: 'Old'});
    expect(parseGroupLink(`${LINK_BASE}/join#g=g_abc123xyz&a=${url}&n=New%20crew`)).toEqual({id: 'g_abc123xyz', admin: k, name: 'New crew'});
    expect(findInvite(`hi, add me: ${makeLink(k, 'Maya')} thanks`)).toEqual({key: k, name: 'Maya'});
    expect(findInvite(`old style pulse://add?k=${url}&n=Maya ok`)?.key).toBe(k);
    expect(findGroupLink(`join: ${makeGroupLink('g_abc123xyz', k, 'Crew')}`)?.id).toBe('g_abc123xyz');
  });

  it('ignores web links from other sites and the wrong page', () => {
    const k = key();
    const url = k.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseLink(`https://evil.example.com/Pulse/add#k=${url}&n=X`)).toBeNull();
    expect(parseLink(`${LINK_BASE}/join#g=g_abc123xyz&a=${url}`)).toBeNull(); // a group link is not a person link
    expect(parseGroupLink(`${LINK_BASE}/add#k=${url}`)).toBeNull();
    expect(findInvite('https://example.com/add#k=abc')).toBeNull();
  });
});
