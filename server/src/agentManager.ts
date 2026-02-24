import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { WebviewBridge } from './wsServer.js';
import type { AgentState, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, ensureProjectScan } from './fileWatcher.js';
import { AGENTS_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';
import { loadLayout } from './layoutPersistence.js';
import { readSettings } from './settingsPersistence.js';

export function getProjectDirPath(workspacePath: string): string | null {
	if (!workspacePath) return null;
	const dirName = workspacePath.replace(/[:\\/]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

export function getAllProjectDirs(): string[] {
	const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
	try {
		if (!fs.existsSync(claudeProjectsDir)) return [];
		return fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(claudeProjectsDir, d.name));
	} catch { return []; }
}

export function getProjectName(projectDir: string): string {
	// projectDir like: ~/.claude/projects/-Users-lilabas-Documents-personal-pixel-agents-browser
	// Encoded form replaces /:\  with -, so hyphens in dir names are ambiguous.
	// Use known directory names to find where the project name starts.
	const encoded = path.basename(projectDir);
	const segments = encoded.split('-').filter(Boolean);
	if (segments.length === 0) return encoded;

	const knownDirs = new Set([
		'Users', 'home', 'root',
		'Documents', 'Desktop', 'Downloads', 'Library',
		'Projects', 'projects', 'repos', 'repositories',
		'src', 'source', 'code', 'Code',
		'work', 'Work', 'workspace', 'Workspace',
		'dev', 'Dev', 'Development',
		'personal', 'Personal',
		'github', 'GitHub', 'gitlab', 'GitLab',
		'go', 'var', 'tmp', 'opt', 'usr', 'etc',
		'mnt', 'media', 'data',
	]);

	let lastKnownIdx = -1;
	for (let i = 0; i < segments.length; i++) {
		if (knownDirs.has(segments[i])) {
			lastKnownIdx = i;
			// Users/home are always followed by a username — skip it too
			if ((segments[i] === 'Users' || segments[i] === 'home') && i + 1 < segments.length) {
				lastKnownIdx = i + 1;
				i++;
			}
		}
	}

	if (lastKnownIdx >= 0 && lastKnownIdx < segments.length - 1) {
		return segments.slice(lastKnownIdx + 1).join('-');
	}
	// Fallback: skip first two segments (likely /Users/<name> or /home/<name>)
	if (segments.length > 2) {
		return segments.slice(2).join('-');
	}
	return segments.join('-') || encoded;
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
	const RESTORE_STALE_MS = 5 * 60 * 1000; // 5 minutes — matches cleanup threshold

	for (const p of persisted) {
		// Skip subagent sessions — they are transient and discovered dynamically
		if (p.jsonlFile.includes('/subagents/')) continue;

		// Only restore if JSONL file exists and was recently active
		try {
			if (!fs.existsSync(p.jsonlFile)) continue;
			const stat = fs.statSync(p.jsonlFile);
			if (Date.now() - stat.mtimeMs > RESTORE_STALE_MS) continue;
		} catch {
			continue;
		}

		const agent: AgentState = {
			id: p.id,
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
	ensureProjectScan(
		knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
		nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		webview, doPersist,
	);
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
	const baseMeta = settings.agentSeats || {};
	// Merge projectName from live agent state into meta
	const agentMeta: Record<number, Record<string, unknown>> = {};
	for (const id of agentIds) {
		const agent = agents.get(id);
		const base = (baseMeta as Record<number, Record<string, unknown>>)[id] || {};
		agentMeta[id] = { ...base, projectName: agent ? getProjectName(agent.projectDir) : undefined };
	}
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
	const projectDirs = getAllProjectDirs();
	if (projectDirs.length === 0) return;

	let jsonlFiles: string[];
	try {
		jsonlFiles = [];
		for (const projectDir of projectDirs) {
			try {
				const files = fs.readdirSync(projectDir)
					.filter(f => f.endsWith('.jsonl'))
					.map(f => path.join(projectDir, f));
				jsonlFiles.push(...files);
				// Also scan subagents/ directories inside each session folder
				for (const entry of fs.readdirSync(projectDir)) {
					const subagentsDir = path.join(projectDir, entry, 'subagents');
					try {
						if (fs.statSync(subagentsDir).isDirectory()) {
							const subFiles = fs.readdirSync(subagentsDir)
								.filter(f => f.endsWith('.jsonl'))
								.map(f => path.join(subagentsDir, f));
							jsonlFiles.push(...subFiles);
						}
					} catch { /* not a session dir or no subagents */ }
				}
			} catch { /* skip unreadable project dir */ }
		}
	} catch { return; }

	// Collect JSONL files already tracked by existing agents
	const trackedFiles = new Set<string>();
	for (const agent of agents.values()) {
		trackedFiles.add(agent.jsonlFile);
	}

	const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
	const SUBAGENT_THRESHOLD_MS = 30 * 1000; // 30 seconds — subagents are transient
	for (const filePath of jsonlFiles) {
		if (trackedFiles.has(filePath)) continue;

		// Only pick up sessions actively being written to
		const isSubagent = filePath.includes('/subagents/');
		const threshold = isSubagent ? SUBAGENT_THRESHOLD_MS : ACTIVE_THRESHOLD_MS;
		try {
			const stat = fs.statSync(filePath);
			if (Date.now() - stat.mtimeMs > threshold) continue;
		} catch { continue; }

		const sessionId = path.basename(filePath, '.jsonl');
		const id = nextAgentIdRef.current++;
		// For subagent files (.../projectDir/session/subagents/file.jsonl), go up 2 dirs
		// For normal files (.../projectDir/file.jsonl), go up 1 dir
		const derivedProjectDir = isSubagent
			? path.dirname(path.dirname(path.dirname(filePath)))
			: path.dirname(filePath);
		const agent: AgentState = {
			id,
			sessionId,
			projectDir: derivedProjectDir,
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
		const projectName = getProjectName(derivedProjectDir);
		console.log(`[Pixel Agents] Auto-discovered agent ${id} → session "${sessionId}"`);
		webview?.postMessage({ type: 'agentCreated', id, projectName });

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
