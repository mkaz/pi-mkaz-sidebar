import type { WorkspacePulseData } from "./workspace-pulse.js";

export type ActivityState = "ready" | "working" | "warning" | "error";

export interface ResponsePerformance {
	ttftMs: number;
	tokensPerSecond?: number;
	estimated?: true;
}

export interface DisplayValue {
	text: string;
	available: boolean;
}

export interface SidebarMetrics {
	usageAvailable: boolean;
	costAvailable: boolean;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheHitPercent?: number;
	cost: number;
	subscription: boolean;
	contextTokens: number | null;
	contextWindow: number;
	contextPercent: number | null;
	autoCompact: boolean | null;
}

export type WorkspacePulseState =
	| { status: "inspecting" }
	| { status: "clean" | "changed" | "conflict" | "stale"; data: WorkspacePulseData }
	| { status: "not-repo" | "unavailable" };

export interface SidebarState {
	activity: ActivityState;
	modelId?: string;
	provider?: string;
	thinkingLevel?: string;
	branch?: string;
	dirty: boolean;
	workspacePulse: WorkspacePulseState;
	metrics: SidebarMetrics;
	extensionStatuses: readonly string[];
}

/** Footer render input: runtime state plus the live response metrics the runtime does not own. */
export interface FooterState extends SidebarState {
	performance?: ResponsePerformance;
}

/**
 * Strip a `accounts/<vendor>/models/` prefix from a model id (Fireworks-style
 * vendor APIs return this shape). Leaves other ids unchanged.
 */
export function shortModelId(modelId: string): string {
	return modelId.replace(/^accounts\/[^/]+\/models\//, "");
}
