import type { Action, OrbitNode, Profile, Snapshot } from './types';

export const clone = <T>(value: T): T => structuredClone(value);
export const uid = (): string => crypto.randomUUID();
export const children = (profile: Profile, parent: string | null): OrbitNode[] => profile.nodes.filter(n => n.parentId === parent);

export function descendants(profile: Profile, id: string): Set<string> {
  const adjacency = new Map<string | null, string[]>();
  for (const n of profile.nodes) {
    const siblings = adjacency.get(n.parentId) ?? [];
    siblings.push(n.id); adjacency.set(n.parentId, siblings);
  }
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (found.has(current)) continue;
    found.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return found;
}

export function validateProfile(profile: Profile): void {
  if (!profile.name.trim() || profile.name.length > 120) throw new Error('Profile needs a name (max 120 characters).');
  const nodes = new Map<string, OrbitNode>();
  for (const node of profile.nodes) {
    if (!node.id || nodes.has(node.id)) throw new Error('Duplicate node ID.');
    if (!node.label.trim() || node.label.length > 160) throw new Error('Node needs a label (max 160 characters).');
    nodes.set(node.id, node);
    const action = node.action;
    if (action.kind === 'application' || action.kind === 'command') {
      if (!action.executable.trim()) throw new Error('Choose an executable.');
      if (!Array.isArray(action.args) || action.args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('Arguments must be a JSON array of strings.');
    } else if (action.kind === 'file' || action.kind === 'folder') {
      if (!action.path.trim()) throw new Error('Choose a path.');
    } else if (action.kind === 'url') {
      const url = new URL(action.url);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('Use http, https, or mailto.');
    }
  }
  const done = new Set<string>();
  for (const node of profile.nodes) {
    const chain = new Set<string>();
    let current: OrbitNode | undefined = node;
    while (current) {
      if (done.has(current.id)) break;
      if (chain.has(current.id)) throw new Error('Menus cannot contain cycles.');
      chain.add(current.id);
      if (current.parentId === null) break;
      const parent: OrbitNode | undefined = nodes.get(current.parentId);
      if (!parent || parent.action.kind !== 'submenu') throw new Error('Parent must be an existing submenu.');
      current = parent;
    }
    for (const id of chain) done.add(id);
  }
}

export function moveNode(profile: Profile, id: string, parentId: string | null, beforeId?: string): void {
  const node = profile.nodes.find(n => n.id === id);
  if (!node) throw new Error('Node no longer exists.');
  if (parentId !== null && descendants(profile, id).has(parentId)) throw new Error('Cannot move a menu into itself or its descendants.');
  if (parentId !== null && profile.nodes.find(n => n.id === parentId)?.action.kind !== 'submenu') throw new Error('Parent must be a submenu.');
  if (beforeId === id) return;
  profile.nodes = profile.nodes.filter(n => n.id !== id);
  node.parentId = parentId;
  const before = beforeId ? profile.nodes.findIndex(n => n.id === beforeId && n.parentId === parentId) : -1;
  if (before >= 0) profile.nodes.splice(before, 0, node); else profile.nodes.push(node);
  validateProfile(profile);
}

export function duplicateSubtree(profile: Profile, id: string): string {
  const subtree = descendants(profile, id);
  const copied = profile.nodes.filter(n => subtree.has(n.id));
  if (!copied.length) throw new Error('Node no longer exists.');
  const ids = new Map(copied.map(n => [n.id, uid()]));
  const copies = copied.map(node => {
    const n = clone(node); n.id = ids.get(n.id)!;
    if (n.parentId && ids.has(n.parentId)) n.parentId = ids.get(n.parentId)!;
    if (node.id === id) n.label += ' copy';
    return n;
  });
  const index = profile.nodes.findIndex(n => n.id === id) + 1;
  profile.nodes.splice(index, 0, ...copies);
  return ids.get(id)!;
}

export function duplicateProfile(profile: Profile, name: string): Profile {
  const copy = clone(profile); copy.id = uid(); copy.name = name;
  const ids = new Map(copy.nodes.map(n => [n.id, uid()]));
  for (const n of copy.nodes) { n.id = ids.get(n.id)!; if (n.parentId) n.parentId = ids.get(n.parentId)!; }
  return copy;
}

export function defaultAction(kind: Action['kind']): Action {
  switch (kind) {
    case 'application': case 'command': return { kind, executable: 'notepad.exe', args: [], workingDirectory: null };
    case 'file': return { kind, path: '%USERPROFILE%\\Desktop\\example.txt' };
    case 'folder': return { kind, path: '%USERPROFILE%\\Documents' };
    case 'url': return { kind, url: 'https://example.com' };
    case 'system': return { kind, action: 'explorer' };
    case 'submenu': return { kind };
  }
}

export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  current: Snapshot;
  constructor(initial: Snapshot) { this.current = clone(initial); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  change(edit: (snapshot: Snapshot) => void): void {
    const next = clone(this.current); edit(next);
    for (const p of next.profiles) validateProfile(p);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    if (this.past.length > 60) this.past.shift();
    this.current = next; this.future = [];
  }
  undo(): void { const old = this.past.pop(); if (old) { this.future.push(this.current); this.current = old; } }
  redo(): void { const next = this.future.pop(); if (next) { this.past.push(this.current); this.current = next; } }
  reset(snapshot: Snapshot): void { this.current = clone(snapshot); this.past = []; this.future = []; }
}
