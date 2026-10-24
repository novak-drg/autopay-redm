import { api } from './api';

export interface AuthUser { id: number; username: string; role: string; }

export const authService = {
  async login(username: string, password: string): Promise<AuthUser> {
    return api.post<AuthUser>('/v1/admin/auth/login', { username, password });
  },

  async logout(): Promise<void> {
    await api.post('/v1/admin/auth/logout', {}).catch(() => null);
    window.location.href = '/login';
  },

  async me(): Promise<AuthUser> {
    return api.get<AuthUser>('/v1/admin/auth/me');
  },
};
