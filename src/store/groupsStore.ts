import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import type {Group, GroupInvite, GroupPerms, GroupPin, JoinRequest, MeshPacket} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {getIdentity} from '@/services/identity';
import {getJSON, setJSON} from '@/services/storage';
import {boxTo, openBox, sealGroup, openGroup, generateGroupKey} from '@/services/crypto';
import {useSessionStore} from './sessionStore';
import {usePairingStore} from './pairingStore';
import {usePrefsStore} from './prefsStore';
import {addInternetAllow} from '@/net/internet';

const GROUPS_KEY = 'groups.list';
const REQUESTS_KEY = 'groups.requests';
export const MAX_NAME = 40;
export const MAX_DESC = 500;
/** Most people in one group. Every message is sent to each of them one by one, so there has to be a limit. */
export const MAX_MEMBERS = 50;
/** Most messages pinned at once in one chat. */
export const MAX_PINS = 3;
const MAX_NOTES = 200;
const MAX_REQUESTS = 50;
const MAX_PIC = 24000;

/*
 * How a group is run:
 *  - The person who made it (createdBy) is always an admin. They can make others admins (admins[]). Admins add and
 *    remove people, make or unmake admins, and change the group's rules (perms).
 *  - perms.edit = 'admins': only admins change the name, picture and description (otherwise any member may).
 *    perms.send = 'admins': only admins can send messages (an announcement group); phones also ignore anybody else's.
 *  - Everything about running the group is sent as a message sealed straight to ONE person (a "box"). A box can only be
 *    made by the real owner of the sender's key, so a receiver always knows who it is from — nobody can pretend to be
 *    an admin.
 *  - Removing someone also changes the group's secret key and gives the new one to everybody but them, so they can no
 *    longer read new messages.
 *  - If the creator leaves, the next person in the member list becomes the creator/admin (every phone works out the same
 *    person).
 *  - Joining by link needs the admin's OK: the link only says which group it is; the person asks, an admin approves.
 */

// Directed, box-sealed to each invitee.
type InviteWire = {
  t: 'invite';
  id: string;
  name: string;
  key: string;
  members: string[];
  byName: string;
  byKey: string;
  pic?: string;
  desc?: string;
  admins?: string[];
  perms?: GroupPerms;
};
// Group-key sealed, sent to each member: someone joined.
type AcceptWire = {t: 'accept'; pk: string; name: string};
// From an admin: who is in the group, who is admin, the rules (and a new secret key when someone was removed).
type RosterWire = {t: 'roster'; id: string; name: string; members: string[]; admins?: string[]; perms?: GroupPerms; key?: string};
// From an admin (or any member when the rules allow): the group's name, picture or description. '' removes it.
// pins = the whole list of pinned messages as it is now (sent whole, so it is always right). pin = what older versions sent: one pin, or null for none.
type InfoWire = {t: 'info'; id: string; name?: string; desc?: string; pic?: string; pin?: GroupPin | null; pins?: GroupPin[]};
// From a member who is leaving.
type GoneWire = {t: 'gone'; id: string};
// From someone who opened the group's link: please let me in.
type JoinReqWire = {t: 'joinreq'; id: string; name: string};
type DirectedWire = InviteWire | RosterWire | InfoWire | GoneWire | JoinReqWire;

function groupId(): string {
  return `g_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
const b64 = (o: unknown) => naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(o)));
const unb64 = <T,>(s: string): T | null => {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as T;
  } catch {
    return null;
  }
};
const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every(k => typeof k === 'string' && k.length > 0 && k.length < 100);
const okPic = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_PIC && /^[A-Za-z0-9+/=]*$/.test(s);
const cleanText = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const okPerms = (p: unknown): GroupPerms | undefined => {
  if (!p || typeof p !== 'object') {
    return undefined;
  }
  const o = p as GroupPerms;
  return {...(o.edit === 'admins' ? {edit: 'admins' as const} : {}), ...(o.send === 'admins' ? {send: 'admins' as const} : {})};
};

/** A pinned message as received: only plain, short text; "by" is who really sent it (not what the message says). */
function cleanPin(p: unknown, by: string): GroupPin | null {
  if (!p || typeof p !== 'object') {
    return null;
  }
  const o = p as Partial<GroupPin>;
  const mid = typeof o.mid === 'string' && o.mid.length < 100 ? o.mid : '';
  const text = cleanText(o.text, 160);
  return mid && text ? {mid, from: typeof o.from === 'string' ? o.from.slice(0, 100) : '', fromName: cleanText(o.fromName, MAX_NAME) || 'Someone', text, by} : null;
}

/** The messages pinned in a group (oldest first). Reads the single pin older versions kept, too. */
export const pinsOf = (g: Group): GroupPin[] => g.pins ?? (g.pinned ? [g.pinned] : []);

/** A list of pinned messages as received: at most MAX_PINS, each one clean, none twice. */
function cleanPins(list: unknown, by: string): GroupPin[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out: GroupPin[] = [];
  for (const p of list) {
    const pin = cleanPin(p, by);
    if (pin && !out.some(o => o.mid === pin.mid) && out.length < MAX_PINS) {
      out.push(pin);
    }
  }
  return out;
}

/** Is this person an admin of this group? */
export const isAdminOf = (g: Group, key: string): boolean => g.createdBy === key || !!g.admins?.includes(key);
/** May this person change the group's name, picture and description? */
export const canEditInfoOf = (g: Group, key: string): boolean => g.members.includes(key) && (g.perms?.edit !== 'admins' || isAdminOf(g, key));
/** May this person send messages in the group? */
export const canSendIn = (g: Group, key: string): boolean => g.members.includes(key) && (g.perms?.send !== 'admins' || isAdminOf(g, key));

type GroupsState = {
  groups: Group[];
  pendingInvites: GroupInvite[];
  /** People who opened a group's link and asked to join (for admins to approve). */
  joinRequests: JoinRequest[];
  subscribed: boolean;

  init: () => void;
  create: (name: string, inviteePublicKeys: string[], extra?: {desc?: string; pic?: string}) => Group;
  accept: (inviteId: string) => void;
  decline: (inviteId: string) => void;
  get: (id: string) => Group | undefined;
  /** I leave; everybody else is told. */
  leave: (id: string) => void;
  /** Am I an admin of this group? */
  isAdmin: (id: string) => boolean;
  /** Can I change its name, picture and description? */
  canEditInfo: (id: string) => boolean;
  /** Can I send messages in it? */
  canSend: (id: string) => boolean;
  /** Change the name, description and/or picture ('' removes the description or picture). False if not allowed. */
  setInfo: (id: string, patch: {name?: string; desc?: string; pic?: string}) => boolean;
  /** Same as setInfo({name}). */
  rename: (id: string, name: string) => boolean;
  /** Pin one more message to the top of the group chat (up to MAX_PINS; the others stay). Same permission as editing the group's info. 'full' = already MAX_PINS pinned. */
  addPin: (id: string, pin: Omit<GroupPin, 'by'>) => 'ok' | 'full' | 'no';
  /** Take one pinned message away (the others stay). */
  removePin: (id: string, mid: string) => boolean;
  /** Admin only: invite more of my connections. False if nobody new, or the group is full. */
  addMembers: (id: string, publicKeys: string[]) => boolean;
  /** Admin only: take someone out and change the group's secret key. */
  removeMember: (id: string, publicKey: string) => boolean;
  /** Admin only: make a member an admin, or take admin away (not from the creator). */
  setAdmin: (id: string, publicKey: string, on: boolean) => boolean;
  /** Admin only: who may edit the info and who may send. */
  setPerms: (id: string, perms: GroupPerms) => boolean;
  /** Admin only: send an invite again to someone who hasn't accepted. */
  resendInvite: (id: string, publicKey: string) => boolean;
  /** Admin only: close the group for everybody. */
  endGroup: (id: string) => boolean;
  /** I opened this group's link: ask its admin to let me in. */
  requestToJoin: (id: string, adminKey: string) => void;
  /** Admin: let a person who asked in (they get an invite) or turn them down. */
  approveJoin: (requestId: string) => boolean;
  declineJoin: (requestId: string) => void;
};

function persist(groups: Group[]) {
  setJSON(GROUPS_KEY, groups);
}
function myName(): string {
  return useSessionStore.getState().profileName || 'Pulse user';
}

/** How a person is called in the group's history: "You", the name I gave them, their own name, or "Someone". */
function nameOf(key: string): string {
  if (key === getIdentity().publicKey) {
    return 'You';
  }
  const prefs = usePrefsStore.getState();
  return prefs.nameFor(key, usePairingStore.getState().paired.find(p => p.publicKey === key)?.name || prefs.profiles[key]?.name || 'Someone');
}
const namesOf = (keys: string[]) => keys.map(nameOf).join(', ');

/** The group with one more line of history. */
function withNote(g: Group, text: string, at = Date.now()): Group {
  const id = `n${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {...g, notes: [...(g.notes ?? []), {id, at, text}].slice(-MAX_NOTES)};
}

/** Seal one directed message to one person and send it. */
function sendTo(recipient: string, wire: DirectedWire): void {
  const me = getIdentity();
  const {cipher, nonce} = boxTo(JSON.stringify(wire), recipient, me.secretKey);
  void getMeshEngine().send({type: 'GROUP', recipient, ttl: 5, payload: cipher, nonce});
}
const others = (g: Group): string[] => g.members.filter(k => k !== getIdentity().publicKey);

export const useGroupsStore = create<GroupsState>((set, get) => {
  const save = (groups: Group[]) => {
    persist(groups);
    set({groups});
  };
  const replace = (g: Group) => save(get().groups.map(x => (x.id === g.id ? g : x)));
  const saveRequests = (joinRequests: JoinRequest[]) => {
    setJSON(REQUESTS_KEY, joinRequests);
    set({joinRequests});
  };
  const mine = () => getIdentity().publicKey;
  /** The group, if I am an admin of it. */
  const asAdmin = (id: string): Group | null => {
    const g = get().groups.find(x => x.id === id);
    return g && isAdminOf(g, mine()) ? g : null;
  };
  const inviteWire = (g: Group): InviteWire => ({
    t: 'invite',
    id: g.id,
    name: g.name,
    key: g.key,
    members: g.members,
    byName: myName(),
    byKey: mine(),
    ...(g.pic ? {pic: g.pic} : {}),
    ...(g.desc ? {desc: g.desc} : {}),
    ...(g.admins?.length ? {admins: g.admins} : {}),
    ...(g.perms ? {perms: g.perms} : {}),
  });
  const rosterWire = (g: Group, key?: string): RosterWire => ({t: 'roster', id: g.id, name: g.name, members: g.members, admins: g.admins ?? [], perms: g.perms ?? {}, ...(key ? {key} : {})});
  const sendRoster = (g: Group, key?: string) => others(g).forEach(k => sendTo(k, rosterWire(g, key)));

  return {
    groups: [],
    pendingInvites: [],
    joinRequests: [],
    subscribed: false,

    init: () => {
      set({groups: getJSON<Group[]>(GROUPS_KEY, []), joinRequests: getJSON<JoinRequest[]>(REQUESTS_KEY, [])});
      // The people in my groups may reach me over the internet too, even if we aren't directly connected to each other:
      // they are in the group because somebody I trust put them there.
      addInternetAllow('groups', k => !usePrefsStore.getState().isBlocked(k) && get().groups.some(g => g.members.includes(k)));
      if (get().subscribed) {
        return;
      }
      const me = getIdentity();
      getMeshEngine().subscribe('GROUP', (packet: MeshPacket) => {
        // Directed, sealed to me: an invite, an update from an admin, someone leaving, someone asking to join.
        if (packet.recipient === me.publicKey && packet.nonce) {
          const json = openBox(packet.payload, packet.nonce, packet.origin, me.secretKey);
          let wire: DirectedWire | null = null;
          try {
            wire = json ? (JSON.parse(json) as DirectedWire) : null;
          } catch {
            return;
          }
          if (!wire || typeof wire.t !== 'string') {
            return;
          }

          if (wire.t === 'invite') {
            const inv = wire;
            // Only people you've connected with can invite you to a group.
            if (!usePairingStore.getState().isPaired(packet.origin) || !isKeyList(inv.members)) {
              return;
            }
            // Ignore if already a member or already have this invite.
            if (get().groups.some(g => g.id === inv.id) || get().pendingInvites.some(p => p.id === inv.id)) {
              return;
            }
            set(state => ({
              pendingInvites: [
                {
                  id: inv.id,
                  name: cleanText(inv.name, MAX_NAME) || 'Group',
                  key: inv.key,
                  members: inv.members,
                  byName: cleanText(inv.byName, MAX_NAME) || 'Someone',
                  byKey: inv.byKey,
                  at: Date.now(),
                  pic: okPic(inv.pic) && inv.pic ? inv.pic : undefined,
                  desc: cleanText(inv.desc, MAX_DESC) || undefined,
                  admins: Array.isArray(inv.admins) ? inv.admins.filter(k => typeof k === 'string' && inv.members.includes(k)) : undefined,
                  perms: okPerms(inv.perms),
                },
                ...state.pendingInvites,
              ],
            }));
            return;
          }

          if (wire.t === 'roster') {
            const group = get().groups.find(g => g.id === wire.id);
            // Only an admin can change who is in the group, who is admin, and the rules.
            if (!group || !isAdminOf(group, packet.origin) || !isKeyList(wire.members)) {
              return;
            }
            if (!wire.members.includes(me.publicKey)) {
              // I was taken out of the group.
              save(get().groups.filter(g => g.id !== group.id));
              return;
            }
            const newMembers = wire.members;
            const added = newMembers.filter(k => !group.members.includes(k));
            const removed = group.members.filter(k => !newMembers.includes(k));
            const admins = Array.isArray(wire.admins) ? wire.admins.filter(k => typeof k === 'string' && newMembers.includes(k) && k !== group.createdBy) : group.admins;
            const perms = wire.perms !== undefined ? okPerms(wire.perms) : group.perms;
            let next: Group = {
              ...group,
              members: newMembers,
              joined: group.joined.filter(k => newMembers.includes(k)),
              key: typeof wire.key === 'string' && wire.key ? wire.key : group.key,
              admins,
              perms,
            };
            const who = nameOf(packet.origin);
            if (added.length) {
              next = withNote(next, `${who} added ${namesOf(added)}`);
            }
            if (removed.length) {
              next = withNote(next, `${who} removed ${namesOf(removed)}`);
            }
            const newAdmins = (admins ?? []).filter(k => !(group.admins ?? []).includes(k));
            const oldAdmins = (group.admins ?? []).filter(k => !(admins ?? []).includes(k) && newMembers.includes(k));
            if (newAdmins.length) {
              next = withNote(next, `${who} made ${namesOf(newAdmins)} ${newAdmins.length === 1 && newAdmins[0] === me.publicKey ? 'an admin' : 'admin'}`);
            }
            if (oldAdmins.length) {
              next = withNote(next, `${who} removed ${namesOf(oldAdmins)} as admin`);
            }
            if (JSON.stringify(perms ?? {}) !== JSON.stringify(group.perms ?? {})) {
              next = withNote(next, `${who} changed the group’s rules`);
            }
            replace(next);
            return;
          }

          if (wire.t === 'info') {
            const group = get().groups.find(g => g.id === wire.id);
            if (!group || !canEditInfoOf(group, packet.origin)) {
              return;
            }
            let next: Group = group;
            const who = nameOf(packet.origin);
            if (typeof wire.name === 'string') {
              const name = cleanText(wire.name, MAX_NAME);
              if (name && name !== group.name) {
                next = withNote({...next, name}, `${who} renamed the group to “${name}”`);
              }
            }
            if (typeof wire.desc === 'string') {
              const desc = cleanText(wire.desc, MAX_DESC);
              if (desc !== (group.desc ?? '')) {
                next = withNote({...next, desc: desc || undefined}, desc ? `${who} changed the group description` : `${who} removed the group description`);
              }
            }
            if (wire.pic !== undefined && okPic(wire.pic) && wire.pic !== (group.pic ?? '')) {
              next = withNote({...next, pic: wire.pic || undefined}, wire.pic ? `${who} changed the group picture` : `${who} removed the group picture`);
            }
            // The pinned messages: the whole list as the sender has it now (or, from an older version, one pin / none).
            const newPins = Array.isArray(wire.pins) ? cleanPins(wire.pins, packet.origin) : wire.pin === null ? [] : wire.pin ? [cleanPin(wire.pin, packet.origin)].filter((p): p is GroupPin => !!p) : undefined;
            if (newPins !== undefined) {
              const before = pinsOf(group);
              const added = newPins.filter(p => !before.some(b => b.mid === p.mid)).length;
              const removed = before.filter(b => !newPins.some(p => p.mid === b.mid)).length;
              if (added || removed) {
                next = {...next, pins: newPins.length ? newPins : undefined, pinned: undefined};
                if (added) {
                  next = withNote(next, `${who} pinned a message`);
                }
                if (removed) {
                  next = withNote(next, `${who} unpinned a message`);
                }
              }
            }
            if (next !== group) {
              replace(next);
            }
            return;
          }

          if (wire.t === 'gone') {
            const group = get().groups.find(g => g.id === wire.id);
            if (!group || !group.members.includes(packet.origin)) {
              return;
            }
            const members = group.members.filter(k => k !== packet.origin);
            const createdBy = packet.origin === group.createdBy ? members[0] ?? group.createdBy : group.createdBy;
            let next: Group = withNote(
              {...group, members, joined: group.joined.filter(k => k !== packet.origin), createdBy, admins: (group.admins ?? []).filter(k => k !== packet.origin && k !== createdBy)},
              `${nameOf(packet.origin)} left`,
            );
            if (createdBy !== group.createdBy) {
              next = withNote(next, createdBy === me.publicKey ? 'You are now the admin' : `${nameOf(createdBy)} is now the admin`);
            }
            replace(next);
            return;
          }

          if (wire.t === 'joinreq') {
            // Somebody opened my group's link. Only an admin hears about it, and only from people I'm connected with
            // (a stranger can't reach me anyway, and this keeps requests from being a way to spam me).
            const group = get().groups.find(g => g.id === wire.id);
            if (!group || !isAdminOf(group, me.publicKey) || group.members.includes(packet.origin)) {
              return;
            }
            if (!usePairingStore.getState().isPaired(packet.origin)) {
              return;
            }
            const id = `${group.id}:${packet.origin}`;
            if (get().joinRequests.some(r => r.id === id) || get().joinRequests.length >= MAX_REQUESTS) {
              return;
            }
            saveRequests([{id, gid: group.id, key: packet.origin, name: cleanText(wire.name, MAX_NAME) || nameOf(packet.origin), at: Date.now()}, ...get().joinRequests]);
          }
          return;
        }

        // Group-key sealed notice (addressed to me, or an old broadcast): someone accepted.
        const wire = unb64<{gid: string; c: string; n: string}>(packet.payload);
        if (!wire?.gid) {
          return;
        }
        const group = get().groups.find(g => g.id === wire.gid);
        if (!group) {
          return;
        }
        const json = openGroup(wire.c, wire.n, group.key);
        const acc = json ? (JSON.parse(json) as AcceptWire) : null;
        if (acc?.t === 'accept' && group.members.includes(acc.pk) && !group.joined.includes(acc.pk)) {
          const known = nameOf(acc.pk);
          const who = known === 'Someone' && typeof acc.name === 'string' && acc.name.trim() ? acc.name.trim().slice(0, 40) : known;
          replace(withNote({...group, joined: [...group.joined, acc.pk]}, `${who} joined`));
        }
      });
      set({subscribed: true});
    },

    create: (name, inviteePublicKeys, extra) => {
      const me = getIdentity();
      const members = [...new Set([me.publicKey, ...inviteePublicKeys])].slice(0, MAX_MEMBERS);
      const group: Group = {
        id: groupId(),
        name: cleanText(name, MAX_NAME) || 'Group',
        key: generateGroupKey(),
        members,
        joined: [me.publicKey], // only the creator has joined so far
        createdBy: me.publicKey,
        createdAt: Date.now(),
        ...(extra?.desc?.trim() ? {desc: cleanText(extra.desc, MAX_DESC)} : {}),
        ...(extra?.pic && okPic(extra.pic) ? {pic: extra.pic} : {}),
      };
      group.notes = [{id: `n${group.createdAt.toString(36)}`, at: group.createdAt, text: 'You created the group'}];
      save([group, ...get().groups]);

      // Send each invitee a sealed invite — they must accept to join.
      const invite = inviteWire(group);
      members.filter(k => k !== me.publicKey).forEach(k => sendTo(k, invite));
      return group;
    },

    accept: inviteId => {
      const inv = get().pendingInvites.find(p => p.id === inviteId);
      if (!inv) {
        return;
      }
      const me = getIdentity();
      const group: Group = {
        id: inv.id,
        name: inv.name,
        key: inv.key,
        members: inv.members,
        joined: [inv.byKey, me.publicKey],
        createdBy: inv.byKey,
        createdAt: Date.now(),
        ...(inv.pic ? {pic: inv.pic} : {}),
        ...(inv.desc ? {desc: inv.desc} : {}),
        ...(inv.admins?.length ? {admins: inv.admins} : {}),
        ...(inv.perms && Object.keys(inv.perms).length ? {perms: inv.perms} : {}),
      };
      group.notes = [{id: `n${group.createdAt.toString(36)}`, at: group.createdAt, text: `${inv.byName} added you`}];
      persist([group, ...get().groups]);
      set({groups: [group, ...get().groups], pendingInvites: get().pendingInvites.filter(p => p.id !== inviteId)});

      // Tell everybody in the group I joined: one addressed copy each (so it also travels over the internet and waits for
      // people who are away), encrypted with the group key.
      const {cipher, nonce} = sealGroup(JSON.stringify({t: 'accept', pk: me.publicKey, name: myName()} as AcceptWire), inv.key);
      const payload = b64({gid: inv.id, c: cipher, n: nonce});
      inv.members.filter(k => k !== me.publicKey).forEach(k => void getMeshEngine().send({type: 'GROUP', recipient: k, ttl: 5, payload}));
    },

    decline: inviteId => {
      set(state => ({pendingInvites: state.pendingInvites.filter(p => p.id !== inviteId)}));
    },

    get: (id: string) => get().groups.find(g => g.id === id),

    isAdmin: id => !!asAdmin(id),
    canEditInfo: id => {
      const g = get().groups.find(x => x.id === id);
      return !!g && canEditInfoOf(g, mine());
    },
    canSend: id => {
      const g = get().groups.find(x => x.id === id);
      return !!g && canSendIn(g, mine());
    },

    setInfo: (id, patch) => {
      const group = get().groups.find(g => g.id === id);
      if (!group || !canEditInfoOf(group, mine())) {
        return false;
      }
      let next: Group = group;
      const wire: InfoWire = {t: 'info', id};
      if (patch.name !== undefined) {
        const name = cleanText(patch.name, MAX_NAME);
        if (!name) {
          return false;
        }
        if (name !== group.name) {
          next = withNote({...next, name}, `You renamed the group to “${name}”`);
          wire.name = name;
        }
      }
      if (patch.desc !== undefined) {
        const desc = cleanText(patch.desc, MAX_DESC);
        if (desc !== (group.desc ?? '')) {
          next = withNote({...next, desc: desc || undefined}, desc ? 'You changed the group description' : 'You removed the group description');
          wire.desc = desc;
        }
      }
      if (patch.pic !== undefined && okPic(patch.pic) && patch.pic !== (group.pic ?? '')) {
        next = withNote({...next, pic: patch.pic || undefined}, patch.pic ? 'You changed the group picture' : 'You removed the group picture');
        wire.pic = patch.pic;
      }
      if (next === group) {
        return true; // nothing to change
      }
      replace(next);
      others(next).forEach(k => sendTo(k, wire));
      return true;
    },

    rename: (id, name) => get().setInfo(id, {name}),

    addPin: (id, pin) => {
      const group = get().groups.find(g => g.id === id);
      if (!group || !canEditInfoOf(group, mine())) {
        return 'no';
      }
      const clean = cleanPin(pin, mine());
      if (!clean) {
        return 'no';
      }
      const now = pinsOf(group);
      if (now.some(p => p.mid === clean.mid)) {
        return 'ok'; // already pinned
      }
      if (now.length >= MAX_PINS) {
        return 'full';
      }
      const pins = [...now, clean];
      replace(withNote({...group, pins, pinned: undefined}, 'You pinned a message'));
      others(group).forEach(k => sendTo(k, {t: 'info', id, pins}));
      return 'ok';
    },

    removePin: (id, mid) => {
      const group = get().groups.find(g => g.id === id);
      if (!group || !canEditInfoOf(group, mine())) {
        return false;
      }
      const now = pinsOf(group);
      if (!now.some(p => p.mid === mid)) {
        return true;
      }
      const pins = now.filter(p => p.mid !== mid);
      replace(withNote({...group, pins: pins.length ? pins : undefined, pinned: undefined}, 'You unpinned a message'));
      others(group).forEach(k => sendTo(k, {t: 'info', id, pins}));
      return true;
    },

    addMembers: (id, publicKeys) => {
      const group = asAdmin(id);
      if (!group) {
        return false;
      }
      const fresh = [...new Set(publicKeys)].filter(k => !group.members.includes(k)).slice(0, Math.max(0, MAX_MEMBERS - group.members.length));
      if (fresh.length === 0) {
        return false;
      }
      const updated = withNote({...group, members: [...group.members, ...fresh]}, `You added ${namesOf(fresh)}`);
      replace(updated);
      // The new people get an invite (with the current key); everybody already in gets the new member list.
      const invite = inviteWire(updated);
      fresh.forEach(k => sendTo(k, invite));
      group.members.filter(k => k !== mine()).forEach(k => sendTo(k, rosterWire(updated)));
      return true;
    },

    removeMember: (id, publicKey) => {
      const group = asAdmin(id);
      // Nobody can remove themself here (that is "leave"), and the creator can't be removed.
      if (!group || publicKey === mine() || publicKey === group.createdBy || !group.members.includes(publicKey)) {
        return false;
      }
      const members = group.members.filter(k => k !== publicKey);
      const key = generateGroupKey(); // the person leaving the group never gets this one
      const updated = withNote(
        {...group, members, joined: group.joined.filter(k => k !== publicKey), key, admins: (group.admins ?? []).filter(k => k !== publicKey)},
        `You removed ${nameOf(publicKey)}`,
      );
      replace(updated);
      members.filter(k => k !== mine()).forEach(k => sendTo(k, rosterWire(updated, key)));
      sendTo(publicKey, {t: 'roster', id, name: group.name, members}); // told they are out, without the new key
      return true;
    },

    setAdmin: (id, publicKey, on) => {
      const group = asAdmin(id);
      if (!group || !group.members.includes(publicKey) || publicKey === group.createdBy) {
        return false;
      }
      const has = !!group.admins?.includes(publicKey);
      if (has === on) {
        return false;
      }
      const admins = on ? [...(group.admins ?? []), publicKey] : (group.admins ?? []).filter(k => k !== publicKey);
      const updated = withNote({...group, admins}, on ? `You made ${nameOf(publicKey)} an admin` : `You removed ${nameOf(publicKey)} as admin`);
      replace(updated);
      sendRoster(updated);
      return true;
    },

    setPerms: (id, perms) => {
      const group = asAdmin(id);
      if (!group) {
        return false;
      }
      const clean = okPerms(perms) ?? {};
      if (JSON.stringify(clean) === JSON.stringify(group.perms ?? {})) {
        return false;
      }
      const updated = withNote({...group, perms: Object.keys(clean).length ? clean : undefined}, 'You changed the group’s rules');
      replace(updated);
      sendRoster(updated);
      return true;
    },

    resendInvite: (id, publicKey) => {
      const group = asAdmin(id);
      if (!group || !group.members.includes(publicKey) || group.joined.includes(publicKey)) {
        return false;
      }
      sendTo(publicKey, inviteWire(group));
      return true;
    },

    endGroup: id => {
      const group = asAdmin(id);
      if (!group) {
        return false;
      }
      // Everybody is told the group now has nobody but me: they are out, and so is the group.
      others(group).forEach(k => sendTo(k, {t: 'roster', id, name: group.name, members: [mine()]}));
      save(get().groups.filter(g => g.id !== id));
      return true;
    },

    requestToJoin: (id, adminKey) => {
      if (get().groups.some(g => g.id === id)) {
        return;
      }
      sendTo(adminKey, {t: 'joinreq', id, name: myName()});
    },

    approveJoin: requestId => {
      const req = get().joinRequests.find(r => r.id === requestId);
      if (!req) {
        return false;
      }
      saveRequests(get().joinRequests.filter(r => r.id !== requestId));
      return get().addMembers(req.gid, [req.key]);
    },

    declineJoin: requestId => {
      saveRequests(get().joinRequests.filter(r => r.id !== requestId));
    },

    leave: id => {
      const me = mine();
      const group = get().groups.find(g => g.id === id);
      if (group) {
        group.members.filter(k => k !== me).forEach(k => sendTo(k, {t: 'gone', id}));
      }
      save(get().groups.filter(g => g.id !== id));
    },
  };
});
