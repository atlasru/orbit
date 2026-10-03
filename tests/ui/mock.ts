import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
export async function desktop(page: Page): Promise<void> {
  const snapshot = JSON.parse(readFileSync('tests/fixtures/contract.json', 'utf8'));
  await page.addInitScript(snapshot => {
    const w = window as unknown as Record<string, any>;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number[]>();
    let next = 1;
    w.__calls = [];
    w.__snapshot = snapshot;
    const bootstrap = () => ({ snapshot: structuredClone(w.__snapshot), status: { requestedShortcut: 'Alt+Space', registeredShortcut: 'Alt+Space', shortcutError: null, warnings: [], dataDirectory: 'C:\\Orbit', frontendReady: true, smoke: false } });
    w.__emit = (name: string, payload: unknown) => { for (const id of listeners.get(name) ?? []) callbacks.get(id)?.({ event: name, payload, id }); };
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      metadata: { currentWindow: { label: location.search.includes('editor') ? 'editor' : 'launcher' } },
      invoke: async (command: string, args: any) => {
        w.__calls.push({ command, args });
        if (command === 'plugin:event|listen') { const ids = listeners.get(args.event) ?? []; ids.push(args.handler); listeners.set(args.event, ids); return args.handler; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'get_bootstrap') return bootstrap();
        if (command === 'resolve_icons') return {};
        if (command === 'save_snapshot') { w.__snapshot = structuredClone(args.snapshot); w.__snapshot.revision++; w.__emit('config-changed', bootstrap()); return bootstrap(); }
        if (command === 'pick_path') return args.folder ? 'C:\\Test Folder' : 'C:\\Test App\\app.exe';
        if (command === 'pick_icon') return { kind: 'custom', file: 'picked.png' };
        if (command === 'import_profile') return { schemaVersion: 1, id: 'imported', name: '<Imported>', trusted: false, nodes: [{ id: 'imported-node', parentId: null, label: 'Imported app', icon: { kind: 'auto' }, action: { kind: 'command', executable: 'test.exe', args: [], workingDirectory: null } }] };
        if (command === 'export_profile') return 'C:\\profile.json';
        if (command === 'smoke_observation') throw new Error('Test diagnostics disabled');
      },
    };
  }, snapshot);
}
