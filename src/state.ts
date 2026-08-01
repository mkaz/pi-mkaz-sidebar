import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { aggregateMetrics, type UsageMessage } from "./metrics.js";
import type {
	ActivityState,
	SidebarConfig,
	SidebarState,
} from "./types.js";
import {
	inspectWorkspacePulse,
	type WorkspacePulseData,
	type WorkspacePulseInspection,
} from "./workspace-pulse.js";

const WORKSPACE_REFRESH_DEBOUNCE_MS = 250;
export interface RuntimeDependencies {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: SidebarConfig;
	autoCompact: boolean | null;
	requestRender(): void;
	inspectWorkspace?(): Promise<WorkspacePulseInspection>;
}

export class SidebarRuntime {
	readonly #pi: ExtensionAPI;
	readonly #ctx: ExtensionContext;
	readonly #autoCompact: boolean | null;
	readonly #requestRender: () => void;
	readonly #inspectWorkspace: () => Promise<WorkspacePulseInspection>;
	#config: SidebarConfig;
	#disposed = false;
	#workspaceRefreshGeneration = 0;
	#workspaceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	#lastWorkspaceData: WorkspacePulseData | undefined;
	#state: SidebarState;

	constructor(dependencies: RuntimeDependencies) {
		this.#pi = dependencies.pi;
		this.#ctx = dependencies.ctx;
		this.#config = dependencies.config;
		this.#autoCompact = dependencies.autoCompact;
		this.#requestRender = dependencies.requestRender;
		this.#inspectWorkspace =
			dependencies.inspectWorkspace ??
			(() => inspectWorkspacePulse({ exec: this.#pi.exec.bind(this.#pi), cwd: this.#ctx.cwd }));
		const context = this.#ctx.getContextUsage();
		this.#state = {
			activity: "ready",
			dirty: false,
			workspacePulse: { status: "inspecting" },
			metrics: aggregateMetrics([], {
				subscription: false,
				autoCompact: this.#autoCompact,
				...(context ? { context } : {}),
			}),
			extensionStatuses: [],
		};
		this.refreshUsage();
	}

	getState(): SidebarState {
		return this.#state;
	}

	getConfig(): SidebarConfig {
		return this.#config;
	}


	setActivity(activity: ActivityState): void {
		if (this.#state.activity === activity) return;
		this.#state = { ...this.#state, activity };
		this.#invalidate();
	}

	refreshUsage(): void {
		if (this.#disposed) return;
		const messages: UsageMessage[] = [];
		for (const entry of this.#ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				messages.push(entry.message as UsageMessage);
			}
		}
		const model = this.#ctx.model;
		const context = this.#ctx.getContextUsage();
		const subscription = model ? this.#ctx.modelRegistry.isUsingOAuth(model) : false;
		const { modelId: _modelId, provider: _provider, ...stateWithoutModel } = this.#state;
		this.#state = {
			...stateWithoutModel,
			...(model ? { modelId: model.id, provider: model.provider } : {}),
			thinkingLevel: this.#pi.getThinkingLevel?.(),
			metrics: aggregateMetrics(messages, {
				subscription,
				autoCompact: this.#autoCompact,
				...(context ? { context } : {}),
			}),
		};
		this.#invalidate();
	}

	scheduleWorkspacePulseRefresh(delayMs = WORKSPACE_REFRESH_DEBOUNCE_MS): void {
		if (this.#disposed) return;
		if (this.#workspaceRefreshTimer) clearTimeout(this.#workspaceRefreshTimer);
		this.#workspaceRefreshTimer = setTimeout(
			() => {
				this.#workspaceRefreshTimer = undefined;
				void this.refreshWorkspacePulse();
			},
			Math.max(0, Math.trunc(delayMs)),
		);
		this.#workspaceRefreshTimer.unref?.();
	}

	async refreshWorkspacePulse(): Promise<void> {
		if (this.#disposed) return;
		if (this.#workspaceRefreshTimer) {
			clearTimeout(this.#workspaceRefreshTimer);
			this.#workspaceRefreshTimer = undefined;
		}
		const generation = ++this.#workspaceRefreshGeneration;
		const inspection = await this.#inspectWorkspace();
		if (this.#disposed || generation !== this.#workspaceRefreshGeneration) return;

		if (inspection.kind === "available") {
			const { kind: _kind, ...data } = inspection;
			this.#lastWorkspaceData = data;
			const { snapshot } = data;
			const dirty = snapshot.trackedFiles > 0;
			const pulseChanged = dirty || snapshot.untrackedFiles > 0;
			const status = snapshot.conflicts > 0 ? "conflict" : pulseChanged ? "changed" : "clean";
			const { branch: _branch, ...withoutBranch } = this.#state;
			this.#replaceState({
				...withoutBranch,
				...(data.branch ? { branch: data.branch } : {}),
				dirty,
				workspacePulse: { status, data },
			});
			return;
		}

		if (inspection.kind === "not-repo") {
			this.#lastWorkspaceData = undefined;
			const { branch: _branch, ...withoutBranch } = this.#state;
			this.#replaceState({
				...withoutBranch,
				dirty: false,
				workspacePulse: { status: "not-repo" },
			});
			return;
		}

		this.#replaceState({
			...this.#state,
			workspacePulse: this.#lastWorkspaceData
				? { status: "stale", data: this.#lastWorkspaceData }
				: { status: "unavailable" },
		});
	}

	async refreshGitState(): Promise<void> {
		await this.refreshWorkspacePulse();
	}

	async refreshGitDirty(): Promise<void> {
		await this.refreshWorkspacePulse();
	}

	dispose(): void {
		this.#disposed = true;
		this.#workspaceRefreshGeneration += 1;
		if (this.#workspaceRefreshTimer) clearTimeout(this.#workspaceRefreshTimer);
		this.#workspaceRefreshTimer = undefined;
	}

	#replaceState(next: SidebarState): void {
		if (isDeepStrictEqual(this.#state, next)) return;
		this.#state = next;
		this.#invalidate();
	}

	#invalidate(): void {
		if (!this.#disposed) this.#requestRender();
	}
}
