# Contributing to Pixel Agents

Thanks for your interest in contributing to Pixel Agents! All contributions are welcome — features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)

### Setup

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd server && npm install && cd ..
cd webview-ui && npm install && cd ..
```

## Development Workflow

For development with hot reload:

```bash
npm run dev
```

This starts the server (with `tsx watch`) and the Vite dev server in parallel. Open `http://localhost:3100` (or the port shown in the terminal) in your browser.

For a production build:

```bash
npm run build
npm start
```

### Project Structure

| Directory | Description |
|---|---|
| `server/` | Node.js backend — Express, WebSocket, JSONL file watching |
| `webview-ui/` | React + TypeScript frontend (Vite project) |
| `scripts/` | Asset extraction and generation tooling |

## Code Guidelines
### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled): All magic numbers and strings are centralized — don't add inline constants to source files:

- **Server:** `server/src/constants.ts`
- **Client:** `webview-ui/src/constants.ts`
- **CSS variables:** `webview-ui/src/index.css` `:root` block (`--pixel-*` properties)

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur)
- The FS Pixel Sans font (loaded in `index.css`)

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run the full build to verify everything passes:
   ```bash
   npm run build
   ```
   This runs TypeScript compilation (server) and Vite build (client).
4. Open a pull request against `main` with:
   - A clear description of what changed and why
   - How you tested the changes (steps to reproduce / verify)
   - **Screenshots or GIFs for any UI changes**

## Reporting Bugs

[Open an issue](https://github.com/pablodelucca/pixel-agents/issues) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js version and OS

## Feature Requests

Have an idea? [Open an issue](https://github.com/pablodelucca/pixel-agents/issues) to discuss it before building. This helps avoid duplicate work and ensures the feature fits the project's direction.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
