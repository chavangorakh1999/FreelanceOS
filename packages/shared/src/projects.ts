/**
 * Project progress — ONE authoritative method (PRD §7.8, App. B #19):
 *
 *   progress = completed tasks ÷ (all tasks except cancelled ones)
 *
 * Milestones are delivery checkpoints with their own status and are never added into the percentage, so work
 * can't be counted twice. A project with no countable tasks reports 0%, not 100%.
 * The result is in basis points (10000 = 100%) so no float ever reaches storage or an API.
 */
export interface ProgressTask { status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' }
export interface Progress { done: number; total: number; basisPoints: number }

export function progressOf(tasks: readonly ProgressTask[]): Progress {
  const counted = tasks.filter((t) => t.status !== 'CANCELLED');
  const done = counted.filter((t) => t.status === 'DONE').length;
  return { done, total: counted.length, basisPoints: counted.length === 0 ? 0 : Math.floor((done * 10000) / counted.length) };
}

export interface Edge { taskId: string; dependsOnTaskId: string }

/**
 * If adding `taskId → dependsOnTaskId` would create a cycle, returns the cycle as a list of task ids
 * (starting and ending on `taskId`); otherwise null. Self-dependencies are cycles of length one.
 */
export function findDependencyCycle(existing: readonly Edge[], add: Edge): string[] | null {
  if (add.taskId === add.dependsOnTaskId) return [add.taskId, add.taskId];
  const next = new Map<string, string[]>();
  for (const e of [...existing, add]) next.set(e.taskId, [...(next.get(e.taskId) ?? []), e.dependsOnTaskId]);
  // Is `taskId` reachable by following dependencies from `dependsOnTaskId`?
  const seen = new Set<string>();
  const walk = (node: string, path: string[]): string[] | null => {
    if (node === add.taskId) return [add.taskId, ...path];
    if (seen.has(node)) return null;
    seen.add(node);
    for (const n of next.get(node) ?? []) { const r = walk(n, [...path, node].slice(0)); if (r) return r; }
    return null;
  };
  const cycle = walk(add.dependsOnTaskId, []);
  return cycle ? [...cycle, add.taskId].filter((v, i, a) => i === 0 || v !== a[i - 1]) : null;
}

/** Tasks that must be DONE before `taskId` may start, given the dependency edges and task statuses. */
export function unmetDependencies(taskId: string, edges: readonly Edge[], statusOf: (id: string) => string | undefined): string[] {
  return edges.filter((e) => e.taskId === taskId).map((e) => e.dependsOnTaskId).filter((id) => {
    const s = statusOf(id);
    return s !== 'DONE' && s !== 'CANCELLED';
  });
}

// ───────── scope comparison ─────────

export interface ScopeItemLike { itemKey: string; kind: string; title: string; description: string }
export interface ScopeDiff {
  added: ScopeItemLike[];
  removed: ScopeItemLike[];
  changed: { before: ScopeItemLike; after: ScopeItemLike }[];
  unchangedCount: number;
}

/** Compare two scope versions by stable item key, so a renamed item is a change, not a delete + add. */
export function diffScope(base: readonly ScopeItemLike[], next: readonly ScopeItemLike[]): ScopeDiff {
  const before = new Map(base.map((i) => [i.itemKey, i]));
  const after = new Map(next.map((i) => [i.itemKey, i]));
  const added = next.filter((i) => !before.has(i.itemKey));
  const removed = base.filter((i) => !after.has(i.itemKey));
  const changed: ScopeDiff['changed'] = [];
  let unchangedCount = 0;
  for (const i of next) {
    const b = before.get(i.itemKey);
    if (!b) continue;
    if (b.kind !== i.kind || b.title !== i.title || b.description !== i.description) changed.push({ before: b, after: i });
    else unchangedCount++;
  }
  return { added, removed, changed, unchangedCount };
}

export const isEmptyDiff = (d: ScopeDiff): boolean => d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
