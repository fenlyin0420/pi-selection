/**
 * /selection - turn the range currently selected in VS Code into a `[path:line-range]` reference.
 *
 * Reads the state file that the VS Code extension `ysd.active-context-mcp` keeps up to date
 * (`<tmpdir>/active-context-mcp/active-context.json`).
 *
 *   /selection           insert `[path:lines]` into the input editor
 *   /selection <prompt>  send it together with <prompt> right away
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE_FILE = path.join(os.tmpdir(), "active-context-mcp", "active-context.json");
const STALE_MS = 10 * 60 * 1000;

interface Position {
	line: number;
	character: number;
}

interface SelectionRange {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

interface EditorContext {
	schema?: string;
	workspace?: string;
	file: string;
	relativeFile?: string;
	cursor?: Position;
	activeLineText?: string;
	selection?: SelectionRange;
	updatedAt?: string;
}

interface Reference {
	ref: string;
	warnings: string[];
}

function isEditorContext(value: unknown): value is EditorContext {
	return typeof value === "object" && value !== null && typeof (value as { file?: unknown }).file === "string";
}

/** Read the state file the MCP server serves; undefined when VS Code has not published it. */
function readContext(): EditorContext | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(STATE_FILE, "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	// The server wraps the context as `{ type, context }`; older builds wrote it flat.
	const candidate =
		typeof parsed === "object" && parsed !== null && "context" in parsed
			? (parsed as { context?: unknown }).context
			: parsed;
	return isEditorContext(candidate) ? candidate : undefined;
}

/** Selection lines are already 1-based, matching the `read` tool's offset/limit. */
function resolveRange(context: EditorContext): { start: number; end: number; notes: string[] } {
	const selection = context.selection;
	const notes: string[] = [];
	if (!selection || (selection.startLine === selection.endLine && selection.startCharacter === selection.endCharacter)) {
		const line = context.cursor?.line ?? selection?.startLine ?? 1;
		notes.push("no selection: using the cursor line");
		return { start: line, end: line, notes };
	}
	let end = selection.endLine;
	// A selection ending at column 1 stopped at the start of the following line.
	if (selection.endCharacter === 1 && end > selection.startLine) end -= 1;
	return { start: selection.startLine, end, notes };
}

/** `[relative/path.ts:12-22]`, falling back to the absolute path outside the workspace. */
function buildReference(context: EditorContext, cwd: string): Reference {
	const warnings: string[] = [];
	const { start, end, notes } = resolveRange(context);
	warnings.push(...notes);

	const relative = path.relative(cwd, context.file);
	const shown = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : context.file;
	const range = start === end ? `${start}` : `${start}-${end}`;

	if (context.updatedAt) {
		const age = Date.now() - Date.parse(context.updatedAt);
		if (Number.isFinite(age) && age > STALE_MS) {
			warnings.push(`VS Code state is ${Math.round(age / 60000)} minutes old: it may not match the current selection`);
		}
	}

	// The extension reports the editor's own line text, so a mismatch means the buffer is ahead of disk
	// and the line numbers may have shifted.
	const cursorLine = context.cursor?.line;
	if (cursorLine && context.activeLineText) {
		try {
			const diskLine = fs.readFileSync(context.file, "utf8").split(/\r?\n/)[cursorLine - 1];
			if (diskLine !== undefined && diskLine.trimEnd() !== context.activeLineText.trimEnd()) {
				warnings.push("the editor has unsaved changes: line numbers may not match the file on disk");
			}
		} catch {
			// The file is gone or unreadable; the reference is still usable on its own.
		}
	}

	return { ref: `[${shown}:${range}]`, warnings };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("selection", {
		description: "Reference the range currently selected in VS Code as [path:lines]",
		handler: async (args, ctx) => {
			const context = readContext();
			if (!context) {
				ctx.ui.notify(
					"No VS Code selection state: check that VS Code is running with ysd.active-context-mcp enabled in this profile and that an editor is active",
					"error",
				);
				return;
			}

			const { ref, warnings } = buildReference(context, ctx.cwd);
			for (const warning of warnings) ctx.ui.notify(warning, "warning");

			const question = args.trim();
			if (question) {
				pi.sendUserMessage(`${ref}\n\n${question}`);
				return;
			}

			const existing = ctx.ui.getEditorText().replace(/\s+$/, "");
			const next = existing ? `${existing}\n\n${ref}` : ref;
			ctx.ui.setEditorText(`${next}\n`);
			ctx.ui.notify(`Attached ${ref}`, "info");
		},
	});
}
