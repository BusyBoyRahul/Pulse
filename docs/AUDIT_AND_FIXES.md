# Pulse — full audit and fix list

Audit date: 2026-10-28. Scope: the whole app (messaging, mesh, SOS, calls, storage, privacy, UI).
Each item says what was wrong, what was done, and how it was checked.

Legend for **Checked**: `auto` = automated test in `npm test`, `build` = compiled into the APK,
`device` = needs two or three real phones (cannot be proven on one emulator).

---

## A. Reaching someone who is out of range (A → B → C)

| # | Problem found | Fix | Checked |
|---|---------------|-----|---------|
| A1 | A relay phone forgot a message the moment the next link was down, so A → B → C failed whenever B↔C flickered or C walked into range later. | **Store-and-forward.** A relay now *carries* messages, SOS alerts, pair requests, group traffic and notes it can't deliver yet, and hands them over when a new phone connects (`meshEngine.ts`). Directed messages are held 12 h, broadcast traffic 45 min, max 120 packets / 3 MB. | auto (`meshCarry.test.ts`, `relayEndToEnd.test.ts`) |
| A2 | The chat showed "✓ sent" instantly even if nothing had left the phone. | Real delivery confirmation: the receiving phone sends an encrypted **delivery receipt** back (through the same relays). Ticks: ✓ left my phone · ✓✓ reached their phone (grey) · ✓✓ opened (black). A small relay icon shows the message crossed other phones. | auto |
| A3 | A lost message was never resent. | **Outbox with retry** (10 s, 25 s, 1 m, 3 m, 8 m, 20 m, 45 m …, up to 24 h). Retries immediately when the person shows up again. Stops as soon as delivered. Survives an app restart. | auto |
| A4 | Photos could stall at "Receiving 90 %" forever if one chunk was lost on a relay. | The receiver now **asks for the missing pieces** (up to 6 times); chunks that arrive before their header are held, not dropped. | auto (photo A→B→C) |
| A5 | Relays echoed every packet straight back to the phone it came from (wasted radio). | The relay now skips the sender (`broadcast(wire, exceptDeviceId)` all the way down to the native module). | auto |
| A6 | You couldn't tell who was only reachable through someone else. | Packets now carry a **hop count**. Nearby and Chats show "In range" or "Via N relays"; the radar shows relayed people in grey. Presence hellos travel 4 hops (the photo thumbnail stays on direct neighbours only to keep relayed traffic small). | auto |
| A7 | The "already seen" memory held only 512 ids; photo chunks and beacons pushed real messages out and could cause re-relay loops. | Raised to 4096. | auto |
| A8 | A connect request lost on the way was never re-asked, and an accept that got lost left the two phones disagreeing. | Requests repeat every 20 s (12 tries); a repeat request from someone you already accepted re-sends your accept. | auto |
| A9 | One failed Bluetooth/Wi-Fi connection attempt was never retried, and a lost tie-break could leave two nearby phones permanently unconnected. | Native: retries with back-off, the "other side" also dials after 12 s, dropped links are re-dialled, discovery is refreshed every 2 min without dropping live links, oversize frames are rejected cleanly (`NearbyMeshModule.kt`). | build, device |
| A10 | **Android froze the app a few minutes after the screen turned off**, so a phone in a pocket silently stopped relaying. A foreground-service permission was declared but no service existed. | Added `MeshForegroundService` — a quiet "Pulse mesh is on" notification that keeps the relay alive. | build, device |
| A11 | An old SOS handed over by a relay 40 minutes later would still sound the alarm. | Nearby-SOS alerts older than 30 min are ignored (`responder.ts`). | build |

## B. In-app calling that never uses a phone number

| # | Item | Detail | Checked |
|---|------|--------|---------|
| B1 | **New: voice calls inside Pulse.** | Call from a chat or the Nearby list. Ring / accept / decline / mute / speaker / end, call timer, missed-call notice. | auto (signalling), build |
| B2 | **Calls work through relays.** | Audio travels as ordinary mesh packets, so you can ring someone who is only reachable through a friend's phone. The call screen shows "via N relays". | auto (A→B→C call test), device (audio quality) |
| B3 | Calls are end-to-end encrypted. | The key is derived on both phones from their key pair + call id (never transmitted); audio is AES-256-GCM per 60 ms frame with a replay guard. Relays carry sound they can't hear. | auto (both ends derive the same key), build |
| B4 | Phone numbers play no part. | Callers are identified by Pulse name + mesh key. The other side never sees your number. | auto |
| B5 | Strangers can't make your phone ring. | Only people you have paired with can ring you; others are dropped silently. Busy → automatic "busy" reply. | auto |
| B6 | Calls ring when the app is in the background. | Native heads-up notification with the caller's **name only**; vibration while ringing. | build, device |
| B7 | Dead-air and drops. | Silence suppression halves the radio traffic; a heartbeat ends the call cleanly ("Connection lost") if the link dies. | device |

Voice quality is "walkie-talkie / old landline" (8 kHz) on purpose: it keeps working across several hops.
Calls are Android-only for now.

## C. Phone-number and data protection

| # | Problem found | Fix | Checked |
|---|---------------|-----|---------|
| C1 | Your own phone number was **mandatory** at sign-up and shown in plain text on your profile. | Now **optional**. When set, it is hidden (`••••• 4567`) until you tap the eye, and re-hides after 6 s. | auto |
| C2 | Onboarding and Edit Profile said your number is "included in your SOS so contacts can reach you" — not true, and a worrying thing to read. | Copy rewritten to say what actually happens: the number is optional, encrypted on the phone, never sent to anyone. | build |
| C3 | Trusted-contact numbers were shown in plain text. | Hidden behind the same tap-to-reveal. | build |
| C4 | Secret key, phone numbers, trusted contacts, group keys and pairings sat **unencrypted** on disk. | Encrypted at rest with an AES-256 key held in the **Android Keystore** (`SecureStoreModule.kt`, `storage.ts`). Old plain values are encrypted automatically on first launch of the new build. | build, device |
| C5 | Chat history lived only in memory — every message vanished when the app closed. | History (text, polls, reactions, votes, outbox) is saved, encrypted. Photos are saved encrypted in a size-limited store (oldest dropped first). Read-receipts are no longer re-sent every restart. | build |
| C6 | Proof that nothing leaks. | Tests assert the presence beacon, SOS broadcast and packet header contain no phone number. | auto (`privacy.test.ts`) |

## D. Interface

| # | Item | Detail |
|---|------|--------|
| D1 | **Monochrome design system.** | True black, white, greys. Red is kept *only* for SOS and destructive actions so an emergency control is unmistakable. All screens, buttons, bubbles, avatars, radar and tab bar re-themed from one place (`theme.ts`). |
| D2 | **Dynamic Island** (REMOVED in section H — replaced by real Android notifications). | A black pill in the status-bar band that morphs for: incoming call (Accept / Decline), live call (timer + voice bars + mute/end), nearby SOS (with Location), messages, connect requests (Accept / Ignore), photo progress, delivery-via-relay, and "relaying for someone". Tap to expand, swipe up to tuck away. Resting state shows mesh status; tap it for in-range / via-relay / carrying counts. (`DynamicIsland.tsx`, `islandStore.ts`, `islandBridge.ts`) |
| D3 | New full-screen **Call screen**, voice-reactive rings, privacy line. | `CallScreen.tsx` |
| D4 | Floating capsule **tab bar**; selected tab is a white capsule, SOS stays red. | `TabBar.tsx` |
| D5 | Own-message bubbles were white-on-white after the theme change (time, ticks, reply quotes, polls). | Re-coloured for contrast. |
| D6 | Emoji in previews (📷 📊) and bright accent colours broke the monochrome look. | Plain text. |
| D7 | Settings → **Dynamic Island** card lets you preview each island state without a second phone. | |
| D8 | The old SOS banner was replaced by the island. | `ResponderBanner.tsx` is no longer mounted (file kept). |

## E. Honest statements fixed

* Onboarding promised messages "escape to the internet" — Pulse has no server; reworded to what it does.
* Trusted Circle said contacts are alerted "by SMS and push when your SOS reaches the network" — it is an SMS from your own SIM.
* Chat said "sent" before anything was sent.

## F. Still open / needs real phones

* **Nothing audio- or radio-related can be proven on one emulator.** Please run the field test below on 3 Android phones.
* iPhone: the mesh and calls are Android-only for now.
* Pairing is trust-on-first-use (no safety-number comparison yet).
* Safety Notes spread only to phones that were around when posted (45 min carry); a note is not yet re-offered to every new neighbour.
* `AuthScreen.tsx`, `server/` and the SOS cloud relay are leftovers of the old online design; unused, left in place.
* AsyncStorage keeps the *amount* of data on disk visible (sizes), not the content.

## Field test (3 Android phones) — the promise being tested: A reaches C only through B

1. Install on A, B, C. Pair A↔B and B↔C **and** A↔C while all three are together (this exchanges keys).
2. Move A and C apart until Nearby on A no longer lists C *in range* (separate rooms / floors) with B between. Within ~30 s A should list C as "Via 1 relay".
3. **Message:** A → C. Expect ✓ then ✓✓ (grey) with a small relay icon; C's island pops with the message.
4. **Out of range then back:** turn C's Bluetooth off, send A → C (stays ✓), turn it on — it arrives and A's tick turns ✓✓.
5. **Call:** A calls C. C's island shows Incoming call with Accept/Decline; accept; talk; the call screen shows "via 1 relay".
6. **Screen off:** lock B's screen for 10 minutes and repeat step 3 — it must still relay (foreground notification visible on B).
7. **Number privacy:** on C, open the chat and the call screen with A — A's number never appears anywhere.

## G. Second pass (2026-10-29) — everything re-checked on screen

Checked with demo chat/peer data on the emulator: chat list, a conversation (all five tick states, relay icon, polls, replies, failed message), Nearby, SOS, Settings, the full call screen, and every Dynamic Island state. Fixed along the way:

* Chat list: names touched the avatars (missing gap) — fixed.
* Ending a call could close the chat underneath the call screen as well — fixed.
* A failed background send (receipt, resend, call signal to an unusable key) raised an unhandled error — now ignored safely.
* Island voice bars were animated on the JS thread; moved to the native driver so weak phones stay smooth.
* New test: mute / speaker / hang-up mid-call and full clean-up on both ends (45 tests now).

Not checkable on the emulator: tapping Mute/End on the call screen. The emulator draws about 7 frames/second (software graphics) and dropped the taps. The same actions are covered by the automated test above, but please try them on a real phone.

## H. Third pass (2026-10-29) — Android notifications, profiles, settings, chat controls

Feedback that started this pass: "can't view a user's profile · not Android friendly, notifications should be phone notifications, not in-app · settings/mute/call options missing · chat deletion, copy, reactions etc. missing · still very basic".

### H1. Notifications are now real Android notifications (the island is gone)
| What | Detail |
|------|--------|
| Removed | The Dynamic Island and every in-app pop-up (`DynamicIsland.tsx`, `islandStore.ts`, `islandBridge.ts`). It is an iPhone idea; Android users expect the notification bar. |
| Messages | Chat-style notification with the sender's photo, the last few lines stacked, **Reply** (type right in the notification) and **Mark as read**. Tap opens that chat. Not shown for the chat you are looking at. |
| SOS | Loud alarm-channel notification (can override Do Not Disturb if the user allows it), **Show location** button. Quiet hours never silence it. |
| Calls | Ringtone + vibration, **Answer** / **Decline**. While on a call: "Pulse call in progress" with a timer and **Hang up**. The call now runs inside a *microphone* foreground service, so the mic keeps working when you leave the app or lock the screen (Android silences it otherwise). |
| Requests | Connect requests (**Accept** / **Ignore**), group invites (**Join** / **Decline**). |
| Photos | Progress bar in the notification while a photo sends or arrives. |
| Channels | Messages, SOS alerts, Calls, Requests & invites, Photo transfers, Mesh relay, Ongoing call — each with its own sound/vibration in Android's own settings. |
| Lock screen | Shows "New message" only; the words appear only if the user's Android setting allows it. A Pulse setting hides the text everywhere. |
| Rules honoured | Master switch, show-text, sound & vibration, quiet hours (22:00–07:00 by default), per-chat mute, blocked people. |
| Incoming call with the app open | The call screen opens by itself. |

Code: `NotifyModule.kt` (native), `services/notifier.ts` (what to show), `services/notificationBridge.ts` (taps/buttons, SOS, requests, invites, photo progress). A tap or button that arrives before the app has finished starting is held and replayed.

### H2. Anyone's profile
Tap a name or photo in Chats, Nearby, a chat header or a group → profile with photo, bio, "in range / via N relays / last seen", **Message · Call · Mute · Pin**; nickname; mute 1 h / 8 h / 1 week / always; pin; **allow calls from this person**; **security code** (compare with them to rule out a swapped key) and a "verified" mark; shared photos (tap for full screen); clear chat; block / unblock; remove connection; **Connect** for someone not yet connected. Their phone number is never shown (Pulse never has it). Profiles still open when the person is out of range (last photo/bio/"last seen" are remembered on this phone). Group info page: members (tap for profile), mute, pin, clear, leave.

### H3. Settings (split into pages)
Notifications · Privacy & security (appear in Nearby, accept connect requests, share my photo, read receipts, hide the app in screenshots / recent apps, blocked people) · Calls (allow calls, start on loudspeaker, ringtone) · Storage & data (space used, delete photos, delete all chats) · Mesh & background (Android battery check so Pulse isn't stopped) · Starred messages · Trusted Circle · About. Your own profile gained an optional "About" line others see.

### H4. Chats
Chat list: unread counts (and a badge on the Chats tab), pinned chats on top, newest first, search, muted icon, long-press menu (profile, pin, mute, mark read, clear). In a chat: ⋮ menu (profile, search, select, starred, mute, clear, block); long-press a message → react (6 quick emoji + a full picker), reply, copy, forward, star, edit (own text, 15 min), info (sent / delivered / read times, route), select, delete (for me, or **for everyone** on your own messages). Select several to copy / forward / delete. Tap a photo for full screen. Tap a quote to jump to the original. Tap reactions to see who reacted.

### H5. Checked
* `tsc` clean; **66 automated tests** pass (new: notifications with Reply/Read buttons, mute, block + unblock catch-up, delete for everyone + tombstone, edit rules, read receipts off, call allow/decline/blocked, bio + remembered profiles, "appear in Nearby" off, SOS/request/notification buttons, safety code, quiet hours, prefs).
* On the emulator (release build): a real Android notification appears in the shade as a chat-style notification with "Mark as read"; tapping it opens the right chat; the chat list, conversation (stars, edited, ticks, reactions, reply quote, long-press menu, selection mode, delete dialog), contact profile, Notifications settings and the new profile menu were all looked at on screen.
* **Not provable on one emulator:** notifications for messages that arrive over the real radio while the app is closed, Reply typed inside a notification, Answer/Decline on a real ring, the mic staying alive with the screen off during a call, the Android battery prompt. These need the 3-phone field test. Notifications only arrive while the mesh is running (the app is open or the "mesh is on" notice is showing) — if Android force-stops Pulse, nothing can arrive until it is opened again.

### H6. Still not built
Voice notes · typing indicator · disappearing messages · saving a received photo to the gallery (needs an extra add-on) · backup / restore · QR contact card · chat wallpapers · iPhone version.

## I. Fourth pass (2026-10-29) — chat-list tabs, SOS tab, pairing rule, message security

Feedback: back arrow missing in chat · SOS tab looks like two things selected (white + red) · copy the WhatsApp-style chat list from the screenshots · no chat without pairing · message security (spoilers, bold, etc.) · select several chats and act on them.

### I1. Fixes
| What | Detail |
|------|--------|
| Back arrow missing in a chat | My earlier "hide the back arrow while selecting" change set `headerBackVisible` on the normal header too, which hid the Android back arrow. Now only the selection mode sets it. Checked on the emulator. |
| SOS tab looked like a second "selected" tab | Only ONE tab is ever filled now. A normal tab = white capsule. SOS at rest = dark with a red outline and red icon; filled red only while you are on it. |
| Chats-tab badge counted chats that don't exist | Counts only visible chats (connected people + groups), not muted/blocked. |
| **No chat without pairing** | A direct message from someone you have not connected with is now dropped (before, anyone who knew your public key could message you). Group invites also need a connection. Sending to an unconnected person is refused; the chat shows "Connect with X to start chatting" instead of a message box. |

### I2. Chat list (from the screenshots)
Filter tabs **All · Unread (count) · Favorites · Groups · ▾ labels**; rows show ticks before your last message (✓✓ bright when read), a photo / poll / view-once icon, a pin icon on the right, muted bell, a **label tag** under the preview (e.g. WORK), and a **clock badge** on the picture when disappearing messages are on. **Multi-select**: press and hold a chat, tap more; then Pin / Mute / Mark read / Favorite / Label / Clear for all of them at once (back button leaves selection). Favorites, labels and disappearing timers are also set from a person's profile or group info.

### I3. Message security & formatting
* **Formatting** typed or from the **Aa** bar: `*bold*`, `_italic_`, `~strike~`, `` `mono` ``, `||spoiler||`. Words like snake_case_names and 5*3*2 are left alone. Previews and notifications hide the marks (spoilers show as dots).
* **Spoiler text** is a solid block until tapped.
* **Photos**: after choosing a photo a sheet offers **Hide as spoiler** (blurred until tapped) and **View once** (direct chats). A view-once photo has no preview, opens full-screen with screenshots blocked, and is deleted on both phones when closed ("Photo · opened").
* **Disappearing messages** per chat (24 hours / 7 days / 90 days). Both phones follow (the choice is sent to the other side; only those three timers are accepted). Starred messages are kept. Shown in the chat bar and as a clock badge in the list.

### I4. Checked
`tsc` clean; **81 automated tests** pass (new: strangers can't start a chat, a forged packet from an unpaired phone is ignored, group invites only from connections, spoiler + view-once photo flow incl. sender's copy vanishing, disappearing messages sync + expiry + starred kept, forged timers rejected, formatting parser edge cases, formatting-bar logic, labels and bulk edits). On the emulator: chat list with tabs/ticks/labels/pin/mute/clock badge, multi-select + mark read, SOS tab look, back arrow, formatted text, spoiler text tap-to-reveal, blurred spoiler photo, view-once tile, formatting bar.
Not seen on screen: the "Send photo" sheet and the full-screen view-once viewer (they need the photo picker/camera, which the emulator can't drive here); they are covered by the tests and the type-check.

### I5. Not built — needs a decision
* **Sending files and videos** (PDF, .docx, .apk, .mp4 like in the screenshots) needs two new libraries (a file picker and a file reader) → waiting for approval.
* PIN lock for chats, notes-to-self, typing indicator, voice notes, backup/restore, QR card, wallpapers, iPhone version.
* The Android emulator image used here runs in 16 KB page mode and shows a one-time "app isn't 16 KB compatible" system notice for React Native 0.75's native libraries. It is harmless, but fixing it properly means upgrading React Native (a big change, needs approval).

## J. Fifth pass (2026-10-29) — files, videos, voice notes, locks, backup, wallpapers, notes to self

Request: "yes any kind of file and do all" (everything that was listed as not built).

### J1. Built
| What | Detail |
|------|--------|
| **Any file or video** | Attach → **Video** or **File** → Android's own picker. Up to **25 MB**. Sent in pieces straight from disk (a 25 MB file never sits in memory), received straight to disk, lost pieces are asked for again, delivery is confirmed like any message. Bubbles show the file name, size and type, a progress bar, and a picture + length for videos. Tap opens it in another app; long-press → **Save to phone** (Android's "save as") or **Open**. Forwarding makes a separate copy. Deleting a message / clearing a chat / disappearing messages also delete the file from the phone. Works A → B → C like photos. |
| **Voice notes** | Tap the mic (it replaces Send while the box is empty): recording bar with timer, trash and send. Small AAC files (about 3 KB/second). Play / pause with a progress bar. Not possible during a call. |
| **Save photos** | A download button in the full-screen photo viewer (and "Save to gallery" in the long-press menu) puts the photo in Pictures/Pulse. Not for view-once photos. |
| **Typing indicator** | "typing…" in the chat header and in the chat list. Sent sealed to one person only, never stored or carried by relay phones, switches off by itself. Can be turned off in Privacy (then you neither send nor see it). |
| **PIN lock** | One PIN (4–8 digits; only a salted, stretched hash is stored, encrypted; 5 wrong tries = 30 s wait). Set / change / remove in Settings → Privacy & security. **App lock**: nothing shows until the PIN (or fingerprint / face if the phone has it); locks after 30 s / 1 / 5 / 15 min away. **Locked chats**: Lock chat from a profile, group info or the ⋮ menu; the chat list shows "Locked chat" with no preview, notifications say only "New message", opening asks for the PIN, and it locks again after ~15 s away. Forgot PIN → the only way back is erasing chats. |
| **Notes to self** | "You" row in the chat list: text, photos, files and voice notes that never leave the phone. |
| **Backup / restore** | Settings → Storage & data. Creates an encrypted `.pulsebak` file (passphrase ≥ 8 characters) with your identity key, connections, groups, chat text, labels and settings; saved wherever you choose. Restore asks for the passphrase, shows when it was made, replaces everything and restarts Pulse by itself. Photos, files and voice notes are not included. |
| **Wallpapers** | Settings → Chats: default, pure black, slate, dusk, dots, or your own photo. |
| Also | Settings → Storage shows space used by files and can delete them; the Android back button leaves selection mode / search first. |

All native work is one small module (`MediaFilesModule.kt`) using only Android's own APIs — **no new libraries were added.**

### J2. Checked
`tsc` clean; **100 automated tests** pass (new: file sent across a relay with identical bytes, recovery when every 3rd packet is lost, voice note, size / empty / stranger refusals, file deleted with its message, forwarding copy, notes to self never on the air, typing sent / expires / respects the setting / never carried, PIN hashing / salt / lock-out / removal, backup round-trip / wrong passphrase / tampered file / restore replaces data, file helpers).
On the emulator with real Android: the file picker → a 195 KB file shows in the chat; voice recording → "0:06" voice note → playback with a moving progress bar; PIN screen (wrong PIN rejected, right PIN opens); app lock after 70 s away; typing shown in the list; locked-chat row with hidden preview; notes-to-self row; Chats / Privacy / Storage settings pages; backup file created and verified to hold no readable text; restore from that file → app restarted itself and came back locked with all chats.

### J3. Not checked / limits
* **Fingerprint / face** (the emulator has none), **opening a received file in another app** (no viewer app on the emulator), **saving a photo to the gallery**, and **file / voice transfer over the real radio** — need real phones. Large files over Bluetooth/Wi-Fi mesh are slow (a 25 MB file can take many minutes, longer through relays).
* Creating a backup takes a few seconds on a phone (it stretches the passphrase on purpose); about 30 s on the slow emulator.
* Voice notes can't be recorded during a call.
* **Still not built:** an iPhone version (needs a Mac and Apple's tools), QR contact cards with scanning (needs a camera-scanner library; Nearby already connects people).
