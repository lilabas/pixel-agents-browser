import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as pty from 'node-pty';
import type { WebviewBridge } from './wsServer.js';
import type { AgentState, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, AGENTS_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';
import { loadLayout } from './layoutPersistence.js';
import { readSettings } from './settingsPersistence.js';

export function getProjectDirPath(workspacePath: string): string | null {
	if (!workspacePath) return null;
	const dirName = workspacePath.replace(/[:\\/]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

export function launchNewTerminal(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	webview: WebviewBridge | undefined,
	workspacePath: string,
	persistAgentsFn: () => void,
): void {
	const projectDir = getProjectDirPath(workspacePath);
	if (!projectDir) {
		console.log(`[Pixel Agents] No project dir, cannot track agent`);
		return;
	}

	const sessionId = crypto.randomUUID();

	// Resolve full path to claude binary (node-pty's posix_spawnp may not see full shell PATH)
	let claudePath = 'claude';
	try {
		claudePath = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
	} catch { /* fall back to bare name */ }

	const proc = pty.spawn(claudePath, ['--session-id', sessionId], {
		name: 'xterm-256color',
		cols: 120,
		rows: 30,
		cwd: workspacePath,
		env: process.env as Record<string, string>,
	});

	// Pre-register expected JSONL file so project scan won't treat it as a /clear file
	const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
	knownJsonlFiles.add(expectedFile);

	// Create agent immediately (before JSONL file exists)
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		processRef: proc,
		sessionId,
		projectDir,
		jsonlFile: expectedFile,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgentsFn();
	console.log(`[Pixel Agents] Agent ${id}: created with session ${sessionId}`);
	webview?.postMessage({ type: 'agentCreated', id });

	// Stream terminal output to webview
	proc.onData((data: string) => {
		webview?.postMessage({ type: 'terminalData', id, data });
	});

	// Clean up when process exits
	proc.onExit(({ exitCode }) => {
		console.log(`[Pixel Agents] Agent ${id}: process exited with code ${exitCode}`);
		removeAgent(
			id, agents, fileWatchers, pollingTimers,
			waitingTimers, permissionTimers, jsonlPollTimers, persistAgentsFn,
		);
		webview?.postMessage({ type: 'agentClosed', id });
	});

	ensureProjectScan(
		projectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
		nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		webview, persistAgentsFn,
	);

	// Poll for the specific JSONL file to appear
	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
				readNewLines(id, agents, waitingTimers, permissionTimers, webview);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgentsFn: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Kill the process if still running
	agent.processRef?.kill();

	// Stop JSONL poll timer
	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	// Stop file watching
	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);

	// Cancel timers
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);

	// Remove from maps
	agents.delete(agentId);
	persistAgentsFn();
}

export function persistAgents(agents: Map<number, AgentState>): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		persisted.push({
			id: agent.id,
			sessionId: agent.sessionId,
			jsonlFile: agent.jsonlFile,
			projectDir: agent.projectDir,
		});
	}
	const dir = path.join(os.homedir(), LAYOUT_FILE_DIR);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, AGENTS_FILE_NAME), JSON.stringify(persisted, null, 2));
}

export function restoreAgents(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	_jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	activeAgentIdRef: { current: number | null },
	webview: WebviewBridge | undefined,
	doPersist: () => void,
): void {
	const agentsFilePath = path.join(os.homedir(), LAYOUT_FILE_DIR, AGENTS_FILE_NAME);
	let persisted: PersistedAgent[] = [];
	try {
		if (fs.existsSync(agentsFilePath)) {
			const raw = fs.readFileSync(agentsFilePath, 'utf-8');
			persisted = JSON.parse(raw) as PersistedAgent[];
		}
	} catch (err) {
		console.error('[Pixel Agents] Failed to read persisted agents:', err);
	}
	if (persisted.length === 0) return;

	let maxId = 0;
	let restoredProjectDir: string | null = null;
	const ONE_HOUR_MS = 60 * 60 * 1000;

	for (const p of persisted) {
		// Only restore if JSONL file exists and was modified within the last hour
		try {
			if (!fs.existsSync(p.jsonlFile)) continue;
			const stat = fs.statSync(p.jsonlFile);
			if (Date.now() - stat.mtimeMs > ONE_HOUR_MS) continue;
		} catch {
			continue;
		}

		const agent: AgentState = {
			id: p.id,
			processRef: null, // monitoring only — no live process
			sessionId: p.sessionId,
			projectDir: p.projectDir,
			jsonlFile: p.jsonlFile,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
		};

		agents.set(p.id, agent);
		knownJsonlFiles.add(p.jsonlFile);
		console.log(`[Pixel Agents] Restored agent ${p.id} → session "${p.sessionId}"`);

		if (p.id > maxId) maxId = p.id;
		restoredProjectDir = p.projectDir;

		// Start file watching, skipping to end of file
		try {
			const stat = fs.statSync(p.jsonlFile);
			agent.fileOffset = stat.size;
			startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
		} catch { /* ignore errors during restore */ }
	}

	// Advance counter past restored IDs
	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}

	// Re-persist cleaned-up list (removes entries whose JSONL files are stale)
	doPersist();

	// Start project scan for /clear detection
	if (restoredProjectDir) {
		ensureProjectScan(
			restoredProjectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
			nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, doPersist,
		);
	}
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	webview: WebviewBridge | undefined,
): void {
	if (!webview) return;
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	// Include persisted palette/seatId from settings
	const settings = readSettings();
	const agentMeta = settings.agentSeats || {};
	console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`);

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
	});

	sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
	agents: Map<number, AgentState>,
	webview: WebviewBridge | undefined,
): void {
	if (!webview) return;
	for (const [agentId, agent] of agents) {
		// Re-send active tools
		for (const [toolId, status] of agent.activeToolStatuses) {
			webview.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		// Re-send waiting status
		if (agent.isWaiting) {
			webview.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	}
}

/**
 * Auto-discover active Claude sessions for this project and create agents for any
 * that aren't already tracked. Detects sessions modified within the last hour.
 */
export function autoDiscoverAgents(
	workspacePath: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
	persistAgentsFn: () => void,
): void {
	const projectDir = getProjectDirPath(workspacePath);
	if (!projectDir) return;

	let jsonlFiles: string[];
	try {
		if (!fs.existsSync(projectDir)) return;
		jsonlFiles = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	// Collect JSONL files already tracked by existing agents
	const trackedFiles = new Set<string>();
	for (const agent of agents.values()) {
		trackedFiles.add(agent.jsonlFile);
	}

	const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
	for (const filePath of jsonlFiles) {
		if (trackedFiles.has(filePath)) continue;

		// Only pick up sessions actively being written to
		try {
			const stat = fs.statSync(filePath);
			if (Date.now() - stat.mtimeMs > ACTIVE_THRESHOLD_MS) continue;
		} catch { continue; }

		const sessionId = path.basename(filePath, '.jsonl');
		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			processRef: null,
			sessionId,
			projectDir,
			jsonlFile: filePath,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
		};

		agents.set(id, agent);
		knownJsonlFiles.add(filePath);
		console.log(`[Pixel Agents] Auto-discovered agent ${id} → session "${sessionId}"`);
		webview?.postMessage({ type: 'agentCreated', id });

		// Start watching, skipping to end of file so we only see new activity
		try {
			const stat = fs.statSync(filePath);
			agent.fileOffset = stat.size;
			startFileWatching(id, filePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
		} catch { /* ignore */ }
	}

	if (agents.size > 0) {
		persistAgentsFn();
	}
}

export function sendLayout(
	webview: WebviewBridge | undefined,
	defaultLayout?: Record<string, unknown> | null,
): void {
	if (!webview) return;
	const layout = loadLayout(defaultLayout);
	webview.postMessage({
		type: 'layoutLoaded',
		layout,
	});
}
