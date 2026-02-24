import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as path from 'path';
import { PixelAgentsSession } from './wsServer.js';
import { SERVER_PORT } from './constants.js';

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || String(SERVER_PORT), 10);
const cwd = process.argv.find((_, i, a) => a[i - 1] === '--cwd') || path.resolve(process.cwd(), '..');

const app = express();
const server = createServer(app);

// Serve static webview-ui build in production
const staticDir = path.join(cwd, 'webview-ui', 'dist');
app.use(express.static(staticDir));

// Fallback to index.html for SPA routing
app.get('*', (_req, res) => {
	res.sendFile(path.join(staticDir, 'index.html'));
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
	console.log('[Pixel Agents] WebSocket client connected');
	new PixelAgentsSession(ws, cwd);
});

server.listen(port, () => {
	console.log(`Pixel Agents running at http://localhost:${port}`);
});
