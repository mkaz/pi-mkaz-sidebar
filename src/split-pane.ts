import { HStack, isViewportTUI, type Component, type OverlayOptions, type TUI } from "@earendil-works/pi-tui";

export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MIN_MAIN_WIDTH = 64;

const REGULAR_RENDER_ADAPTER = Symbol("pi-mkaz-sidebar.regular-render-adapter");
const FULLSCREEN_LAYOUT_ADAPTER = Symbol("pi-mkaz-sidebar.fullscreen-layout-adapter");

type RenderFunction = TUI["render"];

interface RegularRenderAdapterState {
	owner: object;
	baseRender: RenderFunction;
}

interface FullscreenLayoutAdapterState {
	owner: object;
	originalRoot: Component;
	splitRoot: Component;
}

type AdaptedTui = TUI & {
	[REGULAR_RENDER_ADAPTER]?: RegularRenderAdapterState;
	[FULLSCREEN_LAYOUT_ADAPTER]?: FullscreenLayoutAdapterState;
	layoutRoot?: Component;
};

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
	const adapterOwner = {};
	let tui: TUI | undefined;
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

	const findRegularRender = (nextTui: TUI): RenderFunction | undefined => {
		let prototype = Object.getPrototypeOf(nextTui) as object | null;
		if ((prototype as { constructor?: { name?: string } } | null)?.constructor?.name !== "TuiMainScreen") {
			return undefined;
		}
		while (prototype) {
			const render = Object.getOwnPropertyDescriptor(prototype, "render")?.value;
			if (typeof render === "function") return render as RenderFunction;
			prototype = Object.getPrototypeOf(prototype) as object | null;
		}
		return undefined;
	};

	const syncRegularRenderAdapter = () => {
		if (!tui || tui.mode !== "regular") return;
		const adaptedTui = tui as AdaptedTui;
		const current = adaptedTui[REGULAR_RENDER_ADAPTER];
		if (current?.owner === adapterOwner || current) return;
		const baseRender = findRegularRender(tui);
		if (!baseRender) return;
		adaptedTui[REGULAR_RENDER_ADAPTER] = { owner: adapterOwner, baseRender };
		adaptedTui.render = (width: number) =>
			Reflect.apply(baseRender, tui, [isVisibleAtWidth(width) ? width - sidebarWidth : width]);
	};

	const restoreRegularRenderAdapter = () => {
		if (!tui) return;
		const adaptedTui = tui as AdaptedTui;
		const current = adaptedTui[REGULAR_RENDER_ADAPTER];
		if (current?.owner !== adapterOwner) return;
		adaptedTui.render = current.baseRender;
		adaptedTui[REGULAR_RENDER_ADAPTER] = undefined;
	};

	const createFullscreenSplitRoot = (originalRoot: Component): Component =>
		new HStack([
			{ component: originalRoot, basis: 0, grow: 1, shrink: 1, minSize: minMainWidth },
			{
				component: { render: () => [], invalidate() {} },
				basis: sidebarWidth,
				grow: 0,
				shrink: 1,
				visible: ({ width }) => isVisibleAtWidth(width),
			},
		]);

	const syncFullscreenLayoutAdapter = () => {
		if (!tui || tui.mode !== "fullscreen" || !isViewportTUI(tui)) return;
		const adaptedTui = tui as AdaptedTui;
		const current = adaptedTui[FULLSCREEN_LAYOUT_ADAPTER];
		if (current && current.owner !== adapterOwner) return;
		const root = adaptedTui.layoutRoot;
		if (current?.owner === adapterOwner && root === current.splitRoot) return;
		if (!root) return;
		const splitRoot = createFullscreenSplitRoot(root);
		tui.setLayoutRoot(splitRoot);
		adaptedTui[FULLSCREEN_LAYOUT_ADAPTER] = { owner: adapterOwner, originalRoot: root, splitRoot };
	};

	const restoreFullscreenLayoutAdapter = () => {
		if (!tui || !isViewportTUI(tui)) return;
		const adaptedTui = tui as AdaptedTui;
		const current = adaptedTui[FULLSCREEN_LAYOUT_ADAPTER];
		if (current?.owner !== adapterOwner) return;
		if (adaptedTui.layoutRoot === current.splitRoot) tui.setLayoutRoot(current.originalRoot);
		adaptedTui[FULLSCREEN_LAYOUT_ADAPTER] = undefined;
	};

	return {
		attach(nextTui) {
			if (disposed) throw new Error("Cannot attach a disposed split pane");
			if (tui === nextTui) return;
			if (tui) throw new Error("Split pane is already attached to another TUI");
			tui = nextTui;
			syncRegularRenderAdapter();
			syncFullscreenLayoutAdapter();
			nextTui.requestRender();
		},
		show() {
			if (disposed || enabled) return;
			enabled = true;
			syncRegularRenderAdapter();
			syncFullscreenLayoutAdapter();
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
			restoreRegularRenderAdapter();
			restoreFullscreenLayoutAdapter();
			tui?.requestRender();
			tui = undefined;
		},
	};
}
