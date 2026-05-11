/**
 * SQL utilities for V0. These use regex heuristics tuned for migration files
 * (one DDL statement per logical block). In V1 we replace with libpg-query AST.
 */

export interface SqlStatement {
  text: string;
  /** 1-based line offset relative to the start of the input. */
  startLine: number;
}

const LINE_COMMENT = /--[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];

  let segmentStart = 0;
  let segmentStartLine = 1;
  let line = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarQuoteTag: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] ?? "";
    const next = sql[i + 1] ?? "";

    if (ch === "\n") {
      line++;
      if (inLineComment) inLineComment = false;
      continue;
    }

    if (inLineComment) continue;

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, i)) {
        i += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }
      continue;
    }

    if (inSingleQuote) {
      if (ch === "'" && next === "'") {
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"' && next === '"') {
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (ch === "$") {
      const tag = readDollarQuoteTag(sql, i);
      if (tag) {
        dollarQuoteTag = tag;
        i += tag.length - 1;
        continue;
      }
    }

    if (ch === ";") {
      pushStatement(sql.slice(segmentStart, i), segmentStartLine, out);
      segmentStart = i + 1;
      segmentStartLine = line;
    }
  }

  pushStatement(sql.slice(segmentStart), segmentStartLine, out);
  return out;
}

function pushStatement(
  raw: string,
  segmentStartLine: number,
  out: SqlStatement[],
): void {
  const stripped = stripComments(raw);
  const leadingWhitespace = stripped.match(/^\s*/)?.[0] ?? "";
  const text = stripped.trim();
  if (text.length === 0) return;
  out.push({
    text,
    startLine: segmentStartLine + countNewlines(leadingWhitespace),
  });
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function readDollarQuoteTag(text: string, pos: number): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(pos));
  return match?.[0] ?? null;
}

/** Strip comments before pattern matching. */
export function stripComments(sql: string): string {
  return sql
    .replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(LINE_COMMENT, " ");
}

/**
 * Parse a single identifier token starting at `pos`. Supports:
 *   - "double quoted"
 *   - [bracket quoted]
 *   - `backtick quoted`
 *   - unquoted_ident
 * Returns the identifier and the new cursor position (after the ident).
 */
function readIdent(
  text: string,
  pos: number,
): { ident: string; next: number } | null {
  let i = pos;
  // skip whitespace
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  if (i >= text.length) return null;

  const ch = text[i];
  if (ch === '"') {
    const end = text.indexOf('"', i + 1);
    if (end === -1) return null;
    return { ident: text.slice(i + 1, end), next: end + 1 };
  }
  if (ch === "[") {
    const end = text.indexOf("]", i + 1);
    if (end === -1) return null;
    return { ident: text.slice(i + 1, end), next: end + 1 };
  }
  if (ch === "`") {
    const end = text.indexOf("`", i + 1);
    if (end === -1) return null;
    return { ident: text.slice(i + 1, end), next: end + 1 };
  }
  const match = /^[a-zA-Z_][a-zA-Z0-9_$]*/.exec(text.slice(i));
  if (!match) return null;
  return { ident: match[0], next: i + match[0].length };
}

/** Skip whitespace, then expect any of the given keywords. Returns new cursor or null. */
function expectKeyword(
  text: string,
  pos: number,
  keyword: string,
): number | null {
  let i = pos;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  const slice = text.slice(i, i + keyword.length);
  if (slice.toUpperCase() === keyword.toUpperCase()) {
    // Ensure word boundary on right
    const after = text[i + keyword.length];
    if (after === undefined || /[\s(;,]/.test(after)) {
      return i + keyword.length;
    }
  }
  return null;
}

function optionalKeyword(
  text: string,
  pos: number,
  keyword: string,
): number {
  const next = expectKeyword(text, pos, keyword);
  return next ?? pos;
}

function optionalKeywords(
  text: string,
  pos: number,
  ...keywords: string[]
): number {
  let cursor = pos;
  for (const kw of keywords) {
    const next = expectKeyword(text, cursor, kw);
    if (next === null) return pos; // all-or-nothing for multi-word
    cursor = next;
  }
  return cursor;
}

export function matchAlterTableDropColumn(stmt: string): Array<{
  table: string;
  column: string;
  ifExists: boolean;
}> {
  const text = stripComments(stmt);
  const results: Array<{ table: string; column: string; ifExists: boolean }> = [];

  // Scan for every "ALTER TABLE" occurrence.
  const altRe = /\bALTER\s+TABLE\b/gi;
  let altMatch: RegExpExecArray | null;
  while ((altMatch = altRe.exec(text)) !== null) {
    let cursor = altMatch.index + altMatch[0].length;
    cursor = optionalKeyword(text, cursor, "ONLY");
    cursor = optionalKeywords(text, cursor, "IF", "EXISTS");

    const tableTok = readIdent(text, cursor);
    if (!tableTok) continue;
    cursor = tableTok.next;
    let tableName = tableTok.ident;

    // optional schema-qualified name
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor++;
    if (text[cursor] === ".") {
      const next = readIdent(text, cursor + 1);
      if (next) {
        tableName = `${tableName}.${next.ident}`;
        cursor = next.next;
      }
    }

    const dropPos = expectKeyword(text, cursor, "DROP");
    if (dropPos === null) continue;
    cursor = dropPos;
    cursor = optionalKeyword(text, cursor, "COLUMN");
    const ifExistsPos = optionalKeywords(text, cursor, "IF", "EXISTS");
    const ifExists = ifExistsPos !== cursor;
    cursor = ifExistsPos;

    const colTok = readIdent(text, cursor);
    if (!colTok) continue;

    results.push({
      table: tableName,
      column: colTok.ident,
      ifExists,
    });
  }
  return results;
}

export function matchDropTable(stmt: string): Array<{
  table: string;
  ifExists: boolean;
  cascade: boolean;
}> {
  const text = stripComments(stmt);
  const out: Array<{ table: string; ifExists: boolean; cascade: boolean }> = [];
  const re = /\bDROP\s+TABLE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let cursor = m.index + m[0].length;
    const ifExistsPos = optionalKeywords(text, cursor, "IF", "EXISTS");
    const ifExists = ifExistsPos !== cursor;
    cursor = ifExistsPos;

    const tok = readIdent(text, cursor);
    if (!tok) continue;
    cursor = tok.next;
    let table = tok.ident;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor++;
    if (text[cursor] === ".") {
      const next = readIdent(text, cursor + 1);
      if (next) {
        table = `${table}.${next.ident}`;
        cursor = next.next;
      }
    }
    // Look ahead for CASCADE up to next `;` or end of statement window.
    const remainder = text.slice(cursor).split(";")[0] ?? "";
    const cascade = /\bCASCADE\b/i.test(remainder);
    out.push({ table, ifExists, cascade });
  }
  return out;
}

export function matchRenameColumn(stmt: string): Array<{
  table: string;
  fromColumn: string;
  toColumn: string;
}> {
  const text = stripComments(stmt);
  const out: Array<{ table: string; fromColumn: string; toColumn: string }> = [];
  const altRe = /\bALTER\s+TABLE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = altRe.exec(text)) !== null) {
    let cursor = m.index + m[0].length;
    cursor = optionalKeyword(text, cursor, "ONLY");
    cursor = optionalKeywords(text, cursor, "IF", "EXISTS");
    const tableTok = readIdent(text, cursor);
    if (!tableTok) continue;
    cursor = tableTok.next;

    const renamePos = expectKeyword(text, cursor, "RENAME");
    if (renamePos === null) continue;
    cursor = renamePos;
    cursor = optionalKeyword(text, cursor, "COLUMN");

    const fromTok = readIdent(text, cursor);
    if (!fromTok) continue;
    cursor = fromTok.next;

    const toPos = expectKeyword(text, cursor, "TO");
    if (toPos === null) continue;
    cursor = toPos;

    const toTok = readIdent(text, cursor);
    if (!toTok) continue;

    out.push({
      table: tableTok.ident,
      fromColumn: fromTok.ident,
      toColumn: toTok.ident,
    });
  }
  return out;
}

export function matchAddColumnNotNullNoDefault(stmt: string): Array<{
  table: string;
  column: string;
}> {
  const text = stripComments(stmt);
  const out: Array<{ table: string; column: string }> = [];
  const altRe = /\bALTER\s+TABLE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = altRe.exec(text)) !== null) {
    let cursor = m.index + m[0].length;
    cursor = optionalKeyword(text, cursor, "ONLY");
    cursor = optionalKeywords(text, cursor, "IF", "EXISTS");
    const tableTok = readIdent(text, cursor);
    if (!tableTok) continue;
    cursor = tableTok.next;

    const addPos = expectKeyword(text, cursor, "ADD");
    if (addPos === null) continue;
    cursor = addPos;
    cursor = optionalKeyword(text, cursor, "COLUMN");
    cursor = optionalKeywords(text, cursor, "IF", "NOT", "EXISTS");

    const colTok = readIdent(text, cursor);
    if (!colTok) continue;
    cursor = colTok.next;

    // Read the rest of the column definition up to next comma (multi-add)
    // or end of statement.
    const rest = text.slice(cursor).split(/[,;]/)[0] ?? "";
    if (!/\bNOT\s+NULL\b/i.test(rest)) continue;
    if (/\bDEFAULT\b/i.test(rest)) continue;
    out.push({ table: tableTok.ident, column: colTok.ident });
  }
  return out;
}

export function matchCreateIndexNonConcurrent(stmt: string): Array<{
  table: string;
  index: string;
}> {
  const text = stripComments(stmt);
  const out: Array<{ table: string; index: string }> = [];
  const re = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let cursor = m.index + m[0].length;
    // If CONCURRENTLY follows, it's safe — skip.
    const concPos = expectKeyword(text, cursor, "CONCURRENTLY");
    if (concPos !== null) continue;

    cursor = optionalKeywords(text, cursor, "IF", "NOT", "EXISTS");

    const idxTok = readIdent(text, cursor);
    if (!idxTok) continue;
    cursor = idxTok.next;

    const onPos = expectKeyword(text, cursor, "ON");
    if (onPos === null) continue;
    cursor = onPos;
    cursor = optionalKeyword(text, cursor, "ONLY");

    const tableTok = readIdent(text, cursor);
    if (!tableTok) continue;

    out.push({ table: tableTok.ident, index: idxTok.ident });
  }
  return out;
}
