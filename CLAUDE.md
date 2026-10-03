# CLAUDE.md - AI Assistant Guide for Append HMI Desktop

## Project Overview

Append HMI Desktop (Append Automation) runs Append HMI Studio projects (`.ahmi`) on operator PCs, without the editor.

- **Command line:** `append-hmi-desktop project.ahmi` runs a project.
- **Launcher:** with no argument, a launcher window picks a file and offers Run now, desktop shortcut, menu entry and run at login.
- **Repository:** https://github.com/AppendAutomation/AppendHMIDesktop
- **License:** Apache 2.0 (`LICENSE`, `NOTICE`)

## Quick Reference

```bash
git clone --recursive https://github.com/AppendAutomation/AppendHMIDesktop.git
npm install
npm run build-comms        # hmi-comms into studio/comms/publish (needs the .NET 8 SDK)
npm start                  # launcher; npm start -- file.ahmi runs one (HMI_ENV=dev opens DevTools)
npm test                   # Node unit tests
npm run dist-win           # Windows x64 installer (on Linux too; no wine) -> dist/
npm run dist-linux         # AppImage + deb -> dist/
node scripts/make-icons.mjs  # icons from build/icon.svg (inkscape + ImageMagick)
```

## Structure

```
src/main/main.js            Main process: args, single instance, launcher + one window per project, runtime IPC, comms
src/main/args.js            Command line (and the app folder in a second instance's reordered argv)
src/main/project.js         Run settings from the .ahmi XML (<hmiProject><settings><runtime .../>)
src/main/shortcuts.js       .lnk (shell.writeShortcutLink) / .desktop shortcuts, menu entries, login start
src/main/settings.js        userData/settings.json (recent projects)
src/main/launcher-preload.cjs  The launcher's fixed IPC surface
src/launcher/               Launcher page (plain HTML/CSS/JS, strict CSP)
scripts/nsis.mjs            Installer script (Run verb, ProgID only when .ahmi is unclaimed)
studio/                     Submodule: AppendHMIStudio (drawio fork, comms server, main-process stores)
```

## How it reuses the Studio

- **Renderer:** each project window loads `studio/drawio/src/main/webapp/index.html` with `chrome=0&hmiruntime=1`, so Studio's run-only renderer (`js/hmi/HmiRuntimeApp.js`) runs it.
  - `main.js` answers the same `rendererReq` actions Studio answers for a published package: `hmiRuntime.*`, `hmiComms.*`, `hmiAlarms.*`, `hmiRetentive.*`, `hmiUsers.*` and `hmiRecipes.*` (CSV export and import through the OS dialog).
  - Those actions are handled per window.
- **Imported from `studio/src/main`, unchanged:**
  - `runtime/RuntimeMode.js`: window options, exit check, project reader;
  - `comms/*`, `alarms/AlarmLog.js`, `retentive/RetentiveStore.js`, `security/UserStore.js`, `recipes/RecipeStore.js`;
  - `electron-preload.js`, the project windows' preload.
- **Stores:** a project's store name is its file name without the extension (`HmiRuntimeApp.info.productName`).
- **Changing the runtime:** make the change in AppendHMIStudio first, then move the submodule. Keep the IPC protocol in step.

## Packaging

- **Allowlist:** the `files` arrays in both builder configs list only what the runner loads.
  - The list was measured on a running project; `src/test/packaging.test.js` pins it.
  - A new file that the runtime loads must be added to both configs.
- **`electronLanguages`:** `en-US` only; the renderer runs with `appLang=en`.
- **Comms server:** `studio/comms/publish/<platform>-x64` → `resources/comms`.
- **Windows:** electron-builder builds `--dir` only; `scripts/dist-win.mjs` compiles the installer with the fetched makensis (`build/nsis`, git-ignored). Unsigned.

## Behaviour to keep

- **Exit policy:** project windows close only as the project's exit policy allows: Ctrl+Alt+Shift+Q, the password prompt, or never.
  - The operating system always wins: `before-quit` (Linux SIGTERM/SIGINT) and `session-end` (Windows).
- **Single instance:** a second start hands its project to the running instance. A project already open is focused.
- **Launcher paths:** the launcher may act only on paths from the OS dialog, the command line or the recent list (`allowedPaths`).
- **File loads:** local file loads are limited to the web app and the launcher, and the CSP matches Studio's.

## Code Style

- ES modules in the main process, Tab indentation, Allman braces, sparse comments.
- US spelling in UI text and comments.

## Testing

- `npm test` runs args, project parsing, shortcuts (Linux for real, Windows through a fake shell), settings, the NSIS script (compiled with makensis when fetched) and packaging checks.
- End to end:
  - run a project from source or a package, and check `logs/main.log` in userData;
  - on the Windows test box: install `/S`, then `--create-shortcut`, `--startup`, run and uninstall.
