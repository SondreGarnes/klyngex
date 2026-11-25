// Loaded as a <script> by index.html and with require() by test.js.

// shortcut: without hooks, "needs input" means output arrived while you were not looking
// and then went quiet (or the bell rang), so a long silent command also trips it. Agents
// started with "+ Agent" report through Claude Code hooks instead (onHook), which is exact.
const QUIET_MS = 2500;

// Call for program output only, not the echo of your own typing.
// watching: this terminal is the selected one and the window has focus.
function onOutput(t, now, watching) {
  t.lastOutput = now;
  t.busy = true;
  if (t.hooked) {
    // Claude repaints after it stops, so output alone proves nothing. A permission prompt
    // has no "answered" hook, though: a key from you followed by output means it moved on.
    if (t.keyClears && t.acted) t.attention = false;
    return;
  }
  t.attention = false; // something is running again: the only thing that clears the flag
  if (!watching) t.unseen = true;
}

function onTick(t, now) {
  if (t.busy && now - t.lastOutput >= QUIET_MS) {
    t.busy = false;
    if (t.unseen) t.attention = true;
    t.unseen = false;
  }
}

// Events from claude-hooks.json: start, working (prompt submitted), notify (permission
// prompt or idle reminder), stop (turn finished), end (claude exited).
function onHook(t, event, now) {
  t.unseen = false;
  if (event === 'end') {
    t.hooked = false;
    t.attention = false;
  } else if (event === 'stop' || event === 'notify') {
    // A finished turn is only answered by a new prompt; the idle reminder must not weaken that.
    if (event === 'stop') t.keyClears = false;
    else if (!t.attention) t.keyClears = true;
    t.hooked = true;
    t.attention = true;
    t.acted = false;
  } else {
    t.hooked = true;
    t.attention = false;
    if (event === 'working') onOutput(t, now, true);
  }
}

function statusOf(t) {
  return t.attention ? 'attention' : t.exited ? 'exited' : t.busy ? 'working' : 'idle';
}

if (typeof module !== 'undefined') module.exports = { QUIET_MS, onOutput, onTick, onHook, statusOf };
