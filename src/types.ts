export type SystemAction = 'windowsSettings' | 'taskManager' | 'explorer' | 'terminal' | 'lock';
export type Action =
  | { kind: 'application' | 'command'; executable: string; args: string[]; workingDirectory: string | null }
  | { kind: 'file' | 'folder'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'submenu' }
  | { kind: 'system'; action: SystemAction };
export type Icon = { kind: 'auto' } | { kind: 'builtin'; name: string } | { kind: 'custom'; file: string };
export interface OrbitNode { id: string; parentId: string | null; label: string; icon: Icon; action: Action }
export interface Profile { schemaVersion: 1; id: string; name: string; trusted: boolean; nodes: OrbitNode[] }
export interface Settings {
  shortcut: string; launchAtStartup: boolean; trayClick: 'launcher' | 'editor';
  closeAfterAction: boolean; closeDelayMs: number; closeOnBlur: boolean; language: 'en' | 'ru';
  opacity: number; blur: boolean; accent: string; animations: boolean; reducedMotion: boolean;
  showLabels: boolean; launcherScale: number; monitor: 'foreground' | 'cursor' | 'primary';
  keyboard: 'directional' | 'sequential';
}
export interface Snapshot { schemaVersion: 2; revision: number; settings: Settings; activeProfileId: string; profiles: Profile[] }
export interface Status {
  requestedShortcut: string; registeredShortcut: string | null; shortcutError: string | null;
  warnings: string[]; dataDirectory: string; frontendReady: boolean; smoke: boolean;
}
export interface Bootstrap { snapshot: Snapshot; status: Status }
export interface LauncherPayload { profile: Profile; settings: Settings; preview: boolean; epoch: number }

export interface Commands {
  get_bootstrap: { args: Record<string, never>; result: Bootstrap };
  frontend_ready: { args: Record<string, never>; result: void };
  hide_launcher: { args: Record<string, never>; result: void };
  open_launcher: { args: Record<string, never>; result: void };
  open_editor: { args: Record<string, never>; result: void };
  close_editor: { args: Record<string, never>; result: void };
  save_snapshot: { args: { snapshot: Snapshot }; result: Bootstrap };
  select_profile: { args: { profileId: string }; result: Bootstrap };
  preview_launcher: { args: { profile: Profile }; result: void };
  execute_node: { args: { profileId: string; nodeId: string }; result: void };
  resolve_icons: { args: { nodes: OrbitNode[] }; result: Record<string, string> };
  pick_path: { args: { folder: boolean }; result: string | null };
  pick_icon: { args: Record<string, never>; result: Icon | null };
  import_profile: { args: Record<string, never>; result: Profile | null };
  export_profile: { args: { profile: Profile }; result: string | null };
  smoke_observation: { args: { name: string; value: unknown }; result: void };
}
