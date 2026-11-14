'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken } from './api';

export interface Me {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; defaultCurrency: string; timezone: string; locale: string };
  role: string;
}
type State = { status: 'loading' } | { status: 'setup' } | { status: 'anon' } | { status: 'authed'; me: Me };

interface AuthApi {
  state: State;
  login: (email: string, password: string) => Promise<void>;
  setup: (input: { name: string; email: string; password: string; workspaceName: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const router = useRouter();

  const loadMe = useCallback(async () => setState({ status: 'authed', me: await api<Me>('/auth/me') }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { setupRequired } = await api<{ setupRequired: boolean }>('/auth/status');
        if (cancelled) return;
        if (setupRequired) return setState({ status: 'setup' });
        if (await refreshSession()) await loadMe();
        else if (!cancelled) setState({ status: 'anon' });
      } catch {
        if (!cancelled) setState({ status: 'anon' });
      }
    })();
    return () => { cancelled = true; };
  }, [loadMe]);

  const value = useMemo<AuthApi>(() => ({
    state,
    login: async (email, password) => {
      const r = await api<{ accessToken: string }>('/auth/login', { body: { email, password } });
      setAccessToken(r.accessToken);
      await loadMe();
      router.replace('/dashboard');
    },
    setup: async (input) => {
      const r = await api<{ accessToken: string }>('/auth/setup', { body: input });
      setAccessToken(r.accessToken);
      await loadMe();
      router.replace('/dashboard');
    },
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      setAccessToken(null);
      setState({ status: 'anon' });
      router.replace('/login');
    },
  }), [state, loadMe, router]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'authed') throw new Error('useMe outside an authenticated route');
  return state.me;
}
