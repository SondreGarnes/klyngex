# Klyngex

Parallel terminal workspace for coding agents. Electron app: many terminals in one window, sidebar shows which one needs input.

## Commands
- Run: `npm start`
- Test: `npm test`

## Where things are
- `main.js`: window and the pty processes (`@lydell/node-pty`, prebuilt, no compiler needed).
- `preload.js`: the only bridge between the two sides (`window.api`).
- `renderer.js`: sidebar, xterm.js terminals, shortcuts.
- `status.js`: the "needs input" rule, shared by the renderer and `test.js`.
- `claude-hooks.json`: Claude Code hooks passed with `--settings` to agents started from the app. They call the local HTTP server in `main.js` using the `KLYNGEX_HOOK` env var each terminal gets.

## Conventions
- No bundler, no framework. Plain scripts loaded by `index.html`.
- The renderer never gets Node access; add to `preload.js` instead.
