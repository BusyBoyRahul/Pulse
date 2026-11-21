# Testing Pulse

Pulse is safety-critical, so testing runs at three levels: automated tests (no radio, no server), a **field test** with
real phones, and battery checks.

## 1. Automated tests — `npm test`

**256 tests pass** (2 are skipped) in 33 suites. They run with no radio, no internet and no server. The mesh tests use a
**virtual-phone harness** (`src/testing/meshHarness.ts`): each virtual phone has its own keys, storage and stores, and they
talk over a fake mesh, fake relays and fake WebRTC links.

| Area | Suites | What they prove |
|---|---|---|
| **Mesh and relaying** | `relayProtocol`, `meshEngine`, `meshCarry` (in `src/mesh/__tests__`) | Unique packet ids; multi-hop A→B→C→D; hop limits; no loops; a phone **holds a message and hands it over later**; presence and call audio are never carried |
| **Chat end to end** | `relayEndToEnd`, `controls`, `formatting`, `composerFormat` | Chat A→C is delivered **and confirmed back**; photos reassemble across a relay; a call rings through a middle phone; notifications, mute, block, edit, delete for everyone, read receipts, rich text |
| **Groups** | `groupAdmin` (15), `groupExtras`, `groupInternet`, `mentions`, `sharedMedia` | Roles and rules, add/remove with key change, join by link and approval, messages reach every member over the internet only, an offline member catches up, per-person delivered/read ticks, up to 3 pins, typing, @mentions that bypass mute, shared-media strip |
| **Pinned messages (1:1)** | `directPins` | A new pin keeps the old ones, 3 at most, either person can unpin, a pin goes when its message is deleted or disappearing messages are switched on |
| **Internet** | `internet`, `internetCall`, `appRtc`, `liveRelays`, `discovery` | Relay mailboxes, offline catch-up, direct links, internet calls, @username claims (**oldest wins**), repeat searches |
| **Privacy and security** | `crypto`, `ratchet`, `secretChat`, `privacy`, `profileAudience`, `lockAndBackup`, `attestation`, `smsVerify` | Sealed boxes, forward secrecy, secret chats, number masking and optional numbers, who sees your photo and about, app lock vs chat lock, encrypted backup, phone-number certificates |
| **People and names** | `names`, `inviteLink`, `accounts`, `callLog` | A name is never an ID; web and `pulse://` links in both forms, links from other sites rejected; several accounts; call history |
| **SOS** | `sosRelayBridge` | A heard SOS is queued while offline and de-duplicated |
| **Other** | `status`, `themed` | Status updates and their audience; theme tokens |

Run one suite or one area:

```bash
npx jest src/__tests__/groupAdmin.test.ts
npx jest src/mesh
```

`npm run typecheck` must also be clean.

## 2. Field test (needs 3 Android phones)

The automated tests cannot prove real radio behaviour. With phones A, B and C:

1. **Mesh switch rules.** With Wi-Fi off, open Pulse: Wi-Fi must stay off and the mesh must be off. Flip **Mesh on**: the radar starts. Turn Wi-Fi off: the mesh switch turns off by itself. Turn on **Settings → Mesh on by default**, turn Wi-Fi on: the mesh turns on.
2. **Two-phone link.** Mesh on for A and B: each shows the other on the Nearby radar.
3. **Real multi-hop.** Put B between A and C so A and C cannot see each other. Send A→C: it must arrive and show ✓✓, with a relay icon.
4. **Late arrival.** Switch C off, send A→C, bring C back: the message must arrive once, with no duplicate.
5. **Groups.** Create a group on A with B and C. Messages, pins, @mentions and "read by" must work, including with only the internet on.
6. **Calls.** Voice call over the mesh and over the internet; minimise the call and use the green bar to return; the caller shows a name.
7. **SOS.** Hold SOS, cancel inside 5 seconds (nothing is sent), then send one: nearby phones show it and the Trusted Circle text is ready.
8. **Notifications.** With Pulse closed, check message and call notifications, and that **no permanent notification** is shown.
9. **Links.** Share a person link and a group link in WhatsApp: both must be tappable, open the page, and **Open in Pulse** must open the right screen.

Record for each: distance, walls between phones, time to deliver.

## 3. Battery

Scanning is duty-cycled in [`src/config.ts`](../src/config.ts) (`scanWindowMs`, `scanIntervalMs`). Measure with Android Battery Historian
(`adb bugreport`) over a few idle hours with the mesh on. Nearby is off by default, so the idle cost for people who never switch it on
is only the internet connection, which has its own setting (Settings → Internet).

Full audit history and the original field-test checklist: [AUDIT_AND_FIXES.md](AUDIT_AND_FIXES.md).
