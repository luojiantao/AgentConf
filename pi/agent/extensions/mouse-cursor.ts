/**
 * mouse-cursor — click to move the prompt caret, Ctrl+A to select all,
 * Backspace/Delete to clear the selection.
 *
 * Auto-loaded from ~/.pi/agent/extensions/. Use /reload after editing.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";
const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const CURSOR_MARKER = "\x1b_pi:c\x07";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type EditorState = {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
};

type InputListener = (data: string) => { consume?: boolean; data?: string } | undefined;

function editorState(editor: object): EditorState | undefined {
	const state = (editor as { state?: EditorState }).state;
	if (!state || !Array.isArray(state.lines)) return undefined;
	if (typeof state.cursorLine !== "number" || typeof state.cursorCol !== "number") return undefined;
	return state;
}

function normalizeLine(line: string): string {
	return stripTerminalSequences(line.replaceAll(CURSOR_MARKER, "")).replace(/[ \t]+$/g, "");
}

function colFromVisual(line: string, visualX: number): number {
	if (visualX <= 0) return 0;
	let visual = 0;
	let col = 0;
	for (const { segment } of graphemeSegmenter.segment(line)) {
		const width = visibleWidth(segment);
		if (visual + width / 2 >= visualX) return col;
		visual += width;
		col += segment.length;
	}
	return line.length;
}

function wrapLogicalLine(line: string, layoutWidth: number): Array<{ start: number; text: string }> {
	if (layoutWidth <= 0) return [{ start: 0, text: line }];
	if (visibleWidth(line) <= layoutWidth) return [{ start: 0, text: line }];
	const chunks: Array<{ start: number; text: string }> = [];
	let start = 0;
	let text = "";
	let width = 0;
	for (const { segment, index } of graphemeSegmenter.segment(line)) {
		const segWidth = visibleWidth(segment);
		if (text.length > 0 && width + segWidth > layoutWidth) {
			chunks.push({ start, text });
			start = index;
			text = "";
			width = 0;
		}
		text += segment;
		width += segWidth;
	}
	chunks.push({ start, text });
	return chunks;
}

function prependInputListener(tui: TUI, listener: InputListener): () => void {
	const bag = tui as unknown as { inputListeners?: Set<InputListener> };
	const set = bag.inputListeners;
	if (!set || typeof set.add !== "function") {
		return tui.addInputListener(listener);
	}
	const rest = [...set];
	set.clear();
	set.add(listener);
	for (const item of rest) set.add(item);
	return () => {
		set.delete(listener);
	};
}

function findEditorTop(tui: TUI, editorLines: string[], state: EditorState | undefined): number | undefined {
	if (editorLines.length === 0) return undefined;
	const needle = editorLines.map(normalizeLine);
	const rec = tui as unknown as {
		previousScreen?: string[];
		previousLines?: string[];
		previousViewportTop?: number;
		hardwareCursorRow?: number;
	};

	const tryFind = (haystack: string[] | undefined, screenOffset: number): number | undefined => {
		if (!haystack || haystack.length < needle.length) return undefined;
		const hay = haystack.map(normalizeLine);
		for (let i = hay.length - needle.length; i >= 0; i--) {
			let ok = true;
			for (let j = 0; j < needle.length; j++) {
				if (hay[i + j] !== needle[j]) {
					ok = false;
					break;
				}
			}
			if (ok) return i - screenOffset;
		}
		return undefined;
	};

	const fromAlt = tryFind(rec.previousScreen, 0);
	if (fromAlt !== undefined) return fromAlt;
	const fromMain = tryFind(rec.previousLines, rec.previousViewportTop ?? 0);
	if (fromMain !== undefined) return fromMain;

	if (typeof rec.hardwareCursorRow === "number") {
		const viewportTop = rec.previousViewportTop ?? 0;
		const caretScreen = rec.hardwareCursorRow - viewportTop;
		const contentRowsBeforeCaret = visualRowOfCaret(state, Math.max(1, tui.terminal.columns - 1));
		return caretScreen - (1 + contentRowsBeforeCaret);
	}

	return Math.max(0, tui.terminal.rows - editorLines.length);
}

function visualRowOfCaret(state: EditorState | undefined, layoutWidth: number): number {
	if (!state) return 0;
	let row = 0;
	for (let line = 0; line < state.cursorLine; line++) {
		row += wrapLogicalLine(state.lines[line] || "", layoutWidth).length;
	}
	const chunks = wrapLogicalLine(state.lines[state.cursorLine] || "", layoutWidth);
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]!;
		const end = chunk.start + chunk.text.length;
		if (state.cursorCol <= end || i === chunks.length - 1) return row + i;
	}
	return row;
}

class MouseCursorEditor extends CustomEditor {
	private selectedAll = false;
	private mouseEnabled = false;
	private editorMouseActive = false;
	private unhookInput: (() => void) | undefined;

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		this.unhookInput = prependInputListener(this.tui, (data) => {
			if (this.handleMouseInput(data)) return { consume: true };
			return undefined;
		});
		this.ensureMouse();
	}

	disposeMouse(): void {
		this.unhookInput?.();
		this.unhookInput = undefined;
		if (!this.mouseEnabled) return;
		if (this.tui.mode !== "fullscreen") this.tui.terminal.write(DISABLE_MOUSE);
		this.mouseEnabled = false;
	}

	ensureMouse(): void {
		if (this.tui.mode === "fullscreen") return;
		this.tui.terminal.write(ENABLE_MOUSE);
		this.mouseEnabled = true;
	}

	handleInput(data: string): void {
		if (this.handleMouseInput(data)) return;

		if (matchesKey(data, "ctrl+a")) {
			this.selectedAll = this.getText().length > 0;
			const state = editorState(this);
			if (state) {
				state.cursorLine = state.lines.length - 1;
				state.cursorCol = (state.lines[state.cursorLine] || "").length;
			}
			this.tui.requestRender();
			return;
		}

		if (
			this.selectedAll &&
			(matchesKey(data, "backspace") || matchesKey(data, "delete") || matchesKey(data, "shift+backspace"))
		) {
			this.selectedAll = false;
			this.setText("");
			return;
		}

		if (this.selectedAll) {
			this.selectedAll = false;
			const printable = data.length > 0 && data.charCodeAt(0) >= 32 && !data.startsWith("\x1b");
			if (printable) this.setText("");
			super.handleInput(data);
			return;
		}

		super.handleInput(data);
	}

	render(width: number): string[] {
		this.ensureMouse();
		const lines = super.render(width);
		if (!this.selectedAll || lines.length < 3) return lines;
		for (let i = 1; i < lines.length - 1; i++) {
			lines[i] = `\x1b[7m${lines[i]}\x1b[0m`;
		}
		const label = " ALL ";
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= label.length) {
			lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
		}
		return lines;
	}

	private handleMouseInput(data: string): boolean {
		const match = SGR_MOUSE.exec(data);
		if (!match) return false;

		const button = Number.parseInt(match[1], 10);
		const x = Number.parseInt(match[2], 10) - 1;
		const y = Number.parseInt(match[3], 10) - 1;
		const release = match[4] === "m";
		const motion = (button & 32) !== 0;
		const primary = (button & 3) === 0;

		if (release) {
			const active = this.editorMouseActive;
			this.editorMouseActive = false;
			return active;
		}
		if (!primary) return false;

		if (motion) {
			if (!this.editorMouseActive) return false;
			this.moveCaretToScreen(x, y);
			return true;
		}

		if (!this.isClickInEditor(x, y)) return false;
		this.editorMouseActive = true;
		this.moveCaretToScreen(x, y);
		return true;
	}

	private editorGeometry(): { top: number; height: number; lines: string[] } | undefined {
		const cols = this.tui.terminal.columns;
		const lines = super.render(cols);
		if (lines.length === 0) return undefined;
		const top = findEditorTop(this.tui, lines, editorState(this));
		if (top === undefined) return undefined;
		return { top, height: lines.length, lines };
	}

	private isClickInEditor(_x: number, y: number): boolean {
		const box = this.editorGeometry();
		if (!box) return false;
		return y >= box.top && y < box.top + box.height;
	}

	private moveCaretToScreen(screenX: number, screenY: number): void {
		const box = this.editorGeometry();
		if (!box) return;
		const localY = screenY - box.top;
		const contentY = localY - 1;
		if (contentY < 0 || contentY >= box.height - 2) return;

		const cols = this.tui.terminal.columns;
		const layoutWidth = Math.max(1, cols - 1);
		const visual: Array<{ line: number; start: number; text: string }> = [];
		for (const [line, text] of this.getLines().entries()) {
			for (const chunk of wrapLogicalLine(text, layoutWidth)) {
				visual.push({ line, start: chunk.start, text: chunk.text });
			}
		}
		if (visual.length === 0) visual.push({ line: 0, start: 0, text: "" });

		const row = visual[Math.max(0, Math.min(visual.length - 1, contentY))]!;
		const col = row.start + colFromVisual(row.text, screenX);
		this.selectedAll = false;
		const state = editorState(this);
		if (!state) return;
		const lineText = state.lines[row.line] || "";
		state.cursorLine = row.line;
		state.cursorCol = Math.max(0, Math.min(col, lineText.length));
		this.tui.requestRender();
	}
}

export default function (pi: ExtensionAPI) {
	let editor: MouseCursorEditor | undefined;

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			editor?.disposeMouse();
			editor = new MouseCursorEditor(tui, theme, keybindings);
			return editor;
		});
		queueMicrotask(() => editor?.ensureMouse());
	});

	pi.on("session_shutdown", () => {
		editor?.disposeMouse();
		editor = undefined;
	});
}
