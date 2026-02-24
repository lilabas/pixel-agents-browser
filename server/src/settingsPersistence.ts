import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, SETTINGS_FILE_NAME } from './constants.js';

export interface Settings {
	soundEnabled: boolean;
	projectLabelsEnabled: boolean;
	agentSeats?: Record<string, { palette: number; hueShift: number; seatId: string }>;
}

const DEFAULT_SETTINGS: Settings = {
	soundEnabled: true,
	projectLabelsEnabled: true,
};

function getSettingsFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, SETTINGS_FILE_NAME);
}

export function readSettings(): Settings {
	const filePath = getSettingsFilePath();
	try {
		if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };
		const raw = fs.readFileSync(filePath, 'utf-8');
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch (err) {
		console.error('[Pixel Agents] Failed to read settings:', err);
		return { ...DEFAULT_SETTINGS };
	}
}

export function writeSettings(settings: Partial<Settings>): void {
	const filePath = getSettingsFilePath();
	const dir = path.dirname(filePath);
	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const current = readSettings();
		const merged = { ...current, ...settings };
		fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
	} catch (err) {
		console.error('[Pixel Agents] Failed to write settings:', err);
	}
}
