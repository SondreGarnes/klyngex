// What a worktree agent changed on its branch, and merging or deleting that worktree.
// Every function takes the folder the agent works in. Shared by main.js and test.js.
const { execFile } = require('child_process');
const path = require('path');

const git = (dir, ...args) => new Promise((resolve) => {
  execFile('git', ['-C', dir, ...args], { maxBuffer: 4e6, windowsHide: true }, (err, out, errOut) => resolve({ ok: !err, out: String(out).trim(), err: String(errOut).trim() }));
});
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const GONE = 'This terminal is not in a worktree any more.';

// null unless `dir` is inside a linked git worktree.
// top: the worktree, repo: the folder it was made from, base: the branch checked out there,
// fork: the commit where the worktree's branch left the base.
async function worktreeOf(dir) {
  if (!dir) return null;
  const [top, common, branch] = (await git(dir, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--abbrev-ref', 'HEAD')).out.split(/\r?\n/);
  if (!branch || path.basename(common) !== '.git' || samePath(top, path.dirname(common))) return null;
  const repo = path.dirname(common);
  const base = (await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).out;
  const fork = (await git(top, 'merge-base', 'HEAD', base)).out;
  if (!fork) return null;
  const dirty = (await git(top, 'status', '--porcelain')).out.split(/\r?\n/).filter(Boolean);
  return { top, repo, branch, base, fork, dirty };
}

// Everything since the branch left the base, committed or not. New files git does not track yet only count as uncommitted.
async function info(dir) {
  const w = await worktreeOf(dir);
  if (!w) return null;
  const stat = (await git(w.top, 'diff', '--shortstat', w.fork)).out;
  const [files, added, removed] = [/(\d+) file/, /(\d+) insertion/, /(\d+) deletion/].map((re) => Number(re.exec(stat)?.[1] || 0));
  return { branch: w.branch, base: w.base, files, added, removed, uncommitted: w.dirty.length };
}

async function diff(dir) {
  const w = await worktreeOf(dir);
  if (!w) return '';
  const fresh = w.dirty.filter((l) => l.startsWith('??')).map((l) => `new file, not added to git yet: ${l.slice(3)}`);
  return [...fresh, (await git(w.top, 'diff', w.fork)).out].join('\n').slice(0, 400000) || 'No changes.';
}

// Merges the agent's branch into the branch checked out in the repo. Returns '' when it worked,
// otherwise why not. A merge that does not go through cleanly is undone, so the repo is never left half merged.
async function merge(dir) {
  const w = await worktreeOf(dir);
  if (!w) return GONE;
  if (w.branch === 'HEAD' || w.base === 'HEAD') return 'Not on a branch, so there is nothing to merge by name.';
  if (w.dirty.length) return `${w.dirty.length} change(s) are not committed yet. Ask the agent to commit its work, then merge.`;
  const r = await git(w.repo, 'merge', '--no-edit', w.branch);
  if (r.ok) return '';
  await git(w.repo, 'merge', '--abort');
  return `Could not merge ${w.branch} into ${w.base}, so nothing was changed.\n\n${r.out}\n${r.err}`.trim();
}

// Deletes the worktree folder and its branch. Returns '' when it worked, otherwise why not.
// beforeDelete: awaited once the worktree is known, e.g. to stop a shell standing in the folder.
async function remove(dir, beforeDelete = () => {}) {
  const w = await worktreeOf(dir);
  if (!w) return GONE;
  await beforeDelete();
  let r;
  // Windows lets go of a folder a moment after the last program in it has exited.
  for (let i = 0; i < 5 && !(r = await git(w.repo, 'worktree', 'remove', '--force', w.top)).ok; i++) await new Promise((resolve) => setTimeout(resolve, 500));
  if (!r.ok) return `Could not delete ${w.top}:\n\n${r.err}`;
  if (w.branch !== 'HEAD') await git(w.repo, 'branch', '-D', w.branch);
  return '';
}

module.exports = { info, diff, merge, remove };
