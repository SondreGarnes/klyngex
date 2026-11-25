<p align="center"><img src="terminal-agent-app-icons/icon_128x128.png" width="96" alt="Klyngex icon"></p>

# Klyngex

Parallel terminal workspace for coding agents.

Run several terminals side by side in one window. When an agent finishes or asks a question, its terminal gets a blue ring, the taskbar flashes and a notification tells you which one it was.

![Four terminals side by side; the one whose agent has finished has a blue ring](docs/screenshot.png)

## Features

- **Side by side or one at a time.** A grid that always fills the window, or a single terminal. Zoom any pane to full size and back. Drag the names in the sidebar to reorder.
- **See who needs you, and why.** A waiting terminal says whether its agent finished or needs permission, and for how long. The ring stays until something is running in that terminal again.
- **Exact status for Claude Code.** Agents started with `+ Agent` report through Claude Code hooks, so the ring appears the moment Claude stops or asks for permission.
- **Worktree agents.** `+ Worktree agent` starts Claude Code in a new git worktree of the repo you pick, so parallel agents do not overwrite each other.
- **Works with anything else too.** Other programs are tracked by their output: a terminal that printed while you were away and then went quiet is flagged.
- **Picks up where you left off.** Names and folders come back after a restart, and Claude Code sessions reopen with their conversation.
- **The usual terminal comforts.** Search, Ctrl+click on links, adjustable text size, an optional tone when a terminal starts waiting.

## Status

Early. Windows only for now; macOS and Linux support will come.

## Install

Download `Klyngex-Setup.exe` from [klyngex.com](https://klyngex.com) or the [latest release](https://github.com/SondreGarnes/klyngex/releases/latest) and run it. The installer is not code-signed yet, so Windows shows a "Windows protected your PC" warning: choose "More info", then "Run anyway".

## Run from source

Requires [Node.js](https://nodejs.org) 20 or newer. The agent buttons also need [Claude Code](https://claude.com/claude-code) on your PATH.

```
git clone https://github.com/SondreGarnes/klyngex.git
cd klyngex
npm install
npm start
```

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Shift+A | Jump to the next terminal that needs input |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous terminal |
| Ctrl+Shift+T / Ctrl+Shift+W | New terminal / close terminal |
| Ctrl+Shift+G | Side by side on or off |
| Ctrl+Shift+Z | Zoom the current terminal |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Move the current terminal earlier / later |
| Ctrl+Shift+F | Search in the current terminal |
| Ctrl+plus / Ctrl+minus / Ctrl+0 | Larger / smaller / default text |
| Ctrl+click | Open a web link |
| Shift+Enter | New line (in Claude Code and PowerShell) |
| Ctrl+C / Ctrl+V | Copy the selection / paste |

Double-click a name in the sidebar to rename a terminal. Double-click a pane header to zoom it.

## Settings

The `Settings…` button opens a small JSON file:

```json
{
  "shell": "powershell.exe",
  "shellArgs": [],
  "agent": "claude"
}
```

- `shell` and `shellArgs` choose what every new terminal runs, for example `pwsh.exe`, or `C:/Program Files/Git/bin/bash.exe` with `["-i"]`.
- `agent` is the command the agent buttons start. Any command works; the worktree, resume and exact-status features are Claude Code's and only apply when it is `claude`.

Changes apply to the next terminal you open. Following `cd` in the sidebar works out of the box in PowerShell; other shells need to report their folder themselves (OSC 7).

## How "needs input" works

- **Claude Code agents started from the app** are launched with `--settings claude-hooks.json`. Its hooks send Claude Code's own event to a small server that Klyngex runs on `127.0.0.1`, using a per-terminal address in the `KLYNGEX_HOOK` environment variable. Nothing is added to your own Claude Code settings.
- **Claude Code sessions you start by typing `claude`** are tracked the same way if you switch on `Track typed claude`. That adds the same hooks to your Claude Code `settings.json` (a backup is saved next to it) and switching it off removes them again. The hooks do nothing outside Klyngex.
- **Everything else** uses a rule of thumb: output that arrived while you were not looking, followed by 2.5 seconds of silence, or a terminal bell. A long silent command can trip it.

## Development

```
npm test        # the status and hook rules
npm run dist    # build dist/Klyngex-Setup.exe
```

Pushing a tag such as `v0.1.0` (matching `version` in `package.json`) builds the installer on GitHub and publishes it as a release.

Plain Electron with [xterm.js](https://xtermjs.org) and [node-pty](https://github.com/lydell/node-pty). No bundler and no framework. `CLAUDE.md` describes where things are. The landing page for klyngex.com is `docs/index.html`.

## License

[MIT](LICENSE)
