export type ContextAssemblyStatus = "ready" | "partial" | "needs_input" | "failed";

export interface ContextSourceReference {
	path: string;
}

export interface ContextSelection {
	version: 1;
	status: ContextAssemblyStatus;
	role: ContextSourceReference | null;
	stack: ContextSourceReference[];
	businessKnowledge: ContextSourceReference[];
}

export type ContextSourceKind = "role" | "stack" | "businessKnowledge";

export interface MaterializedContextSource {
	id: string;
	path: string;
	content: string;
}

export interface ContextPackage {
	version: 1;
	status: ContextAssemblyStatus;
	request: {
		original: string;
	};
	role: MaterializedContextSource | null;
	stack: MaterializedContextSource[];
	businessKnowledge: MaterializedContextSource[];
	unknowns: string[];
	warnings: string[];
	durationMs: number;
}

export interface AssemblyRoots {
	projectRoot: string;
	actorRoot: string;
	globalStackRoot: string;
	projectStackRoot: string;
	projectKnowledgeRoot: string;
	projectConfigRoot: string;
	projectDocsRoot: string;
}

export interface MaterializeResult {
	role: MaterializedContextSource | null;
	stack: MaterializedContextSource[];
	businessKnowledge: MaterializedContextSource[];
	warnings: string[];
}

export type BuilderRunResult =
	| {
			kind: "success";
			selection: ContextSelection;
			requestTruncated: boolean;
		}
	| {
			kind: "failed";
			warning: string;
		}
	| {
			kind: "aborted";
		};
