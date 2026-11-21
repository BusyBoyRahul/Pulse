# Pulse — Privacy Policy

_Last updated: 2026-11-21_

Pulse is a private messenger. It works by passing sealed messages between nearby phones, and over the internet when you have
it. There is **no Pulse account** and no Pulse server that stores your chats. This page says plainly what stays on your phone,
what leaves it, and who can see it.

> This text describes how the app works. Have it reviewed by counsel and hosted at a public URL before store submission —
> both stores link to it.

## What stays on your phone

Your messages, photos, files, voice notes, contacts' keys, profile and settings are stored **on your phone**, encrypted with a
key kept in the Android Keystore. Pulse makes your encryption keys on your phone the first time you open it. An optional
**backup** is a file (`.pulsebak`) protected by your own passphrase; it never leaves your phone unless you move it yourself.

## What leaves your phone, and who can see it

| What | Where it goes | Who can read it |
|---|---|---|
| **Messages, group messages, call audio** | To the person (or group members), over the nearby mesh and/or the internet | Only the people it is for. They are end-to-end encrypted. |
| **Messages passing through other phones** | Nearby Pulse phones carry them for others | Nobody in between. A carrying phone holds sealed data it cannot open. |
| **Internet delivery** | Public relay servers hold a sealed note until the other phone collects it; calls and some links are set up through relays and public STUN/TURN servers | The relay and STUN/TURN operators can see **sealed data, timing and network addresses (IP)**, not the content. You can change the relays in Settings → Internet, or switch the internet off. |
| **Your @username** (optional) | A signed record on public relays: username → your public key | Anyone. It is meant to be found. |
| **Your phone number** (optional) | Only if you switch on "find me by number": a **one-way scramble (hash)** of the number → your public key, on public relays. Short numbers can be guessed from a hash, so this is **off** until you choose it | Anyone who already knows the number can check it. |
| **SOS alert** | A readable alert (your name, location and optional note) to **nearby Pulse phones**, plus a text with your location prepared in your own messages app for your Trusted Circle (you tap Send) | Pulse phones that receive it, and the people you text. It never contains your Trusted Circle's numbers. |
| **Your contacts** | Read **only** when you tap "find friends". Numbers are compared as one-way scrambles; the list is never uploaded | Nobody. |

## What Pulse does not do

- It does **not** track your location in the background or over time. A location is taken only when you press SOS.
- It does **not** ask for an account, and a phone number is optional.
- It does **not** read your messages, sell data, or show advertising.
- Opening the app does **not** switch on Wi-Fi or Bluetooth. The nearby mesh is off until you turn it on.

## Phone-number check (optional)

If you choose to confirm your number, a one-time code is sent to it. The confirmation Pulse keeps contains only a **hash** of
the number and your public key, signed so other people can check it. Checking it later needs no server.

## Nearby SOS alerts (Responder mode)

By default Pulse can show you a "someone nearby may need help" alert when a nearby person presses SOS. You can turn this off in
Settings → Nearby SOS alerts. Pulse phones also carry other people's sealed messages and SOS alerts silently; nothing is shown
and you never see the contents of sealed messages.

## Permissions, and why

| Permission | Why |
|---|---|
| Bluetooth, Nearby devices, Wi-Fi state, location | To find and talk to nearby Pulse phones (Android requires the location permission for this). |
| Location | To add your position to an SOS you send. |
| Microphone | For voice notes and calls. |
| Camera, photos, files | To send what you choose, and to scan QR codes. |
| Contacts | Only for "find friends" (see above). |
| Notifications | To show messages and calls. |
| Fingerprint / face | Optional app lock. |

## Data retention and deletion

Everything is on your phone, so you control it: clear a chat, delete an account, or erase all chats in Settings → Storage &
backup. Messages can disappear by themselves with the disappearing-messages timer. Sealed notes on public relays expire by the
relay's own rules. Public records (@username, number hash) can be removed by their owner.

## Children

Pulse is not directed to children under 13 and we do not knowingly collect their data.

## Contact

Questions: **privacy@pulse.app** _(replace with your real contact before launch)_.
