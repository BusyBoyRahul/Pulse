import {create} from 'zustand';

/** What the internet road is doing right now, for the screens to show. */
type NetState = {
  /** Public relays currently connected. */
  relays: number;
  /** Connected people I have a live direct link with. */
  linked: string[];
  setRelays: (n: number) => void;
  setLinked: (peerKey: string, open: boolean) => void;
  reset: () => void;
};

export const useNetStore = create<NetState>(set => ({
  relays: 0,
  linked: [],
  setRelays: relays => set({relays}),
  setLinked: (peerKey, open) =>
    set(s => {
      const has = s.linked.includes(peerKey);
      if (open === has) {
        return s;
      }
      return {linked: open ? [...s.linked, peerKey] : s.linked.filter(k => k !== peerKey)};
    }),
  reset: () => set({relays: 0, linked: []}),
}));
