const assert = require('assert');
const { QUIET_MS, onOutput, onTick, onHook, statusOf, inView, nextWaiting, clashes, CLASH_MS } = require('./status');

// A shell whose command has finished: it is back at its prompt.
const t = { atPrompt: true };
assert.equal(statusOf(t), 'idle');

// Output nobody saw, then quiet: flag it.
onOutput(t, 0, false);
onTick(t, QUIET_MS - 1);
assert.equal(statusOf(t), 'working');
onTick(t, QUIET_MS);
assert.equal(statusOf(t), 'attention');

// Time passing does not clear the flag; only something running again does.
onTick(t, 9000);
assert.equal(statusOf(t), 'attention');
onOutput(t, 10000, true);
assert.equal(statusOf(t), 'working');

// It ran and stopped while you watched: no new flag.
onTick(t, 10000 + QUIET_MS);
assert.equal(statusOf(t), 'idle');

// You looked away while it was still working: flag it when it stops.
onOutput(t, 20000, true);
onOutput(t, 21000, false);
onTick(t, 21000 + QUIET_MS);
assert.equal(statusOf(t), 'attention');

// --- Something still running (no prompt since the command was entered) ---
// A dev server: every line is finished, so the cursor rests at the start of an empty line.
// Never flagged, not for a single request and not for a long stretch of logging.
const server = { atPrompt: false };
onOutput(server, 0, false);
onTick(server, QUIET_MS, 'line-start');
assert.equal(statusOf(server), 'idle');
for (let at = 10000; at <= 20000; at += 200) onOutput(server, at, false);
onTick(server, 20000 + QUIET_MS, 'line-start');
assert.equal(statusOf(server), 'idle');
// A program that stops to ask a question: flagged, however little it printed.
const asking = { atPrompt: false };
onOutput(asking, 0, false);
onTick(asking, QUIET_MS, 'input');
assert.equal(statusOf(asking), 'attention');
// An agent that draws its own input box with the cursor hidden: flagged when it goes quiet.
const tui = { atPrompt: false };
onOutput(tui, 0, false);
onTick(tui, QUIET_MS, 'hidden');
assert.equal(statusOf(tui), 'attention');
// The server's command ends and the prompt returns: now it is flagged.
onOutput(server, 30000, false);
server.atPrompt = true;
onTick(server, 30000 + QUIET_MS, 'input');
assert.equal(statusOf(server), 'attention');

// --- With Claude Code hooks ---
const h = {};
onHook(h, 'start', 0);
assert.equal(statusOf(h), 'idle');

// Turn finished: flagged even while watched, and repaints or typing do not clear it.
onHook(h, 'working', 1000);
assert.equal(statusOf(h), 'working');
onHook(h, 'stop', 2000);
onOutput(h, 2100, true);
h.acted = true;
onOutput(h, 3000, true);
onHook(h, 'notify', 60000); // idle reminder
h.acted = true;
onOutput(h, 61000, true);
assert.equal(statusOf(h), 'attention');
onHook(h, 'working', 62000);
assert.equal(statusOf(h), 'working');

// Permission prompt: stays flagged until you press a key and output follows.
onHook(h, 'notify', 70000);
onOutput(h, 70100, true);
assert.equal(statusOf(h), 'attention');
h.acted = true;
onOutput(h, 71000, true);
assert.equal(statusOf(h), 'working');

// Silence never flags a hooked terminal; claude exiting hands it back to the output rule.
onOutput(h, 80000, false);
onTick(h, 80000 + QUIET_MS);
assert.equal(statusOf(h), 'idle');
onHook(h, 'stop', 90000);
onHook(h, 'end', 91000);
assert.equal(statusOf(h), 'idle');
assert.equal(h.hooked, false);

h.exited = true;
assert.equal(statusOf(h), 'exited');

// Why it needs you: finished, permission, or just input.
const w = {};
onHook(w, 'working', 0);
onHook(w, 'stop', 1000);
assert.equal(w.why, 'finished');
onHook(w, 'notify', 61000, 'idle_prompt'); // reminder keeps the reason
assert.equal(w.why, 'finished');
onHook(w, 'working', 62000);
onHook(w, 'notify', 63000, 'permission_prompt');
assert.equal(w.why, 'needs permission');
assert.equal(w.keyClears, true);
const q = { atPrompt: true };
onOutput(q, 0, false);
onTick(q, QUIET_MS);
assert.equal(q.why, 'needs input');

// --- Which terminals side by side shows ---
const a1 = { group: '' }, a2 = { group: '', hidden: true }, b1 = { group: 'api' };
assert.equal(inView(a1, a1), true);
assert.equal(inView(a2, a1), false); // hidden: runs in the background
assert.equal(inView(a2, a2), true); // but shows while it is the selected one
assert.equal(inView(b1, a1), false); // another group has its own view
assert.equal(inView(a1, undefined), false);

// --- Installing the hooks into someone's Claude Code settings ---
const { isInstalled, install, uninstall } = require('./hooks-install');
const ours = require('./claude-hooks.json').hooks;
const theirs = {
  model: 'opus',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }],
  },
};
const before = JSON.stringify(theirs);
const added = install(theirs, ours);
assert.equal(JSON.stringify(theirs), before); // input untouched
assert.equal(isInstalled(theirs), false);
assert.equal(isInstalled(added), true);
assert.equal(added.model, 'opus');
assert.equal(added.hooks.Stop.length, 2); // theirs kept, ours added
assert.equal(added.hooks.PreToolUse.length, 1);
assert.equal(install(added, ours).hooks.Stop.length, 2); // installing twice does not duplicate
assert.deepEqual(uninstall(added), theirs); // and removing restores exactly what was there
assert.deepEqual(uninstall(install({}, ours)), {});
// Every hook is the same command and does nothing without the env var.
for (const entries of Object.values(ours)) assert.ok(entries[0].hooks[0].command.includes('KLYNGEX_HOOK;if(u)'));

// --- Subagent transcripts ---
const { subagentFile, entriesOf } = require('./transcript');
const path = require('path');
const projects = path.resolve('/home/.claude/projects');
const session = path.join(projects, 'proj', 'abc.jsonl');
assert.equal(subagentFile(projects, session, 'a1b2'), path.join(projects, 'proj', 'abc', 'subagents', 'agent-a1b2.jsonl'));
assert.equal(subagentFile(projects, session, '../../x'), null); // agent id cannot walk out
assert.equal(subagentFile(projects, path.resolve('/etc/abc.jsonl'), 'a1b2'), null); // nor can the path
assert.equal(subagentFile(projects, undefined, 'a1b2'), null);
const lines = [
  { type: 'user', message: { role: 'user', content: 'find the bug' } },
  { type: 'user', message: { role: 'user', content: '<system-reminder>\nnot the prompt' } },
  { type: 'api-request-blob',message: { role: 'assistant', content: [{ type: 'text', text: 'internal copy' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'a.js' }] } },
].map((l) => JSON.stringify(l));
assert.deepEqual(entriesOf([...lines, '{"half', ''].join('\n')), [
  { kind: 'prompt', text: 'find the bug' },
  { kind: 'text', text: 'Looking.' },
  { kind: 'tool', text: 'Bash  ls' },
]);

// Jumping goes to the one that has waited longest, then the next longest, then around again.
const w1 = { attention: true, since: 30 }, w2 = { attention: true, since: 10 }, w3 = { attention: true }, calm = {};
assert.equal(nextWaiting([w1, calm, w2, w3], calm), w2);
assert.equal(nextWaiting([w1, calm, w2, w3], w2), w1);
assert.equal(nextWaiting([w1, calm, w2, w3], w1), w3);
assert.equal(nextWaiting([w1, calm, w2, w3], w3), w2);
assert.equal(nextWaiting([calm], calm), undefined);

// Two agents editing the same file are told about each other, until the edits are old.
const e1 = { edits: new Map([['/r/a.js', 1000], ['/r/b.js', 1000]]) }, e2 = { edits: new Map([['/r/b.js', 2000]]) }, e3 = { edits: new Map([['/r/c.js', 2000]]) }, e4 = {};
const hit = clashes([e1, e2, e3, e4], 3000);
assert.deepEqual(hit.get(e1), { file: '/r/b.js', other: e2 });
assert.deepEqual(hit.get(e2), { file: '/r/b.js', other: e1 });
assert.equal(hit.size, 2); // a file only one of them touched is no clash
assert.equal(clashes([e1, e2], 1000 + CLASH_MS).size, 0); // one of the two edits is too old

// --- Worktree agents: needs git, and works in a folder of its own under the temp folder ---
(async () => {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const worktree = require('./worktree');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'klyngex-test-'));
  const wt = path.join(repo, '.claude', 'worktrees', 'x');
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'pipe' });
  try {
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'one');
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'worktree-x');

    assert.equal(await worktree.info(repo), null); // the repo itself is not a worktree
    assert.equal(await worktree.info(os.tmpdir()), null); // nor is a folder outside git
    assert.deepEqual(await worktree.info(wt), { branch: 'worktree-x', base: 'main', files: 0, added: 0, removed: 0, uncommitted: 0 });

    fs.writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n');
    assert.deepEqual(await worktree.info(wt), { branch: 'worktree-x', base: 'main', files: 1, added: 1, removed: 0, uncommitted: 2 });
    const shown = await worktree.diff(wt);
    assert.ok(shown.includes('+two') && shown.includes('not added to git yet: new.txt'));
    assert.match(await worktree.merge(wt), /not committed/); // nothing is merged behind uncommitted work
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').trim(), 'one');

    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'two');
    // The same line changed on main: the merge cannot go through, and main is left as it was.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nother\n');
    git(repo, 'commit', '-qam', 'other');
    assert.match(await worktree.merge(wt), /Could not merge/);
    assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=no').toString(), '');
    git(repo, 'reset', '-q', '--hard', 'HEAD~1');

    assert.equal(await worktree.merge(wt), '');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').replace(/\r/g, ''), 'one\ntwo\n');
    assert.equal((await worktree.info(wt)).files, 0); // all of it is in main now

    assert.equal(await worktree.remove(wt), '');
    assert.equal(fs.existsSync(wt), false);
    assert.equal(git(repo, 'branch', '--list', 'worktree-x').toString(), '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  console.log('ok');
})();
