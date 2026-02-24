import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiscoveredSession {
	projectDir: string;
	sessionId: string;
	jsonlFile: string;
	lastModified: number;
}

export function discoverActiveSessions(): DiscoveredSession[] {
	const claudeDir = path.join(os.homedir(), '.claude', 'projects');
	const sessions: DiscoveredSession[] = [];
	const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

	try {
		if (!fs.existsSync(claudeDir)) return sessions;

		const projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true })
			.filter(d => d.isDirectory());

		for (const projEntry of projectDirs) {
			const projPath = path.join(claudeDir, projEntry.name);
			try {
				const files = fs.readdirSync(projPath)
					.filter(f => f.endsWith('.jsonl'));

				for (const file of files) {
					const filePath = path.join(projPath, file);
					try {
						const stat = fs.statSync(filePath);
						if (stat.mtimeMs > cutoff) {
							const sessionId = path.basename(file, '.jsonl');
							sessions.push({
								projectDir: projPath,
								sessionId,
								jsonlFile: filePath,
								lastModified: stat.mtimeMs,
							});
						}
					} catch { /* skip unreadable files */ }
				}
			} catch { /* skip unreadable dirs */ }
		}
	} catch (err) {
		console.error('[Pixel Agents] Failed to discover sessions:', err);
	}

	return sessions.sort((a, b) => b.lastModified - a.lastModified);
}
