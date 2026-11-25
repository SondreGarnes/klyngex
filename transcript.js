// Turns lines of a Claude Code subagent transcript (JSONL) into what the read-only view shows.
// Pure functions; main.js does the file reading.

const path = require('path');

// Where Claude Code keeps a subagent's transcript, worked out from the session's own
// transcript path. Hook payloads are untrusted: null unless it lands inside projectsDir.
function subagentFile(projectsDir, transcriptPath, agentId) {
  if (!/^[\w-]+$/.test(String(agentId)) || !/\.jsonl$/i.test(String(transcriptPath))) return null;
  const file = path.resolve(String(transcriptPath).slice(0, -6), 'subagents', `agent-${agentId}.jsonl`);
  return file.startsWith(path.resolve(projectsDir) + path.sep) ? file : null;
}

// kind: 'prompt' (what the agent was asked), 'text' (what it said), 'tool' (a tool it called).
// shortcut: tool results and thinking are left out, add them if the view feels too thin.
function entriesOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const content = d?.message?.content;
    // Claude Code slips its own notes to the agent in as user messages; those are not the prompt.
    if (d?.type === 'user' && typeof content === 'string' && !content.startsWith('<system-reminder>')) out.push({ kind: 'prompt', text: content });
    if (d?.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'text' && b.text) out.push({ kind: 'text', text: String(b.text) });
      if (b?.type === 'tool_use') {
        const arg = Object.values(b.input || {}).find((v) => typeof v === 'string') || '';
        out.push({ kind: 'tool', text: `${b.name}  ${arg.slice(0, 300)}` });
      }
    }
  }
  return out;
}

module.exports = { subagentFile, entriesOf };
