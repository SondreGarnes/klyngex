// Loaded as a <script> by index.html and with require() by test.js.

// shortcut: without hooks, "expects input" is read off the screen once output you did not
// see has stopped. A program that is just running, like a dev server, finishes its lines
// and leaves the cursor at the start of an empty one, so it is never flagged however much
// it logs. Anything else is taken to be waiting for you: the cursor after some text (a shell
// prompt, "Continue? (y/n) "), or hidden because the program draws its own input box, as
// agents do. A line left unfinished on purpose ("Installing... ") and a full-screen program
// that is not waiting for anything are false positives. Claude Code sessions report through
// hooks instead (onHook), which is exact.
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

// t.atPrompt: the shell reported a prompt and no command has been entered since (set by the renderer).
// cursor: where the terminal's cursor is now: 'input' (shown, after some text),
// 'line-start' (shown, at the start of a line) or 'hidden'.
function onTick(t, now, cursor) {
  if (t.busy && now - t.lastOutput >= QUIET_MS) {
    t.busy = false;
    if (t.unseen && (t.atPrompt || cursor !== 'line-start')) {
      t.attention = true;
      t.why = 'needs input';
    }
    t.unseen = false;
  }
}

// Events from claude-hooks.json: start, working (prompt submitted), notify (permission
// prompt or idle reminder; kind is Claude Code's notification_type), stop (turn finished),
// end (claude exited).
function onHook(t, event, now, kind) {
  t.unseen = false;
  if (event === 'end') {
    t.hooked = false;
    t.attention = false;
  } else if (event === 'stop' || event === 'notify') {
    if (event === 'stop') {
      // A finished turn is only answered by a new prompt.
      t.keyClears = false;
      t.why = 'finished';
    } else if (kind === 'permission_prompt' || !t.attention) {
      // Anything else arriving while already flagged is the idle reminder: change nothing.
      t.keyClears = true;
      t.why = kind === 'permission_prompt' ? 'needs permission' : 'needs input';
    }
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

// Side by side shows the selected terminal's group. A hidden terminal only shows while it is the selected one.
function inView(t, active) {
  return Boolean(active) && t.group === active.group && (!t.hidden || t === active);
}

// Two terminals that both edited the same file within this long are told about each other.
const CLASH_MS = 15 * 60 * 1000;

// t.edits: Map of file path -> when this terminal's agent last edited it.
// Returns a Map: terminal -> { file, other } for each terminal sharing a recently edited file.
function clashes(all, now) {
  const out = new Map();
  const fresh = (t, file) => now - (t.edits?.get(file) ?? -Infinity) < CLASH_MS;
  for (const t of all) {
    for (const file of t.edits?.keys() || []) {
      const other = fresh(t, file) && all.find((o) => o !== t && fresh(o, file));
      if (other) { out.set(t, { file, other }); break; }
    }
  }
  return out;
}

// The terminal to jump to: the one that has waited longest, and on repeated presses the next longest.
function nextWaiting(all, active) {
  const at = (t) => t.since || Number.MAX_VALUE; // flagged this instant, not yet timed: last
  const waiting = all.filter((t) => statusOf(t) === 'attention').sort((a, b) => at(a) - at(b));
  return waiting[(waiting.indexOf(active) + 1) % waiting.length];
}

if (typeof module !== 'undefined') module.exports = { QUIET_MS, onOutput, onTick, onHook, statusOf, inView, nextWaiting, clashes, CLASH_MS };
