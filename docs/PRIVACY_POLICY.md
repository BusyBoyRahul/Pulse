# Pulse — Privacy Policy

_Last updated: 2026-07-30_

Pulse is a safety app. It works by turning nearby phones into a Bluetooth relay
network so an emergency alert can reach help even without cell service. Because
that requires sensitive permissions, we keep this policy plain and specific.

> This template is provided for the Pulse project. Have it reviewed by counsel
> and hosted at a public URL before store submission — both stores link to it.

## What we collect

| Data | Why | Where it lives |
|------|-----|----------------|
| **Phone number** | Account identity + how your trusted circle recognizes an alert from you. Verified by one-time SMS code. | Our server (MySQL), encrypted in transit. |
| **Trusted contacts** (name + number you enter) | To notify them when you send an SOS. | Your device, and mirrored to our server so they survive a reinstall. |
| **Location** | Attached to an SOS so responders and your contacts can find you. | Captured **only** when you trigger an SOS. Sealed (encrypted) on your device before it enters the mesh. |
| **Safety notes** you post | Shared with people near that spot. | Your device + our server; auto-expire after 30 days. |
| **Device push token** | To confirm your SOS reached the network. | Our server. |

## What we do NOT collect

- We do **not** track your location in the background or over time. A fix is
  taken only at the moment you press SOS.
- We do **not** broadcast your name, number, or contacts over Bluetooth. Other
  phones see only an anonymous, rotating mesh id and opaque, encrypted packets.
- We do **not** read messages your phone relays for other people. SOS payloads
  are end-to-end encrypted; a relaying phone mathematically cannot open them.
- We do **not** sell data or use it for advertising.

## How relaying works (and what it means for your privacy)

When Pulse is running, your phone may pass other people's encrypted alerts along
to extend their range. This is silent and invisible — nothing is shown, and you
never see the contents. Your phone is a postal carrier for a sealed envelope it
cannot open.

**Community Responder Mode** (off by default, opt-in in Settings) is the one
exception: if you turn it on, you'll see a redacted "someone nearby may need
help" alert — still with no identity and no location.

## Encryption

SOS payloads are sealed with a Curve25519 "anonymous sealed box" addressed to
Pulse's servers. Only our servers hold the key to open them; every relay in
between carries ciphertext only.

## Data retention & deletion

- Safety notes expire automatically after 30 days.
- SOS records are retained for incident follow-up and then purged.
- You can delete your account (and all associated contacts and records) by
  contacting us; deletion cascades across our database.

## Children

Pulse is not directed to children under 13 and we do not knowingly collect their
data.

## Contact

Questions or deletion requests: **privacy@pulse.app** _(replace with your real
contact before launch)_.
