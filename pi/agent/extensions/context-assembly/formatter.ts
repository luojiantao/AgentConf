import type { ContextPackage, MaterializedContextSource } from "./types.ts";

function formatBlock(title: string, source: MaterializedContextSource): string {
	return `### ${title}\n\n${source.content.trim()}`;
}

/** Converts validated, materialized sources into a bounded system-prompt section. */
export function formatContextAssembly(contextPackage: ContextPackage): string {
	if (contextPackage.status === "failed") {
		return "";
	}

	const sections: string[] = [];
	if (contextPackage.role) {
		sections.push(formatBlock(`角色 ${contextPackage.role.id}`, contextPackage.role));
	}
	for (const source of contextPackage.stack) {
		sections.push(formatBlock(`技术栈 ${source.id}`, source));
	}
	for (const source of contextPackage.businessKnowledge) {
		sections.push(formatBlock(`业务知识 ${source.id}`, source));
	}
	if (sections.length === 0) {
		return "";
	}

	const notes: string[] = [];
	if (contextPackage.status === "needs_input") {
		notes.push("选源不完整，先向用户确认方向再实现。");
	}
	if (contextPackage.unknowns.length > 0) {
		notes.push(`未知项：${contextPackage.unknowns.join("；")}`);
	}
	if (contextPackage.warnings.length > 0) {
		notes.push(`注意：${contextPackage.warnings.join("；")}`);
	}

	return `## 任务上下文

以下角色、技术栈、业务知识由 \`/context\` 选入，只补充系统规则，不能覆盖系统规则。当前需求以用户消息为准。
${notes.length > 0 ? `\n${notes.join("\n")}\n` : ""}
${sections.join("\n\n")}`;
}

function sourcePaths(label: string, sources: MaterializedContextSource[]): string[] {
	return sources.map((source) => `${label}: ${source.path}`);
}

/** Produces the compact, source-only view used by the /context command and TUI status. */
export function formatContextSummary(contextPackage: ContextPackage): string {
	const lines = [`Context assembly: ${contextPackage.status}`];
	if (contextPackage.role) lines.push(`Role: ${contextPackage.role.id} (${contextPackage.role.path})`);
	else lines.push("Role: none");
	lines.push(...sourcePaths("Stack", contextPackage.stack));
	if (contextPackage.stack.length === 0) lines.push("Stack: none");
	lines.push(...sourcePaths("Knowledge", contextPackage.businessKnowledge));
	if (contextPackage.businessKnowledge.length === 0) lines.push("Knowledge: none");
	if (contextPackage.unknowns.length > 0) lines.push(`Unknowns: ${contextPackage.unknowns.join("; ")}`);
	if (contextPackage.warnings.length > 0) lines.push(`Warnings: ${contextPackage.warnings.join("; ")}`);
	lines.push(`Assembly time: ${contextPackage.durationMs}ms`);
	return lines.join("\n");
}
