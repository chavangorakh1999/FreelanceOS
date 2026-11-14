import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setAccessToken } from './api';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); setAccessToken('old-token'); });
  afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });

  it('sends the bearer token and returns parsed JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await api('/clients')).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBe('Bearer old-token');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new-token' })) // /auth/refresh
      .mockResolvedValueOnce(json(200, { items: [] }));
    expect(await api('/clients')).toEqual({ items: [] });
    expect(fetchMock.mock.calls[1]![0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer new-token');
  });

  it('shares one refresh between concurrent 401s', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: { headers: Record<string, string> }) => {
      if (url.includes('/auth/refresh')) { refreshCalls++; await new Promise((r) => setTimeout(r, 10)); return json(200, { accessToken: 'new-token' }); }
      return init.headers.Authorization === 'Bearer new-token' ? json(200, { ok: 1 }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('gives up (and surfaces the 401) when the refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }));
    await expect(api('/clients')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never tries to refresh on a failed login', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }));
    await expect(api('/auth/login', { body: { email: 'a', password: 'b' } })).rejects.toThrow('Email or password is incorrect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes the stable error code and validation details', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'VALIDATION_FAILED', message: 'bad', details: ['name must not be empty'] } }));
    const err = await api('/clients', { body: {} }).catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: ['name must not be empty'] });
  });

  it('handles 204 and drops empty query values', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api('/clients/x/archive', { method: 'POST', query: { q: '', page: 2, status: undefined } })).toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/clients\/x\/archive\?page=2$/);
  });
});
