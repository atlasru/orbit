import { defineConfig } from 'vite';

// Keep the dev server aligned with src-tauri/tauri.conf.json.
// strictPort prevents Vite from silently switching ports and leaving Tauri waiting.
export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
