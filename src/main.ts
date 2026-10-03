import { isTauri, call } from './ipc';
import { errorText, esc } from './dom';
import { svg } from './icons';
import { startLauncher } from './launcher';
import { Editor } from './editor';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
async function main(): Promise<void> {
  if (!isTauri()) {
    document.body.dataset.view = 'unavailable';
    root.innerHTML = `<main class="runtime-unavailable">${svg('orbit')}<h1>Orbit is a desktop application.</h1><p>Start Orbit.exe, or run <code>npm run tauri dev</code> during development.</p><p>This page has no desktop runtime. Tray, shortcuts, and actions are unavailable here.</p></main>`;
    return;
  }
  try {
    const bootstrap = await call('get_bootstrap', {});
    if (new URLSearchParams(location.search).has('editor')) { const editor = new Editor(root, bootstrap); await editor.connect(); }
    else await startLauncher(root, bootstrap);
  } catch (error) {
    document.body.dataset.view = 'unavailable';
    root.innerHTML = `<main class="runtime-unavailable">${svg('orbit')}<h1>Orbit could not initialize.</h1><p role="alert">${esc(errorText(error))}</p><button id="retry">Retry</button></main>`;
    root.querySelector<HTMLButtonElement>('#retry')!.onclick = () => { void main(); };
  }
}
void main();
