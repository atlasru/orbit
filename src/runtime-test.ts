import { listen } from '@tauri-apps/api/event';
import { call } from './ipc';
import { query, errorText } from './dom';
import type { Radial } from './launcher';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 70));
async function observe(name: string, test: () => Promise<unknown>): Promise<void> {
  try { const result = await test(); await call('smoke_observation', { name, value: { ok: true, result } }); }
  catch (error) { await call('smoke_observation', { name, value: { ok: false, error: errorText(error) } }); }
}
function key(value: string): void { window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }
function fill(name: string, value: string): void {
  const element = query<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(document, `[name="${name}"]`);
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
async function click(selector: string): Promise<void> { query<HTMLElement>(document, selector).click(); await tick(); }

export async function installLauncherSmoke(radial: Radial): Promise<void> {
  await listen<string>('smoke-request', e => {
    void observe(`ui-${e.payload}`, async () => {
      if (e.payload === 'navigation') {
        check(document.querySelectorAll('.radial-node').length === 8, 'First ring must contain 8 nodes');
        const initial = radial.selection;
        key('ArrowDown'); check(radial.selection !== initial, 'Directional arrow must change selection');
        key('Home'); key('Enter');
        check(document.querySelector('.radial-title')?.textContent === 'Nested', 'Enter must open submenu');
        key('Enter');
        check(document.querySelector('.radial-title')?.textContent === 'Deep', 'Nested submenu must open');
        await radial.activate();
        key('Backspace'); key('Backspace'); key('PageDown');
        check(document.querySelectorAll('.radial-node').length === 2, 'Second page must contain remaining 2 nodes');
        key('Home');
        return { keyboard: true, nested: true, pages: true, actionInvoked: true };
      }
      if (e.payload === 'preview') {
        key('Home'); key('Enter'); key('Enter'); await radial.activate();
        check(document.querySelector('.radial-notice')?.textContent?.includes('disabled'), 'Preview must suppress action');
        let blocked = false;
        const b = await call('get_bootstrap', {});
        const executable = b.snapshot.profiles[0].nodes.find(n => n.action.kind === 'application')!;
        try { await call('execute_node', { profileId: b.snapshot.activeProfileId, nodeId: executable.id }); }
        catch (error) { blocked = errorText(error).includes('Preview never executes'); }
        check(blocked, 'Rust must independently reject preview execution');
        return { frontendBlocked: true, backendBlocked: true };
      }
      throw new Error(`Unknown smoke request ${e.payload}`);
    });
  });
}

export async function installEditorSmoke(): Promise<void> {
  await listen<string>('smoke-editor-request', () => {
    void observe('ui-editor', async () => {
      const initial = await call('get_bootstrap', {});
      const fixture = initial.snapshot.profiles[0].nodes.find(n => n.action.kind === 'application')!;
      check(fixture.action.kind === 'application', 'Missing action fixture');
      await click('[data-profile="create"]');
      fill('value', 'Work'); query<HTMLFormElement>(document, '.modal').requestSubmit(); await tick();
      await click('[data-add]');
      fill('label', 'Edited fixture'); fill('kind', 'application');
      fill('executable', fixture.action.executable);
      fill('args', JSON.stringify(['--action-fixture', `${initial.status.dataDirectory}\\editor fixture.txt`, 'edited & literal']));
      fill('workingDirectory', initial.status.dataDirectory);
      query<HTMLFormElement>(document, '#node-form').requestSubmit(); await tick();
      await click('[data-undo]');
      check(document.querySelector('[data-tree].selected .tree-label')?.textContent === 'New node', 'Undo must restore original node');
      await click('[data-redo]');
      check(document.querySelector('[data-tree].selected .tree-label')?.textContent === 'Edited fixture', 'Redo must restore edited node');
      await click('[data-save]');
      for (let i = 0; i < 30; i++) {
        const b = await call('get_bootstrap', {});
        if (b.snapshot.profiles.length === 2) break;
        await tick();
      }
      await click('[data-activate]');
      let saved = await call('get_bootstrap', {});
      for (let i = 0; i < 30 && saved.snapshot.activeProfileId === initial.snapshot.activeProfileId; i++) { await tick(); saved = await call('get_bootstrap', {}); }
      const work = saved.snapshot.profiles.find(p => p.name === 'Work');
      check(work && work.nodes[0]?.label === 'Edited fixture', 'Editor changes must persist through Rust IPC');
      check(work.id === saved.snapshot.activeProfileId, 'Profile activation must persist without restart');
      check(work.nodes[0].action.kind === 'application', 'Node type change must persist');
      return { createProfile: true, editNode: true, changeType: true, undo: true, redo: true, save: true, switchProfile: true };
    });
  });
  await call('smoke_observation', { name: 'editor-ready', value: { ok: true } });
}
