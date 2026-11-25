const assert = require('assert');
const { QUIET_MS, onOutput, onTick, onHook, statusOf } = require('./status');

const t = {};
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

console.log('ok');
