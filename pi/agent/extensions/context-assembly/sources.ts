import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
	AssemblyRoots,
	ContextSelection,
	ContextSourceKind,
	ContextSourceReference,
	MaterializeResult,
	MaterializedContextSource,
} from "./types.ts";

export const MAX_CONTEXT_FILE_BYTES = 32 * 1024;
export const MAX_CONTEXT_TOTAL_BYTES = 96 * 1024;
export const MAX_STACK_FILES = 4;
export const MAX_BUSINESS_KNOWLEDGE_FILES = 6;

const TECHNICAL_FACT_FILENAMES = new Set([
	"package.json",
	"tsconfig.json",
	"tsconfig.build.json",
	"tsconfig.test.json",
	"pom.xml",
	"build.gradle",
	"build.gradle.kts",
	"settings.gradle",
	"settings.gradle.kts",
	"go.mod",
	"pyproject.toml",
	"requirements.txt",
	"cargo.toml",
]);

const SENSITIVE_FILENAMES = new Set([
	"auth.json",
	"credentials.json",
	"credentials",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	"models.json",
	"npmrc",
	".npmrc",
	"known_hosts",
]);

const BLOCKED_PROJECT_SEGMENTS = new Set([".git", ".hg", ".svn", ".ssh", "node_modules", "sessions"]);

function pathExists(candidate: string): boolean {
	try {
		fs.lstatSync(candidate);
		return true;
	} catch {
		return false;
	}
}

function isDirectory(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/** Finds the enclosing Git root when available, with .pi and package roots as fallbacks. */
export function findProjectRoot(cwd: string, configDirName: string): string {
	let current = path.resolve(cwd);
	let configRoot: string | undefined;
	let packageRoot: string | undefined;

	while (true) {
		if (pathExists(path.join(current, ".git"))) return current;
		if (!configRoot && isDirectory(path.join(current, configDirName))) configRoot = current;
		if (!packageRoot && pathExists(path.join(current, "package.json"))) packageRoot = current;

		const parent = path.dirname(current);
		if (parent === current) return configRoot ?? packageRoot ?? path.resolve(cwd);
		current = parent;
	}
}

export function getAssemblyRoots(cwd: string, agentDir: string, configDirName: string): AssemblyRoots {
	const projectRoot = findProjectRoot(cwd, configDirName);
	const projectConfigRoot = path.join(projectRoot, configDirName);
	return {
		projectRoot,
		actorRoot: path.join(agentDir, "Actor"),
		globalStackRoot: path.join(agentDir, "Stack"),
		projectStackRoot: path.join(projectConfigRoot, "Stack"),
		projectKnowledgeRoot: path.join(projectConfigRoot, "knowledge"),
		projectConfigRoot,
		projectDocsRoot: path.join(projectRoot, "docs"),
	};
}

function isInside(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSamePath(left: string, right: string): boolean {
	return path.relative(left, right) === "" && path.relative(right, left) === "";
}

function isSensitivePath(filePath: string): boolean {
	const basename = path.basename(filePath).toLowerCase();
	if (basename.startsWith(".env")) return true;
	if (SENSITIVE_FILENAMES.has(basename)) return true;
	return basename.endsWith(".pem") || basename.endsWith(".key") || basename.endsWith(".pfx") || basename.endsWith(".p12");
}

function hasBlockedProjectSegment(filePath: string, projectRoot: string): boolean {
	const relative = path.relative(projectRoot, filePath);
	return relative.split(path.sep).some((segment) => BLOCKED_PROJECT_SEGMENTS.has(segment.toLowerCase()));
}

function isResourceTemplate(filePath: string): boolean {
	const basename = path.basename(filePath).toLowerCase();
	return basename === "readme.md" || basename === "_template.md";
}

function isRootMarkdownDocument(filePath: string, projectRoot: string): boolean {
	return isSamePath(path.dirname(filePath), projectRoot) && [".md", ".mdx", ".txt"].includes(path.extname(filePath).toLowerCase());
}

function isProjectConfigFile(filePath: string, projectRoot: string): boolean {
	if (!isInside(filePath, projectRoot) || hasBlockedProjectSegment(filePath, projectRoot)) return false;
	return TECHNICAL_FACT_FILENAMES.has(path.basename(filePath).toLowerCase());
}

async function resolveDirectory(candidate: string): Promise<string | undefined> {
	try {
		const realPath = await fsp.realpath(candidate);
		return (await fsp.stat(realPath)).isDirectory() ? realPath : undefined;
	} catch {
		return undefined;
	}
}

async function resolveFile(candidate: string): Promise<string | undefined> {
	try {
		if (!path.isAbsolute(candidate)) return undefined;
		const realPath = await fsp.realpath(candidate);
		return (await fsp.stat(realPath)).isFile() ? realPath : undefined;
	} catch {
		return undefined;
	}
}

interface CanonicalRoots {
	projectRoot?: string;
	actorRoot?: string;
	globalStackRoot?: string;
	projectStackRoot?: string;
	projectKnowledgeRoot?: string;
	projectConfigRoot?: string;
	projectDocsRoot?: string;
}

async function canonicalizeRoots(roots: AssemblyRoots): Promise<CanonicalRoots> {
	const [projectRoot, actorRoot, globalStackRoot, projectStackRoot, projectKnowledgeRoot, projectConfigRoot, projectDocsRoot] =
		await Promise.all([
			resolveDirectory(roots.projectRoot),
			resolveDirectory(roots.actorRoot),
			resolveDirectory(roots.globalStackRoot),
			resolveDirectory(roots.projectStackRoot),
			resolveDirectory(roots.projectKnowledgeRoot),
			resolveDirectory(roots.projectConfigRoot),
			resolveDirectory(roots.projectDocsRoot),
		]);
	return {
		projectRoot,
		actorRoot,
		globalStackRoot,
		projectStackRoot,
		projectKnowledgeRoot,
		projectConfigRoot,
		projectDocsRoot,
	};
}

function isAllowedSource(filePath: string, kind: ContextSourceKind, roots: CanonicalRoots): boolean {
	if (isSensitivePath(filePath)) return false;

	if (kind === "role") {
		return Boolean(roots.actorRoot && isInside(filePath, roots.actorRoot) && !isResourceTemplate(filePath));
	}

	if (kind === "stack") {
		const isGlobalStackFile = Boolean(roots.globalStackRoot && isInside(filePath, roots.globalStackRoot));
		const isProjectStackFile = Boolean(
			roots.projectRoot &&
			roots.projectStackRoot &&
			isInside(roots.projectStackRoot, roots.projectRoot) &&
			isInside(filePath, roots.projectStackRoot),
		);
		if (isGlobalStackFile || isProjectStackFile) return !isResourceTemplate(filePath);
		return Boolean(roots.projectRoot && isProjectConfigFile(filePath, roots.projectRoot));
	}

	if (!roots.projectRoot || !isInside(filePath, roots.projectRoot) || hasBlockedProjectSegment(filePath, roots.projectRoot)) {
		return false;
	}
	if (
		roots.projectKnowledgeRoot &&
		isInside(roots.projectKnowledgeRoot, roots.projectRoot) &&
		isInside(filePath, roots.projectKnowledgeRoot)
	) {
		return true;
	}
	if (
		roots.projectDocsRoot &&
		isInside(roots.projectDocsRoot, roots.projectRoot) &&
		isInside(filePath, roots.projectDocsRoot)
	) {
		return true;
	}

	const projectAgentInstructions =
		roots.projectConfigRoot && isInside(roots.projectConfigRoot, roots.projectRoot)
			? path.join(roots.projectConfigRoot, "AGENTS.md")
			: undefined;
	if (projectAgentInstructions && isSamePath(filePath, projectAgentInstructions)) return true;

	const filename = path.basename(filePath).toLowerCase();
	if (filename === "agents.md" || filename === "agents.override.md" || filename === "claude.md") return false;
	return isRootMarkdownDocument(filePath, roots.projectRoot);
}

function formatId(filePath: string): string {
	return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "source";
}

interface MaterializeState {
	roots: CanonicalRoots;
	bytes: number;
	seen: Set<string>;
	warnings: string[];
}

async function materializeReference(
	reference: ContextSourceReference,
	kind: ContextSourceKind,
	state: MaterializeState,
): Promise<MaterializedContextSource | null> {
	const filePath = await resolveFile(reference.path);
	if (!filePath || !isAllowedSource(filePath, kind, state.roots)) {
		state.warnings.push(`Rejected a ${kind} candidate outside the allowed source boundaries.`);
		return null;
	}
	if (state.seen.has(filePath)) return null;

	let content: Buffer;
	try {
		const stats = await fsp.stat(filePath);
		if (stats.size > MAX_CONTEXT_FILE_BYTES) {
			state.warnings.push(`Skipped a ${kind} source because it exceeds the per-file size limit.`);
			return null;
		}
		content = await fsp.readFile(filePath);
	} catch {
		state.warnings.push(`Could not read a selected ${kind} source.`);
		return null;
	}

	if (content.length > MAX_CONTEXT_FILE_BYTES) {
		state.warnings.push(`Skipped a ${kind} source because it exceeds the per-file size limit.`);
		return null;
	}
	if (content.includes(0)) {
		state.warnings.push(`Skipped a non-text ${kind} source.`);
		return null;
	}
	if (state.bytes + content.length > MAX_CONTEXT_TOTAL_BYTES) {
		state.warnings.push("Skipped a selected source because the context package reached its total size limit.");
		return null;
	}

	state.seen.add(filePath);
	state.bytes += content.length;
	// The child can read broadly even though its output paths are constrained.
	// Do not propagate its arbitrary IDs or rationale into the parent prompt.
	return {
		id: formatId(filePath),
		path: filePath,
		content: content.toString("utf8"),
	};
}

async function materializeMany(
	references: ContextSourceReference[],
	kind: "stack" | "businessKnowledge",
	maxCount: number,
	state: MaterializeState,
): Promise<MaterializedContextSource[]> {
	const sources: MaterializedContextSource[] = [];
	if (references.length > maxCount) {
		state.warnings.push(`Ignored ${references.length - maxCount} excess ${kind} source candidates.`);
	}
	for (const reference of references.slice(0, maxCount)) {
		const source = await materializeReference(reference, kind, state);
		if (source) sources.push(source);
	}
	return sources;
}

/** Re-reads only source paths that pass the extension's directory and sensitive-file checks. */
export async function materializeSelection(selection: ContextSelection, roots: AssemblyRoots): Promise<MaterializeResult> {
	const state: MaterializeState = {
		roots: await canonicalizeRoots(roots),
		bytes: 0,
		seen: new Set<string>(),
		warnings: [],
	};

	const role = selection.role ? await materializeReference(selection.role, "role", state) : null;
	const stack = await materializeMany(selection.stack, "stack", MAX_STACK_FILES, state);
	const businessKnowledge = await materializeMany(
		selection.businessKnowledge,
		"businessKnowledge",
		MAX_BUSINESS_KNOWLEDGE_FILES,
		state,
	);

	return { role, stack, businessKnowledge, warnings: state.warnings };
}
