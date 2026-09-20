import { invoke, isTauri } from '@tauri-apps/api/core';
import './style.css';

type Action = 'files' | 'browser' | 'settings' | 'terminal';
const nodes: { label: string; icon: string; action: Action }[] = [
  { label: 'Файлы', icon: '📁', action: 'files' },
  { label: 'Браузер', icon: '🌐', action: 'browser' },
  { label: 'Настройки', icon: '⚙', action: 'settings' },
  { label: 'Терминал', icon: '⌘', action: 'terminal' },
];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <main class="orbit" aria-label="Orbit launcher">
    <div class="hub" aria-label="Orbit">◌</div>
    ${nodes.map((node, index) => `<button class="node" type="button" style="--i:${index}" data-action="${node.action}" aria-label="${node.label}"><span>${node.icon}</span><small>${node.label}</small></button>`).join('')}
  </main>
  <p class="hint">Escape — закрыть · Alt + Space — открыть</p>
  <p class="notice" role="status" aria-live="polite"></p>
`;

const notice = app.querySelector<HTMLElement>('.notice');
function report(message: string): void {
  if (notice) notice.textContent = message;
}

if (!isTauri()) {
  report('Это только браузерный предпросмотр. Для запуска действий используйте npm run tauri dev.');
}

app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!isTauri()) {
      report('Действия доступны только в приложении Orbit, не на localhost в браузере.');
      return;
    }
    try {
      await invoke('run_action', { action: button.dataset.action });
      report('');
    } catch (error) {
      report(`Ошибка запуска: ${String(error)}`);
      console.error('Orbit action failed:', error);
    }
  });
});

window.addEventListener('keydown', async (event) => {
  if (event.key !== 'Escape' || !isTauri()) return;
  try {
    await invoke('hide_launcher');
  } catch (error) {
    report(`Ошибка закрытия: ${String(error)}`);
  }
});
