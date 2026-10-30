<div align="center">

<img src="pulse-icon-512.png" width="120" alt="Pulse logo" />

# Pulse

**Message, call and send SOS alerts with no signal, no internet and no account.**
Nearby phones relay for each other, so a message can hop from phone to phone until it reaches the person you meant.

[![Platform](https://img.shields.io/badge/platform-Android%206%2B-3DDC84?logo=android&logoColor=white)](#-download)
[![React Native](https://img.shields.io/badge/React%20Native-0.75-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![Tests](https://img.shields.io/badge/tests-100%20passing-brightgreen)](docs/TESTING.md)
[![Offline first](https://img.shields.io/badge/works-offline-1e40af)](#-how-it-works)
[![Encrypted](https://img.shields.io/badge/chats-end--to--end%20encrypted-111827)](#-privacy--security)

<a href="../../releases/latest/download/Pulse.apk">
  <img src="https://img.shields.io/badge/%E2%AC%87%20Download%20Pulse.apk-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Download Pulse.apk" height="48" />
</a>

<sub>Direct download · 69 MB · Android 6.0+ · [all releases](../../releases)</sub>

</div>

---

## ⬇️ Download

| | |
|---|---|
| **Android phone** | 1. Tap [**Download Pulse.apk**](../../releases/latest/download/Pulse.apk). It starts downloading right away.<br>2. Open the file on your phone. If Android asks, allow **Install unknown apps** for your browser or Files app.<br>3. Open Pulse, create your local profile, and allow the Bluetooth / Nearby / location / notification prompts. |
| **Needs** | Android 6.0 or newer and Google Play Services (used for phone-to-phone discovery). |
| **Heads up** | This build is signed with a debug key, not a Play Store key, so Android shows an "unknown source" warning. That is expected. |
| **iPhone** | Not available yet. It needs a Mac and Apple's tools to build. |

> To see Pulse relay, you need **at least two phones** with it installed, and **three** to watch a message hop through a middle phone.

---

## ✨ What it does

### 🆘 SOS
- Press-and-hold trigger with a 5-second cancel window
- GPS location attached to the alert
- Goes by **SMS from your own SIM** to your Trusted Circle, with an honest "failed" screen if nothing could be sent

### 💬 Chat, with no internet
| | |
|---|---|
| **Nearby & relayed** | Chat with people in range, or through other Pulse phones in between (A → B → C) |
| **Delivery ticks** | Sent ✓, delivered ✓✓, with a small relay icon when it came through a hop |
| **Pairing first** | Direct chats and group invites need a request and accept, which also exchanges encryption keys |
| **Groups** | Encrypted groups with member info, invites sealed per person |
| **Rich messages** | Bold, italic, strike, mono, spoilers, emoji, reply, edit (15 min), forward, star, copy |
| **Delete** | Delete for me, or for everyone |
| **Disappearing** | Auto-delete timers and view-once photos |
| **Media** | Photos, **any file or video up to 25 MB**, and voice notes |
| **Extras** | Typing indicator, search, pin, mute, labels, chat-list tabs, wallpapers, notes to self |

### 📞 Calls that never show a phone number
- In-app voice calls, encrypted, over the same mesh, so they work through relays
- Only people you've paired with can ring you
- Answer and Decline straight from the notification

### 🔔 Real Android notifications
- Proper notification channels, heads-up and lock-screen alerts
- Reply and Mark-read from the notification, plus incoming-call actions
- A foreground service keeps relaying while the screen is off

### 🔒 Privacy & security
- **End-to-end encryption** (NaCl: X25519 + XSalsa20-Poly1305) for messages, groups and call audio
- **Relay phones can't read anything** they carry
- **PIN and app lock**, optional fingerprint/face, and **locked chats** with hidden previews
- Sensitive data encrypted at rest using the **Android Keystore**
- **Encrypted backup and restore** to a `.pulsebak` file protected by your passphrase
- Your own phone number is optional and masked everywhere

---

## 🧠 How it works

```
   ┌─────┐   in range   ┌─────┐   in range   ┌─────┐
   │  A  │ ───────────▶ │  B  │ ───────────▶ │  C  │
   └─────┘              └─────┘              └─────┘
   sends sealed         can't read it,       opens it,
   message to C         just carries it      sends a ✓✓ back
```

- **Transport:** Google **Nearby Connections** (Bluetooth + Wi-Fi, chosen automatically), plus a same-Wi-Fi LAN path when available.
- **Relay:** store-and-forward with a hop limit. Packets are de-duplicated by id and re-offered to *new* neighbours, so a message waits for its recipient to come into range.
- **Crypto:** each phone makes its own keypair on first launch. No server, no accounts.
- **Storage:** chat history, preferences and keys are encrypted on the device.

---

## 🧱 Tech stack

| Layer | What |
|---|---|
| App | React Native 0.75 · TypeScript · Zustand · React Navigation |
| Crypto | TweetNaCl |
| Native (Kotlin) | Nearby mesh · foreground service · call audio · notifications · secure store · media files · app share |
| Tests | Jest, including a 3-phone A → B → C simulation |

### Repository layout

```
Pulse/
├── App.tsx                 # root: navigation + gates (onboarding, lock)
├── src/
│   ├── screens/            # Chats, Conversation, Nearby, SOS, Notes, Profile, Settings…
│   ├── components/         # UI kit (Screen, Avatar, Sheet, PinPad, Radar…)
│   ├── mesh/               # mesh engine, relay protocol, Nearby / BLE transports
│   ├── store/              # Zustand stores (chat, calls, pairing, groups, locks…)
│   ├── services/           # crypto, notifier, backup, media files, permissions…
│   ├── sos/                # SOS packet + relay bridge
│   └── theme/              # monochrome design tokens
├── android/                # native project + Kotlin modules (com.pulse)
├── server/                 # legacy backend from the earlier online design (unused)
└── docs/                   # testing, native setup, privacy policy, store notes, audit log
```

---

## 🛠️ Build it yourself

**Requirements:** Node 18+, JDK 17, Android SDK. Details in [docs/NATIVE_SETUP.md](docs/NATIVE_SETUP.md).

```powershell
npm install
npm run typecheck
npm test                 # 100 tests
npm run android          # run on a connected phone / emulator
```

**Build the installable APK** (Windows, one command):

```powershell
.\build-apk.ps1          # produces Pulse.apk on your Desktop
```

---

## 🧪 Status & honesty

| | |
|---|---|
| ✅ **Verified** | 100 automated tests pass, including 3-phone relay, files, backup and locks. The release app was checked on an Android emulator. |
| ⚠️ **Not yet proven** | Real-radio behaviour, call audio quality, notifications with the app closed, and relaying with the screen off all need a **3-phone field test**. The checklist is in [docs/AUDIT_AND_FIXES.md](docs/AUDIT_AND_FIXES.md#field-test-3-android-phones--the-promise-being-tested-a-reaches-c-only-through-b). |
| 🚧 **Limits** | Android only. Large files are slow over the mesh. Pairing is trust-on-first-use. Backups don't include photos, files or voice notes. |
| 🗺️ **Not built** | iPhone version, QR contact cards |

Full history of what was fixed and added: [docs/AUDIT_AND_FIXES.md](docs/AUDIT_AND_FIXES.md).

---

## 📚 Docs

[Testing](docs/TESTING.md) · [Native setup](docs/NATIVE_SETUP.md) · [Privacy policy](docs/PRIVACY_POLICY.md) · [Store submission](docs/STORE_SUBMISSION.md) · [Audit & fixes](docs/AUDIT_AND_FIXES.md)

<div align="center"><sub>Built for the moments when there's no signal.</sub></div>
