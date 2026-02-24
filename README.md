# Pixel Agents

A standalone browser app that turns your Claude Code agents into animated pixel art characters in a virtual office.

Pixel Agents auto-discovers running Claude Code sessions in your project and brings them to life as characters that walk around, sit at desks, and visually reflect what each agent is doing — typing when writing code, reading when searching files, waiting when it needs your attention. It's purely observational — no modifications to Claude Code are needed.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **Auto-discovery** — running Claude Code sessions are automatically detected and visualized as characters
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters that appear while active and disappear when done
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Persistent layouts** — your office design is saved across sessions
- **Diverse characters** — 6 diverse character sprites with customizable palettes

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

## Getting Started

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd server && npm install && cd ..
cd webview-ui && npm install && cd ..
npm run build
npm start
```

Then open `http://localhost:3100` in your browser.

For development with hot reload:

```bash
npm run dev
```

### Usage

1. Start Pixel Agents and open the browser
2. Open Claude Code in a terminal pointed at the same project directory
3. Characters appear automatically as Claude Code sessions become active
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — full HSB color control
- **Walls** — auto-tiling walls with color customization
- **Tools** — select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — share layouts as JSON files via the Settings modal

The grid is expandable up to 64x64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

The office tileset used in this project is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

This is the only part of the project that is not freely available. The tileset is not included in this repository due to its license. To use the full set of office furniture and decorations, purchase the tileset and run the asset import pipeline:

```bash
npm run import-tileset
```

The app will still work without the tileset — you'll get the default characters and basic layout, but the full furniture catalog requires the imported assets.

## How It Works

Pixel Agents watches Claude Code's JSONL transcript files (in `~/.claude/projects/`) to track what each agent is doing. When an agent uses a tool (like writing a file or running a command), it detects the activity and updates the character's animation accordingly. Sub-agents spawned via the Task tool are discovered in their session's `subagents/` directory and automatically cleaned up when they finish.

The frontend runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle -> walk -> type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Server**: Node.js, Express, WebSocket, TypeScript
- **Client**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and can misfire — agents may briefly show the wrong status or miss transitions.
- **macOS tested** — the app has primarily been tested on macOS. It should work on Linux but may have issues on Windows with file path handling.

## Roadmap

There are several areas where contributions would be very welcome:

- **Better status detection** — find or propose clearer signals for agent state transitions (waiting, done, permission needed)
- **Community assets** — freely usable pixel art tilesets or characters that anyone can use without purchasing third-party assets
- **Agent creation and definition** — define agents with custom skills, system prompts, names, and skins before launching them
- **Desks as directories** — click on a desk to select a working directory, drag and drop agents to move them to specific desks/projects
- **Claude Code agent teams** — native support for [agent teams](https://code.claude.com/docs/en/agent-teams), visualizing multi-agent coordination and communication
- **Git worktree support** — agents working in different worktrees to avoid conflict from parallel work on the same files
- **Support for other agentic frameworks** — [OpenCode](https://github.com/nichochar/opencode), or really any kind of agentic experiment you'd want to run inside a pixel art interface (see [simile.ai](https://simile.ai/) for inspiration)

If any of these interest you, feel free to open an issue or submit a PR.

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for instructions on how to contribute to this project.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## License

This project is licensed under the [MIT License](LICENSE).
