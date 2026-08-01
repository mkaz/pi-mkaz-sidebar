export type PaletteRole =
	| "accent"
	| "primary"
	| "muted"
	| "dim"
	| "success"
	| "ready"
	| "working"
	| "input"
	| "output"
	| "cache"
	| "cost"
	| "context"
	| "menu"
	| "warning"
	| "error";

interface PaletteTheme {
	readonly name?: string;
	fg(color: string, text: string): string;
}

const THEME_COLORS: Record<PaletteRole, string> = {
	accent: "accent",
	primary: "text",
	muted: "muted",
	dim: "dim",
	success: "success",
	ready: "thinkingLow",
	working: "mdHeading",
	input: "thinkingLow",
	output: "thinkingHigh",
	cache: "syntaxType",
	cost: "mdHeading",
	context: "thinkingLow",
	menu: "thinkingHigh",
	warning: "warning",
	error: "error",
};

const NO_COLOR: Record<PaletteRole, string> = {
	accent: "accent",
	primary: "text",
	muted: "muted",
	dim: "dim",
	success: "text",
	ready: "text",
	working: "text",
	input: "text",
	output: "text",
	cache: "text",
	cost: "text",
	context: "text",
	menu: "text",
	warning: "warning",
	error: "error",
};

export interface SidebarPalette {
	paint(role: PaletteRole, text: string): string;
}

export function effortRole(effort: string): PaletteRole {
	switch (effort.trim().toLowerCase().replace(/[\s_-]/g, "")) {
		case "medium":
			return "primary";
		case "high":
			return "cache";
		case "xhigh":
			return "warning";
		case "max":
		case "maximum":
			return "error";
		default:
			return "muted";
	}
}

export function createPalette(theme: PaletteTheme, colorEnabled: boolean): SidebarPalette {
	return {
		paint(role, text) {
			return theme.fg(colorEnabled ? THEME_COLORS[role] : NO_COLOR[role], text);
		},
	};
}
