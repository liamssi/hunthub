# Managing and interacting with agents: Herdr, Roamgate, Paperclip, HuntHub (2026-09-27)

How each reference project runs, talks to and watches coding agents, and what that suggests for HuntHub. The details are in `herdr.md`, `roamgate.md` and `paperclip.md`.

## Two models

| | Terminal-first (Herdr, Roamgate, HuntHub today) | Headless-first (Paperclip) |
|---|---|---|
| An agent is | its interactive TUI, in a real terminal pane | a function: prompt in, structured events and a result out |
| Started by | typing its CLI into a shell (`agent.start`) | spawning `claude -p --output-format stream-json`, `codex exec --json`, ACP or app-server |
| Lifetime | long-lived; the human can take over at any time | one run per wake (heartbeat), or turns in a supervised session |
| Status | inferred from the screen (manifest rules) or from lifecycle hooks | exact, from the event stream |
| What it's doing | the screen; transcripts if you parse them (Roamgate) | a normalized transcript: messages, thinking, tool calls, diffs |
| Cost and tokens | not known (Roamgate: tokens from transcripts) | per run: tokens, cost, model, quota errors |
| Questions and approvals | the agent's own dialogs; humans answer in the terminal | turn ends with `approval_required` or a structured question, answered in the UI |
| Resume | Herdr restores by session id after restarts | a session per (agent, task), with rotation and poisoned-session recovery |
| Many harnesses | Herdr knows about 25 agent kinds (detection + hooks) | one adapter contract, about 15 adapters, plus process/http and plugins |
| Remote | a resident per-machine process (HuntHub runner; Herdr `--machine`) | the server pushes runs to SSH hosts or sandboxes |

Neither model wins outright:
- **The terminal model** keeps the agent's full native UX and lets a researcher step in anywhere. That's what long, exploratory hunts need.
- **The headless model** gives the platform facts: status, cost, a transcript, a result. Automation, budgets and records (findings, provenance) need those.

## What each does that HuntHub doesn't yet

**Herdr**
- `agent.explain`: which kind of question is pending (permission form, MCP elicitation, workflow prompt).
- Session ids and resume per agent.
- Deep reads of an idle full-screen agent's own history.

**Roamgate**
- Structured history from the agents' transcript files, with tool calls.
- Token usage.
- "What changed this turn" diffs from git snapshots at working→idle.
- Review comments that pre-fill the agent's input.

**Paperclip**
- One adapter contract per harness: environment test (installed and logged in?), models, config schema, session codec, execute.
- A headless engine with structured events.
- Tasks with atomic checkout, blockers and structured questions.
- Budgets with hard stops.
- Agents reporting their own progress to the server through an injected skill and a short-lived token.
- Quota errors classified with automatic backoff.

## Options for HuntHub

These can be taken separately; most build on the runner, which already sits on each machine.

1. **Structured transcripts from the runner** (the biggest win).
   - The runner reads the agent's transcript file on its own machine, tailing by byte offset.
   - For Claude, derive the path from the session id, or add HuntHub's own SessionStart hook to learn it.
   - It feeds the inbox with the agent's real last message and question, a tool-call timeline, token usage, and provenance for findings.
   - Cost: a parser per agent and version (Roamgate needs about 1100 lines for seven agents), format churn, and secrets appearing in tool output.
2. **Know what a blocked agent asks:**
   - `agent.explain` for the kind of question
   - the pending tool call in the transcript for the details
   - optionally HuntHub's own permission hooks, giving true approval cards
   
   Answers still go in as keys, unless hook-based decisions prove workable.
3. **An adapter contract per agent kind,** after Paperclip's `ServerAdapterModule`:
   - `detect` / `testEnvironment` (installed? logged in?), models, launch arguments, resume arguments
   - a transcript parser
   - an optional headless engine
   
   HuntHub's current launcher becomes the "pane" engine behind it, and new harnesses get added in one place.
4. **A headless engine for bounded tasks:** `claude -p --output-format stream-json --resume`, `codex exec --json`, or ACP, run by the runner (optionally in a Herdr pane, to keep it watchable). It suits recon, triage and report drafting, where a structured result and cost matter more than steering; exploratory hunting stays interactive.
5. **Sessions and resume as a HuntHub feature:**
   - Store each run's agent session id.
   - Offer Resume on dead or restarted panes.
   - Warn when `python3` is missing, since Herdr's Claude and Codex hooks then silently report nothing.
6. **Agents reporting to HuntHub:** an injected skill plus a short-lived token (or MCP) so agents post findings, notes and status themselves. This connects to the hunts, records and provenance steps of the roadmap.
7. **Smaller UX ideas:**
   - "what changed this turn" diffs on finished notifications
   - review comments that pre-fill the agent's input but never submit
   - budgets and quota backoff once cost is known

## Cautions
- Paperclip runs agents with permission prompts bypassed by default. Against live targets, HuntHub should keep approvals on and surface them.
- A human typing in the TUI while a headless or ACP engine drives the same session is likely incompatible (unverified). Pick one engine per session.
- Transcript files live in the agent user's home. The runner must be allowed to read them, and they must be redacted before they leave the machine.
