import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api.get('/auth/me').then((u) => setUser(u ?? null)).catch(() => setUser(null));
  }, []);

  const login = useCallback(async (email, password) => setUser(await api.post('/auth/login', { email, password })), []);
  const signup = useCallback(async (body) => setUser(await api.post('/auth/signup', body)), []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, setUser, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const isTeam = (user) => user?.role === 'admin' || user?.role === 'staff';
