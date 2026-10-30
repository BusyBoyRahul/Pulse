import dgram from 'react-native-udp';
import TcpSocket from 'react-native-tcp-socket';
import naclUtil from 'tweetnacl-util';

import type {MeshPacket} from '@/types';
import {getIdentity} from '@/services/identity';
import {useSessionStore} from '@/store/sessionStore';
import {getMeshEngine} from '@/mesh/bleManager';

const DISCOVERY_PORT = 47474;
const DATA_PORT = 47475;
const BROADCAST_ADDR = '255.255.255.255';
const ANNOUNCE_MS = 3000;
const PEER_TTL_MS = 12000;

type LanPeer = {publicKey: string; name: string; ip: string; port: number; lastSeen: number};

const toStr = (buf: unknown): string => {
  if (typeof buf === 'string') {
    return buf;
  }
  try {
    return naclUtil.encodeUTF8(new Uint8Array(buf as ArrayBufferLike));
  } catch {
    return String(buf);
  }
};

/**
 * Wi-Fi (LAN) direct transport — NO server involved.
 *
 * When two phones are on the same Wi-Fi, they find each other by UDP broadcast
 * and exchange messages/media directly over TCP, at Wi-Fi speed (so full-size
 * photos are practical). When they're not on the same network, chat falls back
 * to the Bluetooth mesh. Everything is still end-to-end encrypted — the LAN
 * just carries the same sealed payloads faster.
 *
 * Note: some Wi-Fi networks block client-to-client traffic ("AP isolation"),
 * in which case discovery won't succeed and the app uses Bluetooth instead.
 */
// react-native-udp's socket is an EventEmitter at runtime but its types omit
// `.on`; use a loose shape for the parts we call.
type UdpLike = {
  on: (ev: string, cb: (...a: any[]) => void) => void;
  bind: (port: number, cb?: () => void) => void;
  send: (msg: string, off: number, len: number, port: number, addr: string, cb?: () => void) => void;
  setBroadcast: (on: boolean) => void;
  close: () => void;
};

class LanManager {
  private peers = new Map<string, LanPeer>();
  private udp: UdpLike | null = null;
  private server: ReturnType<typeof TcpSocket.createServer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.startTcpServer();
    this.startDiscovery();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.udp?.close();
    } catch {}
    try {
      this.server?.close();
    } catch {}
    this.udp = null;
    this.server = null;
    this.peers.clear();
  }

  /** Is this peer currently reachable over the local Wi-Fi? */
  isOnLan(publicKey: string): boolean {
    const p = this.peers.get(publicKey);
    return !!p && Date.now() - p.lastSeen < PEER_TTL_MS;
  }

  /** Send a packet directly to a peer over TCP. Returns false if not reachable. */
  sendTo(publicKey: string, packet: MeshPacket): boolean {
    const peer = this.peers.get(publicKey);
    if (!peer || Date.now() - peer.lastSeen >= PEER_TTL_MS) {
      return false;
    }
    try {
      const frame = JSON.stringify(packet) + '\n';
      const client = TcpSocket.createConnection({host: peer.ip, port: peer.port}, () => {
        client.write(frame);
        client.end();
      });
      client.on('error', () => {
        try {
          client.destroy();
        } catch {}
      });
      return true;
    } catch {
      return false;
    }
  }

  // --- TCP server: receive frames and feed them into the mesh engine --------
  private startTcpServer(): void {
    this.server = TcpSocket.createServer(socket => {
      let buffer = '';
      socket.on('data', data => {
        buffer += toStr(data);
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line) {
            this.handleFrame(line);
          }
        }
      });
      socket.on('error', () => {
        try {
          socket.destroy();
        } catch {}
      });
    });
    try {
      this.server.listen({port: DATA_PORT, host: '0.0.0.0', reuseAddress: true});
    } catch {
      /* port busy — another instance; ignore */
    }
  }

  private handleFrame(line: string): void {
    try {
      const packet = JSON.parse(line) as MeshPacket;
      if (packet && packet.id && packet.type) {
        getMeshEngine().injectPacket(packet);
      }
    } catch {
      /* malformed frame */
    }
  }

  // --- UDP discovery: broadcast presence + track peers ----------------------
  private startDiscovery(): void {
    const socket = dgram.createSocket({type: 'udp4', reusePort: true}) as unknown as UdpLike;
    this.udp = socket;

    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(toStr(msg)) as {t?: string; pk?: string; name?: string; port?: number};
        if (data.t !== 'pulse' || !data.pk || data.pk === getIdentity().publicKey) {
          return;
        }
        this.peers.set(data.pk, {
          publicKey: data.pk,
          name: data.name || 'Pulse user',
          ip: rinfo.address,
          port: data.port || DATA_PORT,
          lastSeen: Date.now(),
        });
      } catch {
        /* ignore */
      }
    });

    socket.on('error', () => {
      try {
        socket.close();
      } catch {}
    });

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch {}
      this.announce();
      this.timer = setInterval(() => this.announce(), ANNOUNCE_MS);
    });
  }

  private announce(): void {
    if (!this.udp) {
      return;
    }
    const name = useSessionStore.getState().profileName || 'Pulse user';
    const msg = JSON.stringify({t: 'pulse', pk: getIdentity().publicKey, name, port: DATA_PORT});
    try {
      this.udp.send(msg, 0, msg.length, DISCOVERY_PORT, BROADCAST_ADDR, () => {});
    } catch {
      /* transient */
    }
    // Prune stale peers.
    const cutoff = Date.now() - PEER_TTL_MS;
    for (const [k, v] of this.peers) {
      if (v.lastSeen < cutoff) {
        this.peers.delete(k);
      }
    }
  }
}

export const lanManager = new LanManager();
export default lanManager;
