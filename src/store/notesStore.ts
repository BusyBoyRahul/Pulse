import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';

import config from '@/config';
import type {MeshPacket, SafetyNote} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {newPacketId} from '@/mesh/relayProtocol';
import {getJSON, setJSON, StorageKeys} from '@/services/storage';
import locationService from '@/services/locationService';

type NotePayload = {m: string; lat: number; lng: number; exp: number};

function encodeNote(p: NotePayload): string {
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(p)));
}
function decodeNote(s: string): NotePayload | null {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as NotePayload;
  } catch {
    return null;
  }
}

type NotesState = {
  notes: SafetyNote[];
  subscribed: boolean;

  init: () => void;
  hydrate: () => void;
  syncNearby: () => Promise<void>;
  post: (message: string) => Promise<void>;
  prune: () => void;
};

function persist(notes: SafetyNote[]) {
  setJSON(StorageKeys.safetyNotes, notes);
}

function upsert(list: SafetyNote[], note: SafetyNote): SafetyNote[] {
  if (list.some(n => n.id === note.id)) {
    return list;
  }
  return [note, ...list];
}

/**
 * Geo-tagged safety notes. They ride the mesh (type NOTE) and are cached
 * locally so a phone passing the same spot later still sees them. Also mirrored
 * to the server so new arrivals can pull nearby notes without a relay.
 */
export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  subscribed: false,

  init: () => {
    if (get().subscribed) {
      return;
    }
    const engine = getMeshEngine();
    engine.subscribe('NOTE', (packet: MeshPacket) => {
      const p = decodeNote(packet.payload);
      if (!p || p.exp < Date.now()) {
        return;
      }
      const note: SafetyNote = {
        id: packet.id,
        latitude: p.lat,
        longitude: p.lng,
        message: p.m,
        createdAt: packet.originTimestamp,
        expiresAt: p.exp,
      };
      const notes = upsert(get().notes, note);
      persist(notes);
      set({notes});
    });
    set({subscribed: true});
  },

  hydrate: () => {
    const cached = getJSON<SafetyNote[]>(StorageKeys.safetyNotes, []);
    set({notes: cached.filter(n => n.expiresAt > Date.now())});
  },

  syncNearby: async () => {
    // No server: notes propagate purely over the mesh. Nothing to fetch.
  },

  post: async (message: string) => {
    const text = message.trim();
    if (!text) {
      return;
    }
    const fix = await locationService.tryGetCurrent();
    if (!fix) {
      throw new Error('Location needed to leave a note here.');
    }
    const id = newPacketId();
    const expiresAt = Date.now() + config.noteTtlDays * 24 * 60 * 60 * 1000;
    const note: SafetyNote = {
      id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      message: text,
      createdAt: Date.now(),
      expiresAt,
    };

    const notes = upsert(get().notes, note);
    persist(notes);
    set({notes});

    // Broadcast into the mesh — no server involved.
    await getMeshEngine().send({
      type: 'NOTE',
      id,
      ttl: config.defaultTtl,
      payload: encodeNote({m: text, lat: fix.latitude, lng: fix.longitude, exp: expiresAt}),
    });
  },

  prune: () => {
    const notes = get().notes.filter(n => n.expiresAt > Date.now());
    persist(notes);
    set({notes});
  },
}));
