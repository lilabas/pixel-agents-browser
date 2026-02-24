import * as fs from 'fs';
import * as path from 'path';
import type { WebviewBridge } from './wsServer.js';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { removeAgent } from './agentManager.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';

const SUBAGENT_STALE_MS = 30 * 1000; // Remove subagents inactive for 30s

/**
 * Remove subagent entries whose JSONL files haven't been modified recently.
 */
export function cleanupStaleSubagents(
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	webview: WebviewBridge | undefined,
	persistAgents: () => void,
): void {
	for (const [id, agent] of agents) {
		if (!agent.jsonlFile.includes('/subagents/')) continue;
		try {
			const stat = fs.statSync(agent.jsonlFile);
			if (Date.now() - stat.mtimeMs > SUBAGENT_STALE_MS) {
				console.log(`[Pixel Agents] Removing stale subagent ${id}`);
				removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
				webview?.postMessage({ type: 'agentClosed', id });
			}
		} catch {
			// File gone — remove agent
			removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
			webview?.postMessage({ type: 'agentClosed', id });
		}
	}
}

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
): void {
	// Primary: fs.watch
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	// Backup: poll every 2s
	const interval = setInterval(() => {
		if (!agents.has(agentId)) { clearInterval(interval); return; }
		readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) return;

		const buf = Buffer.alloc(stat.size - agent.fileOffset);
		const fd = fs.openSync(agent.jsonlFile, 'r');
		fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
		fs.closeSync(fd);
		agent.fileOffset = stat.size;

		const text = agent.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		agent.lineBuffer = lines.pop() || '';

		const hasLines = lines.some(l => l.trim());
		if (hasLines) {
			// New data arriving — cancel timers (data flowing means agent is still active)
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}

		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
		}
	} catch (e) {
		console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
	}
}

export function ensureProjectScan(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	_activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
	persistAgents: () => void,
): void {
	if (projectScanTimerRef.current) return;
	// Seed with all existing JSONL files so we only react to truly new ones
	try {
		const files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		for (const f of files) {
			knownJsonlFiles.add(f);
		}
		// Also seed subagents/ directories
		for (const entry of fs.readdirSync(projectDir)) {
			const subagentsDir = path.join(projectDir, entry, 'subagents');
			try {
				if (fs.statSync(subagentsDir).isDirectory()) {
					for (const sf of fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'))) {
						knownJsonlFiles.add(path.join(subagentsDir, sf));
					}
				}
			} catch { /* ignore */ }
		}
	} catch { /* dir may not exist yet */ }

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewJsonlFiles(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
	persistAgents: () => void,
): void {
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		// Also scan subagents/ directories
		for (const entry of fs.readdirSync(projectDir)) {
			const subagentsDir = path.join(projectDir, entry, 'subagents');
			try {
				if (fs.statSync(subagentsDir).isDirectory()) {
					const subFiles = fs.readdirSync(subagentsDir)
						.filter(f => f.endsWith('.jsonl'))
						.map(f => path.join(subagentsDir, f));
					files.push(...subFiles);
				}
			} catch { /* ignore */ }
		}
	} catch { return; }

	const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
	for (const file of files) {
		if (!knownJsonlFiles.has(file)) {
			knownJsonlFiles.add(file);

			// Only create agent for recently active files
			try {
				const stat = fs.statSync(file);
				if (Date.now() - stat.mtimeMs > ACTIVE_THRESHOLD_MS) continue;
			} catch { continue; }

			const sessionId = path.basename(file, '.jsonl');
			const id = nextAgentIdRef.current++;
			const agent: AgentState = {
				id,
				sessionId,
				projectDir,
				jsonlFile: file,
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
			console.log(`[Pixel Agents] New agent discovered: ${id} → "${sessionId}"`);
			webview?.postMessage({ type: 'agentCreated', id });

			// Start watching from current position
			try {
				const stat = fs.statSync(file);
				agent.fileOffset = stat.size;
				startFileWatching(id, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
			} catch { /* ignore */ }

			persistAgents();
		}
	}
}

export function reassignAgentToFile(
	agentId: number,
	newFilePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: WebviewBridge | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Stop old file watching
	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);

	// Clear activity
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, webview);

	// Swap to new file
	agent.jsonlFile = newFilePath;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	// Start watching new file
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}
