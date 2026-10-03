import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(process.argv[2]);
const exe = resolve(process.argv[3]);
mkdirSync(join(root, 'profiles'), { recursive: true });
const node = (id, parentId, label, action) => ({ id, parentId, label, icon: { kind: 'auto' }, action });
const profile = { schemaVersion: 1, id: 'smoke-default', name: 'Default', trusted: true, nodes: [
  node('menu', null, 'Nested', { kind: 'submenu' }), node('deep', 'menu', 'Deep', { kind: 'submenu' }),
  node('fixture', 'deep', 'Fixture', { kind: 'application', executable: exe, args: ['--action-fixture', join(root, 'action fixture.txt'), 'literal & | ^ % hello "quote" Привет'], workingDirectory: root }),
  ...Array.from({ length: 9 }, (_, i) => node(`placeholder-${i}`, null, `Menu ${i + 1}`, { kind: 'submenu' })),
] };
const settings = { shortcut: 'Alt+Space', launchAtStartup: false, trayClick: 'launcher', closeAfterAction: false, closeDelayMs: 0, closeOnBlur: false, language: 'en', opacity: .9, blur: false, accent: '#a89cfa', animations: false, reducedMotion: true, showLabels: true, launcherScale: 1, monitor: 'foreground', keyboard: 'directional' };
writeFileSync(join(root, 'profiles', 'fixture.json'), JSON.stringify(profile));
writeFileSync(join(root, 'config.json'), JSON.stringify({ schemaVersion: 2, revision: 1, settings, activeProfileId: profile.id, profiles: [{ id: profile.id, file: 'fixture.json' }] }));
