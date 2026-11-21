/**
 * Start-up hand-over. Pulse shows ONE blue screen with the logo from the first frame; when the first real screen has been
 * drawn underneath, the app calls `launchReady()` and the blue screen fades away. (It used to be drawn three times by
 * three different pieces of code, which is why the logo seemed to appear twice.)
 */
let ready = false;
const listeners = new Set<() => void>();

export const isLaunchReady = (): boolean => ready;

export function launchReady(): void {
  if (ready) {
    return;
  }
  ready = true;
  listeners.forEach(l => l());
}

export function onLaunchReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
