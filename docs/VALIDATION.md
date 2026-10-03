# Validation and release gate

Compilation, browser interaction tests, and real Windows runtime checks are distinct. Hardware checks below are not declared passed by a green build.

## Automated

Windows GitHub Actions runs `npm ci`, TypeScript/Vite build, 12 TypeScript model/navigation tests, a Vite strict-port/URL test, 10 Playwright interaction tests using mocked IPC, Rust formatting/check/tests, a Tauri Windows release build with NSIS installer, full `npm run tauri dev` desktop startup smoke tests, and production EXE smoke tests.

Rust tests cover schema/IPC fixtures, all action types, tree cycles/duplicate IDs/invalid parents, 5000-level nesting, import trust, path/URL validation, atomic persistence, damaged config/missing profile recovery, migration backups, monitor geometry at 100/125/150/200% with negative monitor coordinates, environment expansion, missing executable errors, and import/icon validation.

The development smoke suite runs the actual npm/Tauri command, checks Vite’s pinned URL, and exercises the desktop windows. The production smoke suite uses a disposable data directory. It verifies actual application startup, tray initialization, bundled WebView2 loading with no Vite, forced Alt+Space conflict and Alt+Shift+Space fallback, native `SendInput` shortcut/Escape, foreground-monitor work-area centering on the runner's monitor, reused native window handle, second-instance activation, old close-delay timer cancellation, real frontend navigation/nested menus/paging, direct process execution with spaces/metacharacters/Unicode preserved, frontend+Rust preview guards, actual editor form handlers/Undo/Redo/save/profile switching, restart persistence, and corrupted-manifest backup recovery. It does not launch external URLs or lock the CI workstation.

Artifacts: `orbit-windows-x64` (EXE/installer) and `orbit-validation` (runtime JSON, local logs, UI failure screenshots). Smoke modes and `--action-fixture` are explicit test-only invocations; normal startup does not run test code.

## Real Windows 10 and Windows 11 checklist — pending

Use the portable production EXE with Node/Vite stopped. Repeat startup and launcher checks on both OS versions; keep results with OS build, WebView2 version, display layout/scaling and commit SHA.

1. First start: editor appears, tray icon exists, launcher has no taskbar button. Quit from tray. Start again: settings/tree remain. Starting a second copy activates the first; exactly one Orbit host process remains (WebView2 helper processes are expected).
2. Alt+Space opens within a perceptually instant interval after warm-up. Hold shortcut: no repeated toggling from key auto-repeat. Test busy shortcut with PowerToys/another launcher: visible conflict, working fallback or tray, Settings change and Save immediately re-register.
3. Escape, outside-window click with Close on focus loss enabled, and transparent-area background click hide it. Reopen repeatedly; focus accepts arrows/Enter without an extra click. Hide restores the previous application when appropriate, without stealing focus after an action or outside click.
4. Mouse hover/click, all cardinal arrows, sequential keyboard mode, Tab/Shift+Tab, 1–8, Enter, Escape, Home, Backspace, PageUp/PageDown. Check 0, 1, 2, 8, 9, 17 nodes and at least 4 submenu levels. Long labels truncate cleanly. Empty submenu can return to root.
5. Application: an executable under a path containing spaces; separate arguments including spaces, quotes, `& | ^ %`, Unicode; valid and missing working directories; missing executable. Command: normal CLI program, no surprise console window/intermediary shell. Failures remain visible and usable.
6. File with spaces/Unicode opens in the configured Windows handler. Folder opens Explorer. `https`, `http`, and `mailto` use default handlers. Windows Settings, Task Manager, Explorer, installed Windows Terminal work. Missing Terminal reports an error. Lock cancels without locking; explicit confirmation locks.
7. Editor: every node type, path picker, args JSON validation, type change from populated submenu rejected, custom PNG/JPEG/ICO, native EXE/file icon extraction, fallback icon, duplicate/delete subtree, drag reorder, Shift+drop into a submenu, move through Parent menu, cycle prevention, Undo/Redo, Save/restart. Unsaved close prompts; Cancel retains draft.
8. Profiles: create/rename/duplicate/delete (last profile protected), switch in launcher, activate in editor, persistence. Export/import custom-icon profile. Imported executable/command remains blocked until reviewed/enabled/saved. Import/preview/editor configuration must not start a process; preview permits submenu/page navigation only.
9. Settings: launch at startup creates/removes HKCU Run entry. Sign out/reboot to verify silent tray startup; no autostart when disabled. Test tray left-click modes, action close toggle and 0/500/5000 ms delay, reopen during delay (old timer must not close a new invocation), opacity/accent/scale/labels/animations/Reduced Motion, both languages. Acrylic failure falls back to readable dark surfaces. OS Reduced Motion also suppresses frontend animations.
10. Recovery: exit, back up app data, corrupt `config.json`, restart; recovery warning and preserved corrupt file. Save recovered state and restart. Remove referenced profile file and verify recovery. Test malformed import and invalid arguments without modifying current config. Logs remain local.

## DPI and two monitors — pending hardware checks

For **each** scale **100%, 125%, 150%, 200%**:

- Set display scaling, open from foreground app on that display. Center is in the work area, not under taskbar; window/node sizes match launcher-scale setting, text sharp, hover hitboxes aligned.
- Change scale while Orbit remains resident. Reopen and verify new physical size/center, keyboard focus and hitboxes. Test smallest available monitor/work area: launcher fits.

Two-monitor matrix:

- Same DPI on both, then mixed 100/150 and 125/200. Place secondary left of and above primary (negative physical coordinates), then right. Move foreground app across monitors and reopen.
- Foreground on monitor A, cursor on B: foreground policy must choose A. Cursor policy must choose B. Primary policy must choose primary. When foreground is an Orbit window or unavailable, cursor fallback must be sensible.
- Taskbar on each edge, display disconnect/reconnect, primary display change, maximized foreground app, window straddling monitors, remote desktop reconnect.
- Reopen at least 30 times across displays; confirm reused launcher WebView2, no accumulating Orbit host processes, no clipped or shifted controls.

Measure warm open latency and idle CPU/RAM on a normal Windows machine. No performance numbers are asserted without measurements. Windows signatures/SmartScreen handling and installer behavior require manual checks; this build is unsigned.
