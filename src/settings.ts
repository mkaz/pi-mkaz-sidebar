import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface SidebarSettings {
	todo: boolean;
	usage: boolean;
}

const DEFAULT_SETTINGS: SidebarSettings = { todo: true, usage: true };
const SETTINGS_PATH = fileURLToPath(new URL("../settings.json", import.meta.url));

export function loadSidebarSettings(): SidebarSettings {
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("settings must be a JSON object");
		}
		const settings = parsed as Record<string, unknown>;
		const todo = settings.todo;
		const usage = settings.usage;
		if (todo !== undefined && typeof todo !== "boolean") {
			throw new Error('"todo" must be true or false');
		}
		if (usage !== undefined && typeof usage !== "boolean") {
			throw new Error('"usage" must be true or false');
		}
		return {
			todo: todo ?? DEFAULT_SETTINGS.todo,
			usage: usage ?? DEFAULT_SETTINGS.usage,
		};
	} catch (error) {
		console.warn(
			`[pi-mkaz-sidebar] Could not read ${SETTINGS_PATH}; using defaults: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { ...DEFAULT_SETTINGS };
	}
}
