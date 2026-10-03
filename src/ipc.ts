import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Commands } from './types';

export { isTauri };
export function call<K extends keyof Commands>(command: K, args: Commands[K]['args']): Promise<Commands[K]['result']> {
  if (!isTauri()) return Promise.reject(new Error('Desktop runtime unavailable. Start Orbit.exe or npm run tauri dev.'));
  return invoke<Commands[K]['result']>(command, args);
}
