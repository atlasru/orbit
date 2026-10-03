import { listen } from '@tauri-apps/api/event';
import { appearance } from './appearance';
import { esc, errorText, modal, query } from './dom';
import { builtins, fallback, svg } from './icons';
import { call } from './ipc';
import { t } from './i18n';
import { children, clone, defaultAction, descendants, duplicateProfile, duplicateSubtree, History, moveNode, uid } from './model';
import { ringPoints } from './navigation';
import type { Action, Bootstrap, Icon, OrbitNode, Profile, Settings, Snapshot, SystemAction } from './types';

const nodeTypes: Action['kind'][] = ['application', 'file', 'folder', 'url', 'command', 'submenu', 'system'];
const selected = (a: unknown, b: unknown): string => a === b ? 'selected' : '';
const checked = (value: boolean): string => value ? 'checked' : '';

export class Editor {
  private history: History;
  private saved: Snapshot;
  private status: Bootstrap['status'];
  private profileId: string;
  private nodeId: string | null = null;
  private tab: 'editor' | 'settings' = 'editor';
  private collapsed = new Set<string>();
  private formDirty = false;
  private formIcon: Icon = { kind: 'auto' };
  private formAction: Action = { kind: 'submenu' };
  private message = '';
  private saving = false;
  private externalChange = false;
  constructor(private root: HTMLElement, bootstrap: Bootstrap) {
    this.saved = clone(bootstrap.snapshot); this.history = new History(bootstrap.snapshot);
    this.status = bootstrap.status; this.profileId = bootstrap.snapshot.activeProfileId;
    this.render();
  }
  private get snapshot(): Snapshot { return this.history.current; }
  private get profile(): Profile { return this.snapshot.profiles.find(p => p.id === this.profileId) ?? this.snapshot.profiles[0]; }
  private get node(): OrbitNode | undefined { return this.profile.nodes.find(n => n.id === this.nodeId); }
  private get dirty(): boolean { return this.formDirty || JSON.stringify(this.snapshot) !== JSON.stringify(this.saved); }
  private notice(error: unknown): void {
    this.message = errorText(error);
    const banner = this.root.querySelector<HTMLElement>('.editor-message');
    if (banner) { banner.textContent = this.message; banner.hidden = !this.message; }
  }
  private change(edit: (snapshot: Snapshot) => void): void {
    try { this.history.change(edit); this.message = ''; this.formDirty = false; this.render(); }
    catch (error) { this.notice(error); }
  }
  private editProfile(edit: (profile: Profile) => void): void {
    const id = this.profile.id;
    this.change(snapshot => edit(snapshot.profiles.find(p => p.id === id)!));
  }
  private updateDirty(): void {
    const label = this.root.querySelector<HTMLElement>('[data-dirty]');
    if (label) label.textContent = this.dirty ? t('unsaved') : t('saved');
    this.root.querySelector<HTMLButtonElement>('[data-save]')!.disabled = this.saving || !this.dirty;
  }
  private async applyBeforeLeaving(): Promise<boolean> {
    if (!this.formDirty) return true;
    if (!await modal(t('unsaved'), t('applyFirst'), { confirm: t('apply') })) return false;
    return this.applyNode();
  }
  private async safe(action: () => Promise<unknown>): Promise<void> {
    try { await action(); } catch (error) { this.notice(error); }
  }
  private render(): void {
    appearance(this.snapshot.settings);
    document.body.dataset.view = 'editor';
    this.profileId = this.profile.id;
    this.root.innerHTML = `<div class="editor-shell">
      <aside class="sidebar"><a class="wordmark" href="#" aria-label="Orbit">${svg('orbit')}<span>Orbit</span></a><p class="tagline">${esc(t('local'))}</p>
      <nav class="main-tabs"><button data-tab="editor" class="${this.tab === 'editor' ? 'current' : ''}">${svg('submenu')}${esc(t('editor'))}</button><button data-tab="settings" class="${this.tab === 'settings' ? 'current' : ''}">${svg('settings')}${esc(t('settings'))}</button></nav>
      <div class="sidebar-heading"><span>${esc(t('profiles'))}</span><button data-profile="create" class="icon-button" title="${esc(t('create'))}" aria-label="${esc(t('create'))}">${svg('plus')}</button></div>
      <div class="profile-list">${this.snapshot.profiles.map(p => `<button data-profile-select="${esc(p.id)}" class="profile-row ${p.id === this.profileId ? 'current' : ''}"><span>${esc(p.name)}</span>${p.id === this.snapshot.activeProfileId ? '<span class="active-dot" title="Active"></span>' : ''}</button>`).join('')}</div>
      <div class="sidebar-footer"><span>Orbit 0.2.0</span><span>MIT · Windows</span></div></aside>
      <main class="editor-main"><header class="editor-header"><div><h1>${esc(this.tab === 'editor' ? this.profile.name : t('settings'))}</h1><span data-dirty class="save-state">${esc(this.dirty ? t('unsaved') : t('saved'))}</span></div><div class="header-actions">
      <button class="icon-button" data-undo title="${esc(t('undo'))} (Ctrl+Z)" aria-label="${esc(t('undo'))}" ${!this.history.canUndo ? 'disabled' : ''}>${svg('undo')}</button><button class="icon-button" data-redo title="${esc(t('redo'))} (Ctrl+Shift+Z)" aria-label="${esc(t('redo'))}" ${!this.history.canRedo ? 'disabled' : ''}>${svg('redo')}</button>
      <button data-preview>${svg('preview')}${esc(t('preview'))}</button><button class="primary" data-save ${!this.dirty || this.saving ? 'disabled' : ''}>${svg('check')}${esc(t('save'))}</button></div></header>
      <div class="editor-message" role="status" ${!this.message ? 'hidden' : ''}>${esc(this.message)}</div>
      ${this.status.shortcutError ? `<div class="warning shortcut-warning"><strong>${esc(t('conflict'))}</strong><p>${esc(this.status.shortcutError)}</p><span>${esc(t('registered'))}: <b>${esc(this.status.registeredShortcut ?? t('unavailable'))}</b></span><button data-shortcut-settings>${esc(t('settings'))}</button></div>` : ''}
      ${this.status.warnings.map(w => `<div class="warning recovery-warning">${esc(w)}</div>`).join('')}
      ${this.externalChange ? `<div class="warning">${esc(t('changed'))}<button data-reload>${esc(t('reload'))}</button></div>` : ''}
      ${this.tab === 'editor' ? this.editorMarkup() : this.settingsMarkup()}
      </main></div>`;
    this.bind();
  }
  private editorMarkup(): string {
    return `<div class="profile-toolbar"><div class="profile-operations"><button data-profile="rename">${esc(t('rename'))}</button><button data-profile="duplicate">${svg('copy')}${esc(t('duplicate'))}</button><button data-profile="delete" ${this.snapshot.profiles.length === 1 ? 'disabled' : ''}>${esc(t('delete'))}</button></div><div><button data-import>${esc(t('import'))}</button><button data-export>${esc(t('export'))}</button><button data-activate ${this.profile.id === this.snapshot.activeProfileId ? 'disabled' : ''}>${esc(this.profile.id === this.snapshot.activeProfileId ? t('active') : t('activate'))}</button></div></div>
      ${!this.profile.trusted ? `<div class="warning imported-warning"><strong>${esc(t('review'))}</strong><p>${esc(t('reviewDescription'))}</p><button data-trust>${esc(t('enable'))}</button></div>` : ''}
      <div class="editor-workspace"><section class="tree-pane"><div class="pane-heading"><h2>${esc(t('contents'))}</h2><button data-add class="icon-button" title="${esc(t('add'))}" aria-label="${esc(t('add'))}">${svg('plus')}</button></div><button class="root-drop" data-root-drop>${svg('orbit')} ${esc(t('root'))}</button><div class="tree" role="tree">${this.treeMarkup()}</div><p class="tree-help">${esc(t('reorder'))}</p></section>
      <section class="inspector">${this.node ? this.nodeMarkup(this.node) : `<div class="empty-inspector"><div class="mini-orbit">${this.thumbnail()}</div><h2>${esc(t('chooseNode'))}</h2><p>${this.profile.nodes.length} nodes · ${children(this.profile, null).length} at root</p><button data-add class="primary">${svg('plus')}${esc(t('add'))}</button></div>`}</section></div>`;
  }
  private thumbnail(): string {
    const nodes = children(this.profile, null).slice(0, 8), points = ringPoints(nodes.length, 92);
    return `<svg viewBox="0 0 260 260" fill="none" aria-hidden="true"><circle cx="130" cy="130" r="92" stroke="currentColor" opacity=".15"/><circle cx="130" cy="130" r="23" stroke="currentColor"/>${points.map(p => `<circle cx="${130 + p.x}" cy="${130 + p.y}" r="15" fill="currentColor" opacity=".18"/><circle cx="${130 + p.x}" cy="${130 + p.y}" r="15" stroke="currentColor" opacity=".4"/>`).join('')}</svg>`;
  }
  private treeMarkup(): string {
    const adjacency = new Map<string | null, OrbitNode[]>();
    for (const n of this.profile.nodes) { const list = adjacency.get(n.parentId) ?? []; list.push(n); adjacency.set(n.parentId, list); }
    const pending = [...(adjacency.get(null) ?? [])].reverse().map(n => ({ n, depth: 0 }));
    const rows: string[] = [];
    while (pending.length) {
      const { n, depth } = pending.pop()!;
      const menu = n.action.kind === 'submenu';
      rows.push(`<div class="tree-row ${n.id === this.nodeId ? 'selected' : ''}" role="treeitem" ${menu ? `aria-expanded="${!this.collapsed.has(n.id)}"` : ''} draggable="true" data-tree="${esc(n.id)}" style="--depth:${Math.min(depth, 7)}" title="${esc(n.label)}"><button class="tree-fold" data-fold="${esc(n.id)}" aria-label="Toggle submenu" ${!menu ? 'disabled' : ''}>${menu ? svg(this.collapsed.has(n.id) ? 'next' : 'back') : ''}</button><span class="tree-icon">${fallback(n.action, n.icon)}</span><span class="tree-label">${esc(n.label)}</span>${menu ? `<span class="tree-count">${(adjacency.get(n.id) ?? []).length}</span>` : ''}<span class="tree-grip">${svg('grip')}</span></div>`);
      if (menu && !this.collapsed.has(n.id)) pending.push(...[...(adjacency.get(n.id) ?? [])].reverse().map(child => ({ n: child, depth: depth + 1 })));
    }
    return rows.join('') || `<p class="empty-tree">${esc(t('empty'))}</p>`;
  }
  private nodeMarkup(node: OrbitNode): string {
    this.formIcon = clone(node.icon); this.formAction = clone(node.action);
    const banned = descendants(this.profile, node.id);
    return `<div class="pane-heading"><div class="inspector-title"><span class="detail-icon">${fallback(node.action, node.icon)}</span><h2>${esc(node.label)}</h2></div><div><button data-node-copy class="icon-button" title="${esc(t('duplicate'))}" aria-label="Duplicate node">${svg('copy')}</button><button data-node-delete class="icon-button" title="${esc(t('delete'))}" aria-label="Delete node">${svg('delete')}</button></div></div>
      <form id="node-form"><label>${esc(t('label'))}<input name="label" value="${esc(node.label)}" required maxlength="160"></label><div class="form-row"><label>${esc(t('type'))}<select name="kind" aria-label="${esc(t('type'))}">${nodeTypes.map(k => `<option value="${k}" ${selected(k, node.action.kind)}>${esc(t(k))}</option>`).join('')}</select></label><label>${esc(t('parent'))}<select name="parent" aria-label="${esc(t('parent'))}"><option value="">${esc(t('root'))}</option>${this.profile.nodes.filter(n => n.action.kind === 'submenu' && !banned.has(n.id)).map(n => `<option value="${esc(n.id)}" ${selected(n.id, node.parentId)}>${esc(n.label)}</option>`).join('')}</select></label></div>
      <div class="action-fields">${this.actionMarkup(node.action)}</div>
      <label>${esc(t('icon'))}<div class="icon-fields"><select name="icon"><option value="auto" ${node.icon.kind === 'auto' ? 'selected' : ''}>${esc(t('automatic'))}</option>${builtins.map(name => `<option value="${name}" ${node.icon.kind === 'builtin' && node.icon.name === name ? 'selected' : ''}>${name}</option>`).join('')}${node.icon.kind === 'custom' ? `<option value="custom" selected>${esc(t('custom'))}</option>` : ''}</select><button type="button" data-pick-icon>${esc(t('choose'))}</button></div></label>
      <div class="form-actions"><button type="button" data-discard>${esc(t('discard'))}</button><button type="submit" class="primary">${esc(t('apply'))}</button></div></form>`;
  }
  private actionMarkup(action: Action): string {
    if (action.kind === 'application' || action.kind === 'command') return `<label>${esc(t('executable'))}<div class="input-browse"><input name="executable" value="${esc(action.executable)}" required spellcheck="false"><button type="button" data-browse="executable">${esc(t('choose'))}</button></div></label><label>${esc(t('args'))}<textarea name="args" rows="3" spellcheck="false">${esc(JSON.stringify(action.args, null, 2))}</textarea></label><label>${esc(t('workingDirectory'))}<div class="input-browse"><input name="workingDirectory" value="${esc(action.workingDirectory ?? '')}" spellcheck="false"><button type="button" data-browse="workingDirectory">${esc(t('choose'))}</button></div></label><p class="field-help">Each array entry is one argument. No shell is added. Windows environment variables expand in paths.</p>`;
    if (action.kind === 'file' || action.kind === 'folder') return `<label>${esc(t('path'))}<div class="input-browse"><input name="path" value="${esc(action.path)}" required spellcheck="false"><button type="button" data-browse="path">${esc(t('choose'))}</button></div></label>`;
    if (action.kind === 'url') return `<label>URL<input name="url" value="${esc(action.url)}" required spellcheck="false" placeholder="https://example.com"></label>`;
    if (action.kind === 'system') return `<label>${esc(t('system'))}<select name="systemAction">${(['windowsSettings', 'taskManager', 'explorer', 'terminal', 'lock'] as const).map(a => `<option value="${a}" ${selected(a, action.action)}>${({ windowsSettings: 'Windows Settings', taskManager: 'Task Manager', explorer: 'Explorer', terminal: 'Windows Terminal', lock: 'Lock workstation' })[a]}</option>`).join('')}</select></label>`;
    return `<div class="submenu-info">${svg('submenu')}<p>Add nodes inside this menu, or move existing nodes here using Parent menu.</p><button type="button" data-add-child>${svg('plus')}${esc(t('add'))}</button></div>`;
  }
  private applyNode(): boolean {
    const node = this.node;
    if (!node) return true;
    try {
      const form = query<HTMLFormElement>(this.root, '#node-form');
      if (!form.reportValidity()) return false;
      const data = new FormData(form), value = (name: string): string => String(data.get(name) ?? '');
      const kind = value('kind') as Action['kind'];
      if (node.action.kind === 'submenu' && kind !== 'submenu' && children(this.profile, node.id).length) throw new Error('Move or delete the submenu’s children before changing its type.');
      let action: Action;
      switch (kind) {
        case 'application': case 'command': {
          const args: unknown = JSON.parse(value('args'));
          if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Error('Arguments must be a JSON array of strings.');
          action = { kind, executable: value('executable'), args: args as string[], workingDirectory: value('workingDirectory').trim() || null }; break;
        }
        case 'file': case 'folder': action = { kind, path: value('path') }; break;
        case 'url': action = { kind, url: value('url') }; break;
        case 'system': action = { kind, action: value('systemAction') as SystemAction }; break;
        case 'submenu': action = { kind }; break;
        default: throw new Error('Unknown node type.');
      }
      const next = { ...clone(node), label: value('label').trim(), action, icon: clone(this.formIcon) };
      const parent = value('parent') || null;
      const id = this.profile.id;
      this.history.change(snapshot => {
        const p = snapshot.profiles.find(p => p.id === id)!;
        p.nodes[p.nodes.findIndex(n => n.id === node.id)] = next;
        if (parent !== node.parentId) moveNode(p, node.id, parent);
      });
      this.formDirty = false; this.message = ''; this.render(); return true;
    } catch (error) { this.notice(error); return false; }
  }
  private settingsMarkup(): string {
    const s = this.snapshot.settings;
    const toggle = (key: keyof Settings, label: string): string => `<label class="toggle-row"><span>${esc(label)}</span><input type="checkbox" name="${key}" ${checked(Boolean(s[key]))}></label>`;
    const options = (key: keyof Settings, values: [string, string][]): string => `<select name="${key}">${values.map(([value, label]) => `<option value="${value}" ${selected(value, s[key])}>${esc(label)}</option>`).join('')}</select>`;
    return `<form id="settings-form" class="settings-form"><section><h2>${esc(t('general'))}</h2><label>${esc(t('shortcut'))}<input name="shortcut" value="${esc(s.shortcut)}" placeholder="Alt+Space" required><span class="field-help">${esc(t('registered'))}: ${esc(this.status.registeredShortcut ?? t('unavailable'))}</span></label>${toggle('launchAtStartup', t('startup'))}<label>${esc(t('tray'))}${options('trayClick', [['launcher', 'Launcher'], ['editor', t('editor')]])}</label><label>${esc(t('language'))}${options('language', [['en', 'English'], ['ru', 'Русский']])}</label></section>
      <section><h2>${esc(t('appearance'))}</h2><label>${esc(t('opacity'))}<input name="opacity" type="range" min="0.35" max="1" step="0.01" value="${s.opacity}"></label><label>${esc(t('accent'))}<input name="accent" type="color" value="${esc(s.accent)}"></label>${toggle('blur', t('acrylic'))}${toggle('animations', t('animations'))}${toggle('reducedMotion', t('reduced'))}${toggle('showLabels', t('labels'))}<label>${esc(t('scale'))}<input name="launcherScale" type="range" min="0.7" max="1.6" step="0.05" value="${s.launcherScale}"></label></section>
      <section><h2>${esc(t('behavior'))}</h2>${toggle('closeAfterAction', t('closeAction'))}<label>${esc(t('delay'))}<input name="closeDelayMs" type="number" min="0" max="5000" step="50" value="${s.closeDelayMs}"></label>${toggle('closeOnBlur', t('blurClose'))}<label>${esc(t('monitor'))}${options('monitor', [['foreground', t('foreground')], ['cursor', t('cursor')], ['primary', t('primary')]])}</label><label>${esc(t('keyboard'))}${options('keyboard', [['directional', t('directional')], ['sequential', t('sequential')]])}</label><label>${esc(t('profile'))}<select name="activeProfileId">${this.snapshot.profiles.map(p => `<option value="${esc(p.id)}" ${selected(p.id, this.snapshot.activeProfileId)}>${esc(p.name)}</option>`).join('')}</select></label></section>
      <section class="settings-storage"><h2>${esc(t('storage'))}</h2><p class="data-path">${esc(this.status.dataDirectory)}</p><button type="button" data-reload>${esc(t('reload'))}</button></section></form>`;
  }
  private bind(): void {
    this.root.querySelector<HTMLAnchorElement>('.wordmark')!.onclick = e => { e.preventDefault(); void this.safe(() => call('open_launcher', {})); };
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => { b.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.tab = b.dataset.tab as 'editor' | 'settings'; this.render(); }); }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile-select]').forEach(b => { b.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.profileId = b.dataset.profileSelect!; this.nodeId = null; this.tab = 'editor'; this.render(); }); }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b => { b.onclick = () => { void this.safe(() => this.profileOperation(b.dataset.profile!)); }; });
    this.root.querySelector<HTMLButtonElement>('[data-save]')!.onclick = () => { void this.save(); };
    this.root.querySelector<HTMLButtonElement>('[data-preview]')!.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; await call('preview_launcher', { profile: clone(this.profile) }); }); };
    this.root.querySelector<HTMLButtonElement>('[data-undo]')!.onclick = () => { void this.historyAction(false); };
    this.root.querySelector<HTMLButtonElement>('[data-redo]')!.onclick = () => { void this.historyAction(true); };
    this.root.querySelectorAll<HTMLButtonElement>('[data-reload]').forEach(b => { b.onclick = () => { void this.reload(); }; });
    this.root.querySelector<HTMLButtonElement>('[data-shortcut-settings]')?.addEventListener('click', () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.tab = 'settings'; this.render(); }); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(b => { b.onclick = () => { void this.addNode(); }; });
    this.root.querySelector<HTMLButtonElement>('[data-import]')?.addEventListener('click', () => { void this.safe(async () => {
      if (!await this.applyBeforeLeaving()) return;
      const p = await call('import_profile', {});
      if (p) { this.profileId = p.id; this.nodeId = null; this.change(s => { if (s.profiles.length >= 100) throw new Error('Profile limit: 100.'); s.profiles.push(p); }); }
    }); });
    this.root.querySelector<HTMLButtonElement>('[data-export]')?.addEventListener('click', () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; const path = await call('export_profile', { profile: clone(this.profile) }); if (path) this.notice(`Exported: ${path}`); }); });
    this.root.querySelector<HTMLButtonElement>('[data-activate]')?.addEventListener('click', () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.history.change(s => { s.activeProfileId = this.profile.id; }); await this.save(); }); });
    this.root.querySelector<HTMLButtonElement>('[data-trust]')?.addEventListener('click', () => { void this.safe(async () => {
      if (!await this.applyBeforeLeaving()) return;
      if (await modal('Enable executable actions?', 'Review all executable paths, arguments, and working directories first. These programs may run when you activate their nodes after Save.', { confirm: 'Enable' })) this.editProfile(p => { p.trusted = true; });
    }); });
    this.bindTree(); this.bindNode(); this.bindSettings();
  }
  private bindTree(): void {
    this.root.querySelectorAll<HTMLElement>('[data-tree]').forEach(row => {
      row.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.nodeId = row.dataset.tree!; this.render(); }); };
      row.ondragstart = e => { e.dataTransfer?.setData('text/plain', row.dataset.tree!); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; };
      row.ondragover = e => { e.preventDefault(); row.classList.add('drop-target'); };
      row.ondragleave = () => row.classList.remove('drop-target');
      row.ondrop = e => {
        e.preventDefault(); row.classList.remove('drop-target');
        const id = e.dataTransfer?.getData('text/plain'), target = this.profile.nodes.find(n => n.id === row.dataset.tree);
        if (!id || !target) return;
        if (this.formDirty) { this.notice(t('applyFirst')); return; }
        this.editProfile(p => moveNode(p, id, e.shiftKey && target.action.kind === 'submenu' ? target.id : target.parentId, e.shiftKey && target.action.kind === 'submenu' ? undefined : target.id));
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-fold]').forEach(b => { b.onclick = e => { e.stopPropagation(); if (this.formDirty) { this.notice(t('applyFirst')); return; } const id = b.dataset.fold!; if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id); this.render(); }; });
    const drop = this.root.querySelector<HTMLElement>('[data-root-drop]');
    if (drop) {
      drop.ondragover = e => e.preventDefault();
      drop.ondrop = e => { e.preventDefault(); if (this.formDirty) { this.notice(t('applyFirst')); return; } const id = e.dataTransfer?.getData('text/plain'); if (id) this.editProfile(p => moveNode(p, id, null)); };
      drop.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; this.nodeId = null; this.render(); }); };
    }
  }
  private bindNode(): void {
    const form = this.root.querySelector<HTMLFormElement>('#node-form');
    if (!form) return;
    form.oninput = () => { this.formDirty = true; this.updateDirty(); };
    form.onsubmit = e => { e.preventDefault(); this.applyNode(); };
    form.querySelector<HTMLSelectElement>('[name="kind"]')!.onchange = e => {
      const kind = (e.target as HTMLSelectElement).value as Action['kind'];
      this.formAction = kind === this.node?.action.kind ? clone(this.node.action) : defaultAction(kind);
      form.querySelector<HTMLElement>('.action-fields')!.innerHTML = this.actionMarkup(this.formAction);
      this.formDirty = true; this.updateDirty(); this.bindActionButtons();
    };
    form.querySelector<HTMLSelectElement>('[name="icon"]')!.onchange = e => {
      const value = (e.target as HTMLSelectElement).value;
      this.formIcon = value === 'auto' ? { kind: 'auto' } : value === 'custom' ? this.formIcon : { kind: 'builtin', name: value };
      this.formDirty = true; this.updateDirty();
    };
    form.querySelector<HTMLButtonElement>('[data-pick-icon]')!.onclick = () => { void this.safe(async () => {
      const icon = await call('pick_icon', {}); if (!icon) return;
      this.formIcon = icon; this.formDirty = true; this.updateDirty();
      const select = form.querySelector<HTMLSelectElement>('[name="icon"]')!;
      if (!select.querySelector('[value="custom"]')) select.add(new Option(t('custom'), 'custom'));
      select.value = 'custom';
    }); };
    form.querySelector<HTMLButtonElement>('[data-discard]')!.onclick = () => { this.formDirty = false; this.render(); };
    this.root.querySelector<HTMLButtonElement>('[data-node-copy]')!.onclick = () => { void this.safe(async () => { if (!await this.applyBeforeLeaving()) return; const id = this.nodeId!; this.editProfile(p => { this.nodeId = duplicateSubtree(p, id); }); }); };
    this.root.querySelector<HTMLButtonElement>('[data-node-delete]')!.onclick = () => { void this.deleteNode(); };
    this.bindActionButtons();
  }
  private bindActionButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-browse]').forEach(b => { b.onclick = () => { void this.safe(async () => {
      const field = b.dataset.browse!, kind = this.root.querySelector<HTMLSelectElement>('[name="kind"]')!.value;
      const path = await call('pick_path', { folder: field === 'workingDirectory' || kind === 'folder' });
      if (path) { this.root.querySelector<HTMLInputElement>(`[name="${field}"]`)!.value = path; this.formDirty = true; this.updateDirty(); }
    }); }; });
    this.root.querySelector<HTMLButtonElement>('[data-add-child]')?.addEventListener('click', () => { void this.addNode(this.nodeId); });
  }
  private bindSettings(): void {
    const form = this.root.querySelector<HTMLFormElement>('#settings-form');
    if (!form) return;
    form.onsubmit = e => { e.preventDefault(); void this.save(); };
    const capture = (): void => {
      const data = new FormData(form), s = clone(this.snapshot.settings);
      for (const key of ['launchAtStartup', 'closeAfterAction', 'closeOnBlur', 'blur', 'animations', 'reducedMotion', 'showLabels'] as const) s[key] = data.has(key);
      for (const key of ['closeDelayMs', 'opacity', 'launcherScale'] as const) s[key] = Number(data.get(key));
      s.shortcut = String(data.get('shortcut')); s.accent = String(data.get('accent'));
      s.language = String(data.get('language')) as Settings['language']; s.trayClick = String(data.get('trayClick')) as Settings['trayClick'];
      s.monitor = String(data.get('monitor')) as Settings['monitor']; s.keyboard = String(data.get('keyboard')) as Settings['keyboard'];
      this.history.change(snapshot => { snapshot.settings = s; snapshot.activeProfileId = String(data.get('activeProfileId')); });
      this.updateDirty();
    };
    form.oninput = capture;
    form.onchange = capture;
  }
  private async addNode(parent?: string | null): Promise<void> {
    await this.safe(async () => {
      if (!await this.applyBeforeLeaving()) return;
      const actual = parent !== undefined ? parent : this.node?.action.kind === 'submenu' ? this.node.id : this.node?.parentId ?? null;
      const node: OrbitNode = { id: uid(), label: 'New node', parentId: actual, icon: { kind: 'auto' }, action: { kind: 'submenu' } };
      this.nodeId = node.id;
      if (actual) this.collapsed.delete(actual);
      this.editProfile(p => p.nodes.push(node));
    });
  }
  private async deleteNode(): Promise<void> {
    await this.safe(async () => {
      if (!await this.applyBeforeLeaving()) return;
      const node = this.node; if (!node) return;
      const ids = descendants(this.profile, node.id);
      if (!await modal(`Delete ${node.label}?`, `${ids.size} node(s), including children, will be removed. Undo is available until Save.`, { confirm: t('delete'), danger: true })) return;
      this.nodeId = null; this.editProfile(p => { p.nodes = p.nodes.filter(n => !ids.has(n.id)); });
    });
  }
  private async profileOperation(operation: string): Promise<void> {
    if (!await this.applyBeforeLeaving()) return;
    const profile = this.profile;
    if (operation === 'delete') {
      if (this.snapshot.profiles.length === 1) return;
      if (!await modal(`Delete ${profile.name}?`, 'This removes the profile and its entire menu. Undo is available until Save.', { confirm: t('delete'), danger: true })) return;
      this.nodeId = null;
      this.change(s => { s.profiles = s.profiles.filter(p => p.id !== profile.id); if (s.activeProfileId === profile.id) s.activeProfileId = s.profiles[0].id; this.profileId = s.profiles[0].id; });
      return;
    }
    const name = await modal(operation === 'create' ? t('create') : operation === 'rename' ? t('rename') : t('duplicate'), 'Profile name', { input: operation === 'create' ? 'New profile' : operation === 'duplicate' ? `${profile.name} copy` : profile.name });
    if (typeof name !== 'string' || !name) return;
    this.nodeId = null;
    this.change(s => {
      if (operation === 'rename') s.profiles.find(p => p.id === profile.id)!.name = name;
      else {
        if (s.profiles.length >= 100) throw new Error('Profile limit: 100.');
        const p: Profile = operation === 'duplicate' ? duplicateProfile(profile, name) : { schemaVersion: 1, id: uid(), name, trusted: true, nodes: [] };
        s.profiles.push(p); this.profileId = p.id;
      }
    });
  }
  async save(): Promise<void> {
    if (this.saving) return;
    if (this.formDirty && !this.applyNode()) return;
    this.saving = true; this.updateDirty();
    try {
      const b = await call('save_snapshot', { snapshot: clone(this.snapshot) });
      this.saved = clone(b.snapshot); this.history.reset(b.snapshot); this.status = b.status;
      this.externalChange = false; this.message = ''; this.formDirty = false;
    } catch (error) { this.message = errorText(error); }
    finally { this.saving = false; this.render(); }
  }
  private async historyAction(redo: boolean): Promise<void> {
    if (!await this.applyBeforeLeaving()) return;
    if (redo) this.history.redo(); else this.history.undo();
    if (!this.history.current.profiles.some(p => p.id === this.profileId)) this.profileId = this.snapshot.activeProfileId;
    this.render();
  }
  private async reload(): Promise<void> {
    await this.safe(async () => {
      if (this.dirty && !await modal(t('reload'), 'Discard unsaved changes and reload the saved configuration?', { confirm: t('discard'), danger: true })) return;
      const b = await call('get_bootstrap', {});
      this.saved = clone(b.snapshot); this.history.reset(b.snapshot); this.status = b.status;
      this.profileId = b.snapshot.activeProfileId; this.nodeId = null; this.formDirty = false; this.externalChange = false; this.message = ''; this.render();
    });
  }
  async requestClose(): Promise<void> {
    if (this.dirty) {
      if (!await modal(t('unsaved'), 'Discard changes and hide the editor?', { confirm: t('discard'), danger: true })) return;
      this.history.reset(this.saved); this.formDirty = false; this.render();
    }
    await this.safe(() => call('close_editor', {}));
  }
  async connect(): Promise<void> {
    if (this.status.smoke) {
      const { installEditorSmoke } = await import('./runtime-test');
      await installEditorSmoke();
    }
    await listen<Bootstrap>('config-changed', e => {
      this.status = e.payload.status;
      if (this.saving) return;
      if (e.payload.snapshot.revision === this.saved.revision) return;
      if (this.dirty) { this.externalChange = true; this.notice(t('changed')); }
      else { this.saved = clone(e.payload.snapshot); this.history.reset(e.payload.snapshot); this.formDirty = false; this.render(); }
    });
    await listen('editor-close-request', () => { void this.requestClose(); });
    await listen<string>('orbit-error', e => this.notice(e.payload));
    window.addEventListener('keydown', e => {
      if (document.querySelector('.modal-layer')) return;
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void this.save(); }
      else if (e.ctrlKey && ['z', 'y'].includes(e.key.toLowerCase()) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void this.historyAction(e.shiftKey || e.key.toLowerCase() === 'y');
      }
    });
  }
}
