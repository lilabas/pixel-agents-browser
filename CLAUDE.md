# Arcadia

VS Code extension with an embedded React webview panel.

## Architecture

```
├── src/extension.ts          — Extension entry point. Registers a WebviewViewProvider
│                               that loads the built React app into the bottom panel.
├── webview-ui/               — Standalone React + TypeScript app (Vite)
│   ├── src/App.tsx           — Root component (office canvas + message handling)
│   ├── src/office/           — Pixel art office UI (see "Office UI" section below)
│   └── vite.config.ts        — Builds to ../dist/webview with relative base paths
├── esbuild.js                — Bundles the extension (src/) → dist/extension.js
├── dist/                     — Build output (gitignored)
│   ├── extension.js          — Bundled extension
│   └── webview/              — Built React app (loaded by extension at runtime)
└── package.json              — VS Code manifest + all build scripts
```

## Vocabulary

- **Terminal**: The actual VS Code terminal window running Claude Code. A terminal is a physical resource — it exists as long as the VS Code terminal tab is open.
- **Session**: A single Claude Code conversation, identified by a JSONL file (`<session-id>.jsonl`). Sessions are permanent and immutable — once created, a session's identity never changes.
- **Agent**: A UI element in the Arcadia webview, permanently bound to exactly one terminal. One agent per terminal, created immediately when the terminal is launched. Clicking the agent focuses its terminal. When the terminal closes, the agent is removed.

## How it works

- The extension registers a `WebviewViewProvider` for the view `arcadia.panelView`, which lives in the bottom panel (next to Terminal).
- On resolve, it reads `dist/webview/index.html` and rewrites `./` asset paths to `webview.asWebviewUri()` URIs.
- The command `arcadia.showPanel` focuses the panel.
- **One-agent-per-terminal model**: Each "Open Claude Code" click creates a terminal and immediately creates an agent bound to it. The agent button appears right away (before the JSONL file exists). A background 1s poll waits for the specific `<uuid>.jsonl` file, then starts file watching. No adopted terminals.
- **`/clear` detection**: The extension tracks all known JSONL files in the project directory. When a new unknown file appears, it is assigned to the currently-active agent (the one whose terminal is focused). This works because `/clear` is typed in the focused terminal, and the new JSONL file it creates is the only "unknown" file. The agent's file watching is swapped to the new file and activity is cleared.
- **Terminal ↔ agent selection sync**: `onDidChangeActiveTerminal` tracks which agent is active and sends `agentSelected` to the webview so the UI highlights the matching agent when the user switches terminal tabs.
- The webview communicates with the extension via `postMessage`. Clicking "Open Claude Code" sends `openClaude`, the extension creates a named terminal running `claude --session-id <uuid>` and immediately sends `agentCreated`. Each agent gets an "Agent #n" button; clicking it sends `focusAgent` to show the hosting terminal. Each agent button has a close (✕) button that sends `closeAgent` to dispose of the terminal. Closing a terminal (manually or via the close button) sends `agentClosed` to remove its button.
- The webview sends `webviewReady` on mount; the extension responds with `existingAgents` containing all tracked agent IDs.

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

1. **Transcript JSONL**: Claude Code writes real-time JSONL transcripts to `~/.claude/projects/<project-hash>/<session-id>.jsonl`. The project hash is the workspace path with `:` `\` `/` replaced by `-` (e.g., `C:\Users\Developer\Desktop\Arcadia` → `C--Users-Developer-Desktop-Arcadia`).
2. **`--session-id` for deterministic file matching**: Extension generates a UUID per terminal and passes `claude --session-id <uuid>`. The JSONL file is then `<uuid>.jsonl` — no race conditions with parallel agents.
3. **Immediate agent creation**: Agent is created as soon as the terminal is launched (before the JSONL file exists). A 1s poll waits for the specific `<uuid>.jsonl` file to appear, then starts file watching.
3b. **`/clear` reassignment**: A project-level 1s scan watches for unknown JSONL files. Known files are seeded on first scan + pre-registered for each `--session-id`. When an unknown file appears and an agent's terminal is focused, that agent is reassigned to the new file (old watching stops, activity clears, new watching starts).
4. **File watching**: Once the JSONL file is found, extension watches it using hybrid `fs.watch` (instant) + 2s polling (backup). Includes partial line buffering to handle mid-write reads.
5. **Parsing**: Each JSONL line is a complete record with a top-level `type` field:
   - `"assistant"` records contain `message.content[]` with `tool_use` blocks (`id`, `name`, `input`)
   - `"user"` records contain `message.content[]` with `tool_result` blocks, OR `content` as a string (text prompt)
   - `"system"` records with `subtype: "turn_duration"` mark turn completion (reliable signal)
   - `"progress"` records contain sub-agent activity (ignored for now)
   - `"file-history-snapshot"` records track file state (ignored)
   - `"assistant"` records can also have `content: [{type: "thinking"}]` — reasoning blocks, not text
   - Tool IDs match 1:1 between `tool_use.id` and `tool_result.tool_use_id`
6. **Messages to webview**:
   - `agentCreated { id }` — when a terminal is created and agent is bound to it
   - `agentClosed { id }` — when terminal closes
   - `openSessionsFolder` — opens the JSONL project directory in file explorer
   - `agentToolStart { id, toolId, status }` — when a tool_use block is found
   - `agentToolDone { id, toolId }` — when a matching tool_result block is found (300ms delayed)
   - `agentToolsClear { id }` — when a new user prompt is detected (clears stacked tools)
   - `agentStatus { id, status: 'waiting' | 'active' }` — when agent finishes turn or starts new work
   - `existingAgents { agents: number[] }` — sent on webview reconnect
7. **Webview rendering**: Top-down pixel art office scene (Gather.town style). Each agent is an animated character at a desk. Tool status appears as hover tooltips over characters. "+" Agent and "Sessions" buttons float in the top-left corner. See "Office UI" section for full details.

### Key lessons learned

- **Previous failed approach**: Hook-based file IPC. Hooks are captured at session startup, terminal env vars don't propagate to hook subprocesses. Transcript watching is much simpler.
- **`fs.watch` is unreliable on Windows**: Sometimes misses events. Always pair with polling as a backup.
- **Partial line buffering is essential**: When reading an append-only file, the last line may be incomplete (mid-write). Only process lines terminated by `\n`; carry the remainder to the next read.
- **Flickering / instant completion**: For fast tools (~1s like Read), `tool_use` and `tool_result` arrive in the same `readNewLines` batch. Without a delay, React batches both state updates into a single render and the user never sees the blue active state. Fixed by delaying `agentToolDone` messages by 300ms.
- **`--session-id` for multi-agent**: Each terminal gets `claude --session-id <uuid>` so the JSONL filename is deterministic (`<uuid>.jsonl`). Eliminates race conditions when parallel agents share the same project directory.
- **User prompts can be string or array**: `record.message.content` is a string for text prompts, an array for tool results. Must handle both forms to properly clear tools/status on new prompts.
- **`/clear` creates a new JSONL file**: The `/clear` command is recorded in the NEW file's first records, not the old file. The old file simply stops receiving writes.
- **`--output-format stream-json` requires non-TTY stdin**: Cannot be used with VS Code terminals (Ink TUI requires TTY). Transcript JSONL watching is the alternative.
- **Text-only assistant records are often intermediate**: In the JSONL, text and tool_use from the same API response are written as separate records. A text-only `assistant` record is frequently followed by a `tool_use` record (not a turn end). The reliable turn-end signal is `system` records with `subtype: "turn_duration"`. Text-only assistant records use a 2s debounce timer as a fallback.
- **No `summary`/`result` record types exist**: Turn completion is signaled by `system` records with `subtype: "turn_duration"`, not `summary` or `result`.

### Extension state

**Consolidated `AgentState` struct** (per agent):
```
id, terminalRef, projectDir, jsonlFile, fileOffset, lineBuffer,
activeToolIds, activeToolStatuses, isWaiting
```

**Provider-level state**:
```
agents               — agentId → AgentState (consolidated agent state)
activeAgentId        — which agent's terminal is currently focused (null if none)
knownJsonlFiles      — Set<string> of all JSONL paths seen (seeded on first scan + pre-registered per --session-id)
projectScanTimer     — setInterval (1s project-level scan for /clear detection)
jsonlPollTimers      — agentId → setInterval (1s poll for JSONL file to appear)
fileWatchers         — agentId → fs.FSWatcher
pollingTimers        — agentId → setInterval (2s backup file polling)
waitingTimers        — agentId → setTimeout (2s debounce for "waiting" status)
```

**Persistence**: Agent-to-terminal mappings are persisted to `workspaceState` (key `'arcadia.agents'`) as `PersistedAgent[]`. On webview ready, `restoreAgents()` reads persisted state, matches each entry to a live terminal by name, and recreates the `AgentState`. File watching resumes from end-of-file (no replay). Entries whose terminals no longer exist are pruned. `nextAgentId` and `nextTerminalIndex` are advanced past restored values to avoid collisions.

## Office UI (Pixel Art Scene)

The webview renders a top-down pixel art office (Gather.town style) instead of a flat card list. Each AI agent is an animated character that sits at a desk when working and wanders when idle. The existing extension message protocol drives character behavior.

### File structure

All files live under `webview-ui/src/office/`:

```
office/
  types.ts          — Constants (TILE_SIZE=16, SCALE=2, MAP 20x11), interfaces
  sprites.ts        — Hardcoded pixel data for characters (6 palettes), furniture, tiles
  spriteCache.ts    — Renders SpriteData → offscreen canvas, WeakMap cache by reference
  tileMap.ts        — Office layout grid, desk slot positions, furniture placement
  gameLoop.ts       — requestAnimationFrame loop with delta time (capped at 0.1s)
  renderer.ts       — Canvas drawing: tiles (checkerboard), z-sorted furniture + characters
  characters.ts     — Character state machine: idle/walk/type + wander AI
  officeState.ts    — Central game world, bridges messages → character lifecycle
  OfficeCanvas.tsx  — React component: canvas ref, ResizeObserver, DPR, mouse hit-testing
  ToolOverlay.tsx   — HTML tooltip positioned over hovered character showing tool status
```

### How rendering works

**Game state outside React**: An `OfficeState` class (module-level singleton in App.tsx) holds character positions, desk assignments, and animation state. It's updated imperatively by message handlers and read by the canvas every frame. React state is only used for HTML overlays (tool tooltips). This avoids re-renders in the hot path.

**Sprite system**: Pixel data stored as 2D arrays of hex color strings (`SpriteData`). Rendered once to offscreen canvases at SCALE (2x) and cached via `WeakMap`. Characters use palette templates (`'skin'`, `'shirt'`, etc.) resolved at creation time into concrete hex colors. 6 distinct color palettes for agents.

**Z-ordering**: All entities (furniture + characters) merged into a single array, sorted by Y-position before drawing. Lower on screen = drawn later = appears in front.

**Canvas sizing**: Panel is typically 200-400px tall. At SCALE=2, each tile row = 32px. Map is 20 cols x 11 rows = 640x352 px at 2x. Centered in the canvas viewport. ResizeObserver + DPR scaling for crisp rendering on high-DPI displays.

### Data flow

```
Extension messages → App.tsx handler → officeState.method() + React setState()
                                              ↓
                                    requestAnimationFrame loop
                                              ↓
                                    officeState.update(dt) → character movement
                                              ↓
                                    renderer draws to canvas (reads officeState)

React state (agentTools etc.) → ToolOverlay component (HTML positioned over canvas)
                              → AgentLabels component (name + status dot above each character)
```

### Character behavior

- **Active (working)**: Character pathfinds (BFS) to assigned chair tile, sits down facing the desk, plays typing or reading animation depending on the active tool. Triggered by `agentToolStart` or `agentStatus: 'active'`.
- **Idle (waiting)**: Character stands up from desk, wanders to random walkable tiles via BFS pathfinding with 2-5s pauses between moves. Triggered by `agentStatus: 'waiting'`. Walk animation has 4 frames per direction.
- **Created**: Spawns at desk in typing state (assumes new agents are immediately active).
- **Removed**: Character disappears, desk slot freed for next agent.

### Movement system

**Tile-based**: Characters move on a grid, one tile at a time in cardinal directions (no diagonals). BFS pathfinding navigates around walls, desks, and through doorways. Each step lerps pixel position from one tile center to the next.

**4-directional sprites**: All states (idle, walk, typing, reading) have sprites for all 4 directions (down, up, left, right). Left sprites are generated by flipping right sprites horizontally. Direction is set by the current path step when walking, and by the desk slot's `facingDir` when sitting.

**Tool-specific animations**: At desk, characters show either:
- **Typing** animation (arms on keyboard): Write, Edit, Bash, NotebookEdit, Task, and unknown tools
- **Reading** animation (arms at sides, looking at screen): Read, Grep, Glob, WebFetch, WebSearch

Tool name is extracted from the status prefix (e.g., "Reading src/App.tsx" → Read tool → reading animation).

### Office layout

Two rooms connected by a doorway (col 10, rows 4-6):
- **Left room** (tile floor, checkerboard pattern): 1 square desk (2x2 tiles) at (4,3)-(5,4), bookshelf on wall, plant in corner
- **Right room** (wood floor): 1 square desk (2x2 tiles) at (13,3)-(14,4), water cooler, plant, whiteboard on wall
- **Break area** (purple carpet): bottom-right corner of right room
- Walls around perimeter + center divider

### Desk system

Each desk is 2x2 tiles with 4 chair positions (one per side), facing toward the desk center:
- **Top chair**: 1 tile above desk, facing DOWN
- **Bottom chair**: 1 tile below desk, facing UP
- **Left chair**: 1 tile left of desk, facing RIGHT
- **Right chair**: 1 tile right of desk, facing LEFT

2 desks × 4 chairs = 8 slots total (supports up to 8 agents; 6 palettes cycle).

### Interaction

- **Hover** character → `ToolOverlay` tooltip appears showing agent name, active tools (blue pulsing dot), completed tools (green dot, dimmed), permission waits (amber), subagent tools (nested)
- **Click** character → sends `focusAgent` message to extension, which focuses the terminal
- **Name labels** float above each character with status dot (blue pulse = active, amber = waiting)
- **"+ Agent" button** (top-left) creates new terminal + character
- **"Sessions" button** opens JSONL folder in file explorer

### TypeScript constraints

- No `enum` (`erasableSyntaxOnly`) — use `as const` objects (e.g., `TileType`, `CharacterState`, `Direction`)
- `import type` required for type-only imports (`verbatimModuleSyntax`)
- `noUnusedLocals` / `noUnusedParameters` — every import must be used

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
