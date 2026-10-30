# Store Submission Prep

Both stores scrutinize location + background Bluetooth. Below is everything a
reviewer needs, plus the exact justification text to paste into review notes.

## Pre-submission checklist

- [ ] Privacy policy hosted at a public URL (see [PRIVACY_POLICY.md](PRIVACY_POLICY.md)).
- [ ] Production sealing keypair regenerated (do **not** ship the dev key in
      `src/config.ts` / `server/.env.example`).
- [ ] Production `JWT_SECRET` set; `OTP_DEV_MODE=false`; real Twilio + push keys.
- [ ] Permission strings finalized (see [NATIVE_SETUP.md](NATIVE_SETUP.md)).
- [ ] Managed MySQL + uptime monitoring in place (SOS delivery is safety-critical).
- [ ] Demo account / video showing the SOS flow for reviewers.

## App Store (Apple)

### Background Bluetooth justification (paste into App Review notes)

> Pulse is a personal-safety app that forms an offline Bluetooth mesh between
> nearby devices so an emergency SOS can be relayed to help when the user has no
> cellular or Wi-Fi connectivity (remote areas, disasters, dead zones). The
> `bluetooth-central` and `bluetooth-peripheral` background modes are required
> so a phone can continue relaying a stranger's encrypted safety alert while the
> app is backgrounded — this is the core function, not an enhancement. No user
> content is readable by relaying devices; SOS payloads are end-to-end
> encrypted. Location is accessed only at the moment the user triggers an SOS.

### Notes
- Expect Apple to test the SOS flow. Provide a build with `OTP_DEV_MODE` demo
  credentials or a pre-verified demo account.
- Privacy "Nutrition Label": declare Location (app functionality, not tracking),
  Contact Info (phone number), and User Content (safety notes).
- **Be honest in the listing** that iOS background relay is limited by Apple's
  BLE restrictions — describe iOS as foreground-mesh + "keep app open while
  walking," matching [NATIVE_SETUP.md](NATIVE_SETUP.md). Overpromising here is a
  rejection risk and a user-trust risk.

## Google Play

### Sensitive permissions

- **Background location** is NOT requested — call this out in the Data Safety
  form. Location is foreground, SOS-time only.
- **Nearby devices / Bluetooth** (`BLUETOOTH_SCAN` with
  `usesPermissionFlags="neverForLocation"`, `BLUETOOTH_ADVERTISE`,
  `BLUETOOTH_CONNECT`): declared for offline mesh relaying.
- **Foreground service** (`connectedDevice` + `location` types): required to
  keep the mesh alive with a persistent notification. Provide the prominent-
  disclosure screenshot (the onboarding "Join the mesh" step covers this).

### Data Safety form summary
- Collected: phone number, contacts you add, coarse/fine location (SOS-time),
  push token, user content (notes).
- Shared: nothing sold; SOS location shared only with the user's own contacts.
- Encryption in transit: yes. SOS payloads additionally end-to-end encrypted.
- Data deletion method: provided.

## Honest messaging (applies to both listings)

Per the project's risk register, the store description must state plainly:

1. Delivery depends on nearby Pulse density — **not guaranteed instant**.
2. Pulse is a backup, **not** a replacement for calling emergency services.
3. iOS background relay is weaker than Android.

These are set in onboarding (the "Honest about the limits" step) and should
match the store copy word-for-word.
