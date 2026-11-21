import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {KIND_DIRECTORY, NostrEvent, RelayPool, signEvent} from './nostr';
import type {Identity} from './signaling';

/**
 * A public, opt-in phone book kept on public relays — no server of yours.
 *
 *  - @username  -> Pulse key
 *  - hash of a phone number -> Pulse key   (only if the person chose "find me by number")
 *
 * Records are signed, so only their owner can change or remove them. A record is
 * only a CLAIM: for numbers, the searcher confirms it with a text-message check
 * (see numberCheck.ts) before trusting it. Short numbers can be guessed from a
 * hash, which is why this is off until the person switches it on.
 */
/** `at` = when this record was last written; `since` = when this person FIRST claimed the name (it never moves forward). */
export type Candidate = {key: string; name: string; at: number; since: number; author: string};

/**
 * A @username is owned by whoever claimed it FIRST. Anyone can publish any name (there is no server to say no), so every
 * phone applies the same rule to the claims it sees: the oldest one wins, and if two are the same age the smaller key wins.
 * All phones that see the same claims therefore agree on the owner, with nothing to coordinate.
 */
const oldestFirst = (a: Candidate, b: Candidate): number => a.since - b.since || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const USER_RE = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = (s: string): string => s.trim().replace(/^@/, '').toLowerCase();
export const isUsername = (s: string): boolean => USER_RE.test(cleanUsername(s));

export const phoneDTag = (e164: string): string => `pulse-p:${bytesToHex(sha256(naclUtil.decodeUTF8(`pulse-phone-v1|${e164}`))).slice(0, 32)}`;
export const userDTag = (name: string): string => `pulse-u:${cleanUsername(name)}`;

/** My long-term directory signing key (derived from my identity, so it survives a backup restore). */
export function directoryKey(me: Identity): Uint8Array {
  return sha256(naclUtil.decodeUTF8(`pulse-dir|${me.secretKey}`));
}

const isKey = (k: unknown): k is string => {
  if (typeof k !== 'string') {
    return false;
  }
  try {
    return naclUtil.decodeBase64(k).length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
};

export class Directory {
  constructor(private pool: RelayPool, private me: () => Identity) {}

  private publish(dTag: string, displayName: string, on: boolean, since?: number): boolean {
    const me = this.me();
    const now = Date.now();
    const content = on ? JSON.stringify({k: me.publicKey, n: displayName.slice(0, 40), at: now, s: since ?? now}) : '{}';
    return this.pool.publish(signEvent(directoryKey(me), {kind: KIND_DIRECTORY, tags: [['d', dTag]], content}));
  }

  /** `since` = when I first claimed this name. Pass the same value every time the record is refreshed. */
  publishUsername(name: string, displayName: string, since?: number): boolean {
    return isUsername(name) && this.publish(userDTag(name), displayName, true, since);
  }
  removeUsername(name: string): boolean {
    return isUsername(name) && this.publish(userDTag(name), '', false);
  }
  publishPhone(e164: string, displayName: string): boolean {
    return this.publish(phoneDTag(e164), displayName, true);
  }
  removePhone(e164: string): boolean {
    return this.publish(phoneDTag(e164), '', false);
  }

  private parse(ev: NostrEvent): Candidate | null {
    try {
      const c = JSON.parse(ev.content) as {k?: unknown; n?: unknown; at?: unknown; s?: unknown};
      if (!isKey(c.k)) {
        return null; // removed, or junk
      }
      const at = typeof c.at === 'number' ? c.at : ev.created_at * 1000;
      // Records from before "since" existed count as claimed when they were written.
      return {key: c.k, name: typeof c.n === 'string' ? c.n.slice(0, 40) : '', at, since: typeof c.s === 'number' ? Math.min(c.s, at) : at, author: ev.pubkey};
    } catch {
      return null;
    }
  }

  /** Everyone who claims this @username right now, me included, oldest claim first. */
  private async claimants(name: string): Promise<Candidate[]> {
    const evs = await this.pool.query([{kinds: [KIND_DIRECTORY], '#d': [userDTag(name)]}]);
    return this.latestPerAuthor(evs).sort(oldestFirst);
  }

  /**
   * Who owns this @username: the oldest claim. `mine` is my own claim, counted even before the relays show it back to me
   * (they take a moment), so a fresh claim of mine is never judged against a newer stranger by mistake.
   */
  async ownerOf(name: string, mine?: {since: number}): Promise<Candidate | null> {
    if (!isUsername(name)) {
      return null;
    }
    const meKey = this.me().publicKey;
    const seen = await this.claimants(name);
    const others = seen.filter(c => c.key !== meKey);
    const own: Candidate | undefined = mine ? {key: meKey, name: '', at: mine.since, since: mine.since, author: ''} : seen.find(c => c.key === meKey);
    return (own ? [...others, own] : others).sort(oldestFirst)[0] ?? null;
  }

  /** Is this name already claimed by somebody else? (Used before I claim it, to say "taken".) */
  async isTakenByOthers(name: string): Promise<boolean> {
    if (!isUsername(name)) {
      return false;
    }
    const meKey = this.me().publicKey;
    return (await this.claimants(name)).some(c => c.key !== meKey);
  }

  /** The person who owns this @username, if it isn't me. At most one: when several claim it, only the oldest claim counts. */
  async findUsername(name: string): Promise<Candidate[]> {
    if (!isUsername(name)) {
      return [];
    }
    const owner = (await this.claimants(name))[0];
    return owner && owner.key !== this.me().publicKey ? [owner] : [];
  }

  /** For a list of phone numbers (E.164), who claims each one. Asks in batches; numbers never leave as plain text. */
  async findNumbers(numbers: string[]): Promise<Map<string, Candidate[]>> {
    const out = new Map<string, Candidate[]>();
    const byTag = new Map<string, string>();
    numbers.forEach(n => byTag.set(phoneDTag(n), n));
    const tags = [...byTag.keys()];
    for (let i = 0; i < tags.length; i += 40) {
      const evs = await this.pool.query([{kinds: [KIND_DIRECTORY], '#d': tags.slice(i, i + 40)}], 6000);
      for (const ev of evs) {
        const d = ev.tags.find(t => t[0] === 'd')?.[1];
        const number = d ? byTag.get(d) : undefined;
        const c = this.parse(ev);
        if (number && c && c.key !== this.me().publicKey) {
          out.set(number, [...(out.get(number) ?? []).filter(x => x.author !== c.author), c]);
        }
      }
    }
    return out;
  }

  private latestPerAuthor(evs: NostrEvent[]): Candidate[] {
    const newest = new Map<string, NostrEvent>();
    for (const e of evs) {
      const cur = newest.get(e.pubkey);
      if (!cur || e.created_at > cur.created_at) {
        newest.set(e.pubkey, e);
      }
    }
    return [...newest.values()].map(e => this.parse(e)).filter((c): c is Candidate => !!c);
  }
}
