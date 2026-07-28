import {
  MAX_COURSE_DIAGNOSTICS,
  MAX_COURSE_JSON_BYTES,
} from "./schema.ts";
import { validateCourse } from "./validation.ts";
import type { CourseDiagnostic, CourseValidationResult } from "./types.ts";

class DuplicateScanner {
  private offset = 0;
  readonly duplicates: CourseDiagnostic[] = [];

  constructor(private readonly text: string) {}

  scan(): void {
    this.skip();
    this.value("$");
    this.skip();
    if (this.offset !== this.text.length) throw new SyntaxError("Trailing JSON content");
  }

  private skip(): void { while (/\s/u.test(this.text[this.offset] ?? "")) this.offset += 1; }
  private value(path: string): void {
    this.skip();
    const c = this.text[this.offset];
    if (c === "{") this.object(path);
    else if (c === "[") this.array(path);
    else if (c === '"') { this.string(); }
    else {
      const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(this.text.slice(this.offset));
      if (match === null) throw new SyntaxError("Invalid JSON value");
      this.offset += match[0].length;
    }
  }
  private string(): string {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    while (this.offset < this.text.length) {
      const c = this.text[this.offset++];
      if (!escaped && c === '"') return JSON.parse(this.text.slice(start, this.offset)) as string;
      if (!escaped && c === "\\") escaped = true;
      else escaped = false;
    }
    throw new SyntaxError("Unterminated JSON string");
  }
  private object(path: string): void {
    this.offset += 1; this.skip();
    const keys = new Set<string>();
    if (this.text[this.offset] === "}") { this.offset += 1; return; }
    while (true) {
      if (this.text[this.offset] !== '"') throw new SyntaxError("Expected object key");
      const key = this.string(); this.skip();
      if (this.text[this.offset++] !== ":") throw new SyntaxError("Expected colon");
      const keyPath = /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      if (keys.has(key) && this.duplicates.length < MAX_COURSE_DIAGNOSTICS) {
        this.duplicates.push({ path: keyPath, code: "duplicate-key", message: `Duplicate object member at ${keyPath}.` });
      }
      keys.add(key); this.value(keyPath); this.skip();
      const separator = this.text[this.offset++];
      if (separator === "}") return;
      if (separator !== ",") throw new SyntaxError("Expected comma");
      this.skip();
    }
  }
  private array(path: string): void {
    this.offset += 1; this.skip();
    if (this.text[this.offset] === "]") { this.offset += 1; return; }
    let index = 0;
    while (true) {
      this.value(`${path}[${index}]`); index += 1; this.skip();
      const separator = this.text[this.offset++];
      if (separator === "]") return;
      if (separator !== ",") throw new SyntaxError("Expected comma");
      this.skip();
    }
  }
}

/** Duplicate-aware boundary for built-in and external raw JSON bytes. */
export function parseCourseJson(raw: string | Uint8Array): CourseValidationResult {
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (bytes > MAX_COURSE_JSON_BYTES) return { ok: false, warnings: [], errors: [{
    path: "$", code: "input-too-large", message: `Course JSON exceeds ${MAX_COURSE_JSON_BYTES} bytes.`,
  }] };
  const text = typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
  try {
    const scanner = new DuplicateScanner(text);
    scanner.scan();
    if (scanner.duplicates.length > 0) return { ok: false, warnings: [], errors: scanner.duplicates };
    return validateCourse(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, warnings: [], errors: [{ path: "$", code: "invalid-object", message: "Malformed Course JSON." }] };
  }
}
