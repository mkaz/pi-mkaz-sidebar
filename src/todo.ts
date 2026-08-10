import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const TODO_TOOL_NAME = "todo";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface TodoTask {
	id: number;
	subject: string;
	status: TodoStatus;
	description?: string;
	activeForm?: string;
}

export interface TodoSnapshot {
	tasks: TodoTask[];
	nextId: number;
}

interface TodoDetails extends TodoSnapshot {
	action: TodoAction;
	params: Record<string, unknown>;
	error?: string;
}

const TodoParameters = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	id: Type.Optional(Type.Integer({ minimum: 1, description: "Task id for update, get, or delete" })),
	subject: Type.Optional(
		Type.String({ maxLength: 240, description: "Short task subject; required for create" }),
	),
	description: Type.Optional(
		Type.String({ maxLength: 4_000, description: "Optional task detail for create or update" }),
	),
	activeForm: Type.Optional(
		Type.String({
			maxLength: 240,
			description: "Present-continuous label shown while the task is in progress",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed"] as const, {
			description: "New status for update, or a status filter for list",
		}),
	),
});

type TodoParameters = {
	action: TodoAction;
	id?: number;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TodoStatus;
};

const cloneTask = (task: TodoTask): TodoTask => ({ ...task });
const cloneSnapshot = (tasks: readonly TodoTask[], nextId: number): TodoSnapshot => ({
	tasks: tasks.map(cloneTask),
	nextId,
});

function cleanOptional(value: string | undefined): string | undefined {
	const clean = value?.trim().replace(/\s+/g, " ");
	return clean || undefined;
}

function isTodoStatus(value: unknown): value is TodoStatus {
	return value === "pending" || value === "in_progress" || value === "completed";
}

function snapshotFromDetails(value: unknown): TodoSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const details = value as Record<string, unknown>;
	if (
		!Array.isArray(details.tasks) ||
		typeof details.nextId !== "number" ||
		!Number.isFinite(details.nextId)
	) {
		return undefined;
	}

	const tasks: TodoTask[] = [];
	const ids = new Set<number>();
	for (const candidate of details.tasks) {
		if (!candidate || typeof candidate !== "object") return undefined;
		const task = candidate as Record<string, unknown>;
		if (typeof task.id !== "number" || !Number.isInteger(task.id) || task.id < 1) return undefined;
		if (ids.has(task.id)) return undefined;
		ids.add(task.id);
		if (typeof task.subject !== "string" || !task.subject.trim()) return undefined;
		if (task.status === "deleted") continue;
		if (!isTodoStatus(task.status)) return undefined;
		tasks.push({
			id: task.id,
			subject: task.subject,
			status: task.status,
			...(typeof task.description === "string" && task.description ? { description: task.description } : {}),
			...(typeof task.activeForm === "string" && task.activeForm ? { activeForm: task.activeForm } : {}),
		});
	}
	const highestId = tasks.reduce((highest, task) => Math.max(highest, task.id), 0);
	return cloneSnapshot(tasks, Math.max(highestId + 1, Math.trunc(details.nextId), 1));
}

function formatTask(task: TodoTask): string {
	const active = task.status === "in_progress" && task.activeForm ? ` (${task.activeForm})` : "";
	return `[${task.status}] #${task.id} ${task.subject}${active}`;
}

function truncateTodoOutput(text: string): string {
	const result = truncateHead(text, {
		maxBytes: DEFAULT_MAX_BYTES - 300,
		maxLines: DEFAULT_MAX_LINES - 2,
	});
	if (!result.truncated) return text;
	const notice = `[Output truncated: ${result.outputLines} of ${result.totalLines} lines. Use todo get with a task id or a status-filtered list for the remaining tasks.]`;
	return result.content ? `${result.content}\n\n${notice}` : notice;
}

export interface TodoRuntimeOptions {
	onChange(): void;
}

export class TodoRuntime {
	readonly #onChange: () => void;
	#tasks: TodoTask[] = [];
	#nextId = 1;

	constructor(options: TodoRuntimeOptions) {
		this.#onChange = options.onChange;
	}

	getSnapshot(): TodoSnapshot {
		return cloneSnapshot(this.#tasks, this.#nextId);
	}

	restoreFromBranch(ctx: ExtensionContext): void {
		let snapshot: TodoSnapshot = { tasks: [], nextId: 1 };
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "toolResult" || message.toolName !== TODO_TOOL_NAME) continue;
			const restored = snapshotFromDetails(message.details);
			if (restored) snapshot = restored;
		}
		this.#tasks = snapshot.tasks;
		this.#nextId = snapshot.nextId;
		this.#onChange();
	}

	execute(params: TodoParameters): { content: Array<{ type: "text"; text: string }>; details: TodoDetails } {
		let text: string;
		let error: string | undefined;

		switch (params.action) {
			case "create": {
				const subject = cleanOptional(params.subject);
				if (!subject) {
					error = "subject required for create";
					text = `Error: ${error}`;
					break;
				}
				const description = cleanOptional(params.description);
				const activeForm = cleanOptional(params.activeForm);
				const task: TodoTask = {
					id: this.#nextId,
					subject,
					status: "pending",
					...(description ? { description } : {}),
					...(activeForm ? { activeForm } : {}),
				};
				this.#tasks = [...this.#tasks, task];
				this.#nextId += 1;
				text = `Created #${task.id}: ${task.subject} (pending)`;
				this.#onChange();
				break;
			}
			case "update": {
				if (params.id === undefined) {
					error = "id required for update";
					text = `Error: ${error}`;
					break;
				}
				const index = this.#tasks.findIndex((task) => task.id === params.id);
				const current = this.#tasks[index];
				if (!current) {
					error = `#${params.id} not found`;
					text = `Error: ${error}`;
					break;
				}
				if (
					params.subject === undefined &&
					params.description === undefined &&
					params.activeForm === undefined &&
					params.status === undefined
				) {
					error = "update requires subject, description, activeForm, or status";
					text = `Error: ${error}`;
					break;
				}
				const subject = params.subject === undefined ? current.subject : cleanOptional(params.subject);
				if (!subject) {
					error = "subject cannot be blank";
					text = `Error: ${error}`;
					break;
				}
				const updated: TodoTask = {
					...current,
					subject,
					status: params.status ?? current.status,
				};
				if (params.description !== undefined) {
					const description = cleanOptional(params.description);
					if (description) updated.description = description;
					else delete updated.description;
				}
				if (params.activeForm !== undefined) {
					const activeForm = cleanOptional(params.activeForm);
					if (activeForm) updated.activeForm = activeForm;
					else delete updated.activeForm;
				}
				this.#tasks = this.#tasks.map((task, taskIndex) => (taskIndex === index ? updated : task));
				const transition = current.status === updated.status ? "" : ` (${current.status} → ${updated.status})`;
				text = `Updated #${updated.id}${transition}`;
				this.#onChange();
				break;
			}
			case "list": {
				const tasks = params.status
					? this.#tasks.filter((task) => task.status === params.status)
					: this.#tasks;
				text = tasks.length > 0 ? tasks.map(formatTask).join("\n") : "No tasks";
				break;
			}
			case "get": {
				if (params.id === undefined) {
					error = "id required for get";
					text = `Error: ${error}`;
					break;
				}
				const task = this.#tasks.find((candidate) => candidate.id === params.id);
				if (!task) {
					error = `#${params.id} not found`;
					text = `Error: ${error}`;
					break;
				}
				text = formatTask(task);
				if (task.description) text += `\n  ${task.description}`;
				break;
			}
			case "delete": {
				if (params.id === undefined) {
					error = "id required for delete";
					text = `Error: ${error}`;
					break;
				}
				const task = this.#tasks.find((candidate) => candidate.id === params.id);
				if (!task) {
					error = `#${params.id} not found`;
					text = `Error: ${error}`;
					break;
				}
				this.#tasks = this.#tasks.filter((candidate) => candidate.id !== params.id);
				text = `Deleted #${task.id}: ${task.subject}`;
				this.#onChange();
				break;
			}
			case "clear": {
				const count = this.#tasks.length;
				this.#tasks = [];
				this.#nextId = 1;
				text = `Cleared ${count} tasks`;
				this.#onChange();
				break;
			}
		}

		const snapshot = this.getSnapshot();
		return {
			content: [{ type: "text", text: truncateTodoOutput(text) }],
			details: {
				action: params.action,
				params: { ...params },
				...snapshot,
				...(error ? { error } : {}),
			},
		};
	}
}

export function registerTodoTool(pi: ExtensionAPI, runtime: TodoRuntime): void {
	pi.registerTool({
		name: TODO_TOOL_NAME,
		label: "Todo",
		description:
			"Manage a session task list. Actions: create, update, list, get, delete, and clear. Tasks have pending, in_progress, or completed status. Output is limited to 50 KB or 2,000 lines.",
		promptSnippet: "Manage a task list to track multi-step progress",
		promptGuidelines: [
			"Use todo for complex work with 3 or more steps, or when the user asks for a tracked task list; skip it for trivial work.",
			"When using todo, mark one task in_progress before working on it and mark it completed immediately after it is done.",
			"Never mark a todo task completed while its work is partial, failing, or blocked.",
			"Keep todo subjects short and imperative; use activeForm for the present-continuous label of in-progress work.",
		],
		parameters: TodoParameters,
		async execute(_toolCallId, params) {
			return runtime.execute(params as TodoParameters);
		},
	});
}
