import axios, {AxiosInstance, AxiosError} from 'axios';
import config from '@/config';
import {storage, StorageKeys} from './storage';

/**
 * Thin, typed HTTP client for the Pulse backend. Injects the JWT on every
 * request and normalizes error messages so screens can show something useful.
 */
class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 15000,
    });

    this.client.interceptors.request.use(cfg => {
      const token = storage.getString(StorageKeys.jwt);
      if (token) {
        cfg.headers.Authorization = `Bearer ${token}`;
      }
      return cfg;
    });
  }

  private toError(err: unknown): Error {
    const ax = err as AxiosError<{error?: string}>;
    if (ax.response?.data?.error) {
      return new Error(ax.response.data.error);
    }
    if (ax.code === 'ECONNABORTED') {
      return new Error('Request timed out. Check your connection.');
    }
    if (ax.message === 'Network Error') {
      return new Error('No connection to Pulse servers.');
    }
    return new Error(ax.message || 'Something went wrong.');
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      const res = await this.client.post<T>(path, body);
      return res.data;
    } catch (err) {
      throw this.toError(err);
    }
  }

  async get<T>(path: string): Promise<T> {
    try {
      const res = await this.client.get<T>(path);
      return res.data;
    } catch (err) {
      throw this.toError(err);
    }
  }

  async delete<T>(path: string): Promise<T> {
    try {
      const res = await this.client.delete<T>(path);
      return res.data;
    } catch (err) {
      throw this.toError(err);
    }
  }
}

export const api = new ApiService();
export default api;
