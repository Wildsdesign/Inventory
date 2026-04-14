import { createContext, useContext, useState, ReactNode } from 'react';

export interface User {
  id: string;
  email: string | null;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'STAFF';
  facilityId: string;
  facilityName: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  demoMode: boolean;
  login: (pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Pre-OIDC: auth is bypassed. Server accepts all requests with demo-facility defaults.
  const DEFAULT_USER: User = {
    id: 'demo-user',
    email: null,
    name: 'Inventory User',
    role: 'ADMIN',
    facilityId: 'demo-facility',
    facilityName: 'General Hospital — Cafeteria',
  };

  const [user] = useState<User | null>(DEFAULT_USER);
  const [loading] = useState(false);
  const [demoMode] = useState(true);

  const login = async (_pin: string) => { /* bypassed */ };
  const logout = () => { /* bypassed */ };

  return (
    <AuthContext.Provider value={{ user, loading, demoMode, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
