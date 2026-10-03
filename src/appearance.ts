import type { Settings } from './types';
import { setLanguage } from './i18n';
export function appearance(settings: Settings): void {
  const style = document.documentElement.style;
  style.setProperty('--accent', settings.accent);
  style.setProperty('--surface-alpha', String(settings.opacity));
  document.body.classList.toggle('no-motion', settings.reducedMotion || !settings.animations);
  document.body.classList.toggle('no-labels', !settings.showLabels);
  document.body.classList.toggle('acrylic', settings.blur);
  setLanguage(settings.language);
}
