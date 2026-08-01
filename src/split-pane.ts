import type { OverlayOptions, TUI } from "@earendil-works/pi-tui";

export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MIN_MAIN_WIDTH = 64;

type RenderFunction = TUI["render"];

export interface SplitPaneControllerOptions {
	sidebarWidth?: number;
	minMainWidth?: number;
	onError?(error: unknown): void;
}

export interface SplitPaneController {
	attach(tui: TUI): void;
	show(): void;
	hide(): void;
	isEnabled(): boolean;
	overlayOptions(): OverlayOptions;
	requestRender(): void;
	dispose(): void;
}

export function createSplitPaneController(options: SplitPaneControllerOptions = {}): SplitPaneController {
	const sidebarWidth = Math.max(1, Math.trunc(options.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH));
	const minMainWidth = Math.max(1, Math.trunc(options.minMainWidth ?? MIN_MAIN_WIDTH));
	let tui: TUI | undefined;
	let originalRender: RenderFunction | undefined;
	let wrappedRender: RenderFunction | undefined;
	let enabled = false;
	let disposed = false;

	const isVisibleAtWidth = (width: number): boolean => enabled && width >= minMainWidth + sidebarWidth;
	const overlayOptions: OverlayOptions = {
		anchor: "top-right",
		width: sidebarWidth,
		maxHeight: "100%",
		margin: 0,
		nonCapturing: true,
		visible: isVisibleAtWidth,
	};

	return {
		attach(nextTui) {
			if (disposed) throw new Error("Cannot attach a disposed split pane");
			if (tui === nextTui) return;
			if (tui) throw new Error("Split pane is already attached to another TUI");
			tui = nextTui;
			originalRender = nextTui.render;
			const previousRender = nextTui.render;
			wrappedRender = function (this: TUI, terminalWidth: number): string[] {
				if (!isVisibleAtWidth(terminalWidth)) return previousRender.call(nextTui, terminalWidth);
				try {
					return previousRender.call(nextTui, terminalWidth - sidebarWidth);
				} catch (error) {
					enabled = false;
					options.onError?.(error);
					return previousRender.call(nextTui, terminalWidth);
				}
			};
			nextTui.render = wrappedRender;
			nextTui.requestRender();
		},
		show() {
			if (disposed || enabled) return;
			enabled = true;
			tui?.requestRender();
		},
		hide() {
			if (!enabled) return;
			enabled = false;
			tui?.requestRender();
		},
		isEnabled: () => enabled,
		overlayOptions: () => overlayOptions,
		requestRender: () => tui?.requestRender(),
		dispose() {
			if (disposed) return;
			disposed = true;
			enabled = false;
			if (tui && originalRender && tui.render === wrappedRender) tui.render = originalRender;
			tui?.requestRender();
			tui = undefined;
			originalRender = undefined;
			wrappedRender = undefined;
		},
	};
}
