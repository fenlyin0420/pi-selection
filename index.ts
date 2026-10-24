/**
 * /selection - attach the code currently selected in VS Code to the prompt.
 *
 * Reads the state file that the VS Code extension `ysd.active-context-mcp` keeps up to date
 * (`<tmpdir>/active-context-mcp/active-context.json`).
 *
 *   /selection           insert `path:lines` plus the selected code into the input editor
 *   /selection <prompt>  send it together with <prompt> right away
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE_FILE = path.join(os.tmpdir(), "active-context-mcp", "active-context.json");
const STALE_MS = 10 * 60 * 1000;
const MAX_LINES = 400;
const MAX_CHARS = 24_000;

const LANGUAGES: Record<string, string> = {
	bash: "bash",
	c: "c",
	cc: "cpp",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	dart: "dart",
	go: "go",
	h: "c",
	hpp: "cpp",
	html: "html",
	java: "java",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	kt: "kotlin",
	lua: "lua",
	md: "markdown",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	scss: "scss",
	sh: "bash",
	sql: "sql",
	swift: "swift",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	vue: "vue",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zsh: "bash",
};

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

interface Attachment {
	block: string;
	label: string;
	warnings: string[];
}

/** Read the state file the MCP server serves; undefined when VS Code has not published it. */
function readContext(): EditorContext | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(STATE_FILE, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as { type?: string; context?: EditorContext };
		const context = parsed.context ?? (parsed as unknown as EditorContext);
		return context?.file ? context : undefined;
	} catch {
		return undefined;
	}
}

/** Selection lines are already 1-based in the state file. */
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

function buildAttachment(context: EditorContext, cwd: string): Attachment {
	const warnings: string[] = [];
	const { start, end, notes } = resolveRange(context);
	warnings.push(...notes);

	let content: string;
	try {
		content = fs.readFileSync(context.file, "utf8");
	} catch (error) {
		throw new Error(`cannot read ${context.file}: ${error instanceof Error ? error.message : String(error)}`);
	}

	// Normalize CRLF so line numbers match and nothing carries stray carriage returns into the fence.
	const lines = content.split(/\r?\n/);
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	const lastLine = Math.max(start, Math.min(end, start + MAX_LINES - 1, lines.length));
	const truncatedByRange = Math.max(0, Math.min(end, lines.length) - lastLine);
	let slice = lines.slice(start - 1, lastLine).join("\n");
	if (slice.length > MAX_CHARS) {
		slice = slice.slice(0, MAX_CHARS);
		warnings.push(`content exceeds ${MAX_CHARS} characters: truncated, read the file when you need the rest`);
	}
	if (truncatedByRange > 0) {
		warnings.push(`selection exceeds ${MAX_LINES} lines: only the first ${MAX_LINES} were attached`);
	}

	const shownRange = start === lastLine ? `${start}` : `${start}-${lastLine}`;
	const relative = path.relative(cwd, context.file);
	const shown = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : context.file;
	const language = LANGUAGES[path.extname(context.file).slice(1).toLowerCase()] ?? "";

	if (context.updatedAt) {
		const age = Date.now() - Date.parse(context.updatedAt);
		if (Number.isFinite(age) && age > STALE_MS) {
			warnings.push(`VS Code state is ${Math.round(age / 60000)} minutes old: it may not match the current selection`);
		}
	}

	// The extension reports the editor's own line text, so a mismatch means unsaved changes.
	const cursorLine = context.cursor?.line;
	if (cursorLine && context.activeLineText !== undefined && context.activeLineText !== null) {
		const diskLine = lines[cursorLine - 1];
		if (diskLine !== undefined && diskLine.trimEnd() !== context.activeLineText.trimEnd()) {
			warnings.push("the editor has unsaved changes: attached content comes from disk");
		}
	}

	const block = `[selection] ${shown}:${shownRange} — content inlined, no need to read this range\n\`\`\`${language}\n${slice}\n\`\`\``;
	return { block, label: `${shown}:${shownRange}`, warnings };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("selection", {
		description: "Attach the code currently selected in VS Code to the prompt",
		handler: async (args, ctx) => {
			const context = readContext();
			if (!context) {
				ctx.ui.notify(
					"No VS Code selection state: check that VS Code is running with ysd.active-context-mcp enabled in this profile and that an editor is active",
					"error",
				);
				return;
			}

			let attachment: Attachment;
			try {
				attachment = buildAttachment(context, ctx.cwd);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			for (const warning of attachment.warnings) ctx.ui.notify(warning, "warning");

			const question = args.trim();
			if (question) {
				pi.sendUserMessage(`${attachment.block}\n\n${question}`);
				return;
			}

			const existing = ctx.ui.getEditorText().replace(/\s+$/, "");
			const next = existing ? `${existing}\n\n${attachment.block}` : attachment.block;
			ctx.ui.setEditorText(`${next}\n`);
			ctx.ui.notify(`Attached ${attachment.label}`, "info");
		},
	});
}
