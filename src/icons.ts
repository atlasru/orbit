import type { Action, Icon } from './types';
const paths: Record<string, string> = {
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M20 10a8 8 0 1 1-4-5"/><circle cx="18.5" cy="5.5" r="1.5"/>',
  app: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 8h18M7 5.5h.01M10 5.5h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  command: '<path d="m5 6 6 6-6 6M13 18h6"/>',
  terminal: '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4M13 16h5"/>',
  submenu: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="3" r="1"/><circle cx="21" cy="12" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="3" cy="12" r="1"/><path d="M12 5v4M15 12h4M12 15v4M5 12h4"/>',
  settings: '<path d="m9 3 1-1h4l1 1v2l2 1 2-1 2 3-1 2v4l1 2-2 3-2-1-2 1v2l-1 1h-4l-1-1v-2l-2-1-2 1-2-3 1-2v-4L3 8l2-3 2 1 2-1z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M7 10V7a5 5 0 0 1 10 0v3M12 14v3"/>',
  game: '<path d="M7 7h10c3 0 4 3 5 9 0 3-2 4-4 2l-3-2H9l-3 2c-2 2-4 1-4-2 1-6 2-9 5-9zM7 10v5M4.5 12.5h5M16 11h.01M19 14h.01"/>',
  work: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m10 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  undo: '<path d="M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5"/>',
  redo: '<path d="M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  preview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  grip: '<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/>',
};
export const builtins = ['app', 'file', 'folder', 'globe', 'command', 'submenu', 'settings', 'terminal', 'lock', 'orbit', 'game', 'work'];
export function svg(name: string): string { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.app}</svg>`; }
export function fallback(action: Action, icon: Icon = { kind: 'auto' }): string {
  if (icon.kind === 'builtin') return svg(icon.name);
  if (action.kind === 'system') return svg(action.action === 'explorer' ? 'folder' : action.action === 'terminal' ? 'terminal' : action.action === 'lock' ? 'lock' : 'settings');
  return svg(action.kind === 'application' ? 'app' : action.kind === 'url' ? 'globe' : action.kind);
}
