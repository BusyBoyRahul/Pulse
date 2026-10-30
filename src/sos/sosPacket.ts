import naclUtil from 'tweetnacl-util';
import type {Fix} from '@/services/locationService';
import {seal, open} from '@/services/crypto';
import config from '@/config';

/**
 * A nearby-help SOS broadcast. Unlike the sealed server payload below, this is
 * readable by ANY nearby Pulse phone on purpose — the whole point of pressing
 * SOS is to ask people around you for help, so their phones must be able to
 * show who needs help and where. It carries NO private data (no trusted-contact
 * numbers) — those are texted locally from the sender's own SIM.
 */
export type SosBroadcast = {
  n?: string; // name
  lat?: number;
  lng?: number;
  acc?: number; // accuracy (m)
  note?: string;
  t: number; // sent-at (ms)
};

export function buildSosBroadcast(
  fix: Fix | null,
  opts: {name?: string; note?: string; at: number},
): SosBroadcast {
  return {
    n: opts.name,
    lat: fix?.latitude,
    lng: fix?.longitude,
    acc: fix?.accuracy,
    note: opts.note,
    t: opts.at,
  };
}

/** Encode a broadcast for the wire (base64 JSON — any Pulse phone can open it). */
export function encodeSosBroadcast(b: SosBroadcast): string {
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(b)));
}

export function decodeSosBroadcast(payload: string): SosBroadcast | null {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(payload))) as SosBroadcast;
  } catch {
    return null;
  }
}

/** A contact carried inside the SOS so it can be notified with no account. */
export type SosContact = {name: string; phone: string};

/**
 * The contents of an SOS, before it becomes a MeshPacket payload.
 *
 * The payload is sealed (anonymous sealed box) to the server's public key, so
 * relay phones forward the alert without being able to read the victim's
 * location OR contacts. Only the server can open it.
 *
 * Offline-first: the victim's trusted contacts + phone ride INSIDE the sealed
 * payload, so any relay phone that reaches signal can hand the server exactly
 * what it needs to send the SMS — the victim never needs an account or
 * connection of their own.
 */
export type SosPayload = {
  lat?: number;
  lng?: number;
  accuracy?: number;
  name?: string;
  phone?: string;
  note?: string;
  contacts?: SosContact[];
};

export function buildSosPayload(
  fix: Fix | null,
  opts: {name?: string; phone?: string; note?: string; contacts?: SosContact[]},
): SosPayload {
  return {
    lat: fix?.latitude,
    lng: fix?.longitude,
    accuracy: fix?.accuracy,
    name: opts.name,
    phone: opts.phone,
    note: opts.note,
    contacts: opts.contacts,
  };
}

/** Seal an SOS payload to the server's key. Opaque to every relay in between. */
export function sealSosPayload(payload: SosPayload): string {
  return seal(JSON.stringify(payload), config.serverPublicKey);
}

/** Only usable where the server secret key is available (tests). */
export function openSosPayload(sealed: string, serverSecretKey: string): SosPayload | null {
  const json = open(sealed, serverSecretKey);
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as SosPayload;
  } catch {
    return null;
  }
}
