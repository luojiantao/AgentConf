/**
 * Session consensus — named, session-local context injected on @alias.
 *
 * Storage lives in the current session jsonl (CustomEntry). Enable/disable is
 * a process+disk kill switch for injection, not the consensus table itself.
 *
 * Commands:
 *   /consensus set <alias> <content>
 *   /consensus get <alias>
 *   /consensus list
 *   /consensus rm <alias>
 *   /consensus clear
 *   /consensus enable | disable | toggle | status
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CUSTOM_TYPE = "session-consensus";
const STATUS_KEY = "consensus";
const MAX_ITEMS = 50;
const MAX_CONTENT_BYTES = 32 * 1024;
const ALIAS_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ALIAS_REF = /(?<![A-Za-z0-9._])@([A-Za-z][A-Za-z0-9_-]{0,63})\b/g;
const ENABLED_FILE = join(dirname(fileURLToPath(import.meta.url)), "enabled.json");

const USAGE = `Usage:
  /consensus set <alias> <content>
  /consensus get <alias>
  /consensus list
  /consensus rm <alias>
  /consensus clear
  /consensus enable | disable | toggle | status`;

interface ConsensusItem {
	content: string;
	updatedAt: number;
}

interface ConsensusState {
	items: Record<string, ConsensusItem>;
	enabled?: boolean;
}

interface EnabledFile {
	enabled: boolean;
}

const ConsensusParams = Type.Object({
	action: StringEnum(["set", "get", "list", "rm", "clear", "enable", "disable", "status"] as const),
	alias: Type.Optional(Type.String({ description: "Alias without @, e.g. auth-flow" })),
	content: Type.Optional(Type.String({ description: "Consensus body (required for set)" })),
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConsensusItem(value: unknown): value is ConsensusItem {
	if (!isRecord(value)) return false;
	return typeof value.content === "string" && typeof value.updatedAt === "number";
}

function parseState(value: unknown): ConsensusState | undefined {
	if (!isRecord(value) || !isRecord(value.items)) return undefined;
	const items: Record<string, ConsensusItem> = {};
	for (const [key, item] of Object.entries(value.items)) {
		if (isConsensusItem(item)) items[key] = item;
	}
	return {
		items,
		enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
	};
}

function readEnabledFile(): boolean {
	try {
		const raw = JSON.parse(readFileSync(ENABLED_FILE, "utf-8")) as unknown;
		if (isRecord(raw) && typeof raw.enabled === "boolean") return raw.enabled;
	} catch {
		// missing or invalid → default on
	}
	return true;
}

function writeEnabledFile(enabled: boolean): void {
	const payload: EnabledFile = { enabled };
	writeFileSync(ENABLED_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function normalizeAlias(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const alias = raw.startsWith("@") ? raw.slice(1) : raw;
	if (!ALIAS_NAME.test(alias)) return undefined;
	return alias;
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

function userMessageText(message: AgentMessage): string {
	if (message.role !== "user") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function extractAliases(text: string): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const match of text.matchAll(ALIAS_REF)) {
		const alias = match[1];
		if (!alias || seen.has(alias)) continue;
		seen.add(alias);
		ordered.push(alias);
	}
	return ordered;
}

function isConsensusInjection(message: AgentMessage): boolean {
	return message.role === "custom" && "customType" in message && message.customType === CUSTOM_TYPE;
}

export default function (pi: ExtensionAPI): void {
	let items: Record<string, ConsensusItem> = {};
	let enabled = readEnabledFile();

	function snapshot(): ConsensusState {
		return { items: { ...items }, enabled };
	}

	function persist(): void {
		pi.appendEntry<ConsensusState>(CUSTOM_TYPE, snapshot());
	}

	function updateStatus(ctx: ExtensionContext): void {
		const count = Object.keys(items).length;
		if (!enabled) {
			ctx.ui.setStatus(STATUS_KEY, count > 0 ? `consensus: off (${count})` : "consensus: off");
			return;
		}
		if (count === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, `consensus: ${count}`);
	}

	function rebuildFromSession(ctx: ExtensionContext): void {
		items = {};
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
			const data = parseState(entry.data);
			if (!data) continue;
			items = { ...data.items };
		}
		updateStatus(ctx);
	}

	function setItem(alias: string, content: string): { ok: true } | { ok: false; error: string } {
		const trimmed = content.trim();
		if (!trimmed) return { ok: false, error: "content is empty" };
		const bytes = byteLength(trimmed);
		if (bytes > MAX_CONTENT_BYTES) {
			return { ok: false, error: `content exceeds 32 KiB (${bytes} bytes)` };
		}
		const exists = Object.hasOwn(items, alias);
		if (!exists && Object.keys(items).length >= MAX_ITEMS) {
			return { ok: false, error: `at most ${MAX_ITEMS} consensus items per session` };
		}
		items[alias] = { content: trimmed, updatedAt: Date.now() };
		persist();
		return { ok: true };
	}

	function setEnabled(next: boolean, ctx: ExtensionContext): string {
		enabled = next;
		writeEnabledFile(enabled);
		updateStatus(ctx);
		return enabled ? "Session consensus enabled (injection on)." : "Session consensus disabled (injection off).";
	}

	function formatList(): string {
		const aliases = Object.keys(items);
		if (aliases.length === 0) return "No consensus items in this session.";
		return aliases
			.map((alias) => {
				const item = items[alias];
				const preview = item.content.length > 80 ? `${item.content.slice(0, 80)}…` : item.content;
				return `@${alias}: ${preview}`;
			})
			.join("\n");
	}

	function buildInjection(aliases: string[]): string {
		const blocks = aliases.map((alias) => {
			const item = items[alias];
			return `<consensus alias="${alias}">\n${item.content}\n</consensus>`;
		});
		return `<session-consensus>
The following named consensus items were referenced in the current user message.
They are session-local agreements for this conversation only.

${blocks.join("\n\n")}
</session-consensus>`;
	}

	pi.on("session_start", (_event, ctx) => {
		rebuildFromSession(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		rebuildFromSession(ctx);
	});

	pi.on("context", (event) => {
		if (!enabled) return;

		const stripped = event.messages.filter((message) => !isConsensusInjection(message));
		let lastUser = -1;
		for (let i = stripped.length - 1; i >= 0; i--) {
			if (stripped[i]?.role === "user") {
				lastUser = i;
				break;
			}
		}
		if (lastUser < 0) {
			if (stripped.length === event.messages.length) return;
			return { messages: stripped };
		}

		const user = stripped[lastUser];
		if (!user) return;

		const referenced = extractAliases(userMessageText(user)).filter((alias) => Object.hasOwn(items, alias));
		if (referenced.length === 0) {
			if (stripped.length === event.messages.length) return;
			return { messages: stripped };
		}

		const injection: AgentMessage = {
			role: "custom",
			customType: CUSTOM_TYPE,
			content: buildInjection(referenced),
			display: false,
			timestamp: Date.now(),
		};
		return {
			messages: [...stripped.slice(0, lastUser), injection, ...stripped.slice(lastUser)],
		};
	});

	pi.registerCommand("consensus", {
		description: "Session-local named consensus (@alias). Subcommands: set, get, list, rm, clear, enable, disable",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				const state = enabled ? "enabled" : "disabled";
				ctx.ui.notify(`${state}\n${formatList()}`, "info");
				return;
			}

			const space = trimmed.indexOf(" ");
			const action = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
			const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

			switch (action) {
				case "enable":
				case "on":
					ctx.ui.notify(setEnabled(true, ctx), "info");
					return;
				case "disable":
				case "off":
					ctx.ui.notify(setEnabled(false, ctx), "info");
					return;
				case "toggle":
					ctx.ui.notify(setEnabled(!enabled, ctx), "info");
					return;
				case "status":
					ctx.ui.notify(
						enabled
							? `enabled, ${Object.keys(items).length} item(s)`
							: `disabled, ${Object.keys(items).length} item(s) stored`,
						"info",
					);
					return;
				case "list":
					ctx.ui.notify(formatList(), "info");
					return;
				case "clear": {
					const count = Object.keys(items).length;
					items = {};
					persist();
					updateStatus(ctx);
					ctx.ui.notify(`Cleared ${count} consensus item(s).`, "info");
					return;
				}
				case "get": {
					const alias = normalizeAlias(rest);
					if (!alias) {
						ctx.ui.notify("Usage: /consensus get <alias>", "error");
						return;
					}
					const item = items[alias];
					if (!item) {
						ctx.ui.notify(`No consensus for @${alias}`, "error");
						return;
					}
					ctx.ui.notify(`@${alias}\n${item.content}`, "info");
					return;
				}
				case "rm":
				case "remove":
				case "delete": {
					const alias = normalizeAlias(rest);
					if (!alias) {
						ctx.ui.notify("Usage: /consensus rm <alias>", "error");
						return;
					}
					if (!Object.hasOwn(items, alias)) {
						ctx.ui.notify(`No consensus for @${alias}`, "error");
						return;
					}
					delete items[alias];
					persist();
					updateStatus(ctx);
					ctx.ui.notify(`Removed @${alias}.`, "info");
					return;
				}
				case "set": {
					const aliasSpace = rest.indexOf(" ");
					const aliasRaw = aliasSpace === -1 ? rest : rest.slice(0, aliasSpace);
					const content = aliasSpace === -1 ? "" : rest.slice(aliasSpace + 1);
					const alias = normalizeAlias(aliasRaw);
					if (!alias) {
						ctx.ui.notify("Usage: /consensus set <alias> <content>", "error");
						return;
					}
					const result = setItem(alias, content);
					if (!result.ok) {
						ctx.ui.notify(result.error, "error");
						return;
					}
					updateStatus(ctx);
					ctx.ui.notify(`Set @${alias}.`, "info");
					return;
				}
				default:
					ctx.ui.notify(USAGE, "error");
			}
		},
	});

	pi.registerTool({
		name: "consensus",
		label: "Consensus",
		description:
			"Manage session-local named consensus. After set, the user (or you) can reference it with @alias in a later message. Consensus is for this session only and is not a project file.",
		promptSnippet: "Record or read session-local named consensus referenced later with @alias",
		promptGuidelines: [
			"Use the consensus tool when a reusable decision is reached in this session.",
			"Do not write consensus to project files. It disappears when this session is left.",
			"Users (and you) can later write @alias in a message to inject that consensus before the current input.",
		],
		parameters: ConsensusParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "enable":
					return {
						content: [{ type: "text", text: setEnabled(true, ctx) }],
						details: { action: "enable", enabled: true },
					};
				case "disable":
					return {
						content: [{ type: "text", text: setEnabled(false, ctx) }],
						details: { action: "disable", enabled: false },
					};
				case "status":
					return {
						content: [
							{
								type: "text",
								text: enabled
									? `enabled, ${Object.keys(items).length} item(s)`
									: `disabled, ${Object.keys(items).length} item(s) stored`,
							},
						],
						details: { action: "status", enabled, count: Object.keys(items).length },
					};
				case "list":
					return {
						content: [{ type: "text", text: formatList() }],
						details: { action: "list", enabled, count: Object.keys(items).length },
					};
				case "clear": {
					const count = Object.keys(items).length;
					items = {};
					persist();
					updateStatus(ctx);
					return {
						content: [{ type: "text", text: `Cleared ${count} consensus item(s).` }],
						details: { action: "clear", enabled, count: 0 },
					};
				}
				case "get": {
					const alias = normalizeAlias(params.alias);
					if (!alias) {
						return {
							content: [{ type: "text", text: "Error: alias required for get" }],
							details: { action: "get", enabled, error: "alias required" },
						};
					}
					const item = items[alias];
					if (!item) {
						return {
							content: [{ type: "text", text: `No consensus for @${alias}` }],
							details: { action: "get", alias, enabled, error: "not found" },
						};
					}
					return {
						content: [{ type: "text", text: item.content }],
						details: { action: "get", alias, enabled },
					};
				}
				case "rm": {
					const alias = normalizeAlias(params.alias);
					if (!alias) {
						return {
							content: [{ type: "text", text: "Error: alias required for rm" }],
							details: { action: "rm", enabled, error: "alias required" },
						};
					}
					if (!Object.hasOwn(items, alias)) {
						return {
							content: [{ type: "text", text: `No consensus for @${alias}` }],
							details: { action: "rm", alias, enabled, error: "not found" },
						};
					}
					delete items[alias];
					persist();
					updateStatus(ctx);
					return {
						content: [{ type: "text", text: `Removed @${alias}.` }],
						details: { action: "rm", alias, enabled },
					};
				}
				case "set": {
					const alias = normalizeAlias(params.alias);
					if (!alias) {
						return {
							content: [{ type: "text", text: "Error: alias required for set" }],
							details: { action: "set", enabled, error: "alias required" },
						};
					}
					if (!params.content) {
						return {
							content: [{ type: "text", text: "Error: content required for set" }],
							details: { action: "set", alias, enabled, error: "content required" },
						};
					}
					const result = setItem(alias, params.content);
					if (!result.ok) {
						return {
							content: [{ type: "text", text: `Error: ${result.error}` }],
							details: { action: "set", alias, enabled, error: result.error },
						};
					}
					updateStatus(ctx);
					return {
						content: [
							{
								type: "text",
								text: `Set @${alias}. Reference it later with @${alias} in a user message.`,
							},
						],
						details: { action: "set", alias, enabled },
					};
				}
			}
		},
	});
}
