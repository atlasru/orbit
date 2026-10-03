# Orbit

A free, local-first radial launcher for **Windows 10/11 x64**, built with Rust and Tauri 2. MIT. No account, telemetry, database, or required server.

Version **0.2.0** replaces the early visual prototype. Desktop features are implemented; hardware validation remains an explicit release gate. See [validation](docs/VALIDATION.md) for automated coverage and the Windows checklist.

## Install and open

Download **orbit-windows-x64** from a successful [Windows build](https://github.com/atlasru/orbit/actions/workflows/windows-build.yml). It contains the portable `orbit.exe` and a per-user NSIS installer. WebView2 Runtime is required; the installer can install the Runtime when missing. Orbit itself works offline after installation.

Start `orbit.exe`. Orbit stays in the notification area. On first launch, the editor opens. Left-click the tray to toggle the launcher; right-click for **Open Orbit**, **Editor and Settings**, or **Quit Orbit**. Starting Orbit again activates the existing application.

**Alt+Space** opens the launcher on the monitor containing the active foreground window. If another application owns it, Orbit keeps running, reports the conflict in the editor, and tries **Alt+Shift+Space**. The tray always provides access. Change the requested shortcut in Settings and Save.

## Launcher

- Root hub, SVG icons and up to eight nodes per page.
- Hover/click, arrows, Enter, Escape, 1–8, Tab, PageUp/PageDown.
- Backspace returns one menu; Home returns to the root. Click the hub to go back, or open the editor at the root.
- Nested submenus have no model depth limit. Profiles switch from the launcher without restart.
- Reusable hidden WebView2 launcher; no launcher taskbar entry. Focus loss and background clicks can close it. Action close behavior and delay are configurable.

## Actions and editor

Application and Command actions store **executable, argument array, and optional working directory separately**. Orbit starts the executable directly, with no automatic `cmd.exe` or PowerShell wrapper. Arguments are literal strings. `%VARIABLE%` expansion applies to executable, file/folder and working-directory paths, not arguments.

Files/folders use Windows default handlers; URLs accept `https`, `http`, or `mailto`. The predefined system actions are Windows Settings, Task Manager, Explorer, Windows Terminal (requires installation), and Lock Workstation. Lock asks for confirmation in the launcher. Sleep/shutdown/restart and implicit shell execution are intentionally outside this version.

The editor supports create/edit/delete/duplicate, type and parent changes, submenu creation, drag/reorder, custom PNG/JPEG/ICO icons, native file/application icons, fallback SVG icons, Undo/Redo, save, profile CRUD, and JSON import/export with embedded icons. Drag before another node to reorder; Shift+drop on a submenu to move inside it. Moving through **Parent menu** also works. Apply a node form to put it into the draft; Save commits the draft. Undo/Redo covers up to 60 draft operations and resets after Save. `Ctrl+S` saves; `Ctrl+Z`/`Ctrl+Shift+Z` act on the draft when focus is outside text inputs.

Preview uses the real launcher window with an execution guard in Rust and in the frontend. Import does not execute actions. Imported executable/command nodes stay disabled until explicitly reviewed, enabled in the editor, and saved. Other imported actions still require deliberate activation. Preview never executes any action.

## Settings and persistence

Shortcut, Windows startup, tray click, action closing/delay, focus loss, English/Russian language infrastructure, opacity, accent, animations, Reduced Motion, labels, scale, monitor policy, keyboard mode, and active profile are configurable.

Dark Glass is the default. Optional native acrylic applies to the editor, with dark surfaces as fallback. The radial launcher uses translucent shaped surfaces, without a rectangular native acrylic backdrop. Some secondary help/confirmation text remains English.

User data lives under `%APPDATA%\dev.atlasru.orbit`:

```text
config.json              schema-2 manifest, settings, active profile
profiles/*.json          immutable schema-1 profile generations
icons/*.png              normalized local custom icons
backups/last-good.json   previous valid manifest
backups/corrupt-*.json   preserved damaged configuration
backups/pre-migration-*  migration originals
logs/orbit.log           local bounded diagnostic log
```

Profile files are committed before the manifest. Each replacement is atomic and flushed. Invalid drafts never replace the current config. Damaged configuration loads the last valid backup, or safe defaults when none exists, and displays a recovery message. The damaged original is preserved before any later save. Older profile generations are retained for recoverability; automatic garbage collection is not implemented.

## Development

Requirements: Windows x64, Node.js 22+, Rust stable MSVC, Visual Studio C++ Build Tools/Windows SDK, and WebView2 Runtime.

```powershell
git clone https://github.com/atlasru/orbit.git
cd orbit
npm ci
npm run tauri dev
```

This command starts Vite at **http://127.0.0.1:1420**, compiles Rust, and starts the desktop process. `strictPort: true` makes a port conflict fail explicitly. Committed Windows icons remove startup icon generation from the critical path. Use the tray when the warmed launcher is hidden. **`npm run dev` alone is only a frontend server, not Orbit.** A browser page displays a desktop-runtime warning and cannot run actions.

```powershell
npm run tauri build
```

Bundled output: `target/release/orbit.exe` and `target/release/bundle/nsis/*-setup.exe`. Production loads embedded assets; it requires no Vite/localhost server. The `tauri.localhost` WebView2 asset origin is internal to Tauri, not a network server.

Checks:

```powershell
npm run build
npm test
npm run test:dev
npm run test:ui
cargo fmt --all -- --check
cargo check --workspace --locked
cargo test --workspace --locked
```

Frontend tests use mocked IPC and do not establish native Windows behavior. Windows CI additionally launches the built production executable and exercises real WebView2/IPC and native keyboard input. Its isolated `--smoke-test <directory>` mode does not change normal app data or startup registration. `--action-fixture <file> <text>` is the internal child-process fixture used to verify literal argument execution.

## Architecture

- `crates/orbit-core`: typed schemas, iterative tree validation, atomic generation-based storage/recovery, physical-coordinate DPI geometry.
- `src-tauri/src/app.rs`: persistent launcher, lazy reusable editor, tray, shortcut conflict/fallback, placement/focus/lifecycle.
- `src-tauri/src/native.rs`: Windows monitor/DPI APIs, ShellExecute, direct process execution, HKCU startup entry.
- `src-tauri/src/commands.rs`: typed/validated IPC, optimistic revision checks, execution and preview guards, profile bundles, icon dialogs.
- `src-tauri/src/icons.rs`: Windows icon extraction and bounded custom-image normalization.
- `src/{launcher,editor,model,navigation,types,ipc}.ts`: lightweight framework-free UI, typed IPC map, tree editing/history, radial navigation.
- `scripts`, `tests`, `.github/workflows/windows-build.yml`: unit/UI tests and actual Windows build/runtime evidence.

See [manual validation](docs/VALIDATION.md), [security](docs/SECURITY.md), and [LICENSE](LICENSE).
