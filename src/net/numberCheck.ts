import {Signaling, randomId} from './signaling';
import {newCode, textFor} from '@/services/smsVerify';

/**
 * Prove that a Pulse key really owns a phone number — with no server.
 *
 * A directory record is only a claim ("key K says it is +1555…"). To trust it, YOU
 * text a fresh code to that number and ask K, over the encrypted relay channel, to
 * send the code back. Only someone who holds BOTH the key and the SIM that
 * receives the text can answer — so a person who merely claims someone else's number
 * can never pass. The mobile carrier is the only trusted middleman.
 */
export interface SmsLike {
  send(number: string, text: string): Promise<boolean>;
  /** Report the code from the next "Pulse code" text that arrives, for up to ttlMs. Returns a stop function. */
  listen(onCode: (code: string) => void, ttlMs: number): () => void;
}

export type CheckResult = 'confirmed' | 'failed' | 'unavailable';

const WAIT_MS = 120_000;
const LISTEN_MS = 180_000;
const ASK_GAP_MS = 10 * 60_000;

type Pending = {key: string; code: string; done: (r: CheckResult) => void; timer: ReturnType<typeof setTimeout>};

export class NumberCheck {
  private pending = new Map<string, Pending>();
  private lastAsk = new Map<string, number>();
  private off: (() => void) | null = null;

  constructor(private sig: Signaling, private sms: SmsLike) {}

  /** Start answering other people's checks of MY number. */
  start(): void {
    if (this.off) {
      return;
    }
    this.off = this.sig.onSignal((from, p) => this.onSignal(from, p));
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.pending.forEach(p => {
      clearTimeout(p.timer);
      p.done('failed');
    });
    this.pending.clear();
  }

  /** Ask: does key `key` really own `number`? Sends one text message from my SIM. */
  async check(key: string, number: string): Promise<CheckResult> {
    const sid = randomId();
    const code = newCode();
    return new Promise<CheckResult>(resolve => {
      const finish = (r: CheckResult) => {
        const p = this.pending.get(sid);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(sid);
        }
        resolve(r);
      };
      this.pending.set(sid, {key, code, done: finish, timer: setTimeout(() => finish('failed'), WAIT_MS)});
      if (!this.sig.send(key, {t: 'nc1', sid})) {
        finish('unavailable');
        return;
      }
      this.sms
        .send(number, textFor(code))
        .then(ok => {
          if (!ok) {
            finish('unavailable');
          }
        })
        .catch(() => finish('unavailable'));
    });
  }

  private onSignal(from: string, p: Record<string, unknown>): void {
    if (p.t === 'nc1' && typeof p.sid === 'string') {
      // Somebody wants to check that I own my number: watch for their text for a few minutes.
      const now = Date.now();
      if (now - (this.lastAsk.get(from) ?? 0) < ASK_GAP_MS) {
        return;
      }
      this.lastAsk.set(from, now);
      const sid = p.sid;
      let stop: (() => void) | null = null;
      stop = this.sms.listen(code => {
        this.sig.send(from, {t: 'nc2', sid, code});
        stop?.();
      }, LISTEN_MS);
    } else if (p.t === 'nc2' && typeof p.sid === 'string' && typeof p.code === 'string') {
      const pend = this.pending.get(p.sid);
      if (pend && pend.key === from) {
        pend.done(pend.code === p.code ? 'confirmed' : 'failed');
      }
    }
  }
}
