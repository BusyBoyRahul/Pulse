import React, {useSyncExternalStore} from 'react';

/**
 * Live theme switching.
 *
 * Every screen describes its look in a StyleSheet that reads the theme colours. Those used to be built once, when the
 * screen was first loaded, which is why changing the theme meant restarting the app. `themedStyles` builds the same
 * StyleSheet but remembers which theme it was made for: after the theme changes (`bumpTheme`) the next read rebuilds it
 * with the new colours. The app then re-renders itself in place (see Boot), so the new look appears at once, on the same
 * screen, with nothing reloaded.
 */
let version = 0;
const listeners = new Set<() => void>();

/** Changes every time the theme does. */
export const themeVersion = (): number => version;

/** Be told when the theme changed (the app root uses this to repaint). Returns a function that stops listening. */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The theme colours were just rewritten: every themed StyleSheet is stale, and everyone listening should repaint. */
export function bumpTheme(): void {
  version++;
  listeners.forEach(l => l());
}

/**
 * A StyleSheet that follows the theme. Use exactly like `StyleSheet.create`, wrapped:
 *   const styles = themedStyles(() => StyleSheet.create({...}));
 * `styles.name` always gives the style for the current theme.
 */
export function themedStyles<T extends object>(make: () => T): T {
  let cache = make();
  let at = version;
  const current = (): Record<string, unknown> => {
    if (at !== version) {
      cache = make();
      at = version;
    }
    return cache as Record<string, unknown>;
  };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cache)) {
    Object.defineProperty(out, key, {enumerable: true, get: () => current()[key]});
  }
  return out as T;
}

/** Re-draws the component that calls it whenever the theme changes (its state is kept: nothing is reloaded). */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribeTheme, themeVersion, themeVersion);
}

const wrapped = new WeakMap<object, React.ComponentType<any>>();

/**
 * A screen (or any component) that repaints itself when the theme changes. The same component is returned every time it
 * is asked for, so the navigator never mounts a second copy. Its screens keep their scroll position, typed text and
 * everything else; only the colours change.
 */
export function themed<P extends object>(C: React.ComponentType<P>): React.ComponentType<P> {
  const hit = wrapped.get(C);
  if (hit) {
    return hit as React.ComponentType<P>;
  }
  const Themed = (props: P) => {
    useThemeVersion();
    return React.createElement(C as React.ComponentType<any>, props);
  };
  Themed.displayName = 'Themed(' + (C.displayName || C.name || 'Screen') + ')';
  wrapped.set(C, Themed);
  return Themed;
}
