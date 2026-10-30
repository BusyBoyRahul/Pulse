import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * A short code both people can compare in person (or over a call) to be sure
 * nobody swapped keys when they first connected. It's derived from BOTH public
 * keys, in a fixed order, so the two phones always show the same digits.
 * Six groups of four digits.
 */
export function safetyCode(keyA: string, keyB: string): string[] {
  const [lo, hi] = [keyA, keyB].sort();
  const hash = nacl.hash(naclUtil.decodeUTF8(`pulse-safety|${lo}|${hi}`));
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const n = (hash[i * 3] << 16) | (hash[i * 3 + 1] << 8) | hash[i * 3 + 2];
    groups.push(String(n % 10000).padStart(4, '0'));
  }
  return groups;
}
