import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyExclusiveContract,
	buildPlannerTask,
	collectPriorResults,
	currentSessionExecutionInstructions,
	filterLookupRuns,
	formatAggregatedBrief,
	injectPriorBriefs,
	LOOKUP_AGENTS,
	parseDispatch,
	resolveLookupPlan,
} from "./dispatch.ts";

const scoutResearcherJson = JSON.stringify({
	reason: "repo vs docs",
	query: true,
	parallel: true,
	split: [
		{
			id: "repo-protocol",
			agent: "scout",
			seek: "当前仓库里的协议/实现文件",
			not: "外网文档、cwd 外目录",
		},
		{
			id: "web-docs",
			agent: "researcher",
			seek: "官方文档/issue/API",
			not: "当前仓库实现细节与行号",
		},
	],
	run: [
		{ agent: "scout", task: "scout the protocol files", splitId: "repo-protocol" },
		{ agent: "researcher", task: "fetch official docs", splitId: "web-docs" },
	],
});

describe("parseDispatch", () => {
	it("clears split and run when query is false", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: false,
				parallel: true,
				split: [{ id: "a", agent: "scout", seek: "x" }],
				run: [{ agent: "scout", task: "t", splitId: "a" }],
			}),
		);
		assert.ok(plan);
		assert.equal(plan.query, false);
		assert.equal(plan.parallel, false);
		assert.deepEqual(plan.split, []);
		assert.deepEqual(plan.run, []);
	});

	it("parses legacy JSON without split", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: true,
				parallel: true,
				run: [
					{ agent: "scout", task: "a" },
					{ agent: "researcher", task: "b" },
				],
			}),
		);
		assert.ok(plan);
		assert.equal(plan.query, true);
		assert.equal(plan.parallel, true);
		assert.deepEqual(plan.split, []);
		assert.equal(plan.run.length, 2);
	});
});

describe("resolveLookupPlan", () => {
	it("does not parallelize when split is missing", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: true,
				parallel: true,
				run: [
					{ agent: "scout", task: "a" },
					{ agent: "researcher", task: "b" },
				],
			}),
		);
		assert.ok(plan);
		const resolved = resolveLookupPlan(plan, LOOKUP_AGENTS);
		assert.equal(resolved.useParallel, false);
		assert.ok(resolved.errors.length > 0);
	});

	it("does not parallelize duplicate seeks", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: true,
				parallel: true,
				split: [
					{ id: "a", agent: "scout", seek: "Same Topic" },
					{ id: "b", agent: "researcher", seek: "same topic" },
				],
				run: [
					{ agent: "scout", task: "a", splitId: "a" },
					{ agent: "researcher", task: "b", splitId: "b" },
				],
			}),
		);
		assert.ok(plan);
		const resolved = resolveLookupPlan(plan, LOOKUP_AGENTS);
		assert.equal(resolved.useParallel, false);
		assert.ok(resolved.errors.some((item) => item.includes("duplicate seek")));
	});

	it("parallelizes valid scout + researcher splits", () => {
		const plan = parseDispatch(scoutResearcherJson);
		assert.ok(plan);
		const resolved = resolveLookupPlan(plan, LOOKUP_AGENTS);
		assert.equal(resolved.useParallel, true);
		assert.deepEqual(resolved.errors, []);
		assert.equal(resolved.runs[0].lane, "scout:repo-protocol");
		assert.equal(resolved.runs[1].lane, "researcher:web-docs");
		assert.match(resolved.runs[0].exclusiveTask, /Exclusive search contract/);
		assert.match(resolved.runs[0].exclusiveTask, /只查找: 当前仓库里的协议\/实现文件/);
		assert.match(resolved.runs[1].exclusiveTask, /不要查找: 当前仓库实现细节与行号/);
	});

	it("parallelizes two scouts with different seeks", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: true,
				parallel: true,
				split: [
					{ id: "core", agent: "scout", seek: "packages/agent" },
					{ id: "ext", agent: "scout", seek: "extensions/preloop-gate" },
				],
				run: [
					{ agent: "scout", task: "core", splitId: "core" },
					{ agent: "scout", task: "ext", splitId: "ext" },
				],
			}),
		);
		assert.ok(plan);
		const resolved = resolveLookupPlan(plan, LOOKUP_AGENTS);
		assert.equal(resolved.useParallel, true);
		assert.equal(resolved.runs[0].lane, "scout:core");
		assert.equal(resolved.runs[1].lane, "scout:ext");
	});

	it("strips planner from split and refuses parallel", () => {
		const plan = parseDispatch(
			JSON.stringify({
				query: true,
				parallel: true,
				split: [
					{ id: "a", agent: "scout", seek: "repo" },
					{ id: "b", agent: "planner", seek: "plan" },
				],
				run: [
					{ agent: "scout", task: "a", splitId: "a" },
					{ agent: "planner", task: "plan" },
				],
			}),
		);
		assert.ok(plan);
		const resolved = resolveLookupPlan(plan, LOOKUP_AGENTS);
		assert.equal(resolved.useParallel, false);
		assert.ok(resolved.split.every((item) => item.agent !== "planner"));
		assert.ok(resolved.errors.some((item) => item.includes("non-lookup")));
	});
});

describe("injectPriorBriefs", () => {
	it("replaces {previous} and otherwise appends structured prior results", () => {
		const prior = '{"lane":"scout:core","brief":"found files"}';
		assert.equal(injectPriorBriefs("use {previous}", [prior]), `use ${prior}`);
		assert.equal(injectPriorBriefs("first", []), "first");
		assert.match(injectPriorBriefs("next", [prior]), /已完成的查找结果/);
		assert.match(injectPriorBriefs("next", [prior]), /found files/);
	});
});

describe("exclusive contract and aggregated brief", () => {
	it("fills not from other seeks", () => {
		const text = applyExclusiveContract("task", { id: "a", agent: "scout", seek: "repo" }, [
			{ id: "b", agent: "researcher", seek: "docs" },
		]);
		assert.match(text, /只查找: repo/);
		assert.match(text, /不要查找: docs/);
	});

	it("formats aggregated data as JSON", () => {
		const text = formatAggregatedBrief({
			scheduler: "preflight",
			reason: "split lookups",
			query: true,
			parallel: true,
			parallelRequested: true,
			split: [{ id: "a", agent: "scout", seek: "repo" }],
			ran: ["scout:a"],
			results: [
				{
					lane: "scout:a",
					agent: "scout",
					splitId: "a",
					seek: "repo",
					exitCode: 0,
					brief: "files...",
				},
			],
			prior: [
				{
					lane: "researcher:docs",
					agent: "researcher",
					splitId: "docs",
					exitCode: 0,
					brief: "keep this evidence",
				},
			],
		});
		assert.match(text, /```json/);
		assert.match(text, /"lane": "scout:a"/);
		assert.match(text, /"split"/);
		assert.match(text, /evidence/);
		assert.match(text, /must not replace the lookup JSON/);
		assert.match(text, /Do not discard/);
		assert.match(text, /planner\.md/);
		assert.match(text, /continue in this session/);
		assert.match(text, /keep this evidence/);
		assert.match(text, /"prior"/);
		assert.match(text, /### Lookup evidence/);
		assert.doesNotMatch(text, /\[object Object\]/);
	});

	it("keeps lookup JSON when a plan is attached", () => {
		const text = formatAggregatedBrief({
			scheduler: "preflight",
			reason: "split lookups",
			query: true,
			parallel: true,
			parallelRequested: true,
			split: [{ id: "a", agent: "scout", seek: "repo" }],
			ran: ["scout:a", "planner"],
			results: [
				{
					lane: "scout:a",
					agent: "scout",
					splitId: "a",
					exitCode: 0,
					brief: "files must survive",
				},
			],
			prior: [],
			plan: "## Goal\nImplement the gate.\n",
		});
		assert.match(text, /### Lookup evidence/);
		assert.match(text, /files must survive/);
		assert.match(text, /### Plan/);
		assert.match(text, /Implement the gate/);
		assert.match(text, /continue in this session/);
		assert.ok(text.includes(currentSessionExecutionInstructions()));
		const lookupBlock = text.slice(text.indexOf("```json"), text.indexOf("### Plan"));
		assert.match(lookupBlock, /files must survive/);
		assert.doesNotMatch(lookupBlock, /Implement the gate/);
	});

	it("tells planner the parent session will execute", () => {
		const task = buildPlannerTask("fix the gate", {
			scheduler: "preflight",
			reason: "need a plan",
			query: true,
			parallel: false,
			parallelRequested: false,
			split: [],
			ran: ["scout:a"],
			results: [
				{
					lane: "scout:a",
					agent: "scout",
					exitCode: 0,
					brief: "files must survive",
				},
			],
			prior: [],
		});
		assert.match(task, /本会话里直接执行/);
		assert.match(task, /不要指定 worker \/ plan-executor/);
		assert.match(task, /files must survive/);
		assert.doesNotMatch(task, /The worker agent will execute/);
	});

	it("keeps prior lookup results when aggregating", () => {
		const prior = collectPriorResults([
			{
				results: [
					{ lane: "scout:old", agent: "scout", splitId: "old", exitCode: 0, brief: "old files" },
				],
				prior: [{ lane: "researcher:web", agent: "researcher", brief: "old docs" }],
			},
		]);
		assert.equal(prior.length, 2);
		assert.equal(prior[0].brief, "old files");
		assert.equal(prior[1].brief, "old docs");
	});

	it("drops planner from lookup runs", () => {
		const kept = filterLookupRuns([
			{ agent: "scout", task: "a" },
			{ agent: "planner", task: "plan" },
			{ agent: "researcher", task: "b" },
		]);
		assert.deepEqual(
			kept.map((item) => item.agent),
			["scout", "researcher"],
		);
	});
});
