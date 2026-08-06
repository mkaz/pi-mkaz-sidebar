import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const JUSTFILE_NAMES = ["justfile", ".justfile", "Justfile", ".Justfile"];
const STOP_GRACE_MS = 3_000;
const MAX_OUTPUT_LINES = 3;
const MAX_OUTPUT_LINE_LENGTH = 2_000;

export type JustfileStatus =
	| "loading"
	| "missing"
	| "untrusted"
	| "stopped"
	| "running"
	| "stopping"
	| "exited"
	| "error";

export interface JustfileSnapshot {
	status: JustfileStatus;
	command?: string;
	detail?: string;
	output?: readonly string[];
}

export interface JustfileRunnerOptions {
	cwd: string;
	trusted: boolean;
	onChange(): void;
}

export class JustfileRunner {
	readonly #cwd: string;
	readonly #trusted: boolean;
	readonly #onChange: () => void;
	#child: ChildProcess | undefined;
	#stopping: ChildProcess | undefined;
	#stopTimer: ReturnType<typeof setTimeout> | undefined;
	#stopPromise: Promise<void> | undefined;
	#finishStop: (() => void) | undefined;
	#justfile: string | undefined;
	#args: string[] | undefined;
	#output: string[] = [];
	#outputPartial = "";
	#disposed = false;
	#snapshot: JustfileSnapshot = { status: "loading" };

	constructor(options: JustfileRunnerOptions) {
		this.#cwd = options.cwd;
		this.#trusted = options.trusted;
		this.#onChange = options.onChange;
	}

	getSnapshot(): JustfileSnapshot {
		return this.#snapshot;
	}

	async load(): Promise<void> {
		if (this.#disposed) return;
		if (!this.#trusted) {
			this.#setSnapshot({ status: "untrusted" });
			return;
		}

		this.#justfile = undefined;
		this.#args = undefined;
		this.#output = [];
		this.#outputPartial = "";
		for (const name of JUSTFILE_NAMES) {
			try {
				await readFile(join(this.#cwd, name), "utf8");
				this.#justfile = name;
				this.#setState("stopped");
				return;
			} catch (error) {
				if (isMissingFile(error)) continue;
				this.#setState("error", errorMessage(error));
				return;
			}
		}
		this.#setState("missing");
	}

	start(args: readonly string[]): string {
		if (this.#disposed) return "Justfile runner is unavailable";
		if (this.#child) return "A just recipe is already running";
		if (this.#stopping) return "A just recipe is still stopping";
		if (!this.#justfile) return this.#snapshot.detail ?? "No justfile was found";
		if (args.length === 0) return "Specify a just recipe";

		this.#args = [...args];
		this.#output = [];
		this.#outputPartial = "";
		try {
			const child = spawn("just", ["--justfile", this.#justfile, ...args], {
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
			return `Started just ${args.join(" ")}`;
		} catch (error) {
			this.#setState("error", errorMessage(error));
			return `Could not start just: ${errorMessage(error)}`;
		}
	}

	async stop(): Promise<string> {
		if (this.#stopping && this.#stopPromise) {
			await this.#stopPromise;
			return "Just recipe stopped";
		}
		const child = this.#child;
		if (!child) return "No just recipe is running";
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
		return "Just recipe stopped";
	}

	async restart(): Promise<string> {
		if (!this.#args) return "No just recipe has been run";
		if (this.#child || this.#stopping) await this.stop();
		return this.start(this.#args);
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
		if (!child.pid) throw new Error("Just process has no PID");
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

	#setState(status: JustfileStatus, detail?: string): void {
		this.#setSnapshot({
			status,
			...(this.#args ? { command: `just ${this.#args.join(" ")}` } : {}),
			...(detail ? { detail } : {}),
			...(this.#output.length > 0 ? { output: [...this.#output] } : {}),
		});
	}

	#setSnapshot(snapshot: JustfileSnapshot): void {
		if (this.#disposed && snapshot.status !== "stopped") return;
		this.#snapshot = snapshot;
		this.#onChange();
	}
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
