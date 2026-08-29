/**
 * Pre-loop subagent gate.
 *
 * Before the main agent loop, run the `preflight` subagent. Execute the
 * lookup agents it returns (researcher, scout), wait for them, keep a
 * structured JSON brief, then run the `planner` subagent (planner.md) on
 * that JSON. Inject lookup JSON plus plan into the current session so the
 * main agent continues execution here. Planner never rewrites lookup
 * evidence. The main session executes the plan; do not spawn worker or
 * plan-executor for that.
 *
 * Mode: /preloop auto|never|once|status
 * CLI:  --preloop auto|never   --no-preloop
 * Env:  PI_PRELOOP=never|0     PI_SKIP_PRELOOP=1
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	getAgentDir,
	getMarkdownTheme,
	parseFrontmatter,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
	type AggregatedBrief,
	type BriefResult,
	buildPlannerTask,
	collectPriorResults,
	currentSessionExecutionInstructions,
	filterLookupRuns,
	formatAggregatedBrief,
	formatCompletedResults,
	injectPriorBriefs,
	isLookupAgent,
	LOOKUP_AGENTS,
	parseDispatch,
	resolveLookupPlan,
} from "./dispatch.ts";

const CUSTOM_TYPE = "preloop-brief";
const STATUS_KEY = "preloop-gate";
const WIDGET_KEY = "preloop-gate";
const ROUTER_NAME = "preflight";
const PLANNER_NAME = "planner";
const CONFIG_NAME = "preloop-gate.json";
const SKIP_ENV = "PI_SKIP_PRELOOP";
const CHILD_BRIEF_LIMIT = 32 * 1024;
const CHILD_BRIEF_LINES = 800;
const MAX_LOOKUP_CONCURRENCY = 4;

type GateMode = "auto" | "never";

interface GateConfig {
	mode: GateMode;
}

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	filePath: string;
}

interface AgentRunResult {
	output: string;
	exitCode: number;
	stderr: string;
	errorMessage?: string;
	aborted: boolean;
}

interface StoredInput {
	text: string;
	source: string;
	ts: number;
}

function configPath(): string {
	return path.join(getAgentDir(), CONFIG_NAME);
}

function loadConfig(): GateConfig {
	try {
		const raw = fs.readFileSync(configPath(), "utf-8");
		const parsed = JSON.parse(raw) as { mode?: unknown };
		if (parsed.mode === "auto" || parsed.mode === "never") return { mode: parsed.mode };
		if (parsed.mode === "always") return { mode: "auto" };
	} catch {
		/* default */
	}
	return { mode: "auto" };
}

function saveConfig(config: GateConfig): void {
	fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTools(raw: string | undefined): string[] | undefined {
	if (raw === undefined) return undefined;
	const tools = raw
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentFile(filePath: string): AgentConfig | undefined {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
	const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
	if (!frontmatter.name || !frontmatter.description) return undefined;
	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: parseTools(frontmatter.tools),
		model: frontmatter.model,
		systemPrompt: body,
		filePath,
	};
}

function loadUserAgents(): AgentConfig[] {
	const dir = path.join(getAgentDir(), "agents");
	if (!fs.existsSync(dir)) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const agent = loadAgentFile(path.join(dir, entry.name));
		if (agent) agents.push(agent);
	}
	return agents;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function countUserTurns(entries: SessionEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "user") count += 1;
	}
	return count;
}

function recentPreloopAgents(entries: SessionEntry[]): string[] {
	const names: string[] = [];
	for (const item of collectPriorResults(allPreloopDetails(entries))) {
		if (!names.includes(item.agent)) names.push(item.agent);
		if (!names.includes(item.lane)) names.push(item.lane);
	}
	return names;
}

function allPreloopDetails(entries: SessionEntry[]): unknown[] {
	const details: unknown[] = [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom_message" && entry.customType === CUSTOM_TYPE) details.push(entry.details);
	}
	return details;
}

function assistantText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue;
		parts.push(part.text);
	}
	return parts.join("\n").trim();
}

function customContentText(content: unknown): string {
	if (typeof content === "string") return content;
	return assistantText(content);
}

function formatToolProgress(name: string, args: Record<string, unknown>): string {
	const asString = (value: unknown): string => (typeof value === "string" ? value : "");
	switch (name) {
		case "bash":
			return `$ ${asString(args.command).slice(0, 80)}`;
		case "read":
			return `read ${asString(args.path || args.file_path)}`;
		case "grep":
			return `grep ${asString(args.pattern)}`;
		case "find":
			return `find ${asString(args.pattern)}`;
		case "ls":
			return `ls ${asString(args.path) || "."}`;
		default:
			return name;
	}
}

function isNoTools(tools: string[] | undefined): boolean {
	if (!tools || tools.length === 0) return false;
	return tools.length === 1 && (tools[0] === "none" || tools[0] === "no-tools");
}

function dispatchable(agent: AgentConfig): boolean {
	return isLookupAgent(agent.name);
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TOut>(items.length);
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: limit }, async () => {
			while (true) {
				const current = nextIndex++;
				if (current >= items.length) return;
				results[current] = await fn(items[current], current);
			}
		}),
	);
	return results;
}

function buildRouterTask(options: {
	cwd: string;
	prompt: string;
	firstTurn: boolean;
	recentAgents: string[];
	available: AgentConfig[];
}): string {
	const availableLines = options.available
		.filter(dispatchable)
		.map((agent) => `- ${agent.name}: ${agent.description}`)
		.join("\n");
	const recent = options.recentAgents.length > 0 ? options.recentAgents.join(", ") : "无";
	return [
		`工作目录：${options.cwd}`,
		`是否首轮：${options.firstTurn ? "yes" : "no"}`,
		`近期已跑前置：${recent}`,
		"",
		"可用前置 agent：",
		availableLines || "- （无）",
		"",
		"用户任务：",
		options.prompt.trim(),
	].join("\n");
}

async function writeTempDir(systemPrompt: string, task: string): Promise<{ dir: string; promptFile: string; taskFile: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-preloop-"));
	const promptFile = path.join(dir, "system-prompt.md");
	const taskFile = path.join(dir, "task.md");
	await fs.promises.writeFile(promptFile, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	await fs.promises.writeFile(taskFile, `Task:\n${task}\n`, { encoding: "utf-8", mode: 0o600 });
	return { dir, promptFile, taskFile };
}

function cleanupTemp(dir: string | undefined): void {
	if (!dir) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

async function runAgent(options: {
	cwd: string;
	agent: AgentConfig;
	task: string;
	signal: AbortSignal | undefined;
	onProgress: ((line: string) => void) | undefined;
}): Promise<AgentRunResult> {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-context-files", "--no-prompt-templates"];
	if (options.agent.model) args.push("--model", options.agent.model);
	if (isNoTools(options.agent.tools)) args.push("--no-tools");
	else if (options.agent.tools && options.agent.tools.length > 0) args.push("--tools", options.agent.tools.join(","));

	let tmpDir: string | undefined;
	let output = "";
	let stderr = "";
	let errorMessage: string | undefined;
	let aborted = false;

	try {
		const tmp = await writeTempDir(options.agent.systemPrompt, options.task);
		tmpDir = tmp.dir;
		if (options.agent.systemPrompt.trim()) args.push("--append-system-prompt", tmp.promptFile);
		args.push(`@${tmp.taskFile}`);
		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const childEnv = { ...process.env, [SKIP_ENV]: "1", PI_SKIP_RESEARCHER_GATE: "1" };
			const proc = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: childEnv,
			});
			let buffer = "";

			const handleLine = (line: string) => {
				if (!line.trim()) return;
				let event: unknown;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}
				if (!isRecord(event) || typeof event.type !== "string") return;

				if (event.type === "tool_execution_start") {
					const name = typeof event.toolName === "string" ? event.toolName : "tool";
					const toolArgs = isRecord(event.args) ? event.args : {};
					options.onProgress?.(formatToolProgress(name, toolArgs));
					return;
				}

				if (event.type !== "message_end" || !isRecord(event.message)) return;
				const message = event.message;
				if (message.role !== "assistant") return;
				const text = assistantText(message.content);
				if (text) output = text;
				if (typeof message.errorMessage === "string" && message.errorMessage) {
					errorMessage = message.errorMessage;
				}
			};

			proc.stdout.on("data", (chunk: Buffer | string) => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) handleLine(line);
			});
			proc.stderr.on("data", (chunk: Buffer | string) => {
				stderr += chunk.toString();
			});
			proc.on("close", (code) => {
				if (buffer.trim()) handleLine(buffer);
				resolve(code ?? 0);
			});
			proc.on("error", (err) => {
				errorMessage = err instanceof Error ? err.message : String(err);
				resolve(1);
			});

			if (options.signal) {
				const killProc = () => {
					aborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (options.signal.aborted) killProc();
				else options.signal.addEventListener("abort", killProc, { once: true });
			}
		});

		return { output, exitCode, stderr, errorMessage, aborted };
	} finally {
		cleanupTemp(tmpDir);
	}
}

function clipBrief(output: string): string {
	const truncation = truncateHead(output.trim() || "(no output)", {
		maxBytes: Math.min(DEFAULT_MAX_BYTES, CHILD_BRIEF_LIMIT),
		maxLines: CHILD_BRIEF_LINES,
	});
	if (!truncation.truncated) return truncation.content;
	return `${truncation.content}\n\n[brief truncated: ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
}

function resolveMode(pi: ExtensionAPI): GateMode {
	if (process.env[SKIP_ENV] === "1" || process.env.PI_SKIP_RESEARCHER_GATE === "1") return "never";
	const envMode = (process.env.PI_PRELOOP ?? process.env.PI_RESEARCHER_GATE)?.trim().toLowerCase();
	if (envMode === "0" || envMode === "never") return "never";
	if (pi.getFlag("no-preloop") === true || pi.getFlag("no-researcher-gate") === true) return "never";
	const flag = pi.getFlag("preloop") ?? pi.getFlag("researcher-gate");
	if (flag === "auto" || flag === "never") return flag;
	if (flag === "always") return "auto";
	return loadConfig().mode;
}

function clearUi(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

function setProgress(ctx: ExtensionContext, status: string, lines: string[]): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, status);
	ctx.ui.setWidget(WIDGET_KEY, lines);
}

type LaneStatus = "pending" | "running" | "done" | "failed" | "aborted";

interface Lane {
	name: string;
	status: LaneStatus;
	actions: string[];
}

function laneStatusLabel(status: LaneStatus): string {
	switch (status) {
		case "pending":
			return "wait";
		case "running":
			return "run";
		case "done":
			return "ok";
		case "failed":
			return "fail";
		case "aborted":
			return "abort";
	}
}

function createBoard(ctx: ExtensionContext): {
	setHeader: (header: string) => void;
	ensureLane: (name: string, status?: LaneStatus) => void;
	setLane: (name: string, status: LaneStatus) => void;
	action: (name: string, line: string) => void;
} {
	let header = "preloop";
	const lanes: Lane[] = [];

	const paint = () => {
		const running = lanes.filter((lane) => lane.status === "running").length;
		const settled = lanes.filter((lane) => lane.status === "done" || lane.status === "failed").length;
		const summary =
			lanes.length > 1 ? `${header}  ${settled}/${lanes.length} done, ${running} running` : header;
		const lines = [summary];
		for (const lane of lanes) {
			lines.push(`--- ${lane.name} [${laneStatusLabel(lane.status)}]`);
			const tail = lane.actions.slice(-4);
			if (tail.length === 0 && lane.status === "running") lines.push("    (running...)");
			for (const action of tail) lines.push(`    -> ${action}`);
		}
		setProgress(ctx, summary.slice(0, 60), lines);
	};

	const getLane = (name: string): Lane => {
		let lane = lanes.find((item) => item.name === name);
		if (!lane) {
			lane = { name, status: "pending", actions: [] };
			lanes.push(lane);
		}
		return lane;
	};

	return {
		setHeader(next) {
			header = next;
			paint();
		},
		ensureLane(name, status) {
			const lane = getLane(name);
			if (status) lane.status = status;
			paint();
		},
		setLane(name, status) {
			getLane(name).status = status;
			paint();
		},
		action(name, line) {
			const lane = getLane(name);
			if (lane.status === "pending") lane.status = "running";
			lane.actions.push(line);
			paint();
		},
	};
}

export default function (pi: ExtensionAPI) {
	let forceOnce = false;
	let lastInput: StoredInput | undefined;

	pi.registerFlag("preloop", {
		description: "Pre-loop subagent gate: auto | never",
		type: "string",
		default: "",
	});
	pi.registerFlag("no-preloop", {
		description: "Disable the pre-loop subagent gate",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("researcher-gate", {
		description: "Deprecated alias of --preloop",
		type: "string",
		default: "",
	});
	pi.registerFlag("no-researcher-gate", {
		description: "Deprecated alias of --no-preloop",
		type: "boolean",
		default: false,
	});

	const commandHandler = async (args: string, ctx: ExtensionContext) => {
		const value = args.trim().toLowerCase();
		if (!value || value === "status") {
			const mode = forceOnce ? `once→${resolveMode(pi)}` : resolveMode(pi);
			ctx.ui.notify(`preloop: ${mode}`, "info");
			return;
		}
		if (value === "once") {
			forceOnce = true;
			ctx.ui.notify("preloop: 下一条消息强制走 preflight", "info");
			return;
		}
		if (value === "auto" || value === "never") {
			forceOnce = false;
			saveConfig({ mode: value });
			ctx.ui.notify(`preloop: ${value}`, "info");
			return;
		}
		ctx.ui.notify("用法: /preloop auto|never|once|status", "warning");
	};

	pi.registerCommand("preloop", {
		description: "Pre-loop subagent gate: auto | never | once | status",
		getArgumentCompletions: (prefix: string) => {
			const items = ["auto", "never", "once", "status"].map((value) => ({ value, label: value }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: commandHandler,
	});
	pi.registerCommand("researcher-gate", {
		description: "Deprecated alias of /preloop",
		getArgumentCompletions: (prefix: string) => {
			const items = ["auto", "never", "once", "status"].map((value) => ({ value, label: value }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: commandHandler,
	});

	pi.registerMessageRenderer(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
		const details = message.details as AggregatedBrief | undefined;
		const body = customContentText(message.content);
		const names = details?.ran?.join(", ") || "preloop";
		const mode = details?.parallel ? "parallel" : "serial";
		const header = `${theme.fg("accent", theme.bold("preloop"))} ${theme.fg("dim", mode)} ${theme.fg("dim", names)} ${theme.fg("dim", details?.reason ?? "")}`;
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		if (expanded) {
			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(body.trim() || "(empty)", 0, 0, getMarkdownTheme()));
			box.addChild(container);
			return box;
		}
		const lines = body.split("\n");
		const preview = lines.slice(0, 12).join("\n");
		let text = `${header}\n${theme.fg("toolOutput", preview)}`;
		if (lines.length > 12) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	pi.on("input", (event) => {
		lastInput = { text: event.text, source: event.source, ts: Date.now() };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearUi(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.mode === "json") return;
		if (process.env[SKIP_ENV] === "1") return;

		const rawInput = lastInput && Date.now() - lastInput.ts < 10_000 ? lastInput : undefined;
		if (rawInput?.source === "extension") return;

		const decisionPrompt = rawInput?.text ?? event.prompt;
		if (!decisionPrompt.trim()) return;
		if (/^\/skill:/i.test(decisionPrompt.trim())) return;

		const forced = forceOnce;
		forceOnce = false;
		const mode = resolveMode(pi);
		if (!forced && mode === "never") return;

		const agents = loadUserAgents();
		const router = agents.find((agent) => agent.name === ROUTER_NAME);
		if (!router) {
			if (ctx.hasUI) ctx.ui.notify("preloop: 未找到 preflight.md，已跳过", "warning");
			return;
		}

		const entries = ctx.sessionManager.getBranch();
		const routerTask = buildRouterTask({
			cwd: ctx.cwd,
			prompt: event.prompt,
			firstTurn: countUserTurns(entries) === 0,
			recentAgents: recentPreloopAgents(entries),
			available: agents,
		});

		const board = createBoard(ctx);
		board.ensureLane("preflight", "running");
		board.setHeader("preloop");
		if (ctx.hasUI) ctx.ui.notify("进循环前先问 preflight；并行进度在编辑器上方", "info");

		try {
			const decisionResult = await runAgent({
				cwd: ctx.cwd,
				agent: router,
				task: routerTask,
				signal: ctx.signal,
				onProgress: (line) => board.action("preflight", line),
			});

			if (decisionResult.aborted) {
				if (ctx.hasUI) ctx.ui.notify("preflight 已中止，直接进入主循环", "warning");
				return;
			}

			const decision = parseDispatch(decisionResult.output);
			if (!decision) {
				if (ctx.hasUI) ctx.ui.notify("preflight 输出无法解析，直接进入主循环", "warning");
				return;
			}
			if (!decision.query || decision.run.length === 0) {
				if (ctx.hasUI) {
					ctx.ui.notify(`preflight: 不查询（${decision.reason || "无需"}）`, "info");
				}
				return;
			}

			const byName = new Map(agents.map((agent) => [agent.name, agent]));
			for (const item of decision.run) {
				if (!isLookupAgent(item.agent) && ctx.hasUI) {
					ctx.ui.notify(`preloop: 只查找，跳过 ${item.agent}`, "warning");
				}
			}
			const allowedRun = filterLookupRuns(decision.run).filter((item) => {
				if (!byName.has(item.agent)) {
					if (ctx.hasUI) ctx.ui.notify(`preloop: 未知 agent ${item.agent}`, "warning");
					return false;
				}
				return true;
			});
			const resolved = resolveLookupPlan({ ...decision, run: allowedRun }, LOOKUP_AGENTS);
			const lookups = resolved.runs.flatMap((run) => {
				if (!run.isLookup) return [];
				const config = byName.get(run.agent);
				return config ? [{ config, run }] : [];
			});
			if (lookups.length === 0) return;

			const useParallel = resolved.useParallel;
			if (decision.parallel && !useParallel && resolved.errors.length > 0 && ctx.hasUI) {
				ctx.ui.notify(`split 无效，改为串行：${resolved.errors.join("; ")}`.slice(0, 220), "warning");
			}

			const splitById = new Map(resolved.split.map((item) => [item.id, item]));
			board.setLane("preflight", "done");
			board.setHeader(useParallel ? "preloop  split ok" : "preloop");
			for (const step of lookups) board.ensureLane(step.run.lane, "pending");

			const collected: BriefResult[] = [];

			const recordResult = (step: (typeof lookups)[number], result: AgentRunResult): boolean => {
				const lane = step.run.lane;
				const slice = step.run.splitId ? splitById.get(step.run.splitId) : undefined;
				if (result.aborted) {
					board.setLane(lane, "aborted");
					if (ctx.hasUI) ctx.ui.notify(`${lane} 已中止，进入主循环`, "warning");
					return false;
				}
				if (result.exitCode !== 0 && !result.output.trim()) {
					const err = result.errorMessage || result.stderr.trim() || `exit ${result.exitCode}`;
					board.action(lane, err.slice(0, 80));
					board.setLane(lane, "failed");
					if (ctx.hasUI) ctx.ui.notify(`${lane} 失败：${err.slice(0, 180)}`, "warning");
					return false;
				}
				board.setLane(lane, "done");
				const row: BriefResult = {
					lane,
					agent: step.run.agent,
					exitCode: result.exitCode,
					brief: clipBrief(result.output),
				};
				if (step.run.splitId) row.splitId = step.run.splitId;
				if (slice?.seek) row.seek = slice.seek;
				if (slice?.not) row.not = slice.not;
				collected.push(row);
				return true;
			};

			const runOne = async (step: (typeof lookups)[number], task: string) => {
				board.setLane(step.run.lane, "running");
				if (ctx.hasUI) ctx.ui.notify(`前置 ${step.run.lane} 执行中`, "info");
				const result = await runAgent({
					cwd: ctx.cwd,
					agent: step.config,
					task,
					signal: ctx.signal,
					onProgress: (line) => board.action(step.run.lane, line),
				});
				return recordResult(step, result);
			};

			if (useParallel) {
				const splitLines = resolved.split.map((item) => `${item.id}:${item.agent}:${item.seek}`);
				if (ctx.hasUI) ctx.ui.notify(`split ok，并行：${splitLines.join(" | ")}`.slice(0, 220), "info");
				for (const step of lookups) board.setLane(step.run.lane, "running");
				const lookupResults = await mapWithConcurrencyLimit(lookups, MAX_LOOKUP_CONCURRENCY, async (step) => {
					const result = await runAgent({
						cwd: ctx.cwd,
						agent: step.config,
						task: step.run.exclusiveTask,
						signal: ctx.signal,
						onProgress: (line) => board.action(step.run.lane, line),
					});
					return { step, result };
				});
				for (const item of lookupResults) recordResult(item.step, item.result);
			} else {
				if (ctx.hasUI) ctx.ui.notify("preflight 串行查询", "info");
				for (const step of lookups) {
					const task =
						collected.length > 0
							? injectPriorBriefs(step.run.task, [formatCompletedResults(collected)])
							: step.run.task;
					if (!(await runOne(step, task))) break;
				}
			}

			if (collected.length === 0) return;

			const currentLanes = new Set(collected.map((item) => `${item.lane}::${item.splitId ?? ""}`));
			const prior = collectPriorResults(allPreloopDetails(entries)).filter(
				(item) => !currentLanes.has(`${item.lane}::${item.splitId ?? ""}`),
			);
			const aggregated: AggregatedBrief = {
				scheduler: "preflight",
				reason: decision.reason,
				query: decision.query,
				parallel: useParallel,
				parallelRequested: decision.parallel,
				split: resolved.split,
				ran: collected.map((item) => item.lane),
				results: collected,
				prior,
			};

			const planner = agents.find((agent) => agent.name === PLANNER_NAME);
			if (planner) {
				board.ensureLane(PLANNER_NAME, "running");
				if (ctx.hasUI) ctx.ui.notify("查找已汇总，开始 planner", "info");
				const planResult = await runAgent({
					cwd: ctx.cwd,
					agent: planner,
					task: buildPlannerTask(event.prompt, aggregated),
					signal: ctx.signal,
					onProgress: (line) => board.action(PLANNER_NAME, line),
				});
				if (planResult.aborted) {
					board.setLane(PLANNER_NAME, "aborted");
				} else if (planResult.exitCode !== 0 && !planResult.output.trim()) {
					board.setLane(PLANNER_NAME, "failed");
					if (ctx.hasUI) {
						const err = planResult.errorMessage || planResult.stderr.trim() || `exit ${planResult.exitCode}`;
						ctx.ui.notify(`planner 失败，仍保留查找 JSON：${err.slice(0, 160)}`, "warning");
					}
				} else {
					board.setLane(PLANNER_NAME, "done");
					aggregated.plan = clipBrief(planResult.output);
					aggregated.ran = [...aggregated.ran, PLANNER_NAME];
				}
			} else if (ctx.hasUI) {
				ctx.ui.notify("未找到 planner.md，只注入查找 JSON", "warning");
			}

			const content = formatAggregatedBrief(aggregated);
			if (ctx.hasUI) ctx.ui.notify(`前置完成（${aggregated.ran.join(", ")}），进入主循环`, "info");

			return {
				message: {
					customType: CUSTOM_TYPE,
					content,
					display: true,
					details: aggregated,
				},
				systemPrompt: `${event.systemPrompt}

## Pre-loop gate
A structured lookup JSON plus an optional plan from the planner.md subagent were injected.
${currentSessionExecutionInstructions()}
Use the Plan section as the implementation plan.`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(`preloop 异常，进入主循环：${message.slice(0, 180)}`, "warning");
			return;
		} finally {
			clearUi(ctx);
		}
	});
}
