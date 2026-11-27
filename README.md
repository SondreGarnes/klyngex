<p align="center"><img src="terminal-agent-app-icons/icon_128x128.png" width="96" alt="Klyngex icon"></p>

# Klyngex

Parallel terminal workspace for coding agents.

Run several terminals side by side in one window. When an agent finishes or asks a question, its terminal gets a blue ring, the taskbar flashes (on a Mac the Dock icon bounces) and a notification tells you which one it was.

![Four terminals side by side; the one whose agent has finished has a blue ring](docs/screenshot.png)

## Features

- **Side by side or one at a time.** A grid that always fills the window, or a single terminal. Zoom any pane to full size and back. Drag the names in the sidebar to reorder. Hide a terminal to let it run in the background, or sort terminals into groups that each have their own side by side.
- **See who needs you, and why.** A waiting terminal says whether its agent finished or needs permission, and for how long. The ring stays until something is running in that terminal again.
- **Exact status for Claude Code.** Agents started with `+ Agent` report through Claude Code hooks, so the ring appears the moment Claude stops or asks for permission.
- **Subagents in a folder.** When a Claude Code agent starts subagents, they appear under its terminal in the sidebar. Click one to read along with what it is doing; Esc goes back to the terminal.
- **Answer from the sidebar.** When Claude Code agents ask for permission, their questions queue up at the top of the sidebar, longest waiting first, with what they want to run. Yes or No there answers without switching terminal.
- **A warning when two agents edit the same file.** Both are marked in the sidebar with the file and the other agent's name.
- **Where each agent stands.** Each Claude Code agent shows how many files it has edited and commands it has run since your last prompt.
- **Worktree agents.** `+ Worktree agent` starts Claude Code in a new git worktree of the repo you pick: a separate copy on its own branch, so parallel agents do not overwrite each other. A line under the agent shows what it has changed, with buttons to read the changes, merge them into your branch, or delete the copy.
- **Works with anything else too.** Other programs are tracked by their output: a terminal that printed while you were away and then went quiet is flagged.
- **Picks up where you left off.** Names and folders come back after a restart, and Claude Code sessions reopen with their conversation.
- **The usual terminal comforts.** Search, Ctrl+click on links (Cmd+click on a Mac), adjustable text size, an optional tone when a terminal starts waiting.

## Status

Early. Windows, and macOS on Apple Silicon. The Mac version is new and less tested. Linux support will come.

## Install

Download `Klyngex-Setup.exe` from [klyngex.com](https://klyngex.com) or the [latest release](https://github.com/SondreGarnes/klyngex/releases/latest) and run it. The installer is not code-signed yet, so Windows shows a "Windows protected your PC" warning: choose "More info", then "Run anyway".

**Mac (Apple Silicon):** download `Klyngex-arm64.dmg` from the [latest release](https://github.com/SondreGarnes/klyngex/releases/latest), open it and drag Klyngex to Applications. The app is not signed with an Apple certificate, so macOS refuses to open it the first time: try to open it once, then go to System Settings, Privacy & Security, and choose "Open Anyway". If macOS instead says the app is damaged, run `xattr -cr /Applications/Klyngex.app` in Terminal and open it again. macOS also asks once per folder (Documents, Desktop, Downloads) whether Klyngex may read it, and asks again after each new version because the app is not signed. The Mac version does not update itself, so download the new disk image when there is a new release.

The Windows installer also adds two commands, `klyngex` and the shorter `kx`. Type either in any terminal to open Klyngex with a terminal in that folder; if Klyngex is already open, the terminal is added to it.

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
| Ctrl+Shift+A | Jump to the terminal that has waited longest for input; again for the next |
| Ctrl+1 to Ctrl+9 | Jump to the terminal with that number in the sidebar |
| Ctrl+Shift+Y / Ctrl+Shift+N | Answer yes / no to the first permission question in the inbox |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous terminal |
| Ctrl+Shift+T / Ctrl+Shift+W | New terminal / close terminal |
| Ctrl+Shift+G | Side by side on or off |
| Ctrl+Shift+Z | Zoom the current terminal |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Move the current terminal earlier / later |
| Ctrl+Shift+F | Search in the current terminal |
| Ctrl+plus / Ctrl+minus / Ctrl+0 | Larger / smaller / default text |
| Ctrl+click (Cmd+click on a Mac) | Open a web link |
| Shift+Enter | New line (in Claude Code and PowerShell) |
| Ctrl+C / Ctrl+V (Cmd+C / Cmd+V on a Mac) | Copy the selection / paste |

Double-click a name in the sidebar to rename a terminal. Double-click a pane header to zoom it.

## Settings

The `Settings…` button at the bottom of the sidebar opens a settings page:

- **Shell** and **shell arguments**: what every new terminal runs. Shells found on your computer are offered, for example PowerShell, Command Prompt, WSL or Git Bash (zsh or bash on a Mac), or type a path.
- **Agent command**: what the agent buttons start. Any command works; reopening after a restart, worktrees and exact status are Claude Code's and only apply when it is `claude`.
- **Text size**, and a **tone** when a terminal starts needing input.
- **Track Claude Code sessions I start by typing `claude`**: see below.

Shell and agent changes apply to the next terminal you open. Following `cd` in the sidebar works out of the box in PowerShell; other shells need to report their folder themselves (OSC 7). The version you are running is shown under the Settings button.

## How "needs input" works

- **Claude Code agents started from the app** are launched with `--settings claude-hooks.json`. Its hooks send Claude Code's own event to a small server that Klyngex runs on `127.0.0.1`, using a per-terminal address in the `KLYNGEX_HOOK` environment variable. Nothing is added to your own Claude Code settings.
- **Claude Code sessions you start by typing `claude`** are tracked the same way if you tick that option on the settings page. That adds the same hooks to your Claude Code `settings.json` (a backup is saved next to it) and switching it off removes them again. The hooks do nothing outside Klyngex.
- **Everything else** is read off the screen once output you did not see has stopped. Something that is just running, like a dev server, finishes its lines and leaves the cursor at the start of an empty one, so it is never flagged however much it logs. Anything else is taken to be waiting for you: a shell back at its prompt, a question such as `Continue? (y/n)`, or an agent showing its own input box. A terminal bell always flags. This is a rule of thumb: a line left unfinished on purpose (`Installing... `) is flagged too, and a program that keeps redrawing its screen while it waits is not.

## Development

```
npm test        # the status and hook rules
npm run dist    # build the installer for the system you are on into dist/
```

Pushing a tag such as `v0.1.0` (matching `version` in `package.json`) builds the Windows installer and the Mac disk image on GitHub and publishes them as a release.

Plain Electron with [xterm.js](https://xtermjs.org) and [node-pty](https://github.com/lydell/node-pty). No bundler and no framework. `CLAUDE.md` describes where things are. The landing page for klyngex.com is `docs/index.html`.

## License

[MIT](LICENSE)
