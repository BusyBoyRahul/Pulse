import Geolocation from 'react-native-geolocation-service';

export type Fix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

/**
 * GPS access. Works fully offline — a satellite fix needs no internet. We ask
 * for high accuracy but fall back fast so an SOS is never blocked waiting for a
 * perfect fix.
 */
export const locationService = {
  getCurrent(timeoutMs = 8000): Promise<Fix> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        pos =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
            timestamp: pos.timestamp,
          }),
        err => reject(new Error(err.message || 'Could not get location.')),
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 10000, // accept a recent cached fix to stay fast
        },
      );
    });
  },

  /** Best-effort fix that never rejects — returns null instead of throwing. */
  async tryGetCurrent(timeoutMs = 8000): Promise<Fix | null> {
    try {
      return await this.getCurrent(timeoutMs);
    } catch {
      return null;
    }
  },
};

export default locationService;
