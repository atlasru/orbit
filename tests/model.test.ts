import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { clone, descendants, duplicateProfile, duplicateSubtree, History, moveNode, validateProfile } from '../src/model';
import { directionalIndex, pageItems, ringPoints } from '../src/navigation';
import { esc } from '../src/dom';
import type { Snapshot } from '../src/types';
const fixture: Snapshot = JSON.parse(readFileSync('tests/fixtures/contract.json', 'utf8'));

test('Rust/TypeScript contract covers every action, icon and camelCase path', () => {
  validateProfile(fixture.profiles[0]);
  assert.deepEqual(fixture.profiles[0].nodes.map(n => n.action.kind), ['application', 'file', 'folder', 'url', 'command', 'submenu', 'system']);
  const app = fixture.profiles[0].nodes[0].action;
  assert.equal(app.kind, 'application');
  if (app.kind === 'application') { assert.equal(app.workingDirectory, 'C:\\Work'); assert.deepEqual(app.args, ['--profile', 'one argument', 'literal & value']); }
});
test('moves preserve descendants and reject cycles without changing source snapshot', () => {
  const p = clone(fixture.profiles[0]);
  moveNode(p, 'n0', 'n5'); assert.equal(p.nodes.find(n => n.id === 'n0')!.parentId, 'n5');
  assert.deepEqual([...descendants(p, 'n5')].sort(), ['n0', 'n5', 'n6']);
  assert.throws(() => moveNode(p, 'n5', 'n5'), /descendants/);
  assert.equal(fixture.profiles[0].nodes[0].parentId, null);
});
test('reordering changes ring order while preserving child relationships', () => {
  const p = clone(fixture.profiles[0]); moveNode(p, 'n4', null, 'n0');
  assert.equal(p.nodes[0].id, 'n4'); assert.equal(p.nodes.find(n => n.id === 'n6')!.parentId, 'n5');
});
test('subtree duplication remaps all IDs and internal parents', () => {
  const p = clone(fixture.profiles[0]); const id = duplicateSubtree(p, 'n5');
  assert.equal(p.nodes.length, 9); assert.equal(descendants(p, id).size, 2); validateProfile(p);
  const all = p.nodes.map(n => n.id); assert.equal(new Set(all).size, all.length);
});
test('profile duplication has independent IDs and mutable content', () => {
  const p = duplicateProfile(fixture.profiles[0], 'Work');
  assert.notEqual(p.id, fixture.profiles[0].id); assert.equal(p.name, 'Work'); validateProfile(p);
  p.nodes[0].label = 'Changed'; assert.equal(fixture.profiles[0].nodes[0].label, 'application');
});
test('Undo/Redo preserves complete edits and invalidates redo after new edit', () => {
  const h = new History(fixture);
  h.change(s => { s.profiles[0].name = 'Work'; });
  h.undo(); assert.equal(h.current.profiles[0].name, 'Default');
  h.redo(); assert.equal(h.current.profiles[0].name, 'Work');
  h.undo(); h.change(s => { s.profiles[0].name = 'Gaming'; }); assert.equal(h.canRedo, false);
});
test('invalid edits never enter history', () => {
  const h = new History(fixture);
  assert.throws(() => h.change(s => { s.profiles[0].nodes[5].parentId = 'n5'; }), /cycles/);
  assert.equal(h.canUndo, false); assert.deepEqual(h.current, fixture);
});
test('iterative traversal supports 5000 nested submenus', () => {
  const p = clone(fixture.profiles[0]);
  p.nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `node-${i}`, parentId: i ? `node-${i - 1}` : null, label: 'Menu', icon: { kind: 'auto' }, action: { kind: 'submenu' } }));
  validateProfile(p); assert.equal(descendants(p, 'node-0').size, 5000);
});
test('each page contains at most 8 nodes and preserves every item', () => {
  const nodes = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual([pageItems(nodes, 0), pageItems(nodes, 1), pageItems(nodes, 2)].flat(), nodes);
  assert.equal(pageItems(nodes, 2).length, 7);
});
test('directional navigation follows the ring at cardinal positions', () => {
  assert.equal(directionalIndex(0, 'ArrowDown', 8), 4);
  assert.equal(directionalIndex(4, 'ArrowUp', 8), 0);
  assert.equal(directionalIndex(6, 'ArrowRight', 8), 2);
  assert.equal(directionalIndex(2, 'ArrowLeft', 8), 6);
  assert.equal(directionalIndex(0, 'ArrowRight', 1), 0);
});
test('ring coordinates remain deterministic for 1 through 8 nodes', () => {
  for (let count = 1; count <= 8; count++) {
    const points = ringPoints(count); assert.equal(points.length, count);
    for (const p of points) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 166) < 1e-8);
  }
});
test('profile names and labels are escaped before HTML insertion', () => {
  assert.equal(esc('<img src=x onerror="evil()">'), '&lt;img src=x onerror=&quot;evil()&quot;&gt;');
});
