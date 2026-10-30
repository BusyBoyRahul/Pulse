/**
 * Phone-number privacy helpers.
 *
 * Pulse identifies people by a mesh key and a display name — never by phone
 * number. Numbers are only ever (a) the optional one you enter for yourself and
 * (b) your trusted contacts', used to send an SOS text from your own SIM. They
 * are kept encrypted on this phone, hidden on screen until you tap to reveal,
 * and are never put in any packet that leaves the phone over the mesh.
 */

/** "+15551234567" -> "••••• 4567". Anything too short to mask safely is fully hidden. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 6) {
    return phone ? '••••••' : '';
  }
  return `••••• ${digits.slice(-4)}`;
}

/** Accepts an international number, or empty (the number is optional). */
export function isValidOptionalPhone(phone: string): boolean {
  const p = phone.trim();
  return p === '' || p === '+1' || /^\+[1-9]\d{7,14}$/.test(p);
}

/** A blank field that only holds the "+1" starter counts as "no number". */
export function normalizeOptionalPhone(phone: string): string {
  const p = phone.trim();
  return p === '+1' ? '' : p;
}
