# Orbit

Open-source Windows radial launcher (MIT). **Phase 1 alpha — not production-ready.**

## Requirements

- Windows 10/11 x64, WebView2 Runtime
- Node.js 22 and npm
- Rust stable with Windows MSVC toolchain
- Visual Studio C++ Build Tools and Windows SDK

## Run the desktop app

```powershell
git clone https://github.com/atlasru/orbit.git
cd orbit
npm install
npm run tauri dev
```

**Do not run `npm run dev` alone:** that starts only the Vite web preview on http://127.0.0.1:1420. Browser preview does not have Tauri IPC, system tray or global shortcuts. `npm run tauri dev` starts both Vite and the Rust desktop application. The `pretauri` script generates Windows icons automatically from `assets/orbit.svg`.

If the desktop window is hidden at startup, look in the Windows notification area (including hidden icons), right-click Orbit and select **Open Orbit**. `Alt+Space` toggles the launcher. If occupied by another application, Orbit tries `Alt+Shift+Space`; the terminal prints the result. If neither registers, open Orbit through the tray. `Alt+Space` may already be reserved by Windows or another launcher.

To build an executable locally:

```powershell
npm run tauri build -- --no-bundle
```

The output is `src-tauri/target/release/orbit.exe`. Windows GitHub Actions builds and uploads the executable as a workflow artifact once CI succeeds. Do not assume a binary exists until that job passes.

## Status and limitations

The prototype currently has four built-in actions (Explorer, example.com, Windows Settings and Windows Terminal). The Terminal action requires `wt.exe` on PATH. Editor, user-defined actions, profiles, persistence, installer and performance validation are not implemented. A browser-only preview deliberately displays a warning and cannot execute Windows actions.

## Troubleshooting

- If Tauri waits for a localhost server, verify that Vite reports `127.0.0.1:1420`; `vite.config.ts` pins port 1420 with `strictPort: true`.
- If port 1420 is already occupied, stop the other Vite process; the server now fails immediately rather than silently switching ports.
- If the shortcut does not work, read the terminal log and use the tray menu.
- If a Rust build fails, use the full terminal error text to identify a missing toolchain, SDK or code issue.

## Security

Only built-in allowlisted actions are accepted; commands are launched directly without interpolation into `cmd.exe`. No telemetry or cloud service is implemented. The demo browser action opens example.com.

## License

MIT. See [LICENSE](LICENSE).
