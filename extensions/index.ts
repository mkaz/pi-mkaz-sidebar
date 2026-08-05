import {
	type ExtensionAPI,
	type ExtensionContext,
	estimateTokens,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createFooterComponent, type ThemeLike } from "../src/footer.js";
import { ServerRunner } from "../src/server.js";
import { createRunActivityTracker, type RunActivityTracker } from "../src/run-activity.js";
import {
	buildSidebarSnapshot,
	createSidebarController,
	type SidebarController,
	type SidebarSnapshot,
} from "../src/sidebar.js";
import { SidebarRuntime } from "../src/state.js";
import type { FooterState } from "../src/types.js";

export default function sidebarExtension(pi: ExtensionAPI): void {
	let runtime: SidebarRuntime | undefined;
	let currentContext: ExtensionContext | undefined;
	let currentSessionManager: ExtensionContext["sessionManager"] | undefined;
	let requestRender: () => void = () => undefined;
	let sidebar: SidebarController | undefined;
	let runActivity: RunActivityTracker | undefined;
	let server: ServerRunner | undefined;
	let extensionStatuses: readonly string[] = [];
	let enabled = true;
	let lifecycleGeneration = 0;

	const requestAllRenders = (): void => {
		requestRender();
		sidebar?.requestRender();
	};

	function updateExtensionStatuses(next: readonly string[]): void {
		if (
			next.length === extensionStatuses.length &&
			next.every((status, index) => status === extensionStatuses[index])
		) {
			return;
		}
		extensionStatuses = [...next];
		sidebar?.requestRender();
	}

	function getSidebarSnapshot(
		ctx: ExtensionContext,
		targetRuntime: SidebarRuntime,
		targetRunActivity: RunActivityTracker | undefined,
		targetServer: ServerRunner | undefined,
	): SidebarSnapshot {
		const sessionName = ctx.sessionManager.getSessionName();
		const sessionFile = ctx.sessionManager.getSessionFile();
		return buildSidebarSnapshot({
			state: targetRuntime.getState(),
			cwd: ctx.cwd,
			...(sessionName ? { sessionName } : {}),
			...(sessionFile ? { sessionFile } : {}),
			branchEntryCount: ctx.sessionManager.getBranch().length,
			extensionStatuses,
			...(targetServer ? { server: targetServer.getSnapshot() } : {}),
			...(targetRunActivity ? { runActivity: targetRunActivity.getSnapshot() } : {}),
		});
	}

	function getCurrentContextState(ctx: ExtensionContext | undefined):
		| {
				ctx: ExtensionContext;
				runtime: SidebarRuntime | undefined;
				sidebar: SidebarController | undefined;
				runActivity: RunActivityTracker | undefined;
				server: ServerRunner | undefined;
		  }
		| undefined {
		if (ctx === undefined || currentContext === undefined || currentSessionManager === undefined)
			return undefined;
		try {
			if (ctx.sessionManager !== currentSessionManager) return undefined;
		} catch {
			return undefined;
		}
		return { ctx: currentContext, runtime, sidebar, runActivity, server };
	}


	function describeServer(targetServer: ServerRunner): string {
		const snapshot = targetServer.getSnapshot();
		const command = snapshot.command ? ` (${snapshot.command})` : "";
		const detail = snapshot.detail ? `: ${snapshot.detail}` : "";
		return `Server ${snapshot.status}${command}${detail}`;
	}

	async function handleServerCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const [action] = parts;
		if (parts.length > 1 || ![undefined, "start", "stop", "restart", "status"].includes(action)) {
			ctx.ui.notify("Usage: /server [start|stop|restart|status]", "warning");
			return;
		}
		const current = getCurrentContextState(ctx);
		if (!current?.server) {
			ctx.ui.notify("Pi Mkaz Sidebar server control is not active in this session", "warning");
			return;
		}
		if (action === undefined || action === "status") {
			ctx.ui.notify(describeServer(current.server), "info");
			return;
		}
		const message =
			action === "start"
				? current.server.start()
				: action === "stop"
					? await current.server.stop()
					: await current.server.restart();
		ctx.ui.notify(message, current.server.getSnapshot().status === "error" ? "error" : "info");
	}

	function installFooter(
		ctx: ExtensionContext,
		targetRuntime: SidebarRuntime,
		targetRunActivity: RunActivityTracker | undefined,
		generation = lifecycleGeneration,
	): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			const isCurrentFooter = (): boolean => generation === lifecycleGeneration && runtime === targetRuntime;
			const footerRequestRender = (): void => {
				if (isCurrentFooter()) tui.requestRender();
			};
			if (isCurrentFooter()) requestRender = footerRequestRender;
			return createFooterComponent({
				getState: (): FooterState => {
					const state = targetRuntime.getState();
					const branch = footerData.getGitBranch();
					if (isCurrentFooter()) {
						updateExtensionStatuses(Array.from(footerData.getExtensionStatuses().values()));
					}
					const performance = targetRunActivity?.getSnapshot().performance;
					return {
						...state,
						...(branch ? { branch } : {}),
						...(performance ? { performance } : {}),
						extensionStatuses,
					};
				},
				colorEnabled: !("NO_COLOR" in process.env),
				requestRender: footerRequestRender,
				onBranchChange: (callback) =>
					footerData.onBranchChange(() => {
						void targetRuntime.refreshGitState();
						callback();
					}),
				theme: theme as unknown as ThemeLike,
			});
		});
	}

	pi.registerCommand("sidebar", {
		description: "Control the Pi Mkaz Sidebar",
		handler: async (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const [action, ...extra] = parts;
			if (action === "server") {
				await handleServerCommand(extra.join(" "), ctx);
				return;
			}
			if (action === "on" || action === "off") {
				if (ctx.mode !== "tui") {
					ctx.ui.notify("Pi Mkaz Sidebar requires TUI mode", "warning");
					return;
				}
				if (!runtime || !sidebar) {
					ctx.ui.notify("Pi Mkaz Sidebar is not active in this session", "warning");
					return;
				}
				if (extra.length > 0) {
					ctx.ui.notify("Usage: /sidebar [on|off]", "warning");
					return;
				}
				if (action === "on") sidebar.show();
				else sidebar.hide();
				return;
			}
			if (action === "disable") {
				enabled = false;
				sidebar?.hide();
				updateExtensionStatuses([]);
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Pi Mkaz Sidebar disabled", "info");
				return;
			}
			if (action === "enable") {
				enabled = true;
				if (runtime) installFooter(ctx, runtime, runActivity);
				ctx.ui.notify("Pi Mkaz Sidebar enabled", "info");
				return;
			}
			if (action === undefined) {
				if (ctx.mode !== "tui" || !sidebar) {
					ctx.ui.notify("Pi Mkaz Sidebar is not active in this session", "warning");
					return;
				}
				sidebar.toggle();
			} else ctx.ui.notify("Usage: /sidebar [on|off|disable|enable|server]", "warning");
		},
	});

	pi.registerCommand("server", {
		description: "Control the configured project server",
		handler: (args, ctx) => handleServerCommand(args, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		const initializationGeneration = ++lifecycleGeneration;
		const initializationContext = ctx;
		if (initializationContext.mode !== "tui") return;

		let localRuntime: SidebarRuntime | undefined;
		let localSidebar: SidebarController | undefined;
		let localServer: ServerRunner | undefined;
		const isFresh = (): boolean => initializationGeneration === lifecycleGeneration;
		const localRunActivity = createRunActivityTracker({
			cwd: initializationContext.cwd,
			onChange: () => {
				if (isFresh() && runActivity === localRunActivity) requestAllRenders();
			},
		});
		try {
			if (!isFresh()) return;
			let autoCompact: boolean | null = null;
			try {
				autoCompact = SettingsManager.create(
					initializationContext.isProjectTrusted() ? initializationContext.cwd : getAgentDir(),
				).getCompactionSettings().enabled;
			} catch {
				initializationContext.ui.notify(
					"Could not read Pi compaction settings; compaction mode is unavailable",
					"warning",
				);
			}
			const candidateRuntime = new SidebarRuntime({
				pi,
				ctx: initializationContext,
				autoCompact,
				requestRender: () => {
					if (isFresh() && runtime === localRuntime) requestAllRenders();
				},
			});
			localRuntime = candidateRuntime;
			localServer = new ServerRunner({
				cwd: initializationContext.cwd,
				trusted: initializationContext.isProjectTrusted(),
				onChange: () => {
					if (isFresh() && server === localServer) requestAllRenders();
				},
			});
			localSidebar = createSidebarController({
				ctx: initializationContext,
				getSnapshot: () => getSidebarSnapshot(initializationContext, candidateRuntime, localRunActivity, localServer),
				colorEnabled: !("NO_COLOR" in process.env),
				shouldAnimate: () => runActivity?.isRunning() ?? false,
				onError: (error) =>
					initializationContext.ui.notify(
						`Pi Mkaz Sidebar sidebar failed: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					),
			});
			await localServer.load();
			if (!isFresh()) {
				localSidebar.dispose();
				localRunActivity.reset();
				candidateRuntime.dispose();
				await localServer.dispose();
				return;
			}

			const previousSidebar = sidebar;
			const previousRuntime = runtime;
			const previousRunActivity = runActivity;
			const previousServer = server;
			runtime = candidateRuntime;
			sidebar = localSidebar;
			runActivity = localRunActivity;
			server = localServer;
			currentContext = initializationContext;
			currentSessionManager = initializationContext.sessionManager;
			extensionStatuses = [];
			previousSidebar?.dispose();
			previousRuntime?.dispose();
			previousRunActivity?.reset();
			void previousServer?.dispose();

			if (enabled && isFresh()) {
				installFooter(initializationContext, candidateRuntime, localRunActivity, initializationGeneration);
				localSidebar.show();
			}
			void candidateRuntime.refreshWorkspacePulse();
		} catch (error) {
			localSidebar?.dispose();
			localRunActivity.reset();
			localRuntime?.dispose();
			await localServer?.dispose();
			if (!isFresh()) return;
			sidebar?.dispose();
			sidebar = undefined;
			runtime?.dispose();
			runtime = undefined;
			const previousRunActivity = runActivity;
			runActivity = undefined;
			const previousServer = server;
			server = undefined;
			previousRunActivity?.reset();
			await previousServer?.dispose();
			currentContext = undefined;
			currentSessionManager = undefined;
			updateExtensionStatuses([]);
			initializationContext.ui.setFooter(undefined);
			initializationContext.ui.notify(
				`Pi Mkaz Sidebar could not start: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runActivity || !current.runtime) return;
		current.runActivity.startRun();
		current.runtime.setActivity("working");
	});
	pi.on("turn_start", (event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runActivity) return;
		current.runActivity.startTurn(event.turnIndex);
		void current.runtime?.refreshWorkspacePulse();
	});
	pi.on("before_provider_request", (_event, ctx) => {
		getCurrentContextState(ctx)?.runActivity?.startResponse();
	});
	pi.on("message_update", (event, ctx) => {
		const estimatedOutputTokens = estimateTokens(event.message);
		if (estimatedOutputTokens <= 0) return;
		getCurrentContextState(ctx)?.runActivity?.updateResponseEstimate(estimatedOutputTokens);
	});
	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		getCurrentContextState(ctx)?.runActivity?.finishResponse(event.message.usage.output);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runActivity) return;
		current.runActivity.startTool(event);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runActivity) return;
		current.runActivity.finishTool(event);
		current.runtime?.scheduleWorkspacePulseRefresh();
	});
	pi.on("agent_settled", (_event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runActivity || !current.runtime || !ctx.isIdle()) return;
		current.runActivity.settle();
		current.runtime.setActivity("ready");
		current.sidebar?.requestRender();
	});
	pi.on("turn_end", async (_event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current?.runtime) return;
		current.runtime.refreshUsage();
		await current.runtime.refreshGitState();
	});
	pi.on("model_select", (_event, ctx) => getCurrentContextState(ctx)?.runtime?.refreshUsage());
	pi.on("thinking_level_select", (_event, ctx) => getCurrentContextState(ctx)?.runtime?.refreshUsage());
	pi.on("session_compact", (_event, ctx) => getCurrentContextState(ctx)?.runtime?.refreshUsage());
	pi.on("session_info_changed", (_event, ctx) => getCurrentContextState(ctx)?.runtime?.refreshUsage());
	pi.on("session_shutdown", async (_event, ctx) => {
		const current = getCurrentContextState(ctx);
		if (!current && currentContext !== undefined) return;
		lifecycleGeneration += 1;
		(current?.sidebar ?? sidebar)?.dispose();
		sidebar = undefined;
		(current?.runtime ?? runtime)?.dispose();
		runtime = undefined;
		const previousRunActivity = current?.runActivity ?? runActivity;
		runActivity = undefined;
		const previousServer = current?.server ?? server;
		server = undefined;
		previousRunActivity?.reset();
		await previousServer?.dispose();
		current?.ctx.ui.setFooter(undefined);
		currentContext = undefined;
		currentSessionManager = undefined;
		requestRender = () => undefined;
		extensionStatuses = [];
	});
}
