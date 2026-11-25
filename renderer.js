const LABEL = { working: 'working', idle: 'idle', attention: 'needs input', exited: 'exited' };
const list = document.getElementById('list');
const panes = document.getElementById('panes');
const terms = new Map();
let activeId = null;
let zoomId = null;
let lastCount = 0;
let restoring = false;

const watching = (t) => t.id === activeId && document.hasFocus();
const nameOf = (t) => t.name || t.title || t.cwd.split(/[\\/]/).filter(Boolean).pop() || t.cwd;

// Remembered so the same folders and names come back after a restart.
function save() {
  if (restoring) return;
  localStorage.terms = JSON.stringify([...terms.values()].map((t) => ({ cwd: t.cwd, name: t.name })));
}

function notify(t) {
  const n = new Notification(`${nameOf(t)} needs input`, { body: t.cwd });
  n.onclick = () => { api.showWindow(); select(t.id); };
}

function refresh() {
  let count = 0;
  for (const t of terms.values()) {
    const s = statusOf(t);
    if (s === 'attention') count++;
    if (s === 'attention' && !t.notified && !document.hasFocus()) notify(t);
    t.notified = s === 'attention';
    t.item.className = `item ${s}${t.id === activeId ? ' active' : ''}`;
    t.el.classList.toggle('attention', s === 'attention');
    t.el.classList.toggle('zoomed', t.id === zoomId);
    t.state.textContent = LABEL[s];
    t.head.textContent = `${nameOf(t)}  ·  ${LABEL[s]}  ·  ${t.cwd}`;
    if (document.activeElement !== t.label) t.label.textContent = nameOf(t);
  }
  panes.classList.toggle('zoom', zoomId !== null);
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

function closeTerminal(id) {
  const t = terms.get(id);
  if (!t) return;
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

const activeCwd = () => terms.get(activeId)?.cwd;

// Returning false tells xterm to leave the key alone.
function onKey(e, t) {
  const down = e.type === 'keydown';
  const key = e.key.toLowerCase();
  const run = (fn) => { e.preventDefault(); if (down) fn(); return false; };
  if (e.ctrlKey && key === 'tab') return run(() => cycle(e.shiftKey ? -1 : 1));
  if (e.ctrlKey && e.shiftKey && key === 't') return run(() => addTerminal(activeCwd()));
  if (e.ctrlKey && e.shiftKey && key === 'w') return run(() => closeTerminal(activeId));
  if (e.ctrlKey && e.shiftKey && key === 'a') return run(nextAttention);
  if (e.ctrlKey && e.shiftKey && key === 'g') return run(() => setGrid(!panes.classList.contains('grid')));
  if (e.ctrlKey && e.shiftKey && key === 'z') return run(() => toggleZoom(t.id));
  // Line feed is what Ctrl+J sends: a new line in Claude Code, same as Enter in most shells.
  if (e.shiftKey && !e.ctrlKey && !e.altKey && key === 'enter') return run(() => api.write(t.id, '\n'));
  if (e.ctrlKey && !e.shiftKey && key === 'v') return false; // browser paste, which xterm picks up
  if (e.ctrlKey && !e.shiftKey && key === 'c' && t.term.hasSelection()) {
    if (down) setTimeout(() => t.term.clearSelection()); // so the next Ctrl+C interrupts again
    return false; // browser copy
  }
  return true;
}

// opts.agent: 'agent' starts claude, 'worktree' starts it in a new git worktree.
async function addTerminal(cwd, opts = {}) {
  const el = document.createElement('div');
  // Must be visible before open() so the size can be measured.
  for (const o of terms.values()) o.el.classList.remove('active');
  el.className = 'pane active';
  el.innerHTML = '<div class="head" title="Double-click to zoom (Ctrl+Shift+Z)"></div><div class="body"></div>';
  panes.append(el);
  const body = el.querySelector('.body');

  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    scrollback: 10000,
    theme: { background: '#111111' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(body);
  // GPU renderer, about as fast as a native terminal. Falls back to the DOM one if the context is lost.
  try {
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch {}
  fit.fit();

  const created = await api.create({ cwd, cols: term.cols, rows: term.rows, agent: opts.agent });
  const id = created.id;

  const item = document.createElement('div');
  item.innerHTML = '<span class="dot"></span><div class="text"><div class="label"></div><div class="state"></div></div><button class="close" title="Close (Ctrl+Shift+W)" aria-label="Close terminal">×</button>';
  list.append(item);
  const label = item.querySelector('.label');
  const t = {
    id, cwd: created.cwd, name: opts.name, term, fit, el, item, label,
    head: el.querySelector('.head'), state: item.querySelector('.state'),
  };
  terms.set(id, t);

  // Refit whenever the pane changes size: window resize, view switch, zoom, terminals added or closed.
  new ResizeObserver(() => { if (body.offsetWidth) fit.fit(); }).observe(body);
  el.addEventListener('mousedown', () => { if (activeId !== id) select(id); });
  t.head.ondblclick = () => toggleZoom(id);
  item.onclick = () => select(id);
  item.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTerminal(id); };
  label.ondblclick = () => {
    label.contentEditable = 'plaintext-only';
    label.focus();
    document.getSelection().selectAllChildren(label);
  };
  label.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } };
  label.onblur = () => {
    if (label.contentEditable === 'inherit') return;
    label.contentEditable = 'inherit';
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
  // Agents set a useful title; a bare shell on Windows just reports its exe path.
  term.onTitleChange((title) => { t.title = /\.exe$/i.test(title) ? '' : title; refresh(); });
  term.onBell(() => { if (!watching(t)) t.attention = true; refresh(); });

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

api.onHook((id, event) => {
  const t = terms.get(id);
  if (!t) return;
  onHook(t, event, Date.now());
  refresh();
});

api.onExit((id) => {
  const t = terms.get(id);
  if (!t) return;
  t.exited = true;
  t.busy = false;
  t.hooked = false;
  if (!watching(t)) t.attention = true;
  t.term.write('\r\n[process exited]\r\n');
  refresh();
});

setInterval(() => {
  const now = Date.now();
  for (const t of terms.values()) onTick(t, now);
  refresh();
}, 500);

window.addEventListener('focus', () => terms.get(activeId)?.term.focus());

document.getElementById('view').onclick = () => setGrid(!panes.classList.contains('grid'));
setGrid(localStorage.grid !== ''); // side by side unless switched off

document.getElementById('new').onclick = () => addTerminal(activeCwd());
document.getElementById('newIn').onclick = async () => {
  const dir = await api.pickFolder();
  if (dir) addTerminal(dir);
};
document.getElementById('agent').onclick = () => addTerminal(activeCwd(), { agent: 'agent' });
document.getElementById('agentWt').onclick = () => addTerminal(activeCwd(), { agent: 'worktree' });

(async () => {
  let saved = [];
  try { saved = JSON.parse(localStorage.terms || '[]'); } catch {}
  restoring = true; // keep the saved list intact until every terminal is back
  for (const s of saved) await addTerminal(s.cwd, { name: s.name });
  restoring = false;
  if (!terms.size) await addTerminal();
  save();
})();
