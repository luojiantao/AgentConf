/**
 * mouse-cursor — click to move the prompt caret, Ctrl+A to select all,
 * Backspace/Delete to clear the selection.
 *
 * Inside Herdr (HERDR_ENV=1), regular mode also owns drag-select so the
 * highlight can be white-on-black instead of Herdr's dark overlay.
 * Fullscreen selection uses the same contrast by patching TuiAltScreen.
 *
 * Auto-loaded from ~/.pi/agent/extensions/. Use /reload after editing.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type TUI,
} from "@earendil-works/pi-tui";

// mintty Readline mouse button 1: click-to-caret without taking over wheel events.
const ENABLE_READLINE_MOUSE = "\x1b[?2001h";
const DISABLE_READLINE_MOUSE = "\x1b[?2001l";
// xterm SGR drag reporting — Herdr forwards this into the pane and stops its own selection.
const ENABLE_SGR_MOUSE = "\x1b[?1002h\x1b[?1006h";
const DISABLE_SGR_MOUSE = "\x1b[?1002l\x1b[?1006l";
const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const CURSOR_MARKER = "\x1b_pi:c\x07";
const HIGHLIGHT_ON = "\x1b[47;30m";
const HIGHLIGHT_OFF = "\x1b[0m";
const INSIDE_HERDR = process.env.HERDR_ENV === "1";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const patchedTuis = new WeakSet<object>();

type EditorState = {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
};

type Cell = { row: number; col: number };

type ScreenSelection = {
	anchor: Cell;
	focus: Cell;
	dragging: boolean;
	pressing: boolean;
};

type InputListener = (data: string) => { consume?: boolean; data?: string } | undefined;

type TuiInternals = TUI & {
	previousLines?: string[];
	previousViewportTop?: number;
	applyLineResets?(lines: string[]): string[];
	applySelectionHighlight?(text: string): string;
};

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

function consumeEscape(text: string, pos: number): number {
	if (text.charCodeAt(pos) !== 0x1b) return pos + 1;
	const next = text[pos + 1];
	if (next === "[") {
		let i = pos + 2;
		while (i < text.length && text.charCodeAt(i) < 0x40) i += 1;
		return Math.min(i + 1, text.length);
	}
	if (next === "]") {
		const bel = text.indexOf("\x07", pos + 2);
		const st = text.indexOf("\x1b\\", pos + 2);
		if (bel < 0 && st < 0) return text.length;
		if (bel < 0) return st + 2;
		if (st < 0) return bel + 1;
		return Math.min(bel + 1, st + 2);
	}
	if (next === "_" || next === "P" || next === "^") {
		const bel = text.indexOf("\x07", pos + 2);
		const st = text.indexOf("\x1b\\", pos + 2);
		if (bel < 0 && st < 0) return text.length;
		if (bel < 0) return st + 2;
		if (st < 0) return bel + 1;
		return Math.min(bel + 1, st + 2);
	}
	return Math.min(pos + 2, text.length);
}

function applyHighContrastHighlight(text: string): string {
	let result = HIGHLIGHT_ON;
	let index = 0;
	while (index < text.length) {
		if (text.charCodeAt(index) === 0x1b) {
			const end = consumeEscape(text, index);
			const code = text.slice(index, end);
			result += code;
			if (code.endsWith("m")) result += HIGHLIGHT_ON;
			index = end;
			continue;
		}
		result += text[index];
		index += 1;
	}
	return `${result}${HIGHLIGHT_OFF}`;
}

function orderedCells(a: Cell, b: Cell): [Cell, Cell] {
	if (a.row < b.row || (a.row === b.row && a.col <= b.col)) return [a, b];
	return [b, a];
}

function paintSelection(lines: string[], selection: ScreenSelection | undefined): string[] {
	if (!selection?.dragging) return lines;
	const [start, end] = orderedCells(selection.anchor, selection.focus);
	if (start.row === end.row && start.col === end.col) return lines;
	return lines.map((line, row) => {
		if (row < start.row || row > end.row) return line;
		const width = visibleWidth(line);
		if (width <= 0) return line;
		const from = row === start.row ? Math.min(start.col, width - 1) : 0;
		const to = row === end.row ? Math.min(end.col, width - 1) : width - 1;
		if (to < from) return line;
		const before = sliceByColumn(line, 0, from, true);
		const selected = sliceByColumn(line, from, to - from + 1, true);
		const after = sliceByColumn(line, to + 1, Math.max(0, width - (to + 1)), true);
		return `${before}${applyHighContrastHighlight(selected)}${after}`;
	});
}

function extractSelectionText(lines: string[], selection: ScreenSelection): string {
	const [start, end] = orderedCells(selection.anchor, selection.focus);
	const out: string[] = [];
	for (let row = start.row; row <= end.row; row++) {
		const line = lines[row] ?? "";
		const width = visibleWidth(line);
		const from = row === start.row ? start.col : 0;
		const to = row === end.row ? end.col : Math.max(0, width - 1);
		out.push(stripTerminalSequences(sliceByColumn(line, from, Math.max(0, to - from + 1), true)));
	}
	return out.join("\n").replace(/[ \t]+$/gm, "");
}

function copyWithOsc52(tui: TUI, text: string): void {
	if (!text) return;
	const encoded = Buffer.from(text, "utf8").toString("base64");
	tui.terminal.write(`\x1b]52;c;${encoded}\x07`);
}

function patchFullscreenSelection(tui: TUI): void {
	if (tui.mode !== "fullscreen" || patchedTuis.has(tui)) return;
	const bag = tui as TuiInternals;
	if (typeof bag.applySelectionHighlight !== "function") return;
	bag.applySelectionHighlight = applyHighContrastHighlight;
	patchedTuis.add(tui);
}

function hookRegularSelectionPaint(tui: TUI, getSelection: () => ScreenSelection | undefined): void {
	if (tui.mode !== "regular" || patchedTuis.has(tui)) return;
	const proto = Object.getPrototypeOf(tui) as TuiInternals;
	if (typeof proto.applyLineResets !== "function") return;
	const orig = proto.applyLineResets;
	(tui as TuiInternals).applyLineResets = function patchedApplyLineResets(this: TUI, lines: string[]) {
		return paintSelection(orig.call(this, lines), getSelection());
	};
	patchedTuis.add(tui);
}

class MouseCursorEditor extends CustomEditor {
	private selectedAll = false;
	private mouseEnabled = false;
	private sgrMouseEnabled = false;
	private editorMouseActive = false;
	private screenSelection: ScreenSelection | undefined;
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
		if (this.sgrMouseEnabled) {
			this.tui.terminal.write(DISABLE_SGR_MOUSE);
			this.sgrMouseEnabled = false;
		}
		if (!this.mouseEnabled) return;
		if (this.tui.mode !== "fullscreen") this.tui.terminal.write(DISABLE_READLINE_MOUSE);
		this.mouseEnabled = false;
	}

	ensureMouse(): void {
		if (this.tui.mode === "fullscreen") {
			if (this.mouseEnabled) this.tui.terminal.write(DISABLE_READLINE_MOUSE);
			if (this.sgrMouseEnabled) this.tui.terminal.write(DISABLE_SGR_MOUSE);
			this.mouseEnabled = false;
			this.sgrMouseEnabled = false;
			patchFullscreenSelection(this.tui);
			return;
		}
		if (INSIDE_HERDR) {
			if (this.mouseEnabled) this.tui.terminal.write(DISABLE_READLINE_MOUSE);
			this.mouseEnabled = false;
			hookRegularSelectionPaint(this.tui, () => this.screenSelection);
			if (this.sgrMouseEnabled) return;
			this.tui.terminal.write(ENABLE_SGR_MOUSE);
			this.sgrMouseEnabled = true;
			return;
		}
		if (this.sgrMouseEnabled) this.tui.terminal.write(DISABLE_SGR_MOUSE);
		this.sgrMouseEnabled = false;
		if (this.mouseEnabled) return;
		this.tui.terminal.write(ENABLE_READLINE_MOUSE);
		this.mouseEnabled = true;
	}

	handleInput(data: string): void {
		if (this.handleMouseInput(data)) return;

		if (this.screenSelection && !this.screenSelection.pressing) {
			this.screenSelection = undefined;
			this.tui.requestRender();
		}

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
			lines[i] = applyHighContrastHighlight(lines[i]!);
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
		const wheel = (button & 64) !== 0;
		const primary = !wheel && (button & 3) === 0;

		if (this.tui.mode !== "fullscreen") {
			if (!INSIDE_HERDR) return false;
			return this.handleRegularHerdrMouse({ x, y, release, motion, wheel, primary });
		}

		// Let TuiAltScreen route fullscreen wheel events to its ScrollView.
		if (wheel) return false;

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

	private handleRegularHerdrMouse(event: {
		x: number;
		y: number;
		release: boolean;
		motion: boolean;
		wheel: boolean;
		primary: boolean;
	}): boolean {
		if (event.wheel) return true;
		if (!event.primary && !event.release) return false;

		const cell = this.screenCell(event.x, event.y);
		if (event.release) {
			const selection = this.screenSelection;
			this.editorMouseActive = false;
			if (!selection?.pressing) return Boolean(selection);
			selection.pressing = false;
			if (!selection.dragging) {
				this.screenSelection = undefined;
				if (this.isClickInEditor(event.x, event.y)) this.moveCaretToScreen(event.x, event.y);
				this.tui.requestRender();
				return true;
			}
			const lines = (this.tui as TuiInternals).previousLines ?? [];
			copyWithOsc52(this.tui, extractSelectionText(lines, selection));
			this.tui.requestRender();
			return true;
		}

		if (event.motion || this.screenSelection?.pressing) {
			if (!this.screenSelection?.pressing) return false;
			this.screenSelection.focus = cell;
			if (cell.row !== this.screenSelection.anchor.row || cell.col !== this.screenSelection.anchor.col) {
				this.screenSelection.dragging = true;
			}
			this.tui.requestRender();
			return true;
		}

		this.selectedAll = false;
		this.screenSelection = { anchor: cell, focus: cell, dragging: false, pressing: true };
		if (this.isClickInEditor(event.x, event.y)) {
			this.editorMouseActive = true;
			this.moveCaretToScreen(event.x, event.y);
		}
		this.tui.requestRender();
		return true;
	}

	private screenCell(screenX: number, screenY: number): Cell {
		const bag = this.tui as TuiInternals;
		const top = bag.previousViewportTop ?? 0;
		const lines = bag.previousLines ?? [];
		const row = Math.max(0, Math.min(top + screenY, Math.max(0, lines.length - 1)));
		const width = visibleWidth(lines[row] ?? "");
		const col = Math.max(0, Math.min(screenX, Math.max(0, width - 1)));
		return { row, col };
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
