# Testing Pulse

Pulse is safety-critical, so testing runs at three levels: automated unit tests
(run in CI), on-device field tests (run manually with real phones), and battery
profiling.

## 1. Automated tests — `npm test`

24 tests across the most bug-prone logic. These run with no radio, no server,
and no MySQL.

| Suite | What it proves |
|-------|----------------|
| `relayProtocol.test.ts` | Packet id uniqueness, wire encode/decode round-trip, rejection of malformed/out-of-range frames, `SeenCache` LRU eviction, and every branch of the relay decision (TTL, self-echo, recipient). |
| `meshEngine.test.ts` | **Multi-hop delivery** over a topology where nodes are out of range — SOS travels A→B→C→D and arrives; TTL exhaustion stops a packet mid-chain; **no infinite loops** in a cyclic topology; directed messages reach only their recipient. |
| `crypto.test.ts` | Anonymous sealed box round-trips; a relay with the wrong key **cannot** open an SOS; tampered ciphertext is rejected; ciphertext is non-deterministic; a real SOS payload seals app→server. |
| `sosRelayBridge.test.ts` | A heard SOS stays queued while offline and drains when connectivity returns; the same alert heard from many relays is de-duplicated. |

Cross-boundary check (manual, documented in Phase 5): a payload sealed with the
app's `crypto.seal` is opened byte-for-byte by the server's `seal.open` using
the `.env` secret — the two independent implementations interoperate.

## 2. Field test plan (Phase 6, requires ≥3 Android phones)

Goal: confirm real BLE range and that hops actually happen.

1. **Two-device link.** Install on phones A and B. Confirm each shows the other
   in "phones in range" on Home within ~30s (one scan cycle).
2. **Direct SOS.** Put B in airplane mode + Wi-Fi off (no internet), A online.
   Trigger SOS on B. A should relay it to the server; B's trusted contact gets
   the SMS. Confirm the map link resolves to B's location.
3. **True multi-hop.** Place A—B—C so A and C are NOT in range (separate rooms /
   floors; verify A and C don't see each other on Home). B in the middle.
   Airplane-mode A and B; leave C online. Trigger SOS on A. It must hop A→B→C
   and C relays it out. This is the core promise — verify the contact is
   notified and the alert isn't duplicated.
4. **Cancel window.** Trigger, then cancel within 5s — confirm no SMS is sent.
5. **Notes & chat.** Leave a safety note on A; confirm it appears on B, and
   persists on B after A leaves range.

Record for each: distance, walls/floors between devices, time-to-relay.

## 3. Battery profiling (Phase 6)

Background BLE scanning is the #1 uninstall driver. Scanning is duty-cycled in
[`src/config.ts`](../src/config.ts): scan `scanWindowMs` (5s), rest
`scanIntervalMs` (30s) → ~14% radio duty cycle.

- Measure with Android **Battery Historian** (`adb bugreport`) over a 4-hour
  idle run with the mesh active.
- Target: < 4%/hr drain with the screen off in a low-density area.
- Tuning levers, in order of impact: `scanIntervalMs` (rest longer in low
  density), `scanWindowMs`, and connection count (cap simultaneous GATT links).
- Consider adaptive duty cycling: shorten the rest when peers are present, widen
  it when alone. (Hook: `BleMeshTransport.scanCycle`.)

## Running a single suite

```bash
npx jest src/mesh          # mesh + relay
npx jest src/services      # crypto
npx jest src/sos           # relay bridge
```

## 4. Update (2026-10-28): relay-through-a-friend, delivery receipts, calls, privacy

The suite is now 100 tests. New ones:

| Suite | What it proves |
|-------|----------------|
| `mesh/__tests__/meshCarry.test.ts` | A→B→C hop counting, no echo back to the sender, **store-and-forward** (B holds a message and hands it over when C arrives later, or when a flapping link returns), carried packets expire, presence/call audio are never carried. |
| `__tests__/relayEndToEnd.test.ts` | Three isolated virtual phones (own keys, storage, stores) in a line A—B—C: chat A→C delivered **and confirmed back**, message sent while C is away arrives later without duplicates, retries stop once delivered, a photo reassembles exactly across a relay, A sees C as "1 relay away", a **call** rings C through B (both ends derive the same call key; audio frames reach C's speaker), strangers can't ring, unanswered calls become missed. |
| `__tests__/privacy.test.ts` | Number masking, optional-number validation, and that presence beacons / SOS broadcasts / packet headers carry no phone number. |

**Update (2026-10-29): Android notifications, profiles, chat controls** — added to `relayEndToEnd.test.ts` and a new `__tests__/controls.test.ts`: a relayed message raises an Android notification with Reply / Mark-as-read; sound-off and hide-text are honoured; muted and blocked chats stay quiet (and unblocking lets the waiting message through); delete-for-everyone removes it on both phones and can't come back; edit works only for the sender and only for 15 minutes; read receipts off means the sender never sees "seen"; calls off (everyone / one person) are declined and a blocked caller gets silence; the "about me" line is shared and remembered; "appear in Nearby" off; SOS and connect-request notifications and their buttons; security-code, quiet-hours and per-person-choice unit tests.

Full audit and the three-phone field test: [AUDIT_AND_FIXES.md](AUDIT_AND_FIXES.md).
