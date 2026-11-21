import naclUtil from 'tweetnacl-util';

/**
 * Where the link page lives (the `site` folder, published with GitHub Pages). A link people SHARE is a web address, because chat apps
 * only make web addresses tappable: `https://…/Pulse/add#k=<key>&n=<name>` and `https://…/Pulse/join#g=…&a=…&n=…`. The page shows the
 * person or group and opens Pulse. The details are after the "#", so they never reach the web server. Change this one line if the
 * page moves; older `pulse://` links keep working too.
 */
export const LINK_BASE = 'https://busyboyrahul.github.io/Pulse';
const BASE_HOST = LINK_BASE.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

/** A web link from our page → the app's own `pulse://` form (anything else is returned unchanged). */
function toAppLink(text: string): string {
  const m = /^https?:\/\/([^/\s]+)\/(?:[^/\s#?]+\/)?(add|join)\/?#(.+)$/i.exec(text.trim());
  if (!m || m[1].toLowerCase() !== BASE_HOST) {
    return text;
  }
  return `pulse://${m[2].toLowerCase() === 'join' ? 'group' : 'add'}?${m[3]}`;
}

/** The two ways a link can be written inside a message: our web address, or `pulse://`. */
const HOST_RE = BASE_HOST.replace(/\./g, '\\.');
const WEB_ADD = new RegExp(`https?://${HOST_RE}/[^\\s#]*?add/?#[^\\s]+`, 'i');
const WEB_JOIN = new RegExp(`https?://${HOST_RE}/[^\\s#]*?join/?#[^\\s]+`, 'i');

/**
 * Invite links and QR codes: `pulse://add?k=<key>&n=<name>`.
 * They only carry a public key and a display name — nothing secret — so a link
 * can be shared anywhere. Opening one just offers "Connect".
 *
 * The key is written in URL-safe base64 (no "+", "/" or "=") so the link stays
 * short and never needs percent-codes.
 */
export type Invite = {key: string; name: string};

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s: string): string => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/ /g, '+');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
};

/** The link to SHARE for a person (a tappable web address). */
export function makeLink(key: string, name: string): string {
  return `${LINK_BASE}/add#k=${toUrlSafe(key)}&n=${encodeURIComponent(name.trim().slice(0, 40))}`;
}

export const validKey = (k: string): boolean => {
  try {
    return naclUtil.decodeBase64(k).length === 32;
  } catch {
    return false;
  }
};

export function parseLink(text: string): Invite | null {
  const m = /^pulse:\/\/add\?(.*)$/i.exec(toAppLink(text).trim());
  if (!m) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const part of m[1].split('&')) {
    const eq = part.indexOf('=');
    const k = eq < 0 ? part : part.slice(0, eq);
    const v = eq < 0 ? '' : part.slice(eq + 1);
    try {
      params[k] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  // Accept both the short URL-safe form and the older standard base64 form.
  const key = fromUrlSafe(params.k ?? '');
  if (!validKey(key)) {
    return null;
  }
  return {key, name: (params.n ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 40) || 'Pulse user'};
}

/**
 * A group's link: `pulse://group?g=<group id>&a=<admin's key>&n=<group name>`.
 * It says only WHICH group and who to ask — nothing secret (no group key). Opening it never joins anyone: the person
 * asks, and an admin has to say yes. So a link that leaks is harmless.
 */
export type GroupLink = {id: string; admin: string; name: string};

/** The link to SHARE for a group (a tappable web address). */
export function makeGroupLink(id: string, adminKey: string, name: string): string {
  return `${LINK_BASE}/join#g=${encodeURIComponent(id)}&a=${toUrlSafe(adminKey)}&n=${encodeURIComponent(name.trim().slice(0, 40))}`;
}

export function parseGroupLink(text: string): GroupLink | null {
  const m = /^pulse:\/\/group\?(.*)$/i.exec(toAppLink(text).trim());
  if (!m) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const part of m[1].split('&')) {
    const eq = part.indexOf('=');
    try {
      params[eq < 0 ? part : part.slice(0, eq)] = decodeURIComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  const admin = fromUrlSafe(params.a ?? '');
  if (!/^g_[A-Za-z0-9]{3,60}$/.test(params.g ?? '') || !validKey(admin)) {
    return null;
  }
  return {id: params.g, admin, name: (params.n ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 40) || 'Group'};
}

/** Find a group link inside any text. */
export function findGroupLink(text: string): GroupLink | null {
  const m = WEB_JOIN.exec(text) ?? /pulse:\/\/group\?[^\s]+/i.exec(text);
  return m ? parseGroupLink(m[0]) : null;
}

/** Find an invite inside any text (a whole shared message, for example). */
export function findInvite(text: string): Invite | null {
  const m = WEB_ADD.exec(text) ?? /pulse:\/\/add\?[^\s]+/i.exec(text);
  return m ? parseLink(m[0]) : null;
}
