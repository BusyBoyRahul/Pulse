import {create} from 'zustand';
import type {NearbyDevice} from '@/types';
import type {TransportState} from './transport/types';
import {getMeshEngine} from './bleManager';
import type {MeshEngine} from './meshEngine';

type MeshState = {
  status: TransportState;
  running: boolean;
  devices: NearbyDevice[];
  engine: MeshEngine | null;

  init: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Reactive view of the mesh for the UI. Owns the engine lifecycle and mirrors
 * transport state + nearby devices into React-friendly state.
 */
export const useMeshStore = create<MeshState>((set, get) => ({
  status: 'idle',
  running: false,
  devices: [],
  engine: null,

  init: () => {
    if (get().engine) {
      return;
    }
    const engine = getMeshEngine();
    engine.onState(status => set({status}));
    engine.onDevices(devices => set({devices}));
    set({engine, status: engine.state});
  },

  start: async () => {
    get().init();
    const engine = get().engine;
    if (!engine || get().running) {
      return;
    }
    set({running: true});
    try {
      await engine.start();
    } catch {
      set({running: false, status: 'error'});
    }
  },

  stop: async () => {
    const engine = get().engine;
    if (!engine) {
      return;
    }
    await engine.stop();
    set({running: false, devices: []});
  },
}));
