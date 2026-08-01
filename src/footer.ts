import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createPalette, effortRole, type PaletteRole } from "./palette.js";
import type { SidebarConfig, SidebarState, FooterState } from "./types.js";

export interface ThemeLike {
	readonly name?: string;
	fg(color: string, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
}

const sanitize = (text: string): string =>
	text
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

function activityText(state: SidebarState, theme: ThemeLike, colorEnabled: boolean): string {
	const palette = createPalette(theme, colorEnabled);
	const label = state.activity.toUpperCase();
	const role: PaletteRole =
		state.activity === "ready"
			? "ready"
			: state.activity === "working"
				? "working"
				: state.activity === "warning"
					? "warning"
					: "error";
	return palette.paint(role, theme.bold(`● ${sanitize(label)}`));
}

function modelText(state: FooterState, theme: ThemeLike, colorEnabled: boolean): string {
	const palette = createPalette(theme, colorEnabled);
	const model = state.modelId ? sanitize(state.modelId) : "";
	const effort = state.thinkingLevel ? sanitize(state.thinkingLevel) : "";
	if (!model) return "";
	return [palette.paint("primary", model), effort ? palette.paint(effortRole(effort), effort) : ""]
		.filter(Boolean)
		.join(" · ");
}

export function renderFooterLine(
	state: FooterState,
	_config: SidebarConfig,
	theme: ThemeLike,
	width: number,
	colorEnabled = true,
): string {
	if (width <= 0) return "";
	const status = activityText(state, theme, colorEnabled);
	const model = modelText(state, theme, colorEnabled);
	const statusWidth = visibleWidth(status);
	const modelWidth = visibleWidth(model);
	if (model && statusWidth + modelWidth + 2 <= width) {
		return `${status}${" ".repeat(width - statusWidth - modelWidth)}${model}`;
	}
	return truncateToWidth(status, width, "");
}

export interface FooterComponentOptions {
	getState(): FooterState;
	getConfig(): SidebarConfig;
	colorEnabled?: boolean;
	requestRender(): void;
	onBranchChange(callback: () => void): () => void;
	theme: ThemeLike;
}

export function createFooterComponent(options: FooterComponentOptions): Component & { dispose(): void } {
	const unsubscribe = options.onBranchChange(options.requestRender);
	return {
		render(width) {
			return [
				renderFooterLine(
					options.getState(),
					options.getConfig(),
					options.theme,
					width,
					options.colorEnabled ?? true,
				),
			];
		},
		invalidate() {},
		dispose: unsubscribe,
	};
}
