import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import type {Group, GroupInvite, MeshPacket} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {getIdentity} from '@/services/identity';
import {getJSON, setJSON} from '@/services/storage';
import {boxTo, openBox, sealGroup, openGroup, generateGroupKey} from '@/services/crypto';
import {useSessionStore} from './sessionStore';
import {usePairingStore} from './pairingStore';

const GROUPS_KEY = 'groups.list';

// Directed, box-sealed to each invitee.
type InviteWire = {t: 'invite'; id: string; name: string; key: string; members: string[]; byName: string; byKey: string};
// Broadcast, secretbox'd with the group key.
type AcceptWire = {t: 'accept'; pk: string; name: string};

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

type GroupsState = {
  groups: Group[];
  pendingInvites: GroupInvite[];
  subscribed: boolean;

  init: () => void;
  create: (name: string, inviteePublicKeys: string[]) => Group;
  accept: (inviteId: string) => void;
  decline: (inviteId: string) => void;
  get: (id: string) => Group | undefined;
  leave: (id: string) => void;
};

function persist(groups: Group[]) {
  setJSON(GROUPS_KEY, groups);
}
function myName(): string {
  return useSessionStore.getState().profileName || 'Pulse user';
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: [],
  pendingInvites: [],
  subscribed: false,

  init: () => {
    set({groups: getJSON<Group[]>(GROUPS_KEY, [])});
    if (get().subscribed) {
      return;
    }
    const me = getIdentity();
    getMeshEngine().subscribe('GROUP', (packet: MeshPacket) => {
      // Directed invite (sealed to me).
      if (packet.recipient === me.publicKey && packet.nonce) {
        // Only people you've connected with can invite you to a group.
        if (!usePairingStore.getState().isPaired(packet.origin)) {
          return;
        }
        const json = openBox(packet.payload, packet.nonce, packet.origin, me.secretKey);
        const inv = json ? (JSON.parse(json) as InviteWire) : null;
        if (!inv || inv.t !== 'invite') {
          return;
        }
        // Ignore if already a member or already have this invite.
        if (get().groups.some(g => g.id === inv.id) || get().pendingInvites.some(p => p.id === inv.id)) {
          return;
        }
        set(state => ({
          pendingInvites: [
            {id: inv.id, name: inv.name, key: inv.key, members: inv.members, byName: inv.byName, byKey: inv.byKey, at: Date.now()},
            ...state.pendingInvites,
          ],
        }));
        return;
      }

      // Broadcast "accept" (secretbox'd with a group key we may hold).
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
      if (acc?.t === 'accept' && !group.joined.includes(acc.pk)) {
        const groups = get().groups.map(g =>
          g.id === group.id ? {...g, joined: [...g.joined, acc.pk]} : g,
        );
        persist(groups);
        set({groups});
      }
    });
    set({subscribed: true});
  },

  create: (name, inviteePublicKeys) => {
    const me = getIdentity();
    const members = [...new Set([me.publicKey, ...inviteePublicKeys])];
    const group: Group = {
      id: groupId(),
      name,
      key: generateGroupKey(),
      members,
      joined: [me.publicKey], // only the creator has joined so far
      createdBy: me.publicKey,
      createdAt: Date.now(),
    };
    const groups = [group, ...get().groups];
    persist(groups);
    set({groups});

    // Send each invitee a sealed invite — they must accept to join.
    const engine = getMeshEngine();
    const invite: InviteWire = {
      t: 'invite',
      id: group.id,
      name: group.name,
      key: group.key,
      members,
      byName: myName(),
      byKey: me.publicKey,
    };
    for (const member of inviteePublicKeys) {
      const {cipher, nonce} = boxTo(JSON.stringify(invite), member, me.secretKey);
      void engine.send({type: 'GROUP', recipient: member, ttl: 5, payload: cipher, nonce});
    }
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
    };
    const groups = [group, ...get().groups];
    persist(groups);
    set({groups, pendingInvites: get().pendingInvites.filter(p => p.id !== inviteId)});

    // Tell the group I joined (broadcast, encrypted with the group key).
    const {cipher, nonce} = sealGroup(JSON.stringify({t: 'accept', pk: me.publicKey, name: myName()} as AcceptWire), inv.key);
    void getMeshEngine().send({type: 'GROUP', ttl: 5, payload: b64({gid: inv.id, c: cipher, n: nonce})});
  },

  decline: inviteId => {
    set(state => ({pendingInvites: state.pendingInvites.filter(p => p.id !== inviteId)}));
  },

  get: (id: string) => get().groups.find(g => g.id === id),

  leave: (id: string) => {
    const groups = get().groups.filter(g => g.id !== id);
    persist(groups);
    set({groups});
  },
}));
