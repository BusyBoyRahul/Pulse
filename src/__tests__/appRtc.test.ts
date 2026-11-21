/**
 * The real app wiring: the WebRTC handed to the call engine must be able to make a call peer and open the microphone/camera.
 * (The call tests use a fake WebRTC that always has these, so they could not notice when the app's own wiring left them out.)
 */
const mockEngine = {
  createPeer: jest.fn(() => 'peer'),
  createCallPeer: jest.fn(() => 'callPeer'),
  getMedia: jest.fn(async (video: boolean) => ({video})),
};
jest.mock('@/net/reactNativeRtc', () => ({createReactNativeRtc: () => mockEngine}));

import {appRtc} from '@/net/internet';

describe('the app’s WebRTC wiring', () => {
  it('offers links, call peers and media, each passed on to the real engine', async () => {
    expect(typeof appRtc.createPeer).toBe('function');
    expect(typeof appRtc.createCallPeer).toBe('function');
    expect(typeof appRtc.getMedia).toBe('function');

    expect(appRtc.createPeer([])).toBe('peer');
    expect(appRtc.createCallPeer?.([{urls: 'stun:x'}])).toBe('callPeer');
    expect(mockEngine.createCallPeer).toHaveBeenCalledWith([{urls: 'stun:x'}]);
    await expect(appRtc.getMedia?.(true)).resolves.toEqual({video: true});
    expect(mockEngine.getMedia).toHaveBeenCalledWith(true);
  });
});
