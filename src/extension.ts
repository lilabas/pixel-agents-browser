import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_TERMINAL_PATTERN = /^Claude Code #(\d+)$/;

interface FolderInfo {
	id: string;
	name: string;
	path: string;
}

interface AgentFolderMapping {
	agentId: number;
	folderId: string;
}

class ArcadiaViewProvider implements vscode.WebviewViewProvider {
	private nextId = 1;
	private terminals = new Map<number, vscode.Terminal>();
	private webviewView: vscode.WebviewView | undefined;
	private folders: FolderInfo[] = [];
	private agentFolders = new Map<number, string>(); // agentId → folderId
	private movingAgents = new Set<number>(); // agents currently being moved (suppress close event)

	// Transcript watching state
	private sessionIds = new Map<number, string>();
	private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	private fileWatchers = new Map<number, fs.FSWatcher>();
	private fileOffsets = new Map<number, number>();
	private lineBuffers = new Map<number, string>();
	private watchTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private activeToolIds = new Map<number, Set<string>>();

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		// Adopt any existing Claude Code terminals
		this.adoptExistingTerminals();

		// Ensure a default folder exists
		this.ensureDefaultFolder();

		webviewView.webview.onDidReceiveMessage((message) => {
			if (message.type === 'openClaude') {
				const folderId = message.folderId as string | undefined;
				const folderPath = message.folderPath as string | undefined;
				const id = this.nextId++;
				const terminal = this.createClaudeTerminal(id, folderPath);
				terminal.show();
				this.terminals.set(id, terminal);
				const assignedFolderId = folderId || (this.folders.length > 0 ? this.folders[0].id : '');
				this.agentFolders.set(id, assignedFolderId);
				webviewView.webview.postMessage({ type: 'agentCreated', id, folderId: assignedFolderId });
			} else if (message.type === 'focusAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.show();
				}
			} else if (message.type === 'closeAgent') {
				const terminal = this.terminals.get(message.id);
				if (terminal) {
					terminal.dispose();
				}
			} else if (message.type === 'webviewReady') {
				this.sendExistingAgents();
			} else if (message.type === 'addFolder') {
				this.handleAddFolder();
			} else if (message.type === 'moveAgent') {
				this.handleMoveAgent(
					message.agentId as number,
					message.targetFolderId as string,
					message.targetPath as string,
					message.keepAccess as boolean,
					message.sourcePath as string | undefined,
					message.continueConversation as boolean,
				);
			}
		});

		// Clean up buttons when terminals are closed (skip agents being moved)
		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, terminal] of this.terminals) {
				if (terminal === closed) {
					if (this.movingAgents.has(id)) { break; }
					this.stopWatching(id);
					this.terminals.delete(id);
					this.agentFolders.delete(id);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
					break;
				}
			}
		});

		// Detect Claude Code terminals opened outside the extension
		vscode.window.onDidOpenTerminal((terminal) => {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match && !this.isTracked(terminal)) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
				const folderId = this.folders.length > 0 ? this.folders[0].id : '';
				this.agentFolders.set(id, folderId);
				webviewView.webview.postMessage({ type: 'agentCreated', id, folderId });
			}
		});
	}

	private ensureDefaultFolder() {
		if (this.folders.length === 0) {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				const wsPath = workspaceFolders[0].uri.fsPath;
				this.folders.push({
					id: 'default',
					name: path.basename(wsPath),
					path: wsPath,
				});
			}
		}
	}

	private async handleAddFolder() {
		const uris = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: 'Select Folder',
		});
		if (uris && uris.length > 0) {
			const folderPath = uris[0].fsPath;
			const folder: FolderInfo = {
				id: crypto.randomUUID(),
				name: path.basename(folderPath),
				path: folderPath,
			};
			this.folders.push(folder);
			this.webviewView?.webview.postMessage({
				type: 'folderAdded',
				id: folder.id,
				name: folder.name,
				path: folder.path,
			});
		}
	}

	private handleMoveAgent(
		agentId: number,
		targetFolderId: string,
		targetPath: string,
		keepAccess: boolean,
		sourcePath: string | undefined,
		continueConversation: boolean,
	) {
		const oldTerminal = this.terminals.get(agentId);
		if (!oldTerminal) { return; }

		// Claude Code cannot change its primary cwd mid-session, and
		// terminal.sendText() cannot submit commands to Ink's raw-mode stdin.
		// Instead, dispose the terminal and restart in the new directory.
		this.movingAgents.add(agentId);
		this.stopWatching(agentId);
		oldTerminal.dispose();

		const addDirs = keepAccess && sourcePath ? [sourcePath] : undefined;
		const newTerminal = this.createClaudeTerminal(agentId, targetPath, addDirs, continueConversation);
		newTerminal.show();
		this.terminals.set(agentId, newTerminal);
		this.agentFolders.set(agentId, targetFolderId);
		this.movingAgents.delete(agentId);

		this.webviewView?.webview.postMessage({
			type: 'agentMoved',
			agentId,
			targetFolderId,
		});
	}

	private createClaudeTerminal(id: number, cwd?: string, addDirs?: string[], continueSession = false): vscode.Terminal {
		const terminal = vscode.window.createTerminal({
			name: `Claude Code #${id}`,
			cwd,
		});
		const sessionId = crypto.randomUUID();
		this.sessionIds.set(id, sessionId);

		const parts = ['claude', '--session-id', sessionId];
		if (addDirs) {
			for (const dir of addDirs) {
				parts.push(`--add-dir "${dir}"`);
			}
		}
		if (continueSession) {
			parts.push('--continue');
		}
		terminal.sendText(parts.join(' '));
		this.startWatchingTranscript(id, sessionId, cwd);
		return terminal;
	}

	private adoptExistingTerminals() {
		for (const terminal of vscode.window.terminals) {
			const match = terminal.name.match(CLAUDE_TERMINAL_PATTERN);
			if (match) {
				const id = parseInt(match[1], 10);
				this.terminals.set(id, terminal);
				if (id >= this.nextId) {
					this.nextId = id + 1;
				}
				// Assign to default folder
				const folderId = this.folders.length > 0 ? this.folders[0].id : 'default';
				this.agentFolders.set(id, folderId);
			}
		}
	}

	private sendExistingAgents() {
		if (!this.webviewView) { return; }
		const agents: AgentFolderMapping[] = [];
		for (const [agentId, folderId] of this.agentFolders) {
			agents.push({ agentId, folderId });
		}
		agents.sort((a, b) => a.agentId - b.agentId);
		this.webviewView.webview.postMessage({
			type: 'existingAgents',
			agents,
			folders: this.folders,
		});
	}

	private isTracked(terminal: vscode.Terminal): boolean {
		for (const t of this.terminals.values()) {
			if (t === terminal) { return true; }
		}
		return false;
	}

	// --- Transcript JSONL watching ---

	private getProjectDirPath(cwd?: string): string | null {
		const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspacePath) { return null; }
		// C:\Users\Dev\Desktop\Arcadia → C--Users-Dev-Desktop-Arcadia
		const dirName = workspacePath.replace(/[:\\/]/g, '-');
		return path.join(os.homedir(), '.claude', 'projects', dirName);
	}

	private startWatchingTranscript(agentId: number, sessionId: string, cwd?: string) {
		const projectDir = this.getProjectDirPath(cwd);
		if (!projectDir) {
			console.log(`[Arcadia] No project dir for agent ${agentId}, cwd=${cwd}`);
			return;
		}

		const filePath = path.join(projectDir, `${sessionId}.jsonl`);
		this.fileOffsets.set(agentId, 0);
		this.lineBuffers.set(agentId, '');
		console.log(`[Arcadia] Watching transcript: ${filePath}`);

		// Wait for file to appear, then start watching
		const tryStart = (retries: number) => {
			if (!this.sessionIds.has(agentId)) { return; }
			if (fs.existsSync(filePath)) {
				console.log(`[Arcadia] File found for agent ${agentId}`);
				// Primary: fs.watch for instant response
				try {
					const watcher = fs.watch(filePath, () => {
						this.readNewLines(agentId, filePath);
					});
					this.fileWatchers.set(agentId, watcher);
				} catch (e) {
					console.log(`[Arcadia] fs.watch failed for agent ${agentId}: ${e}`);
				}
				// Backup: poll every 2s in case fs.watch misses events
				const interval = setInterval(() => {
					if (!this.sessionIds.has(agentId)) { clearInterval(interval); return; }
					this.readNewLines(agentId, filePath);
				}, 2000);
				this.pollingTimers.set(agentId, interval);
				// Initial read
				this.readNewLines(agentId, filePath);
			} else if (retries > 0) {
				const timer = setTimeout(() => tryStart(retries - 1), 1000);
				this.watchTimers.set(agentId, timer);
			} else {
				console.log(`[Arcadia] File never appeared: ${filePath}`);
			}
		};
		tryStart(30);
	}

	private readNewLines(agentId: number, filePath: string) {
		try {
			const stat = fs.statSync(filePath);
			const offset = this.fileOffsets.get(agentId) || 0;
			if (stat.size <= offset) { return; }

			const buf = Buffer.alloc(stat.size - offset);
			const fd = fs.openSync(filePath, 'r');
			fs.readSync(fd, buf, 0, buf.length, offset);
			fs.closeSync(fd);
			this.fileOffsets.set(agentId, stat.size);

			// Prepend any leftover partial line from the previous read
			const text = (this.lineBuffers.get(agentId) || '') + buf.toString('utf-8');
			const lines = text.split('\n');
			// Last element may be an incomplete line — save it for next read
			this.lineBuffers.set(agentId, lines.pop() || '');

			for (const line of lines) {
				if (!line.trim()) { continue; }
				this.processTranscriptLine(agentId, line);
			}
		} catch (e) {
			console.log(`[Arcadia] Read error for agent ${agentId}: ${e}`);
		}
	}

	private processTranscriptLine(agentId: number, line: string) {
		try {
			const record = JSON.parse(line);

			if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
				const blocks = record.message.content as Array<{
					type: string; id?: string; name?: string; input?: Record<string, unknown>;
				}>;
				for (const block of blocks) {
					if (block.type === 'tool_use' && block.id) {
						const status = this.formatToolStatus(block.name || '', block.input || {});
						console.log(`[Arcadia] Agent ${agentId} tool start: ${block.id} ${status}`);
						let active = this.activeToolIds.get(agentId);
						if (!active) { active = new Set(); this.activeToolIds.set(agentId, active); }
						active.add(block.id);
						this.webviewView?.webview.postMessage({
							type: 'agentToolStart',
							id: agentId,
							toolId: block.id,
							status,
						});
					}
				}
			} else if (record.type === 'user' && Array.isArray(record.message?.content)) {
				const blocks = record.message.content as Array<{
					type: string; tool_use_id?: string;
				}>;
				const hasToolResult = blocks.some(b => b.type === 'tool_result');
				if (hasToolResult) {
					for (const block of blocks) {
						if (block.type === 'tool_result' && block.tool_use_id) {
							console.log(`[Arcadia] Agent ${agentId} tool done: ${block.tool_use_id}`);
							this.activeToolIds.get(agentId)?.delete(block.tool_use_id);
							const toolId = block.tool_use_id;
							// Delay so the webview renders the active (blue) state before transitioning to done (green)
							setTimeout(() => {
								this.webviewView?.webview.postMessage({
									type: 'agentToolDone',
									id: agentId,
									toolId,
								});
							}, 300);
						}
					}
				} else {
					// Plain user message (new prompt) — clear all tool activities
					this.activeToolIds.delete(agentId);
					this.webviewView?.webview.postMessage({
						type: 'agentToolsClear',
						id: agentId,
					});
				}
			}
		} catch {
			// Ignore malformed lines
		}
	}

	private formatToolStatus(toolName: string, input: Record<string, unknown>): string {
		const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
		switch (toolName) {
			case 'Read': return `Reading ${base(input.file_path)}`;
			case 'Edit': return `Editing ${base(input.file_path)}`;
			case 'Write': return `Writing ${base(input.file_path)}`;
			case 'Bash': {
				const cmd = (input.command as string) || '';
				return `Running: ${cmd.length > 30 ? cmd.slice(0, 30) + '\u2026' : cmd}`;
			}
			case 'Glob': return 'Searching files';
			case 'Grep': return 'Searching code';
			case 'WebFetch': return 'Fetching web content';
			case 'WebSearch': return 'Searching the web';
			case 'Task': return 'Running subtask';
			default: return `Using ${toolName}`;
		}
	}

	private stopWatching(agentId: number) {
		this.fileWatchers.get(agentId)?.close();
		this.fileWatchers.delete(agentId);
		const pt = this.pollingTimers.get(agentId);
		if (pt) { clearInterval(pt); }
		this.pollingTimers.delete(agentId);
		const wt = this.watchTimers.get(agentId);
		if (wt) { clearTimeout(wt); }
		this.watchTimers.delete(agentId);
		this.activeToolIds.delete(agentId);
		this.sessionIds.delete(agentId);
		this.fileOffsets.delete(agentId);
		this.lineBuffers.delete(agentId);
	}

	dispose() {
		for (const id of [...this.sessionIds.keys()]) {
			this.stopWatching(id);
		}
	}
}

let providerInstance: ArcadiaViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	const provider = new ArcadiaViewProvider(context.extensionUri);
	providerInstance = provider;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('arcadia.panelView', provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('arcadia.showPanel', () => {
			vscode.commands.executeCommand('arcadia.panelView.focus');
		})
	);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	// Rewrite asset paths to use webview URIs
	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}

export function deactivate() {
	providerInstance?.dispose();
}
