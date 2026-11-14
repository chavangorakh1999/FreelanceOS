'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

/** A signer's drawn or uploaded signature, fetched with the session (never a public URL). */
export function SignatureImage({ path, load, name }: { path: string; load: (path: string) => Promise<string>; name: string }) {
  const q = useQuery({ queryKey: ['signature-image', path], queryFn: () => load(path), staleTime: Infinity, gcTime: 60_000 });
  useEffect(() => () => { if (q.data) URL.revokeObjectURL(q.data); }, [q.data]);
  if (!q.data) return <div className="h-12" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={q.data} alt={`Signature of ${name}`} className="h-12 max-w-[220px] object-contain object-left" />;
}
