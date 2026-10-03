export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export function query<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function modal(title: string, description: string, options: { input?: string; confirm?: string; danger?: boolean } = {}): Promise<string | boolean> {
  return new Promise(resolve => {
    const layer = document.createElement('div'); layer.className = 'modal-layer';
    layer.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p>${esc(description)}</p>${options.input !== undefined ? `<input name="value" aria-label="Name" value="${esc(options.input)}" required maxlength="120">` : ''}<div class="modal-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="${options.danger ? 'danger' : 'primary'}">${esc(options.confirm ?? 'Confirm')}</button></div></form>`;
    document.body.append(layer);
    const previous = document.activeElement as HTMLElement | null;
    const finish = (value: string | boolean): void => { layer.remove(); previous?.focus(); resolve(value); };
    query(layer, '[data-cancel]').onclick = () => finish(false);
    query<HTMLFormElement>(layer, 'form').onsubmit = e => { e.preventDefault(); const input = layer.querySelector<HTMLInputElement>('input'); finish(input ? input.value.trim() : true); };
    layer.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      if (e.key === 'Tab') {
        const elements = Array.from(layer.querySelectorAll<HTMLElement>('input, button'));
        const index = elements.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); elements[(index + (e.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus();
      }
    });
    const focus = layer.querySelector<HTMLElement>('input, [data-cancel]'); focus?.focus();
  });
}
