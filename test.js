const assert = require('assert');
const { QUIET_MS, onOutput, onTick, onHook, statusOf, inView } = require('./status');

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

console.log('ok');
