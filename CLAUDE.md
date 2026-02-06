# Arcadia

VS Code extension with an embedded React webview panel.

## Architecture

```
├── src/extension.ts          — Extension entry point. Registers a WebviewViewProvider
│                               that loads the built React app into the bottom panel.
├── webview-ui/               — Standalone React + TypeScript app (Vite)
│   ├── src/App.tsx           — Root component (agent launcher + session buttons)
│   └── vite.config.ts        — Builds to ../dist/webview with relative base paths
├── esbuild.js                — Bundles the extension (src/) → dist/extension.js
├── dist/                     — Build output (gitignored)
│   ├── extension.js          — Bundled extension
│   └── webview/              — Built React app (loaded by extension at runtime)
└── package.json              — VS Code manifest + all build scripts
```

## How it works

- The extension registers a `WebviewViewProvider` for the view `arcadia.panelView`, which lives in the bottom panel (next to Terminal).
- On resolve, it reads `dist/webview/index.html` and rewrites `./` asset paths to `webview.asWebviewUri()` URIs.
- The command `arcadia.showPanel` focuses the panel.
- The webview communicates with the extension via `postMessage`. Clicking "Open Claude Code" sends `openClaude`, the extension creates a named terminal running `claude` and replies with `agentCreated`. Each session gets an "Agent #n" button; clicking it sends `focusAgent` to show that terminal. Each agent button has a close (✕) button that sends `closeAgent` to dispose of the terminal. Closing a terminal (manually or via the close button) sends `agentClosed` to remove its button.
- On resolve, the extension adopts any existing VS Code terminals whose name matches `Claude Code #N`. It also listens to `onDidOpenTerminal` to detect Claude Code terminals created outside the extension. The webview sends `webviewReady` on mount; the extension responds with `existingAgents` containing all tracked agent IDs.

## Build

```sh
npm install                   # root deps
cd webview-ui && npm install  # webview deps
cd .. && npm run build        # builds both extension + webview
```

`npm run build` runs: type-check → lint → esbuild (extension) → vite build (webview).

## Dev

Press F5 to launch the Extension Development Host. The "Arcadia" tab appears in the bottom panel. Run "Arcadia: Show Panel" from the command palette to focus it.

## Key decisions

- Used `WebviewViewProvider` (not `WebviewPanel`) so the view sits in the panel area alongside the terminal rather than in an editor tab.
- Inline esbuild problem matcher in `.vscode/tasks.json` to avoid requiring the `connor4312.esbuild-problem-matchers` extension.
- Webview is a separate Vite project with its own `node_modules` and `tsconfig`. Root `tsconfig.json` excludes `webview-ui/`.

## Agent Status Tracking

Real-time display of what each Claude Code agent is doing (e.g., "Reading App.tsx", "Running: npm test").

### How it works

1. **Session ID**: Extension generates a UUID via `crypto.randomUUID()` and passes `--session-id <uuid>` when launching `claude` in the terminal.
2. **Transcript JSONL**: Claude Code writes real-time JSONL transcripts to `~/.claude/projects/<project-hash>/<session-id>.jsonl`. The project hash is the workspace path with `:` `\` `/` replaced by `-` (e.g., `C:\Users\Developer\Desktop\Arcadia` → `C--Users-Developer-Desktop-Arcadia`).
3. **File watching**: Extension watches the JSONL file using hybrid `fs.watch` (instant) + 2s polling (backup). Includes partial line buffering to handle mid-write reads.
4. **Parsing**: Each JSONL line is a complete record with a top-level `type` field:
   - `"assistant"` records contain `message.content[]` with `tool_use` blocks (`id`, `name`, `input`)
   - `"user"` records contain `message.content[]` with `tool_result` blocks (`tool_use_id`)
   - `"progress"` records contain sub-agent activity (ignored for now)
   - Tool IDs match 1:1 between `tool_use.id` and `tool_result.tool_use_id`
5. **Messages to webview**:
   - `agentToolStart { id, toolId, status }` — when a tool_use block is found
   - `agentToolDone { id, toolId }` — when a matching tool_result block is found (300ms delayed)
   - `agentToolsClear { id }` — when a new user prompt is detected (clears stacked tools)
6. **Webview rendering**: Tools stack vertically below each agent button. Active tools show a blue pulsing dot; completed tools show a green solid dot (dimmed).

### Key lessons learned

- **Previous failed approach**: Hook-based file IPC (documented in `.claude/agent-status-attempt.md`). Hooks are captured at session startup, terminal env vars don't propagate to hook subprocesses. Transcript watching is much simpler.
- **`fs.watch` is unreliable on Windows**: Sometimes misses events. Always pair with polling as a backup.
- **Partial line buffering is essential**: When reading an append-only file, the last line may be incomplete (mid-write). Only process lines terminated by `\n`; carry the remainder to the next read.
- **Flickering / instant completion**: For fast tools (~1s like Read), `tool_use` and `tool_result` arrive in the same `readNewLines` batch. Without a delay, React batches both state updates into a single render and the user never sees the blue active state. Fixed by delaying `agentToolDone` messages by 300ms.
- **`--session-id` works in interactive terminal mode**: Controls which JSONL file Claude Code writes to.
- **`--output-format stream-json` requires non-TTY stdin**: Cannot be used with VS Code terminals (Ink TUI requires TTY). Transcript JSONL watching is the alternative.

### Extension state maps (on ArcadiaViewProvider)

```
sessionIds        — agentId → session UUID
fileWatchers      — agentId → fs.FSWatcher
pollingTimers     — agentId → setInterval handle (2s backup polling)
fileOffsets       — agentId → byte offset into JSONL file
lineBuffers       — agentId → incomplete line from last read
watchTimers       — agentId → setTimeout handle (retry waiting for file)
activeToolIds     — agentId → Set<toolId> (currently running tools)
```

## Memory

Keep all memories and notes in this file (CLAUDE.md), not in `~/.claude/` memory files.

### Key patterns
- `crypto.randomUUID()` works in VS Code extension host
- Terminal `cwd` option sets working directory at creation; `!cd` does NOT work mid-session
- `/add-dir <path>` grants a running session access to an additional directory
- To change cwd, must close session and restart with new `cwd` terminal option

### Windows-MCP (desktop automation)
- Installed as user-scoped MCP server via `uvx --python 3.13 windows-mcp`
- Tools: `Snapshot`, `Click`, `Type`, `Scroll`, `Move`, `Shortcut`, `App`, `Shell`, `Wait`, `Scrape`
- `Snapshot(use_vision=true)` returns screenshot + interactive element coordinates
- Webview buttons show coords `(0,0)` in accessibility tree — must use vision coordinates instead
- **Before clicking in Extension Dev Host, snap both VS Code windows side-by-side on the SAME screen** (user has dual monitors; otherwise clicks land on the wrong window)
- Extension Dev Host starts at x=960 when snapped to right half of 1920-wide monitor
- Remember to click the reload button on the top of the main VS Code window to reload the extension after building.
