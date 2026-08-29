import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatContextAssembly, formatContextSummary } from "./formatter.ts";
import { CONTEXT_ASSEMBLY_CHILD_ENV, runContextBuilder } from "./selector.ts";
import { getAssemblyRoots, materializeSelection } from "./sources.ts";
import type { ContextPackage } from "./types.ts";

function makeFailedPackage(prompt: string, warning: string, durationMs: number): ContextPackage {
	return {
		version: 1,
		status: "failed",
		request: { original: prompt },
		role: null,
		stack: [],
		businessKnowledge: [],
		unknowns: ["context builder unavailable"],
		warnings: [warning],
		durationMs,
	};
}

function modelIdentifier(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

function safeUnknownsForStatus(status: ContextPackage["status"]): string[] {
	if (status === "needs_input") {
		return ["Context builder could not unambiguously select the implementation context."];
	}
	if (status === "partial") {
		return ["Context builder found incomplete task context."];
	}
	return [];
}

function safeWarningsForStatus(status: ContextPackage["status"]): string[] {
	return status === "partial" ? ["Context builder reported a partial context selection."] : [];
}

function statusText(contextPackage: ContextPackage | undefined): string | undefined {
	if (!contextPackage) return "Context: idle";
	const role = contextPackage.role?.id ?? "none";
	return `Context: ${contextPackage.status} role:${role} stack:${contextPackage.stack.length} knowledge:${contextPackage.businessKnowledge.length}`;
}

function usage(): string {
	return [
		"Usage:",
		"  /context <task>   Assemble role/stack/knowledge for this task",
		"  /context show     Show the current assembled context",
		"  /context clear    Stop injecting assembled context",
	].join("\n");
}

export default function contextAssembly(pi: ExtensionAPI) {
	let latestContext: ContextPackage | undefined;

	async function assemble(prompt: string, ctx: ExtensionContext): Promise<ContextPackage | undefined> {
		const startedAt = Date.now();
		ctx.ui.setStatus("context-assembly", "Context: assembling...");
		const roots = getAssemblyRoots(ctx.cwd, getAgentDir(), CONFIG_DIR_NAME);
		const result = await runContextBuilder({
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			prompt,
			roots,
			model: ctx.model ? modelIdentifier(ctx.model.provider, ctx.model.id) : undefined,
			thinkingLevel: ctx.thinkingLevel,
			signal: ctx.signal,
		});

		if (result.kind === "aborted" || ctx.signal?.aborted) {
			ctx.ui.setStatus("context-assembly", "Context: canceled");
			return undefined;
		}

		const durationMs = Date.now() - startedAt;
		if (result.kind === "failed") {
			return makeFailedPackage(prompt, result.warning, durationMs);
		}
		if (result.selection.status === "failed") {
			return {
				version: 1,
				status: "failed",
				request: { original: prompt },
				role: null,
				stack: [],
				businessKnowledge: [],
				unknowns: ["context builder reported an unavailable selection"],
				warnings: ["Context builder reported failed selection; continued without assembled context."],
				durationMs,
			};
		}

		try {
			const materialized = await materializeSelection(result.selection, roots);
			const warnings = [...safeWarningsForStatus(result.selection.status), ...materialized.warnings];
			const sourceCount =
				Number(materialized.role !== null) + materialized.stack.length + materialized.businessKnowledge.length;
			if (sourceCount === 0) {
				warnings.push("No context source passed parent validation.");
			}
			if (result.requestTruncated) {
				warnings.push(
					"Context builder received a truncated copy of the request; the original user message remains intact.",
				);
			}
			const status: ContextPackage["status"] =
				result.selection.status === "needs_input"
					? "needs_input"
					: warnings.length > 0
						? "partial"
						: result.selection.status;
			return {
				version: 1,
				status,
				request: { original: prompt },
				role: materialized.role,
				stack: materialized.stack,
				businessKnowledge: materialized.businessKnowledge,
				unknowns: safeUnknownsForStatus(status),
				warnings,
				durationMs,
			};
		} catch {
			return makeFailedPackage(
				prompt,
				"Context source materialization failed; continued without assembled context.",
				durationMs,
			);
		}
	}

	async function handleCommand(args: string, ctx: ExtensionContext): Promise<void> {
		if (process.env[CONTEXT_ASSEMBLY_CHILD_ENV] === "1") {
			ctx.ui.notify("Context assembly cannot run inside the context-builder child.", "warning");
			return;
		}

		const task = args.trim();
		if (!task || task === "show" || task === "status") {
			if (!latestContext) {
				ctx.ui.notify(usage(), "info");
				return;
			}
			ctx.ui.notify(formatContextSummary(latestContext), latestContext.status === "failed" ? "warning" : "info");
			return;
		}

		if (task === "clear" || task === "off") {
			latestContext = undefined;
			ctx.ui.setStatus("context-assembly", "Context: idle");
			ctx.ui.notify("Cleared assembled context. Later prompts will not inject role/stack/knowledge.", "info");
			return;
		}

		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy. Wait for it to finish, then run /context again.", "warning");
			return;
		}

		const contextPackage = await assemble(task, ctx);
		if (!contextPackage) {
			return;
		}

		latestContext = contextPackage;
		ctx.ui.setStatus("context-assembly", statusText(contextPackage));
		ctx.ui.notify(
			`${formatContextSummary(contextPackage)}\n\nNext prompt will use this assembled context.`,
			contextPackage.status === "failed" ? "warning" : "info",
		);
	}

	pi.on("session_start", (_event, ctx) => {
		latestContext = undefined;
		ctx.ui.setStatus("context-assembly", "Context: idle");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		latestContext = undefined;
		ctx.ui.setStatus("context-assembly", undefined);
	});

	pi.registerCommand("context", {
		description: "Manually assemble role, stack, and business knowledge for later prompts",
		handler: handleCommand,
	});

	pi.on("before_agent_start", async (event) => {
		if (!latestContext || process.env[CONTEXT_ASSEMBLY_CHILD_ENV] === "1") {
			return;
		}
		const section = formatContextAssembly(latestContext);
		if (!section) {
			return;
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${section}` };
	});
}
