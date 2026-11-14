'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { papi, PortalMe, refreshPortal, setPortalToken } from './portal-api';

type State = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; me: PortalMe };
interface Api {
  state: State;
  /** Sign in (or accept an invitation) and land on the dashboard. */
  establish: (accessToken: string) => Promise<void>;
  login: (email: string, password: string, membershipId?: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
const Ctx = createContext<Api | null>(null);

export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const router = useRouter();
  const loadMe = useCallback(async () => setState({ status: 'authed', me: await papi<PortalMe>('/portal/auth/me') }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await refreshPortal()) await loadMe();
        else if (!cancelled) setState({ status: 'anon' });
      } catch { if (!cancelled) setState({ status: 'anon' }); }
    })();
    return () => { cancelled = true; };
  }, [loadMe]);

  const value = useMemo<Api>(() => ({
    state,
    establish: async (token) => { setPortalToken(token); await loadMe(); router.replace('/portal'); },
    login: async (email, password, membershipId) => {
      const r = await papi<{ accessToken: string }>('/portal/auth/login', { body: { email, password, ...(membershipId ? { membershipId } : {}) } });
      setPortalToken(r.accessToken); await loadMe(); router.replace('/portal');
    },
    logout: async () => {
      await papi('/portal/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
      setPortalToken(null); setState({ status: 'anon' }); router.replace('/portal/login');
    },
    reload: loadMe,
  }), [state, loadMe, router]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalAuth(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePortalAuth outside PortalAuthProvider');
  return v;
}
export function usePortalMe(): PortalMe {
  const { state } = usePortalAuth();
  if (state.status !== 'authed') throw new Error('usePortalMe outside an authenticated portal route');
  return state.me;
}
