import { describe, expect, it } from 'vitest';
import { diffScope, findDependencyCycle, isEmptyDiff, progressOf, unmetDependencies } from './projects';

const t = (status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED') => ({ status });

describe('progressOf — the single progress method', () => {
  it('is done ÷ countable tasks, in basis points', () => {
    expect(progressOf([t('DONE'), t('DONE'), t('TODO'), t('IN_PROGRESS')])).toEqual({ done: 2, total: 4, basisPoints: 5000 });
    expect(progressOf([t('DONE'), t('TODO'), t('TODO')])).toEqual({ done: 1, total: 3, basisPoints: 3333 }); // rounds down, never overstates
  });
  it('ignores cancelled tasks entirely', () => {
    expect(progressOf([t('DONE'), t('CANCELLED'), t('CANCELLED')])).toEqual({ done: 1, total: 1, basisPoints: 10000 });
  });
  it('reports 0% (not 100%) when there is nothing to count', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, basisPoints: 0 });
    expect(progressOf([t('CANCELLED')])).toEqual({ done: 0, total: 0, basisPoints: 0 });
  });
});

describe('findDependencyCycle', () => {
  const edges = [{ taskId: 'B', dependsOnTaskId: 'A' }, { taskId: 'C', dependsOnTaskId: 'B' }];
  it('accepts a dependency that keeps the graph acyclic', () => {
    expect(findDependencyCycle(edges, { taskId: 'D', dependsOnTaskId: 'C' })).toBeNull();
    expect(findDependencyCycle(edges, { taskId: 'C', dependsOnTaskId: 'A' })).toBeNull(); // diamond, not a cycle
  });
  it('rejects self-dependency, direct and transitive cycles', () => {
    expect(findDependencyCycle(edges, { taskId: 'A', dependsOnTaskId: 'A' })).not.toBeNull();
    expect(findDependencyCycle(edges, { taskId: 'A', dependsOnTaskId: 'B' })).not.toBeNull();
    const c = findDependencyCycle(edges, { taskId: 'A', dependsOnTaskId: 'C' });
    expect(c).not.toBeNull();
    expect(c![0]).toBe('A');
    expect(c![c!.length - 1]).toBe('A');
  });
  it('lists unmet dependencies, treating cancelled work as not blocking', () => {
    const status = (id: string) => ({ A: 'DONE', B: 'TODO', X: 'CANCELLED' } as Record<string, string>)[id];
    expect(unmetDependencies('C', [{ taskId: 'C', dependsOnTaskId: 'A' }, { taskId: 'C', dependsOnTaskId: 'B' }, { taskId: 'C', dependsOnTaskId: 'X' }], status)).toEqual(['B']);
  });
});

describe('diffScope', () => {
  const i = (itemKey: string, title: string, description = '', kind = 'FEATURE') => ({ itemKey, kind, title, description });
  const base = [i('1', 'Login'), i('2', 'Reports'), i('3', 'Export', 'CSV only')];
  it('reports added, removed and changed items by stable key', () => {
    const next = [i('1', 'Login'), i('3', 'Export', 'CSV and PDF'), i('4', 'Refund workflow')];
    const d = diffScope(base, next);
    expect(d.added.map((x) => x.title)).toEqual(['Refund workflow']);
    expect(d.removed.map((x) => x.title)).toEqual(['Reports']);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.before.description).toBe('CSV only');
    expect(d.unchangedCount).toBe(1);
  });
  it('treats a rename as a change, not a delete plus add', () => {
    const d = diffScope(base, [i('1', 'Sign-in'), i('2', 'Reports'), i('3', 'Export', 'CSV only')]);
    expect(d.changed).toHaveLength(1);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });
  it('is empty for identical scope', () => {
    expect(isEmptyDiff(diffScope(base, [...base]))).toBe(true);
  });
});
