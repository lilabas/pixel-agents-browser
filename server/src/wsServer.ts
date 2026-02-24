import WebSocket from 'ws';
import * as path from 'path';
import type { FSWatcher } from 'fs';
import {
	removeAgent, persistAgents, restoreAgents,
	sendExistingAgents, sendLayout, getProjectDirPath, autoDiscoverAgents,
} from './agentManager.js';
import { ensureProjectScan, cleanupStaleAgents } from './fileWatcher.js';
import {
	loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles,
	sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview,
	loadCharacterSprites, sendCharacterSpritesToWebview, loadDefaultLayout,
} from './assetLoader.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import type { AgentState } from './types.js';
import { readSettings, writeSettings } from './settingsPersistence.js';

export interface WebviewBridge {
	postMessage(msg: unknown): void;
}

export class WsBridge implements WebviewBridge {
	private ws: WebSocket;

	constructor(ws: WebSocket) {
		this.ws = ws;
	}

	postMessage(msg: unknown): void {
		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}
}

export class PixelAgentsSession {
	private ws: WebSocket;
	private workspacePath: string;
	private bridge: WsBridge;

	// Agent state
	private nextAgentId = { current: 1 };
	private agents = new Map<number, AgentState>();
	private activeAgentId = { current: null as number | null };

	// Per-agent timers
	private fileWatchers = new Map<number, FSWatcher>();
	private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection
	private knownJsonlFiles = new Set<string>();
	private projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Subagent cleanup
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	// Layout
	private defaultLayout: Record<string, unknown> | null = null;
	private layoutWatcher: LayoutWatcher | null = null;

	// Disposed flag
	private disposed = false;

	// Bound persist method
	private persistAgentsBound = (): void => {
		persistAgents(this.agents);
	};

	constructor(ws: WebSocket, workspacePath: string) {
		this.ws = ws;
		this.workspacePath = workspacePath;
		this.bridge = new WsBridge(ws);

		ws.on('message', (data) => {
			try {
				const message = JSON.parse(String(data)) as Record<string, unknown>;
				this.handleMessage(message);
			} catch (err) {
				console.error('[Pixel Agents] Failed to parse message:', err);
			}
		});

		ws.on('close', () => {
			console.log('[Pixel Agents] WebSocket client disconnected');
			this.dispose();
		});
	}

	private handleMessage(message: Record<string, unknown>): void {
		switch (message.type) {
			case 'webviewReady': {
				// Restore agents from persistence
				restoreAgents(
					this.nextAgentId, this.agents, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers,
					this.permissionTimers, this.jsonlPollTimers, this.projectScanTimer,
					this.activeAgentId, this.bridge, this.persistAgentsBound,
				);

				// Auto-discover active Claude sessions for this project
				autoDiscoverAgents(
					this.workspacePath,
					this.nextAgentId, this.agents, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers,
					this.permissionTimers, this.bridge, this.persistAgentsBound,
				);

				// Send settings
				const settings = readSettings();
				this.bridge.postMessage({ type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

				// Ensure project scan
				const projectDir = getProjectDirPath(this.workspacePath);
				if (projectDir) {
					ensureProjectScan(
						projectDir, this.knownJsonlFiles, this.projectScanTimer,
						this.activeAgentId, this.nextAgentId, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers,
						this.permissionTimers, this.bridge, this.persistAgentsBound,
					);
				}

				// Periodically clean up stale agents
				if (!this.cleanupTimer) {
					this.cleanupTimer = setInterval(() => {
						cleanupStaleAgents(
							this.agents, this.fileWatchers, this.pollingTimers,
							this.waitingTimers, this.permissionTimers, this.jsonlPollTimers,
							this.bridge, this.persistAgentsBound,
						);
					}, 10_000); // every 10s
				}

				// Load and send assets (async)
				(async () => {
					try {
						const assetsRoot = path.join(this.workspacePath, 'webview-ui', 'public');

						this.defaultLayout = loadDefaultLayout(assetsRoot);

						const charSprites = await loadCharacterSprites(assetsRoot);
						if (charSprites) {
							sendCharacterSpritesToWebview(this.bridge, charSprites);
						}

						const floorTiles = await loadFloorTiles(assetsRoot);
						if (floorTiles) {
							sendFloorTilesToWebview(this.bridge, floorTiles);
						}

						const wallTiles = await loadWallTiles(assetsRoot);
						if (wallTiles) {
							sendWallTilesToWebview(this.bridge, wallTiles);
						}

						const assets = await loadFurnitureAssets(assetsRoot);
						if (assets) {
							sendAssetsToWebview(this.bridge, assets);
						}
					} catch (err) {
						console.error('[Pixel Agents] Error loading assets:', err);
					}

					sendLayout(this.bridge, this.defaultLayout);
					this.startLayoutWatcher();
				})();

				// Send existing agents
				sendExistingAgents(this.agents, this.bridge);
				break;
			}

			case 'closeAgent': {
				const agent = this.agents.get(message.id as number);
				if (agent) {
					removeAgent(
						message.id as number, this.agents, this.fileWatchers,
						this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgentsBound,
					);
					this.bridge.postMessage({ type: 'agentClosed', id: message.id });
				}
				break;
			}

			case 'saveAgentSeats': {
				console.log('[Pixel Agents] saveAgentSeats:', JSON.stringify(message.seats));
				writeSettings({
					agentSeats: message.seats as Record<string, { palette: number; hueShift: number; seatId: string }>,
				});
				break;
			}

			case 'saveLayout': {
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
				break;
			}

			case 'setSoundEnabled': {
				writeSettings({ soundEnabled: message.enabled as boolean });
				break;
			}

			case 'exportLayout': {
				const layout = readLayoutFromFile();
				if (layout) {
					this.bridge.postMessage({ type: 'exportLayoutData', layout });
				}
				break;
			}

			case 'importLayoutData': {
				const imported = message.layout as Record<string, unknown>;
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(imported);
				this.bridge.postMessage({ type: 'layoutLoaded', layout: imported });
				break;
			}

			case 'setActiveAgent': {
				this.activeAgentId.current = message.id as number | null;
				break;
			}

			}
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Pixel Agents] External layout change — pushing to client');
			this.bridge.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;

		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents, this.fileWatchers, this.pollingTimers,
				this.waitingTimers, this.permissionTimers, this.jsonlPollTimers,
				this.persistAgentsBound,
			);
		}

		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}

		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		this.ws.close();
	}
}
