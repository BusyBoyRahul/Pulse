/**
 * Tiny flag shared by the app lock and the things that briefly send Pulse to the
 * background on purpose (file picker, camera, "save as", fingerprint prompt,
 * permission dialogs). Coming back from one of those must not count as "left the
 * app", or the lock would trigger every time you attach a photo.
 */
let external = false;

export function markExternal(): void {
  external = true;
}

/** True once if an external screen was just opened; then resets. */
export function consumeExternal(): boolean {
  const was = external;
  external = false;
  return was;
}
