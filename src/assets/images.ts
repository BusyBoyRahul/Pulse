/**
 * Photographs bundled inside the app (so they work with no internet). All are
 * free-to-use Unsplash photos — see docs/IMAGE_CREDITS.md.
 */
export const photos = {
  night: require('./photos/night.jpg'),
  city: require('./photos/city.jpg'),
  lake: require('./photos/lake.jpg'),
  sunset: require('./photos/sunset.jpg'),
  alpine: require('./photos/alpine.jpg'),
  beach: require('./photos/beach.jpg'),
  fog: require('./photos/fog.jpg'),
  earth: require('./photos/earth.jpg'),
  dusk: require('./photos/dusk.jpg'),
  wave: require('./photos/wave.jpg'),
  forest: require('./photos/forest.jpg'),
  tree: require('./photos/tree.jpg'),
  hills: require('./photos/hills.jpg'),
  road: require('./photos/road.jpg'),
  neon: require('./photos/neon.jpg'),
  reflect: require('./photos/reflect.jpg'),
} as const;

export type PhotoKey = keyof typeof photos;

export const PHOTO_KEYS = Object.keys(photos) as PhotoKey[];

/** Backgrounds people can pick for a status / story. */
export const STATUS_BACKGROUNDS: PhotoKey[] = ['sunset', 'alpine', 'beach', 'fog', 'earth', 'dusk', 'neon', 'reflect'];

/** Chat wallpapers (shown dimmed behind messages). */
export const WALLPAPER_PHOTOS: PhotoKey[] = ['wave', 'forest', 'tree', 'hills', 'road', 'night', 'lake', 'city'];

/** Stable photo for an id (used for generated covers). */
export function photoFor(seed: string, from: PhotoKey[] = PHOTO_KEYS): PhotoKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return from[Math.abs(h) % from.length];
}
