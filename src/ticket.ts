import type { ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";

export interface Ticket {
	id: string;
	url?: string;
}

export const TICKET_ENTRY = "mkaz-sidebar-ticket";
const idPattern = /\b[A-Z][A-Z0-9]*-\d+\b/gi;

function githubReference(text: string): Ticket | undefined {
	const match = text.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
	if (!match) return undefined;
	const [, owner, repo, number] = match;
	const repository = `${owner}/${repo}`.toLowerCase();
	return { id: `${repository}#${number}`, url: `https://github.com/${repository}/issues/${number}` };
}

function ticketLinks(text: string): Ticket[] {
	return (text.match(/https?:\/\/[^\s<>"'`\\]+/g) ?? [])
		.map((url) => ticketFromUrl(url.replace(/[).,;\]}]+$/, "")))
		.filter((ticket): ticket is Ticket => ticket !== undefined);
}

/** Read-only Git metadata may use HTTPS, SSH URLs, or scp-style SSH syntax. */
export function githubRepositoryFromRemote(remote: string): string | undefined {
	const match = remote.trim().match(/^(?:git@github\.com:|(?:https?|ssh|git):\/\/(?:git@)?github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)\/?$/i);
	if (!match) return undefined;
	const repo = match[2]!.replace(/\.git$/i, "");
	return repo ? `${match[1]}/${repo}`.toLowerCase() : undefined;
}

function singleId(text: string, repository?: string): string | undefined {
	const withoutUrls = text.replace(/https?:\/\/[^\s<>"'`\\]+/g, " ");
	const references = withoutUrls.match(/[\w.-]+\/[\w.-]+#\d+\b/g) ?? [];
	const withoutReferences = withoutUrls.replace(/[\w.-]+\/[\w.-]+#\d+\b/g, " ");
	const ids = new Set([
		...(withoutReferences.match(idPattern) ?? []).map((id) => id.toUpperCase()),
		...references.map((reference) => githubReference(reference)!.id),
		...ticketLinks(text).map((ticket) => ticket.id),
	]);
	// Resolve issue shorthand only against a known GitHub repository. Explicit
	// GitHub wording can still display an unresolved ticket without inventing a URL.
	const shorthand = repository
		? /(?:\b(?:github\s+)?(?:issue|ticket)\s*#?\s*|(?:^|\s|\()#)(\d+)\b/gi
		: /\bgithub\s+(?:issue|ticket)\s*#?\s*(\d+)\b/gi;
	for (const match of withoutReferences.matchAll(shorthand)) {
		ids.add(repository ? `${repository}#${match[1]}` : `GitHub #${match[1]}`);
	}
	return ids.size === 1 ? [...ids][0] : undefined;
}

/** Only accept web links with a Linear issue, Jira browse, or GitHub issue path. */
export function ticketFromUrl(text: string): Ticket | undefined {
	try {
		const url = new URL(text);
		if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
		if (url.hostname === "github.com") {
			const github = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/);
			return github ? githubReference(`${github[1]}/${github[2]}#${github[3]}`) : undefined;
		}
		const match = url.hostname === "linear.app"
			? url.pathname.match(/^\/(?:[^/]+\/)?issue\/([A-Z][A-Z0-9]*-\d+)(?:\/|$)/i)
			: url.pathname.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)\/?$/i);
		if (!match) return undefined;
		url.search = "";
		url.hash = "";
		return { id: match[1]!.toUpperCase(), url: url.href };
	} catch {
		return undefined;
	}
}

export function parseTicket(text: string): Ticket | undefined {
	return ticketFromUrl(text) ?? githubReference(text)
		?? (/^[A-Z][A-Z0-9]*-\d+$/i.test(text) ? { id: text.toUpperCase() } : undefined);
}

/** Rebuild from the active session branch, never from abandoned session history. */
export function detectTicket(
	ctx: ExtensionContext,
	branch?: string,
	pending?: MessageEndEvent["message"],
	githubRepository?: string,
): Ticket | undefined {
	const texts: { text: string; user: boolean }[] = [];
	let pinned: Ticket | undefined;
	const entries = ctx.sessionManager.getBranch();
	const messages: MessageEndEvent["message"][] = [];
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === TICKET_ENTRY) {
			const data = entry.data as { ticket?: unknown } | undefined;
			const value = data?.ticket;
			pinned = typeof value === "string" ? parseTicket(value) : undefined;
		}
		if (entry.type === "message") messages.push(entry.message);
	}
	// message_end runs before Pi appends this message to session history.
	if (pending) messages.push(pending);
	for (const message of messages) {
		if (!("content" in message)) continue;
		const text = typeof message.content === "string"
			? message.content
			: message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		texts.push({ text, user: message.role === "user" });
	}
	const links = texts.flatMap(({ text }) => ticketLinks(text));
	const latest = [...texts].reverse();
	// Without a remote, a unique GitHub repository explicitly named in the
	// conversation can provide context. Never choose among multiple repositories.
	const repositories = new Set(texts.flatMap(({ text }) => [
		...(text.match(/[\w.-]+\/[\w.-]+#\d+\b/g) ?? []).map((reference) => githubReference(reference)!.id.split("#")[0]!),
		...ticketLinks(text).filter((ticket) => ticket.id.includes("#")).map((ticket) => ticket.id.split("#")[0]!),
	]));
	const repository = githubRepository ?? (repositories.size === 1 ? [...repositories][0] : undefined);
	const id = pinned?.id
		?? latest.filter(({ user }) => user).map(({ text }) => singleId(text, repository)).find(Boolean)
		?? singleId(ctx.sessionManager.getSessionName() ?? "", repository)
		?? singleId(branch ?? "", repository)
		?? (new Set(links.map((ticket) => ticket.id)).size === 1 ? links[0]?.id : undefined);
	if (!id) return undefined;
	const url = pinned?.url ?? [...links].reverse().find((ticket) => ticket.id === id)?.url
		?? githubReference(id)?.url;
	return { id, ...(url ? { url } : {}) };
}
