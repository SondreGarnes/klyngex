const LABEL = { working: 'working', idle: 'idle', attention: 'needs input', exited: 'exited' };
const DEFAULT_FONT = 14;
const list = document.getElementById('list');
const panes = document.getElementById('panes');
const searchBar = document.getElementById('search');
const searchInput = document.getElementById('searchInput');
const terms = new Map();
// Group names in sidebar order. A terminal's group is one of these, or '' for none.
let groups = [];
try { groups = JSON.parse(localStorage.groups || '[]').filter((g) => g && typeof g === 'string'); } catch {}
const heads = new Map(); // group name -> its header in the sidebar
let folded = new Set(); // collapsed groups: header only, their terminals keep running and stay in side by side
try { folded = new Set(JSON.parse(localStorage.folded || '[]')); } catch {}
const shownIn = (g) => [...terms.values()].filter((t) => t.group === g && !t.hidden);
let activeId = null;
let zoomId = null;
let dragId = null;
let lastCount = 0;
let restoring = false;
let fontSize = Number(localStorage.fontSize) || DEFAULT_FONT;
const mac = navigator.platform.startsWith('Mac');

const watching = (t) => t.id === activeId && document.hasFocus();
// Where the cursor rests tells a program waiting for typing from one that is just running (see status.js).
const cursorOf = (t) => (t.cursorHidden ? 'hidden' : t.term.buffer.active.cursorX > 0 ? 'input' : 'line-start');
// Keys go to the subagent view while it covers the terminal, so nothing is typed blind.
const focusPane = (t) => (t?.viewing ? t.sub : t?.term)?.focus();
const nameOf = (t) => t.name || t.title || t.cwd.split(/[\\/]/).filter(Boolean).pop() || t.cwd;

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// Remembered so the same folders, names and Claude Code sessions come back after a restart.
function save() {
  if (restoring) return;
  localStorage.terms = JSON.stringify([...terms.values()].map((t) => ({ cwd: t.cwd, name: t.name, session: t.session, group: t.group, hidden: t.hidden })));
  localStorage.groups = JSON.stringify(groups);
  localStorage.folded = JSON.stringify([...folded]);
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
    t.item.className = `item ${s}${t.id === activeId ? ' active' : ''}${t.hidden ? ' hid' : ''}`;
    t.hide.textContent = t.hidden ? 'show' : 'hide';
    t.hide.setAttribute('aria-pressed', String(Boolean(t.hidden)));
    t.el.classList.toggle('attention', s === 'attention');
    t.el.classList.toggle('zoomed', t.id === zoomId);
    const running = [...t.agents.values()].filter((a) => !a.done).length;
    t.state.textContent = text + (running ? ` · ${running} agent${running > 1 ? 's' : ''}` : '');
    const a = t.viewing && t.agents.get(t.viewing.agent);
    t.head.textContent = a
      ? `${nameOf(t)}  ›  ${a.title || a.type}  ·  ${a.done ? 'done' : 'running'}  ·  read-only, Esc to go back`
      : `${nameOf(t)}  ·  ${text}  ·  ${t.cwd}`;
    if (document.activeElement !== t.label) t.label.textContent = nameOf(t);
  }
  panes.classList.toggle('zoom', zoomId !== null);
  // 1, 2 and 3 terminals sit in one row; 4 is 2 by 2; after that the grid stays roughly square.
  // A shorter last row is stretched to fill the width: the grid gets cols * last columns,
  // panes in full rows span `last` of them and panes in the last row span `cols`.
  const active = terms.get(activeId);
  const shown = [...terms.values()].filter((t) => inView(t, active));
  for (const t of terms.values()) t.el.classList.toggle('off', !shown.includes(t));
  for (const [g, h] of heads) {
    h.classList.toggle('active', g === active?.group);
    // A collapsed group still says how many terminals it holds and how many need you.
    const mine = folded.has(g) ? [...terms.values()].filter((t) => t.group === g) : [];
    const need = mine.filter((t) => statusOf(t) === 'attention').length;
    h.classList.toggle('attention', need > 0);
    h.querySelector('.state').textContent = folded.has(g) ? ` ${mine.length}${need ? ` · ${need} need input` : ''}` : '';
  }
  const n = shown.length;
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
  const last = n % cols || cols;
  panes.style.setProperty('--cols', cols * last);
  shown.forEach((t, i) => { t.el.style.gridColumn = `span ${i < n - last ? last : cols}`; });

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
  focusPane(t);
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
  t.subs.remove();
  terms.delete(id);
  if (zoomId === id) zoomId = null;
  if (activeId === id) {
    activeId = null;
    select((shownIn(t.group).pop() || [...terms.values()].pop())?.id);
  }
  save();
  refresh();
}

function cycle(dir) {
  const ids = shownIn(terms.get(activeId)?.group).map((t) => t.id); // stays in the group on screen
  const i = ids.indexOf(activeId); // -1 when the selected one is hidden: backwards then starts from the last
  select(ids[((i < 0 && dir < 0 ? 0 : i) + dir + ids.length) % ids.length]);
}

// Starts after the current terminal, so repeated presses walk through all flagged ones.
function nextAttention() {
  const all = [...terms.values()];
  const from = all.findIndex((t) => t.id === activeId) + 1;
  const t = [...all.slice(from), ...all.slice(0, from)].find((t) => statusOf(t) === 'attention');
  if (t) select(t.id);
}

function groupHead(g) {
  const h = document.createElement('div');
  h.className = 'group';
  h.innerHTML = '<button class="fold" aria-label="Collapse or expand the group"></button><span class="label"></span><span class="state"></span>' + (g ? '<button class="close" title="Remove the group. Its terminals keep running." aria-label="Remove group">×</button>' : '');
  const label = h.querySelector('.label');
  h.firstChild.textContent = folded.has(g) ? '▸' : '▾';
  h.firstChild.setAttribute('aria-expanded', String(!folded.has(g)));
  h.firstChild.onclick = (e) => {
    e.stopPropagation();
    if (!folded.delete(g)) folded.add(g);
    reorder([...terms.values()]);
  };
  label.textContent = g || 'No group'; // names are typed by the user: never as HTML
  heads.set(g, h);
  h.onclick = () => label.isContentEditable || select((shownIn(g)[0] || [...terms.values()].find((t) => t.group === g))?.id);
  h.ondragover = (e) => { if (dragId !== null) e.preventDefault(); };
  h.ondrop = (e) => { e.preventDefault(); toGroup(terms.get(dragId), g); };
  if (!g) return h;
  const rename = (to) => {
    groups = groups.flatMap((o) => (o !== g ? [o] : to ? [to] : []));
    if (folded.delete(g) && to) folded.add(to);
    for (const t of terms.values()) if (t.group === g) t.group = to;
    reorder([...terms.values()]);
  };
  h.lastChild.onclick = (e) => { e.stopPropagation(); rename(''); };
  label.ondblclick = () => {
    label.contentEditable = 'plaintext-only';
    label.focus();
    document.getSelection().selectAllChildren(label);
  };
  label.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } };
  label.onblur = () => {
    label.onblur = null; // the header is rebuilt below, which would blur it again
    const name = label.textContent.trim();
    rename(name && !groups.includes(name) ? name : g); // an empty or taken name changes nothing
  };
  return h;
}

// The sidebar: terminals without a group first, then each group under its header.
function renderList() {
  heads.clear();
  list.replaceChildren();
  for (const g of ['', ...groups]) {
    if (groups.length) list.append(groupHead(g));
    // Without groups there are no headers, so nothing can be collapsed.
    if (!groups.length || !folded.has(g)) for (const t of terms.values()) if (t.group === g) list.append(t.item, t.subs);
  }
}

// The sidebar and the grid both follow the order of `terms`.
function reorder(order) {
  terms.clear();
  for (const t of order) {
    terms.set(t.id, t);
    panes.append(t.el);
  }
  renderList();
  save();
  refresh();
  focusPane(terms.get(activeId));
}

// Moves a terminal to a group: last in it, or first.
function toGroup(t, g, first) {
  if (!t) return;
  const rest = [...terms.values()].filter((o) => o !== t);
  t.group = g;
  reorder(first ? [t, ...rest] : [...rest, t]);
}

// Puts terminal `id` where terminal `targetId` is now, in that terminal's group.
function moveTo(id, targetId) {
  const order = [...terms.values()];
  const from = order.findIndex((t) => t.id === id);
  const to = order.findIndex((t) => t.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  order[from].group = order[to].group;
  order.splice(to, 0, order.splice(from, 1)[0]);
  reorder(order);
}

function moveBy(id, dir) {
  const t = terms.get(id);
  const peers = [...terms.values()].filter((o) => o.group === t.group);
  const peer = peers[peers.indexOf(t) + dir];
  if (peer) return moveTo(id, peer.id);
  // At the edge of its group: on into the group above or below.
  const order = ['', ...groups];
  const g = order[order.indexOf(t.group) + dir];
  if (g !== undefined) toGroup(t, g, dir > 0);
}

function openSearch() {
  searchBar.hidden = false;
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  searchBar.hidden = true;
  focusPane(terms.get(activeId));
}

// --- Subagents: the folder under a Claude Code terminal and the read-only view of one ---
function renderSubs(t) {
  t.fold.hidden = !t.agents.size;
  t.fold.textContent = t.folded ? '▸' : '▾';
  t.fold.setAttribute('aria-expanded', String(!t.folded));
  t.subs.replaceChildren(...(t.folded ? [] : [...t.agents].map(([agent, a]) => {
    const row = document.createElement('button');
    row.className = `subrow${a.done ? '' : ' working'}${t.viewing?.agent === agent ? ' active' : ''}`;
    row.innerHTML = '<span class="dot"></span><span class="label"></span>';
    row.lastChild.textContent = a.title || a.type;
    row.title = `${a.type}, ${a.done ? 'done' : 'running'}. Click to read along.`;
    row.onclick = () => openSub(t, agent);
    return row;
  })));
}

function openSub(t, agent) {
  t.viewing = { agent, next: 0 };
  t.sub.replaceChildren();
  t.sub.hidden = false;
  renderSubs(t);
  select(t.id);
  pollSub(t);
}

function closeSub(t) {
  if (!t.viewing) return;
  t.viewing = null;
  t.sub.hidden = true;
  renderSubs(t);
}

// Appends what the subagent has written to its transcript since the last poll.
async function pollSub(t) {
  const v = t.viewing;
  if (!v || v.busy) return;
  v.busy = true;
  const r = await api.readSub(t.id, v.agent, v.next);
  v.busy = false;
  if (t.viewing !== v) return;
  v.next = r.next;
  const a = t.agents.get(v.agent);
  if (r.title && a && !a.title) { a.title = r.title; renderSubs(t); }
  if (!r.entries.length) return;
  const atEnd = t.sub.scrollHeight - t.sub.scrollTop - t.sub.clientHeight < 40;
  for (const e of r.entries) {
    const div = document.createElement('div');
    div.className = e.kind;
    div.textContent = e.text; // transcript text is untrusted: never as HTML
    t.sub.append(div);
  }
  if (atEnd) t.sub.scrollTop = t.sub.scrollHeight; // follow along unless you scrolled up
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
  if (mac) return true; // copy and paste are Cmd+C and Cmd+V from the menu; Ctrl+C and Ctrl+V go to the program
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
    fontFamily: '"Cascadia Mono", Consolas, Menlo, monospace',
    fontSize,
    scrollback: 10000,
    theme: { background: '#111111' },
  });
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  // Terminal output is untrusted, so links only open on Ctrl+click (Cmd+click on a Mac), and only web links (see main.js).
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, url) => { if (e.ctrlKey || e.metaKey) api.openLink(url); }));
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
  // Checked after the wait above: the group may have been renamed or removed meanwhile.
  const group = opts.group ?? terms.get(previous)?.group;

  const item = document.createElement('div');
  item.innerHTML = '<span class="dot"></span><div class="text"><div class="label"></div><div class="state"></div></div><button class="fold" hidden aria-label="Show or hide its subagents"></button><button class="hide" title="Hide from side by side. It keeps running, and shows again while you have it selected." aria-label="Hide from side by side"></button><button class="close" title="Close (Ctrl+Shift+W)" aria-label="Close terminal">×</button>';
  const subs = document.createElement('div');
  // The read-only view of a subagent; covers the terminal while open.
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.hidden = true;
  sub.tabIndex = 0;
  body.append(sub);
  const label = item.querySelector('.label');
  const t = {
    id, cwd: created.cwd, name: opts.name, session: opts.resume, term,
    group: groups.includes(group) ? group : '', hidden: opts.hidden, hide: item.querySelector('.hide'), fit, search, el, item, label,
    head: el.querySelector('.head'), state: item.querySelector('.state'),
    subs, sub, fold: item.querySelector('.fold'), agents: new Map(),
  };
  terms.set(id, t);
  renderList();

  // Refit whenever the pane changes size: window resize, view switch, zoom, terminals added or closed.
  new ResizeObserver(() => { if (body.offsetWidth) fit.fit(); }).observe(body);
  el.addEventListener('mousedown', () => { if (activeId !== id) select(id); });
  t.head.ondblclick = () => toggleZoom(id);
  item.onclick = () => { closeSub(t); select(id); };
  t.fold.onclick = (e) => { e.stopPropagation(); t.folded = !t.folded; renderSubs(t); };
  sub.onkeydown = (e) => { if (e.key === 'Escape') { closeSub(t); select(id); } };
  t.hide.onclick = (e) => {
    e.stopPropagation();
    t.hidden = !t.hidden;
    if (t.hidden && id === activeId) select(shownIn(t.group)[0]?.id); // nothing else to show: it stays until you pick another
    save();
    refresh();
    focusPane(terms.get(activeId));
  };
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
    if (domEvent.key === 'Enter') t.atPrompt = false; // a command is running from here on
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
    t.atPrompt = true; // sent each time the shell shows its prompt
    t.setCwd(data.slice(2).replace(/^"|"$/g, ''));
    return true;
  });
  term.parser.registerOscHandler(7, (data) => {
    t.atPrompt = true;
    try { t.setCwd(decodeURIComponent(new URL(data).pathname).replace(/^\/(?=[A-Za-z]:)/, '')); } catch {}
    return true;
  });
  // Programs show and hide the cursor with these two sequences; returning false lets xterm act on them too.
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => { if (params.includes(25)) t.cursorHidden = false; return false; });
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => { if (params.includes(25)) t.cursorHidden = true; return false; });
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
  if (info.agent) {
    // Subagents say nothing about whether the terminal needs you, so status.js never sees them.
    if (event === 'sub-start') {
      const a = { type: info.agent.type };
      t.agents.set(info.agent.id, a);
      // Its short description is on disk a moment after it starts; until then the row shows the type.
      setTimeout(async () => { a.title = a.title || (await api.readSub(id, info.agent.id, 0)).title; renderSubs(t); }, 2000);
    } else if (t.agents.has(info.agent.id)) t.agents.get(info.agent.id).done = true;
    renderSubs(t);
    refresh();
    return;
  }
  if (event === 'start' || event === 'end') {
    // Finished ones stay to be read until the session starts over, except the one you are reading.
    // (Not cleared per prompt: a background agent reporting back counts as a prompt.)
    for (const [agent, a] of t.agents) {
      if (event === 'end') a.done = true; // they stop with claude
      if (a.done && t.viewing?.agent !== agent) t.agents.delete(agent);
    }
    renderSubs(t);
  }
  onHook(t, event, Date.now(), info.kind);
  // Kept so the session can be reopened after a restart; gone once claude has exited.
  t.session = event === 'end' ? undefined : info.session || t.session;
  // A worktree agent works in its own folder, which only the hook knows.
  if (event === 'start') t.setCwd(info.cwd);
  save();
  refresh();
});

api.onOpenDir((dir) => addTerminal(dir));

api.onExit((id) => {
  const t = terms.get(id);
  if (!t) return;
  t.exited = true;
  t.busy = false;
  t.hooked = false;
  t.session = undefined;
  closeSub(t);
  t.agents.clear();
  renderSubs(t);
  if (!watching(t)) { t.attention = true; t.why = LABEL.exited; }
  t.term.write('\r\n[process exited]\r\n');
  save();
  refresh();
});

setInterval(() => {
  const now = Date.now();
  for (const t of terms.values()) { onTick(t, now, cursorOf(t)); pollSub(t); }
  refresh();
}, 500);

window.addEventListener('focus', () => { if (searchBar.hidden) focusPane(terms.get(activeId)); });

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

// --- Settings page ---
const dialog = document.getElementById('settingsDialog');
const field = (id) => document.getElementById(id);
let trackedBefore = false;

async function openSettings() {
  const [s, hooks] = await Promise.all([api.getSettings(), api.hooksState()]);
  field('setShell').value = s.shell;
  field('setArgs').value = (Array.isArray(s.shellArgs) ? s.shellArgs : []).join(' ');
  field('setAgent').value = s.agent;
  field('shells').replaceChildren(...s.shells.map((shell) => new Option(shell)));
  field('setFont').value = fontSize;
  field('setSound').checked = Boolean(localStorage.sound);
  trackedBefore = hooks.on;
  field('setManual').checked = hooks.on;
  field('manualFile').textContent = hooks.file;
  dialog.showModal();
}

field('settingsForm').onsubmit = async () => {
  // shortcut: shell arguments are split on spaces, so an argument cannot contain one; add quoting if someone needs it.
  await api.setSettings({
    shell: field('setShell').value,
    shellArgs: field('setArgs').value.trim().split(/\s+/).filter(Boolean),
    agent: field('setAgent').value,
  });
  setFont(Number(field('setFont').value) || DEFAULT_FONT);
  const sound = field('setSound').checked;
  if (sound && !localStorage.sound) beep(); // let them hear what they switched on
  localStorage.sound = sound ? '1' : '';
  // Adds or removes Klyngex's hooks in the user's own Claude Code settings (main.js keeps a backup).
  if (field('setManual').checked !== trackedBefore) await api.setHooks(field('setManual').checked);
};
field('setCancel').onclick = () => dialog.close();
dialog.onclose = () => focusPane(terms.get(activeId));
document.getElementById('settings').onclick = openSettings;
api.version().then((v) => { document.getElementById('version').textContent = `Klyngex ${v}`; });

document.getElementById('new').onclick = () => addTerminal(activeCwd());
// The folder chooser opens at the current terminal's folder; cancelling does nothing.
const pickThenAdd = (opts) => async () => {
  const dir = await api.pickFolder(activeCwd());
  if (dir) addTerminal(dir, opts);
};
document.getElementById('group').onclick = () => {
  let n = 1;
  while (groups.includes(`Group ${n}`)) n++;
  groups.push(`Group ${n}`);
  reorder([...terms.values()]);
};
document.getElementById('newIn').onclick = pickThenAdd();
document.getElementById('agent').onclick = pickThenAdd({ agent: 'agent' });
document.getElementById('agentWt').onclick = pickThenAdd({ agent: 'worktree' });

(async () => {
  let saved = [];
  try { saved = JSON.parse(localStorage.terms || '[]'); } catch {}
  restoring = true; // keep the saved list intact until every terminal is back
  for (const s of saved) await addTerminal(s.cwd, { name: s.name, group: groups.includes(s.group) ? s.group : '', hidden: Boolean(s.hidden), agent: s.session ? 'agent' : undefined, resume: s.session });
  restoring = false;
  // Started with the klyngex command: open a terminal in the folder it was typed in.
  const dir = await api.launchDir();
  if (dir) await addTerminal(dir);
  if (!terms.size) await addTerminal();
  save();
})();
