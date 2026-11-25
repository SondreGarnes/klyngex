const LABEL = { working: 'working', idle: 'idle', attention: 'needs input', exited: 'exited' };
const DEFAULT_FONT = 14;
const list = document.getElementById('list');
const panes = document.getElementById('panes');
const searchBar = document.getElementById('search');
const searchInput = document.getElementById('searchInput');
const terms = new Map();
let activeId = null;
let zoomId = null;
let dragId = null;
let lastCount = 0;
let restoring = false;
let fontSize = Number(localStorage.fontSize) || DEFAULT_FONT;

const watching = (t) => t.id === activeId && document.hasFocus();
const nameOf = (t) => t.name || t.title || t.cwd.split(/[\\/]/).filter(Boolean).pop() || t.cwd;

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// Remembered so the same folders, names and Claude Code sessions come back after a restart.
function save() {
  if (restoring) return;
  localStorage.terms = JSON.stringify([...terms.values()].map((t) => ({ cwd: t.cwd, name: t.name, session: t.session })));
}

function notify(t) {
  const n = new Notification(`${nameOf(t)}: ${t.why}`, { body: t.cwd });
  n.onclick = () => { api.showWindow(); select(t.id); };
}

function beep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.35);
  osc.onended = () => ctx.close();
}

function refresh() {
  const now = Date.now();
  let count = 0;
  for (const t of terms.values()) {
    const s = statusOf(t);
    if (s === 'attention') {
      count++;
      if (!t.since) {
        // It just started needing you.
        t.since = now;
        t.why = t.why || LABEL.attention;
        if (localStorage.sound) beep();
        if (!document.hasFocus()) notify(t);
      }
    } else {
      t.since = 0;
      t.why = '';
    }
    const text = s === 'attention' ? `${t.why}, ${ago(now - t.since)}` : LABEL[s];
    t.item.className = `item ${s}${t.id === activeId ? ' active' : ''}`;
    t.el.classList.toggle('attention', s === 'attention');
    t.el.classList.toggle('zoomed', t.id === zoomId);
    t.state.textContent = text;
    t.head.textContent = `${nameOf(t)}  ·  ${text}  ·  ${t.cwd}`;
    if (document.activeElement !== t.label) t.label.textContent = nameOf(t);
  }
  panes.classList.toggle('zoom', zoomId !== null);
  // 1, 2 and 3 terminals sit in one row; 4 is 2 by 2; after that the grid stays roughly square.
  // A shorter last row is stretched to fill the width: the grid gets cols * last columns,
  // panes in full rows span `last` of them and panes in the last row span `cols`.
  const n = terms.size;
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
  const last = n % cols || cols;
  panes.style.setProperty('--cols', cols * last);
  [...terms.values()].forEach((t, i) => { t.el.style.gridColumn = `span ${i < n - last ? last : cols}`; });

  document.title = (count ? `(${count}) ` : '') + 'Klyngex';
  if (count > lastCount) api.flash(true);
  if (!count && lastCount) api.flash(false);
  lastCount = count;
}

function select(id) {
  const t = terms.get(id);
  if (!t) return;
  activeId = id;
  if (zoomId !== null) zoomId = id; // stay zoomed, on the newly selected one
  for (const o of terms.values()) o.el.classList.toggle('active', o === t);
  t.term.focus();
  refresh();
}

function setGrid(on) {
  panes.classList.toggle('grid', on);
  localStorage.grid = on ? '1' : '';
  document.getElementById('view').textContent = on ? 'View: side by side' : 'View: one at a time';
}

function toggleZoom(id) {
  zoomId = zoomId === null ? id : null;
  select(id);
}

function setFont(size) {
  fontSize = Math.min(32, Math.max(8, size));
  localStorage.fontSize = fontSize;
  for (const t of terms.values()) {
    t.term.options.fontSize = fontSize;
    if (t.el.offsetWidth) t.fit.fit();
  }
}

// ask: confirm first if something is still running in it (the × button and the shortcut do).
function closeTerminal(id, ask) {
  const t = terms.get(id);
  if (!t) return;
  const running = !t.exited && (t.hooked || statusOf(t) === 'working');
  if (ask && running && !confirm(`"${nameOf(t)}" is still running. Close it and stop what it is doing?`)) {
    t.term.focus();
    return;
  }
  api.kill(id);
  t.term.dispose();
  t.el.remove();
  t.item.remove();
  terms.delete(id);
  if (zoomId === id) zoomId = null;
  if (activeId === id) {
    activeId = null;
    select([...terms.keys()].pop());
  }
  save();
  refresh();
}

function cycle(dir) {
  const ids = [...terms.keys()];
  select(ids[(ids.indexOf(activeId) + dir + ids.length) % ids.length]);
}

// Starts after the current terminal, so repeated presses walk through all flagged ones.
function nextAttention() {
  const all = [...terms.values()];
  const from = all.findIndex((t) => t.id === activeId) + 1;
  const t = [...all.slice(from), ...all.slice(0, from)].find((t) => statusOf(t) === 'attention');
  if (t) select(t.id);
}

// The sidebar and the grid both follow the order of `terms`.
function reorder(order) {
  terms.clear();
  for (const t of order) {
    terms.set(t.id, t);
    list.append(t.item);
    panes.append(t.el);
  }
  save();
  refresh();
  terms.get(activeId)?.term.focus();
}

// Puts terminal `id` where terminal `targetId` is now.
function moveTo(id, targetId) {
  const order = [...terms.values()];
  const from = order.findIndex((t) => t.id === id);
  const to = order.findIndex((t) => t.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  reorder(order);
}

function moveBy(id, dir) {
  const ids = [...terms.keys()];
  moveTo(id, ids[ids.indexOf(id) + dir]);
}

function openSearch() {
  searchBar.hidden = false;
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  searchBar.hidden = true;
  terms.get(activeId)?.term.focus();
}

const activeCwd = () => terms.get(activeId)?.cwd;

// Returning false tells xterm to leave the key alone.
function onKey(e, t) {
  const down = e.type === 'keydown';
  const key = e.key.toLowerCase();
  const run = (fn) => { e.preventDefault(); if (down) fn(); return false; };
  if (e.ctrlKey && key === 'tab') return run(() => cycle(e.shiftKey ? -1 : 1));
  if (e.ctrlKey && e.shiftKey && key === 't') return run(() => addTerminal(activeCwd()));
  if (e.ctrlKey && e.shiftKey && key === 'w') return run(() => closeTerminal(t.id, true));
  if (e.ctrlKey && e.shiftKey && key === 'a') return run(nextAttention);
  if (e.ctrlKey && e.shiftKey && key === 'g') return run(() => setGrid(!panes.classList.contains('grid')));
  if (e.ctrlKey && e.shiftKey && key === 'z') return run(() => toggleZoom(t.id));
  if (e.ctrlKey && e.shiftKey && key === 'f') return run(openSearch);
  if (e.ctrlKey && e.shiftKey && key === 'arrowup') return run(() => moveBy(t.id, -1));
  if (e.ctrlKey && e.shiftKey && key === 'arrowdown') return run(() => moveBy(t.id, 1));
  if (e.ctrlKey && !e.altKey && (key === '+' || key === '=')) return run(() => setFont(fontSize + 1));
  if (e.ctrlKey && !e.altKey && !e.shiftKey && key === '-') return run(() => setFont(fontSize - 1));
  if (e.ctrlKey && !e.altKey && !e.shiftKey && key === '0') return run(() => setFont(DEFAULT_FONT));
  // Line feed is what Ctrl+J sends: a new line in Claude Code, same as Enter in most shells.
  if (e.shiftKey && !e.ctrlKey && !e.altKey && key === 'enter') return run(() => api.write(t.id, '\n'));
  if (e.ctrlKey && !e.shiftKey && key === 'v') return false; // browser paste, which xterm picks up
  if (e.ctrlKey && !e.shiftKey && key === 'c' && t.term.hasSelection()) {
    if (down) setTimeout(() => t.term.clearSelection()); // so the next Ctrl+C interrupts again
    return false; // browser copy
  }
  return true;
}

// opts.agent: 'agent' starts the agent, 'worktree' starts it in a new git worktree.
// opts.resume: a Claude Code session id to reopen. opts.name: a name the user gave it.
async function addTerminal(cwd, opts = {}) {
  const previous = activeId;
  const el = document.createElement('div');
  // Must be visible before open() so the size can be measured.
  for (const o of terms.values()) o.el.classList.remove('active');
  el.className = 'pane active';
  el.innerHTML = '<div class="head" title="Double-click to zoom (Ctrl+Shift+Z)"></div><div class="body"></div>';
  panes.append(el);
  const body = el.querySelector('.body');

  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize,
    scrollback: 10000,
    theme: { background: '#111111' },
  });
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  // Terminal output is untrusted, so links only open on Ctrl+click, and only web links (see main.js).
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, url) => { if (e.ctrlKey) api.openLink(url); }));
  term.open(body);
  // GPU renderer, about as fast as a native terminal. Falls back to the DOM one if the context is lost.
  try {
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch {}
  fit.fit();

  let created;
  try {
    created = await api.create({ cwd, cols: term.cols, rows: term.rows, agent: opts.agent, resume: opts.resume });
  } catch (err) {
    term.dispose();
    el.remove();
    select(previous);
    alert(`Could not start the shell. Check the shell in Settings.\n\n${err.message}`);
    return;
  }
  const id = created.id;

  const item = document.createElement('div');
  item.innerHTML = '<span class="dot"></span><div class="text"><div class="label"></div><div class="state"></div></div><button class="close" title="Close (Ctrl+Shift+W)" aria-label="Close terminal">×</button>';
  list.append(item);
  const label = item.querySelector('.label');
  const t = {
    id, cwd: created.cwd, name: opts.name, session: opts.resume, term, fit, search, el, item, label,
    head: el.querySelector('.head'), state: item.querySelector('.state'),
  };
  terms.set(id, t);

  // Refit whenever the pane changes size: window resize, view switch, zoom, terminals added or closed.
  new ResizeObserver(() => { if (body.offsetWidth) fit.fit(); }).observe(body);
  el.addEventListener('mousedown', () => { if (activeId !== id) select(id); });
  t.head.ondblclick = () => toggleZoom(id);
  item.onclick = () => select(id);
  item.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTerminal(id, true); };

  // Drag a sidebar entry onto another to take its place (Ctrl+Shift+Up/Down does the same).
  item.draggable = true;
  item.ondragstart = () => { dragId = id; };
  item.ondragend = () => { dragId = null; };
  item.ondragover = (e) => { if (dragId !== null && dragId !== id) e.preventDefault(); };
  item.ondrop = (e) => { e.preventDefault(); moveTo(dragId, id); };

  label.ondblclick = () => {
    item.draggable = false; // so dragging inside the name selects text
    label.contentEditable = 'plaintext-only';
    label.focus();
    document.getSelection().selectAllChildren(label);
  };
  label.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } };
  label.onblur = () => {
    if (label.contentEditable === 'inherit') return;
    label.contentEditable = 'inherit';
    item.draggable = true;
    t.name = label.textContent.trim();
    save();
    refresh();
  };

  term.attachCustomKeyEventHandler((e) => onKey(e, t));
  term.onData((d) => api.write(id, d));
  // Output right after a keystroke is just the echo of your typing, not something running.
  // Enter is the exception: what follows it is the command's output.
  term.onKey(({ domEvent }) => {
    t.lastKey = domEvent.key === 'Enter' ? 0 : Date.now();
    t.acted = true;
  });
  body.addEventListener('paste', () => { t.lastKey = Date.now(); }, true);
  term.onResize(({ cols, rows }) => {
    api.resize(id, cols, rows);
    t.ignoreUntil = Date.now() + 1000; // the shell repaints after a resize; that is not work
  });
  // The shell reports its folder at every prompt, so the name and header follow `cd`.
  t.setCwd = (dir) => { if (dir && dir !== t.cwd) { t.cwd = dir; save(); refresh(); } };
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith('9;')) return false;
    t.setCwd(data.slice(2).replace(/^"|"$/g, ''));
    return true;
  });
  term.parser.registerOscHandler(7, (data) => {
    try { t.setCwd(decodeURIComponent(new URL(data).pathname).replace(/^\/(?=[A-Za-z]:)/, '')); } catch {}
    return true;
  });
  // Agents set a useful title; a bare shell on Windows just reports its exe path.
  term.onTitleChange((title) => { t.title = /\.exe$/i.test(title) ? '' : title; refresh(); });
  term.onBell(() => {
    if (!watching(t)) { t.attention = true; t.why = t.why || LABEL.attention; }
    refresh();
  });

  select(id);
  save();
}

api.onData((id, data) => {
  const t = terms.get(id);
  if (!t) return;
  t.term.write(data);
  const now = Date.now();
  const echo = now - t.lastKey < 300;
  if (!(now < t.ignoreUntil) && !echo) onOutput(t, now, watching(t));
});

api.onHook((id, event, info) => {
  const t = terms.get(id);
  if (!t) return;
  onHook(t, event, Date.now(), info.kind);
  // Kept so the session can be reopened after a restart; gone once claude has exited.
  t.session = event === 'end' ? undefined : info.session || t.session;
  // A worktree agent works in its own folder, which only the hook knows.
  if (event === 'start') t.setCwd(info.cwd);
  save();
  refresh();
});

api.onExit((id) => {
  const t = terms.get(id);
  if (!t) return;
  t.exited = true;
  t.busy = false;
  t.hooked = false;
  t.session = undefined;
  if (!watching(t)) { t.attention = true; t.why = LABEL.exited; }
  t.term.write('\r\n[process exited]\r\n');
  save();
  refresh();
});

setInterval(() => {
  const now = Date.now();
  for (const t of terms.values()) onTick(t, now);
  refresh();
}, 500);

window.addEventListener('focus', () => { if (searchBar.hidden) terms.get(activeId)?.term.focus(); });

searchInput.oninput = () => terms.get(activeId)?.search.findNext(searchInput.value, { incremental: true });
searchInput.onkeydown = (e) => {
  const s = terms.get(activeId)?.search;
  if (e.key === 'Escape') closeSearch();
  else if (e.key === 'Enter' && e.shiftKey) s?.findPrevious(searchInput.value);
  else if (e.key === 'Enter') s?.findNext(searchInput.value);
};
document.getElementById('searchClose').onclick = closeSearch;

document.getElementById('view').onclick = () => setGrid(!panes.classList.contains('grid'));
setGrid(localStorage.grid !== ''); // side by side unless switched off

const soundButton = document.getElementById('sound');
function setSound(on) {
  localStorage.sound = on ? '1' : '';
  soundButton.textContent = `Sound: ${on ? 'on' : 'off'}`;
  soundButton.setAttribute('aria-pressed', on);
}
soundButton.onclick = () => { setSound(!localStorage.sound); if (localStorage.sound) beep(); };
setSound(Boolean(localStorage.sound));

// Tracking of sessions started by typing `claude`: adds Klyngex's hooks to the user's own Claude Code settings.
const manualButton = document.getElementById('manual');
function showManual(on) {
  manualButton.textContent = `Track typed claude: ${on ? 'on' : 'off'}`;
  manualButton.setAttribute('aria-pressed', on);
}
manualButton.onclick = async () => {
  const { on, file } = await api.hooksState();
  const question = on
    ? `Remove the Klyngex hooks from ${file}?`
    : `Add Klyngex hooks to ${file}?\n\nClaude Code sessions you start by typing "claude" in a Klyngex terminal are then tracked exactly, like the ones started with the agent buttons. The hooks do nothing outside Klyngex. A backup of the file is saved next to it.`;
  if (confirm(question)) showManual(await api.setHooks(!on));
};
api.hooksState().then(({ on }) => showManual(on));

document.getElementById('settings').onclick = () => api.openSettings();

document.getElementById('new').onclick = () => addTerminal(activeCwd());
// The folder chooser opens at the current terminal's folder; cancelling does nothing.
const pickThenAdd = (opts) => async () => {
  const dir = await api.pickFolder(activeCwd());
  if (dir) addTerminal(dir, opts);
};
document.getElementById('newIn').onclick = pickThenAdd();
document.getElementById('agent').onclick = pickThenAdd({ agent: 'agent' });
document.getElementById('agentWt').onclick = pickThenAdd({ agent: 'worktree' });

(async () => {
  let saved = [];
  try { saved = JSON.parse(localStorage.terms || '[]'); } catch {}
  restoring = true; // keep the saved list intact until every terminal is back
  for (const s of saved) await addTerminal(s.cwd, { name: s.name, agent: s.session ? 'agent' : undefined, resume: s.session });
  restoring = false;
  if (!terms.size) await addTerminal();
  save();
})();
