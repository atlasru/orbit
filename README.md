# Orbit

Free, local-first radial launcher for Windows 10/11. MIT licensed.

## Status
Phase 1 prototype. Not production ready. Includes a four-node radial UI, Alt+Space shortcut, system tray, centered transparent window and allowlisted actions. Editor, JSON persistence, profiles, full security hardening, installer and CI are pending.

## Development
Install Rust, Node.js, Windows C++ build tools and WebView2. Run:

```powershell
npm install
npm run tauri dev
```

The shortcut may conflict with another application. This prototype currently fails startup if the shortcut cannot be registered.

## Security
Only built-in allowlisted actions are accepted. Do not load untrusted configuration. No telemetry or network service is implemented; the browser demo action opens example.com.

## License
MIT. See LICENSE.
