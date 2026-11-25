// Adds or removes Klyngex's hooks in a Claude Code settings object, leaving everything else
// alone. Pure functions; main.js does the file reading and writing.

const MARK = 'KLYNGEX_HOOK';
const ours = (entry) => Array.isArray(entry?.hooks) && entry.hooks.some((h) => String(h?.command).includes(MARK));

function isInstalled(settings) {
  return Object.values(settings.hooks || {}).some((entries) => Array.isArray(entries) && entries.some(ours));
}

function uninstall(settings) {
  const hooks = {};
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    const kept = Array.isArray(entries) ? entries.filter((e) => !ours(e)) : entries;
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept;
  }
  const next = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}

function install(settings, ourHooks) {
  const next = uninstall(settings);
  next.hooks = { ...next.hooks };
  for (const [event, entries] of Object.entries(ourHooks)) {
    next.hooks[event] = [...(next.hooks[event] || []), ...entries];
  }
  return next;
}

module.exports = { isInstalled, install, uninstall };
