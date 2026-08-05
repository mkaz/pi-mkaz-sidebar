import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE_NAME = "mkaz-sidebar.json";
const STOP_GRACE_MS = 3_000;
const MAX_OUTPUT_LINES = 3;
const MAX_OUTPUT_LINE_LENGTH = 2_000;

export type ServerStatus =
	| "loading"
	| "unconfigured"
	| "untrusted"
	| "stopped"
	| "starting"
	| "running"
	| "stopping"
	| "exited"
	| "error";

export interface ServerSnapshot {
	status: ServerStatus;
	command?: string;
	url?: string;
	detail?: string;
	output?: readonly string[];
}

export interface ServerRunnerOptions {
	cwd: string;
	trusted: boolean;
	onChange(): void;
}

interface ServerConfig {
	serverCommand?: unknown;
	serverUrl?: unknown;
}

export class ServerRunner {
	readonly #cwd: string;
	readonly #trusted: boolean;
	readonly #onChange: () => void;
	#child: ChildProcess | undefined;
	#stopping: ChildProcess | undefined;
	#stopTimer: ReturnType<typeof setTimeout> | undefined;
	#stopPromise: Promise<void> | undefined;
	#finishStop: (() => void) | undefined;
	#command: string | undefined;
	#url: string | undefined;
	#output: string[] = [];
	#outputPartial = "";
	#disposed = false;
	#snapshot: ServerSnapshot = { status: "loading" };

	constructor(options: ServerRunnerOptions) {
		this.#cwd = options.cwd;
		this.#trusted = options.trusted;
		this.#onChange = options.onChange;
	}

	getSnapshot(): ServerSnapshot {
		return this.#snapshot;
	}


	async load(): Promise<void> {
		if (this.#disposed) return;
		if (!this.#trusted) {
			this.#setSnapshot({ status: "untrusted" });
			return;
		}

		try {
			const config = JSON.parse(
				await readFile(join(this.#cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME), "utf8"),
			) as ServerConfig;
			const command = typeof config.serverCommand === "string" ? config.serverCommand.trim() : "";
			this.#command = command || undefined;
			this.#url = typeof config.serverUrl === "string" ? config.serverUrl.trim() || undefined : undefined;
			this.#output = [];
			this.#outputPartial = "";
			this.#setState(command ? "stopped" : "unconfigured");
		} catch (error) {
			this.#command = undefined;
			this.#url = undefined;
			this.#output = [];
			this.#outputPartial = "";
			if (isMissingFile(error)) {
				this.#setState("unconfigured");
				return;
			}
			this.#setState("error", errorMessage(error));
		}
	}

	start(): string {
		if (this.#disposed) return "Server runner is unavailable";
		if (this.#child) return "Server is already running";
		if (this.#stopping) return "Server is still stopping";
		const command = this.#command;
		if (!command) return this.#snapshot.detail ?? "No serverCommand is configured";

		this.#output = [];
		this.#outputPartial = "";
		this.#setState("starting");
		try {
			const child = spawn(shell(), shellArgs(command), {
				cwd: this.#cwd,
				env: process.env,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			this.#child = child;
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string | Buffer) => this.#appendOutput(chunk));
			child.stderr?.on("data", (chunk: string | Buffer) => this.#appendOutput(chunk));
			child.once("error", (error) => {
				if (this.#child !== child) return;
				this.#child = undefined;
				this.#setState("error", errorMessage(error));
			});
			child.once("exit", (code, signal) => {
				if (this.#stopping === child) {
					this.#completeStop(child);
					return;
				}
				if (this.#child !== child) return;
				this.#child = undefined;
				this.#flushOutput();
				const detail = signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
				this.#setState("exited", detail);
			});
			this.#setState("running");
			return "Server started";
		} catch (error) {
			this.#setState("error", errorMessage(error));
			return `Could not start server: ${errorMessage(error)}`;
		}
	}

	async stop(): Promise<string> {
		if (this.#stopping && this.#stopPromise) {
			await this.#stopPromise;
			return "Server stopped";
		}
		const child = this.#child;
		if (!child) return "Server is not running";
		this.#stopping = child;
		this.#setState("stopping");
		this.#stopPromise = new Promise((resolve) => {
			this.#finishStop = resolve;
		});
		try {
			this.#signal(child, "SIGTERM");
			this.#stopTimer = setTimeout(() => {
				if (this.#stopping !== child) return;
				try {
					this.#signal(child, "SIGKILL");
				} catch (error) {
					this.#setState("error", errorMessage(error));
				}
				this.#completeStop(child);
			}, STOP_GRACE_MS);
			this.#stopTimer.unref?.();
		} catch (error) {
			this.#setState("error", errorMessage(error));
			this.#completeStop(child);
		}
		await this.#stopPromise;
		return "Server stopped";
	}

	async restart(): Promise<string> {
		if (this.#child || this.#stopping) await this.stop();
		return this.start();
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		await this.stop();
		this.#disposed = true;
	}

	#completeStop(child: ChildProcess): void {
		if (this.#stopping !== child) return;
		if (this.#stopTimer) clearTimeout(this.#stopTimer);
		this.#stopTimer = undefined;
		this.#stopping = undefined;
		if (this.#child === child) this.#child = undefined;
		const finish = this.#finishStop;
		this.#finishStop = undefined;
		this.#stopPromise = undefined;
		this.#flushOutput();
		this.#setState("stopped");
		finish?.();
	}

	#signal(child: ChildProcess, signal: NodeJS.Signals): void {
		if (!child.pid) throw new Error("Server process has no PID");
		if (process.platform === "win32") {
			child.kill(signal);
			return;
		}
		process.kill(-child.pid, signal);
	}

	#appendOutput(chunk: string | Buffer): void {
		const lines = `${this.#outputPartial}${chunk.toString()}`.split(/\r\n|[\r\n]/);
		this.#outputPartial = (lines.pop() ?? "").slice(-MAX_OUTPUT_LINE_LENGTH);
		for (const line of lines) this.#recordOutput(line);
		if (this.#output.length > 0) this.#setState(this.#snapshot.status, this.#snapshot.detail);
	}

	#flushOutput(): void {
		if (!this.#outputPartial) return;
		this.#recordOutput(this.#outputPartial);
		this.#outputPartial = "";
	}

	#recordOutput(line: string): void {
		if (!line.trim()) return;
		this.#output.push(line.slice(-MAX_OUTPUT_LINE_LENGTH));
		this.#output = this.#output.slice(-MAX_OUTPUT_LINES);
	}

	#setState(status: ServerStatus, detail?: string): void {
		this.#setSnapshot({
			status,
			...(this.#command ? { command: this.#command } : {}),
			...(this.#url ? { url: this.#url } : {}),
			...(detail ? { detail } : {}),
			...(this.#output.length > 0 ? { output: [...this.#output] } : {}),
		});
	}

	#setSnapshot(snapshot: ServerSnapshot): void {
		if (this.#disposed && snapshot.status !== "stopped") return;
		this.#snapshot = snapshot;
		this.#onChange();
	}
}

function shell(): string {
	return process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh");
}

function shellArgs(command: string): string[] {
	return process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
