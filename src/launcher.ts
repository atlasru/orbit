import { listen } from '@tauri-apps/api/event';
import { call } from './ipc';
import { children } from './model';
import { PAGE_SIZE, ringPoints, pageItems, directionalIndex } from './navigation';
import { esc, errorText, modal } from './dom';
import { fallback, svg } from './icons';
import { appearance } from './appearance';
import { t } from './i18n';
import type { Bootstrap, LauncherPayload, OrbitNode, Profile, Settings } from './types';

const iconCache = new Map<string, string>();
export class Radial {
  profile: Profile;
  settings: Settings;
  preview: boolean;
  private path: string[] = [];
  private page = 0;
  private selected = 0;
  private version = 0;
  private busy = false;
  private current: OrbitNode[] = [];
  constructor(private host: HTMLElement, payload: LauncherPayload, private hide: () => void, private editor: () => void) {
    this.profile = payload.profile; this.settings = payload.settings; this.preview = payload.preview;
    this.render();
  }
  update(payload: LauncherPayload): void {
    this.profile = payload.profile; this.settings = payload.settings; this.preview = payload.preview;
    this.path = []; this.page = 0; this.selected = 0; this.busy = false; this.render();
  }
  get parent(): string | null { return this.path.at(-1) ?? null; }
  get selection(): string | null { return this.current[this.selected]?.id ?? null; }
  message(text: string): void { const notice = this.host.querySelector<HTMLElement>('.radial-notice'); if (notice) notice.textContent = text; }
  private select(index: number): void {
    this.selected = index;
    this.host.querySelectorAll<HTMLButtonElement>('.radial-node').forEach((button, i) => {
      button.classList.toggle('selected', i === index); button.tabIndex = i === index ? 0 : -1;
      button.setAttribute('aria-selected', String(i === index));
    });
  }
  render(): void {
    this.version++;
    const version = this.version;
    const all = children(this.profile, this.parent);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    this.current = pageItems(all, this.page);
    this.selected = Math.max(0, Math.min(this.selected, this.current.length - 1));
    const points = ringPoints(this.current.length);
    const parent = this.profile.nodes.find(n => n.id === this.parent);
    const title = parent?.label ?? this.profile.name;
    this.host.innerHTML = `<div class="radial" role="region" aria-label="${esc(title)}">
      <div class="radial-title">${esc(this.preview ? t('previewHint') : title)}</div>
      <svg class="orbit-lines" viewBox="0 0 580 580" aria-hidden="true"><circle cx="290" cy="290" r="166"/>${points.map(p => `<path d="M${290 + p.x * .34} ${290 + p.y * .34} L${290 + p.x * .75} ${290 + p.y * .75}"/>`).join('')}</svg>
      <button class="hub" data-hub title="${esc(parent ? 'Back' : t('editor'))}" aria-label="${esc(parent ? 'Back' : t('editor'))}">${svg(parent ? 'back' : 'orbit')}<span>${esc(parent ? 'Back' : 'Orbit')}</span></button>
      <div role="listbox" aria-label="Menu nodes">${this.current.map((node, i) => `<button class="radial-node ${i === this.selected ? 'selected' : ''}" role="option" aria-selected="${i === this.selected}" tabindex="${i === this.selected ? 0 : -1}" data-index="${i}" data-node="${esc(node.id)}" style="--x:${points[i].x}px;--y:${points[i].y}px" title="${esc(node.label)}"><span class="node-disc">${fallback(node.action, node.icon)}${node.action.kind === 'submenu' ? `<span class="menu-dot"></span>` : ''}</span><span class="node-label">${esc(node.label)}</span><span class="node-key">${i + 1}</span></button>`).join('')}</div>
      ${this.current.length ? '' : `<p class="radial-empty">${esc(t('empty'))}</p>`}
      ${pages > 1 ? `<button class="page-arrow prev" data-page="-1" aria-label="Previous page">${svg('back')}</button><button class="page-arrow next" data-page="1" aria-label="Next page">${svg('next')}</button><div class="page-number">${this.page + 1} / ${pages}</div>` : ''}
      <div class="radial-hint">${esc(this.preview ? t('previewHint') : t('hint'))}</div>
      <p class="radial-notice" role="status" aria-live="polite"></p>
    </div>`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-index]').forEach(button => {
      const i = Number(button.dataset.index);
      button.onpointerenter = () => this.select(i);
      button.onclick = () => { this.select(i); void this.activate(); };
    });
    this.host.querySelector<HTMLButtonElement>('[data-hub]')!.onclick = () => { if (parent) this.back(); else if (!this.preview) this.editor(); };
    this.host.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => { button.onclick = () => this.changePage(Number(button.dataset.page)); });
    this.host.querySelector<HTMLElement>('.radial')!.onclick = e => { if (e.target === e.currentTarget) this.hide(); };
    const nativeNodes = this.profile.trusted ? this.current : this.current.filter(n => n.icon.kind === 'custom');
    const missing = nativeNodes.filter(n => !iconCache.has(JSON.stringify([n.action, n.icon])));
    const applyIcons = (icons: Record<string, string>): void => {
      if (version !== this.version) return;
      for (const n of this.current) {
        const src = icons[n.id] ?? iconCache.get(JSON.stringify([n.action, n.icon]));
        if (!src) continue;
        const disc = this.host.querySelector<HTMLElement>(`[data-node="${CSS.escape(n.id)}"] .node-disc`);
        if (disc) { const image = document.createElement('img'); image.src = src; image.alt = ''; disc.replaceChildren(image); }
      }
    };
    applyIcons({});
    if (missing.length) void call('resolve_icons', { nodes: missing }).then(icons => {
      for (const n of missing) if (icons[n.id]) iconCache.set(JSON.stringify([n.action, n.icon]), icons[n.id]);
      while (iconCache.size > 256) iconCache.delete(iconCache.keys().next().value!);
      applyIcons(icons);
    }).catch(() => {});
  }
  back(): void { if (this.path.length) { this.path.pop(); this.page = 0; this.selected = 0; this.render(); } }
  changePage(direction: number): void {
    const pages = Math.max(1, Math.ceil(children(this.profile, this.parent).length / PAGE_SIZE));
    this.page = (this.page + direction + pages) % pages; this.selected = 0; this.render();
  }
  async activate(): Promise<void> {
    const node = this.current[this.selected];
    if (!node || this.busy) return;
    if (node.action.kind === 'submenu') { this.path.push(node.id); this.page = 0; this.selected = 0; this.render(); return; }
    if (this.preview) { this.message(t('previewHint')); return; }
    this.busy = true;
    try {
      if (node.action.kind === 'system' && node.action.action === 'lock') {
        if (!await modal('Lock workstation?', 'Windows will lock the current session.', { confirm: 'Lock' })) return;
      }
      await call('execute_node', { profileId: this.profile.id, nodeId: node.id });
      this.message('');
    } catch (error) { this.message(errorText(error)); }
    finally { this.busy = false; }
  }
  key(event: KeyboardEvent): void {
    if (document.querySelector('.modal-layer')) return;
    const key = event.key;
    if (key === 'Escape') { event.preventDefault(); this.hide(); }
    else if (key === 'Backspace') { event.preventDefault(); this.back(); }
    else if (key === 'Home') { event.preventDefault(); this.path = []; this.page = 0; this.selected = 0; this.render(); }
    else if (key === 'PageDown' || key === 'PageUp') { event.preventDefault(); this.changePage(key === 'PageDown' ? 1 : -1); }
    else if (key === 'Enter') { event.preventDefault(); void this.activate(); }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(key)) {
      event.preventDefault();
      const count = this.current.length;
      if (!count) return;
      const i = this.settings.keyboard === 'sequential' || key === 'Tab'
        ? (this.selected + (event.shiftKey || key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + count) % count
        : directionalIndex(this.selected, key, count);
      this.select(i);
    } else if (/^[1-8]$/.test(key)) {
      const i = Number(key) - 1;
      if (this.current[i]) { event.preventDefault(); this.select(i); void this.activate(); }
    }
  }
}

export async function startLauncher(root: HTMLElement, bootstrap: Bootstrap): Promise<void> {
  appearance(bootstrap.snapshot.settings);
  document.body.dataset.view = 'launcher';
  root.innerHTML = '<div class="launcher-shell"><div id="radial-host"></div><select class="launcher-profiles" aria-label="Profile"></select><button class="launcher-edit" aria-label="Editor">' + svg('settings') + '</button></div>';
  const shell = root.querySelector<HTMLElement>('.launcher-shell')!;
  const hide = (): void => { void call('hide_launcher', {}).catch(e => radial.message(errorText(e))); };
  const edit = (): void => { void call('open_editor', {}).catch(e => radial.message(errorText(e))); };
  const radial = new Radial(root.querySelector('#radial-host')!, { profile: bootstrap.snapshot.profiles.find(p => p.id === bootstrap.snapshot.activeProfileId)!, settings: bootstrap.snapshot.settings, preview: false, epoch: 0 }, hide, edit);
  const selector = root.querySelector<HTMLSelectElement>('.launcher-profiles')!;
  const updateProfiles = (b: Bootstrap): void => {
    selector.innerHTML = b.snapshot.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === b.snapshot.activeProfileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  };
  updateProfiles(bootstrap);
  selector.onchange = () => { void call('select_profile', { profileId: selector.value }).catch(e => radial.message(errorText(e))); };
  root.querySelector<HTMLButtonElement>('.launcher-edit')!.onclick = edit;
  const resize = (): void => shell.style.setProperty('--window-scale', String(Math.min(window.innerWidth, window.innerHeight) / 580));
  resize(); window.addEventListener('resize', resize);
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement && e.key !== 'Escape') return;
    radial.key(e);
  });
  window.addEventListener('contextmenu', e => { e.preventDefault(); edit(); });
  await listen<LauncherPayload>('launcher-opened', e => {
    appearance(e.payload.settings); radial.update(e.payload);
    selector.hidden = e.payload.preview;
    root.querySelector<HTMLElement>('.launcher-edit')!.hidden = e.payload.preview;
    document.body.focus();
    if (bootstrap.status.smoke) void call('smoke_observation', { name: 'launcher-state', value: { profile: e.payload.profile.id, preview: e.payload.preview, nodes: e.payload.profile.nodes.length } }).catch(() => {});
  });
  await listen<Bootstrap>('config-changed', e => {
    updateProfiles(e.payload);
    if (!radial.preview) {
      appearance(e.payload.snapshot.settings);
      radial.update({ profile: e.payload.snapshot.profiles.find(p => p.id === e.payload.snapshot.activeProfileId)!, settings: e.payload.snapshot.settings, preview: false, epoch: 0 });
    }
  });
  await listen<string>('orbit-error', e => radial.message(e.payload));
  if (bootstrap.status.smoke) {
    const { installLauncherSmoke } = await import('./runtime-test');
    await installLauncherSmoke(radial);
  }
  await call('frontend_ready', {});
}
