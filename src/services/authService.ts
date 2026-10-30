import api from './apiService';
import {getIdentity} from './identity';

/** Server responses for the auth flow. */
type RequestOtpResponse = {ok: boolean; devMode: boolean};
type VerifyOtpResponse = {
  token: string;
  user: {id: number; phone: string; displayName: string | null};
};

export const authService = {
  requestOtp(phone: string) {
    return api.post<RequestOtpResponse>('/auth/request-otp', {phone});
  },

  verifyOtp(phone: string, code: string, displayName?: string) {
    return api.post<VerifyOtpResponse>('/auth/verify-otp', {
      phone,
      code,
      displayName,
      meshPublicKey: getIdentity().publicKey,
    });
  },

  registerPushToken(token: string, platform: 'android' | 'ios' | 'web') {
    return api.post<{ok: boolean}>('/auth/push-token', {token, platform});
  },
};

export default authService;
