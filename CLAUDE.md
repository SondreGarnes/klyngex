# Klyngex

Parallel terminal workspace for coding agents. Electron app: many terminals in one window, sidebar shows which one needs input.

## Commands
- Run: `npm start`
- Test: `npm test`

## Where things are
- `main.js`: window, the pty processes (`@lydell/node-pty`, prebuilt, no compiler needed), the local hook server, the settings files.
- `preload.js`: the only bridge between the two sides (`window.api`).
- `renderer.js`: sidebar, xterm.js terminals, shortcuts, layout, restore.
- `status.js`: the "needs input" rule, shared by the renderer and `test.js`.
- `claude-hooks.json`: Claude Code hooks passed with `--settings` to agents started from the app. They POST Claude Code's hook JSON to the server in `main.js`, using the `KLYNGEX_HOOK` env var each terminal gets.
- `transcript.js`: finds and parses a subagent's transcript for the read-only view (the folder under a terminal in the sidebar). Shared by `main.js` and `test.js`.
- `worktree.js`: the git commands behind the line under a worktree agent (what it changed, merge, delete). Shared by `main.js` and `test.js`.
- `hooks-install.js`: adds or removes those hooks in the user's own Claude Code settings (the tracking option on the settings page).
- `docs/`: the landing page for klyngex.com (`index.html`, one file, no build) and the README screenshot.

## Conventions
- No bundler, no framework. Plain scripts loaded by `index.html`.
- The renderer never gets Node access; add to `preload.js` instead.
- Terminal output and hook payloads are untrusted: validate in `main.js` before using them in a command or opening anything.
- Windows and macOS (Apple Silicon, not signed). The Mac side is written on Windows, so say what was not run on a Mac. Do not claim Linux or Intel Mac support in the README or the landing page.
