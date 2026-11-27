# Contributing to Klyngex

Thanks for wanting to help. Klyngex is small on purpose, so this guide is too.

## Running it

You need [Node.js](https://nodejs.org) 20 or newer. Klyngex is developed on Windows; it also runs on macOS.

```
git clone https://github.com/SondreGarnes/klyngex.git
cd klyngex
npm install
npm start
```

`npm test` runs the tests for the "needs input" rules and the hook installer. `npm run dist` builds the installer for the system you are on into `dist/`.

`CLAUDE.md` lists what each file does. It is written for coding agents, and it is the quickest map for people too.

## Reporting a bug

Open an [issue](https://github.com/SondreGarnes/klyngex/issues) and include:

- the Klyngex version (the installer's release, or the commit if you run from source)
- your Windows or macOS version and which shell you use
- what you did, what you expected and what happened
- whether the terminal was a plain shell, an agent started with a button, or `claude` typed by hand

A terminal that was ringed when it should not have been, or was not ringed when it should have been, is a useful report. Say what was running in it.

## Suggesting a change

For anything larger than a small fix, open an issue first and describe what you want to do. It saves you from building something that does not fit.

Changes that are especially welcome:

- Linux support, and fixes from people who use Klyngex on a Mac
- exact status for agents other than Claude Code
- bug fixes with a test that shows the bug

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change small and about one thing.
3. Run `npm test`. If you change the rules in `status.js` or `hooks-install.js`, add a case to `test.js`.
4. Try the change in the running app, and say in the pull request what you tried.
5. Open the pull request against `main`. The test must pass before it can be merged.

House rules, so the code stays easy to read:

- No bundler, no framework, no build step. Plain scripts loaded by `index.html`.
- Do not add a dependency for something a few lines can do.
- The renderer never gets Node access. Anything that touches the system goes through `preload.js` to `main.js`.
- Treat terminal output and hook payloads as untrusted. Validate them in `main.js` before they reach a command line or the system.
- Write comments that say why, not what.

## Security problems

Please do not open a public issue for a security problem. Email sondre.garnaes@gmail.com instead, so it can be fixed before it is public.

## License

By contributing you agree that your contribution is released under the [MIT license](LICENSE).
