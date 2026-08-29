export const LOOKUP_AGENTS = new Set(["scout", "researcher"]);
export const MAX_LOOKUP_RUNS = 8;
export const SPLIT_ID_RE = /^[\w.-]+$/;

export function isLookupAgent(name: string): boolean {
	return LOOKUP_AGENTS.has(name);
}

export function filterLookupRuns<T extends { agent: string }>(run: T[]): T[] {
	return run.filter((item) => isLookupAgent(item.agent));
}

export interface SplitItem {
	id: string;
	agent: string;
	seek: string;
	not?: string;
}

export interface DispatchItem {
	agent: string;
	task: string;
	splitId?: string;
}

export interface DispatchPlan {
	reason: string;
	query: boolean;
	parallel: boolean;
	split: SplitItem[];
	run: DispatchItem[];
}

export interface ResolvedRun {
	agent: string;
	task: string;
	splitId?: string;
	lane: string;
	exclusiveTask: string;
	isLookup: boolean;
	originalIndex: number;
}

export interface ResolvedLookupPlan {
	useParallel: boolean;
	errors: string[];
	split: SplitItem[];
	runs: ResolvedRun[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAgentName(value: unknown): string | undefined {
	if (typeof value === "string") {
		const name = value.trim();
		return name || undefined;
	}
	if (isRecord(value) && typeof value.name === "string") {
		const name = value.name.trim();
		return name || undefined;
	}
	return undefined;
}

export function extractJsonObject(text: string): Record<string, unknown> | undefined {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const raw = (fenced?.[1] ?? text).trim();
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function parseSplitItem(value: unknown): SplitItem | undefined {
	if (!isRecord(value)) return undefined;
	const id = typeof value.id === "string" ? value.id.trim() : "";
	const agent = readAgentName(value.agent);
	const seek = typeof value.seek === "string" ? value.seek.trim() : "";
	if (!id || !agent || !seek) return undefined;
	const item: SplitItem = { id, agent, seek };
	if (typeof value.not === "string" && value.not.trim()) item.not = value.not.trim();
	return item;
}

function parseRunItem(value: unknown): DispatchItem | undefined {
	if (!isRecord(value)) return undefined;
	const agent = readAgentName(value.agent);
	const task = typeof value.task === "string" ? value.task.trim() : "";
	if (!agent || !task) return undefined;
	const item: DispatchItem = { agent, task };
	if (typeof value.splitId === "string" && value.splitId.trim()) item.splitId = value.splitId.trim();
	return item;
}

export function parseDispatch(output: string): DispatchPlan | undefined {
	const parsed = extractJsonObject(output);
	if (!parsed) return undefined;
	const reason = typeof parsed.reason === "string" ? parsed.reason : "";
	const run: DispatchItem[] = [];
	if (Array.isArray(parsed.run)) {
		for (const item of parsed.run) {
			const parsedItem = parseRunItem(item);
			if (parsedItem) run.push(parsedItem);
		}
	}
	const split: SplitItem[] = [];
	if (Array.isArray(parsed.split)) {
		for (const item of parsed.split) {
			const parsedItem = parseSplitItem(item);
			if (parsedItem) split.push(parsedItem);
		}
	}
	const query = parsed.query === false ? false : parsed.query === true || run.length > 0;
	if (!query) {
		return { reason, query: false, parallel: false, split: [], run: [] };
	}
	return {
		reason,
		query: true,
		parallel: parsed.parallel === true,
		split,
		run,
	};
}

export function normalizeSeek(seek: string): string {
	return seek.trim().toLowerCase();
}

export function laneName(agent: string, splitId: string | undefined, index: number): string {
	if (splitId) return `${agent}:${splitId}`;
	return `${agent}#${index}`;
}

export function applyExclusiveContract(task: string, slice: SplitItem, others: SplitItem[]): string {
	const not = slice.not?.trim() || others.map((item) => item.seek).filter(Boolean).join("；") || "其它并发 split 的目标";
	return `${task.trim()}

## Exclusive search contract
- splitId: ${slice.id}
- 只查找: ${slice.seek}
- 不要查找: ${not}
- 禁止与其它并发 subagent 重复同一文件集或同一问题`;
}

export function injectPriorBriefs(task: string, briefs: string[]): string {
	const previous = briefs.length > 0 ? briefs.join("\n\n") : "(none)";
	if (task.includes("{previous}")) return task.replaceAll("{previous}", previous);
	if (briefs.length === 0) return task;
	return `${task}\n\n## 已完成的查找结果\n\n${briefs.join("\n\n")}`;
}

export function formatSplitList(split: SplitItem[]): string {
	if (split.length === 0) return "";
	const lines = split.map((item) => {
		const not = item.not?.trim() || "(auto)";
		return `- ${item.id} (${item.agent}): 只查找 ${item.seek} / 不要查找 ${not}`;
	});
	return `## Lookup split\n${lines.join("\n")}`;
}

function bindSplitId(
	item: DispatchItem,
	lookupSplits: SplitItem[],
	usedIds: Set<string>,
	errors: string[],
): string | undefined {
	if (item.splitId) {
		const slice = lookupSplits.find((entry) => entry.id === item.splitId);
		if (!slice) {
			errors.push(`splitId not found: ${item.splitId}`);
			return undefined;
		}
		if (slice.agent !== item.agent) {
			errors.push(`splitId ${item.splitId} agent is ${slice.agent}, run is ${item.agent}`);
			return undefined;
		}
		if (usedIds.has(item.splitId)) {
			errors.push(`splitId reused: ${item.splitId}`);
			return undefined;
		}
		usedIds.add(item.splitId);
		return item.splitId;
	}
	const matches = lookupSplits.filter((entry) => entry.agent === item.agent);
	if (matches.length === 1 && !usedIds.has(matches[0].id)) {
		usedIds.add(matches[0].id);
		return matches[0].id;
	}
	errors.push(`missing unique splitId for ${item.agent}`);
	return undefined;
}

export function resolveLookupPlan(
	plan: DispatchPlan,
	lookupAgents: ReadonlySet<string> = LOOKUP_AGENTS,
): ResolvedLookupPlan {
	const errors: string[] = [];
	if (!plan.query) {
		return { useParallel: false, errors, split: [], runs: [] };
	}

	const rawSplit = plan.split;
	for (const item of rawSplit) {
		if (!SPLIT_ID_RE.test(item.id)) errors.push(`invalid split id: ${item.id}`);
	}
	const idCounts = new Map<string, number>();
	for (const item of rawSplit) idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
	for (const [id, count] of idCounts) {
		if (count > 1) errors.push(`duplicate split id: ${id}`);
	}

	const nonLookupSplit = rawSplit.filter((item) => !lookupAgents.has(item.agent));
	for (const item of nonLookupSplit) errors.push(`split contains non-lookup agent: ${item.agent}`);
	const lookupSplits = rawSplit.filter((item) => lookupAgents.has(item.agent));

	const seekCounts = new Map<string, number>();
	for (const item of lookupSplits) {
		const key = normalizeSeek(item.seek);
		seekCounts.set(key, (seekCounts.get(key) ?? 0) + 1);
	}
	for (const [seek, count] of seekCounts) {
		if (count > 1) errors.push(`duplicate seek: ${seek}`);
	}

	const lookupRuns = plan.run.filter((item) => lookupAgents.has(item.agent));
	if (lookupRuns.length > MAX_LOOKUP_RUNS) errors.push(`too many lookup runs: ${lookupRuns.length}`);

	const usedIds = new Set<string>();
	const boundIds: Array<string | undefined> = plan.run.map((item) => {
		if (!lookupAgents.has(item.agent)) return item.splitId;
		return bindSplitId(item, lookupSplits, usedIds, errors);
	});

	const filledSplit = lookupSplits.map((item) => {
		if (item.not?.trim()) return item;
		const others = lookupSplits.filter((entry) => entry.id !== item.id);
		const not = others.map((entry) => entry.seek).filter(Boolean).join("；");
		return not ? { ...item, not } : { ...item };
	});

	const splitById = new Map(filledSplit.map((item) => [item.id, item]));
	const runs: ResolvedRun[] = plan.run.map((item, originalIndex) => {
		const isLookup = lookupAgents.has(item.agent);
		const splitId = boundIds[originalIndex];
		const slice = splitId ? splitById.get(splitId) : undefined;
		return {
			agent: item.agent,
			task: item.task,
			splitId,
			lane: laneName(item.agent, splitId, originalIndex),
			exclusiveTask: item.task,
			isLookup,
			originalIndex,
		};
	});

	const canParallel =
		plan.parallel &&
		lookupRuns.length >= 2 &&
		filledSplit.length >= 2 &&
		errors.length === 0 &&
		runs.filter((item) => item.isLookup).every((item) => Boolean(item.splitId));

	if (plan.parallel && !canParallel && errors.length === 0) {
		if (filledSplit.length < 2) errors.push("parallel requires at least 2 split items");
		if (lookupRuns.length < 2) errors.push("parallel requires at least 2 lookup runs");
	}

	if (canParallel) {
		for (const run of runs) {
			if (!run.isLookup || !run.splitId) continue;
			const slice = splitById.get(run.splitId);
			if (!slice) continue;
			const others = filledSplit.filter((item) => item.id !== slice.id);
			run.exclusiveTask = applyExclusiveContract(run.task, slice, others);
		}
	}

	return {
		useParallel: Boolean(canParallel),
		errors,
		split: filledSplit,
		runs,
	};
}

export interface BriefResult {
	lane: string;
	agent: string;
	splitId?: string;
	seek?: string;
	not?: string;
	exitCode: number;
	brief: string;
}

export interface AggregatedBrief {
	scheduler: "preflight";
	reason: string;
	query: boolean;
	parallel: boolean;
	parallelRequested: boolean;
	split: SplitItem[];
	ran: string[];
	results: BriefResult[];
	prior: BriefResult[];
	plan?: string;
}

export function lookupEvidencePayload(data: AggregatedBrief): Omit<AggregatedBrief, "plan"> {
	return {
		scheduler: data.scheduler,
		reason: data.reason,
		query: data.query,
		parallel: data.parallel,
		parallelRequested: data.parallelRequested,
		split: data.split,
		ran: data.ran,
		results: data.results,
		prior: data.prior,
	};
}

export function parseBriefResult(value: unknown): BriefResult | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.lane !== "string" || typeof value.agent !== "string") return undefined;
	if (typeof value.brief !== "string") return undefined;
	const item: BriefResult = {
		lane: value.lane,
		agent: value.agent,
		exitCode: typeof value.exitCode === "number" ? value.exitCode : 0,
		brief: value.brief,
	};
	if (typeof value.splitId === "string" && value.splitId) item.splitId = value.splitId;
	if (typeof value.seek === "string" && value.seek) item.seek = value.seek;
	if (typeof value.not === "string" && value.not) item.not = value.not;
	return item;
}

export function collectPriorResults(detailsList: unknown[]): BriefResult[] {
	const out: BriefResult[] = [];
	const seen = new Set<string>();
	for (const details of detailsList) {
		if (!isRecord(details)) continue;
		const buckets = [details.results, details.prior];
		for (const bucket of buckets) {
			if (!Array.isArray(bucket)) continue;
			for (const value of bucket) {
				const parsed = parseBriefResult(value);
				if (!parsed) continue;
				const key = `${parsed.lane}::${parsed.splitId ?? ""}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(parsed);
			}
		}
	}
	return out;
}

export function currentSessionExecutionInstructions(): string {
	return [
		"After the planner.md subagent finishes, continue in this session.",
		"Execute using the lookup evidence and the plan together.",
		"Do not discard or rewrite results[].brief or prior[].brief. The plan must not replace the lookup JSON.",
		"Do not hand execution to worker, plan-executor, or another subagent.",
	].join(" ");
}

export function formatAggregatedBrief(data: AggregatedBrief): string {
	const splitList = formatSplitList(data.split);
	const lookupJson = JSON.stringify(lookupEvidencePayload(data), null, 2);
	const lines = [
		"## Pre-loop briefs",
		"",
		"Two parts: (1) lookup JSON evidence, (2) optional plan from the planner.md subagent.",
		currentSessionExecutionInstructions(),
		"",
		splitList,
		splitList ? "" : undefined,
		"### Lookup evidence",
		"```json",
		lookupJson,
		"```",
	];
	if (data.plan?.trim()) {
		lines.push("", "### Plan", "", data.plan.trim());
	}
	return lines.filter((line) => line !== undefined).join("\n");
}

export function buildPlannerTask(userPrompt: string, lookup: AggregatedBrief): string {
	return [
		"根据下面的查找证据写实现计划。不要改文件。",
		"不要删除、改写或摘要掉 JSON 里的 results[].brief / prior[].brief；那些证据由父级原样保留。",
		"你的输出只应是计划本身（Goal / Plan / Files to Modify / Risks）。",
		"计划写给当前父会话主 Agent 在本会话里直接执行；不要指定 worker / plan-executor 去执行。",
		"",
		"## 用户任务",
		userPrompt.trim(),
		"",
		"## Lookup evidence",
		"```json",
		JSON.stringify(lookupEvidencePayload(lookup), null, 2),
		"```",
	].join("\n");
}

export function formatCompletedResults(results: BriefResult[]): string {
	return JSON.stringify(
		{
			split: results.map((item) => ({
				lane: item.lane,
				agent: item.agent,
				splitId: item.splitId,
				seek: item.seek,
				not: item.not,
			})),
			results: results.map((item) => ({
				lane: item.lane,
				agent: item.agent,
				splitId: item.splitId,
				brief: item.brief,
			})),
		},
		null,
		2,
	);
}
