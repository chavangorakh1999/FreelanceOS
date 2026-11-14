'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { CommentItem } from '@/lib/portal-api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, ErrorNote, Select, Spinner, Textarea } from './ui';

interface Props {
  title?: string;
  queryKey: unknown[];
  load: () => Promise<CommentItem[]>;
  post: (body: string, visibility: 'INTERNAL' | 'CLIENT_VISIBLE') => Promise<unknown>;
  /** Owner view: shows who can read each comment and offers an internal-only option. */
  staff?: boolean;
  /** Owner view only: whether the thing being discussed has been shared with the client. */
  shared?: boolean;
  disabledReason?: string;
}

/** The same conversation for both sides. A client only ever receives CLIENT_VISIBLE entries; the owner chooses per comment. */
export function CommentsPanel({ title = 'Comments', queryKey, load, post, staff, shared = true, disabledReason }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: load });
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'INTERNAL' | 'CLIENT_VISIBLE'>(shared ? 'CLIENT_VISIBLE' : 'INTERNAL');
  const send = useMutation({ mutationFn: () => post(body.trim(), staff ? visibility : 'CLIENT_VISIBLE'), onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey }); } });

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="cm-h">
      <h2 id="cm-h" className="mb-4 flex items-center gap-2 text-lg font-semibold"><MessageSquare size={18} aria-hidden="true" />{title}</h2>
      {q.isLoading ? <Spinner /> : (
        <ul className="mb-5 flex flex-col gap-4">
          {q.data?.length === 0 && <li className="text-muted">No comments yet.</li>}
          {q.data?.map((c) => (
            <li key={c.id} className={`flex flex-col gap-1 rounded-control px-3.5 py-3 ${c.mine ? 'bg-accent-soft/50' : 'bg-stat'}`}>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium text-ink">{c.mine ? 'You' : c.authorName}</span>
                <span className="text-muted">{c.authorKind === 'CLIENT' ? 'client' : 'team'}, {fmtDateTime(c.createdAt)}</span>
                {staff && c.visibility === 'INTERNAL' && <Badge icon={<Lock size={12} aria-hidden="true" />}>Internal</Badge>}
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {disabledReason ? <p className="text-muted">{disabledReason}</p> : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
          <Textarea aria-label="Write a comment" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={staff ? 'Write a comment…' : 'Ask a question or leave a note…'} />
          <ErrorNote error={send.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={send.isPending || !body.trim()}>Post comment</Button>
            {staff && (
              <Select aria-label="Who can see this comment" className="w-56" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                <option value="INTERNAL">Internal, only your team</option>
                <option value="CLIENT_VISIBLE" disabled={!shared}>Visible to the client{shared ? '' : ' (not shared yet)'}</option>
              </Select>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
