import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import { camelize, snakeize } from "../recipes/symbol-variants.js";

export type SchemaSurface = "head" | "base";
export type SchemaSource = "prisma" | "drizzle";

export interface SchemaSymbolEntry {
  source: SchemaSource;
  surface: SchemaSurface;
  file: string;
  table: string;
  column: string;
  codeSymbols: string[];
}

export interface SchemaSymbolIndex {
  entries: SchemaSymbolEntry[];
}

export async function buildSchemaSymbolIndex(opts: {
  repoRoot: string;
  baseRepoRoot?: string;
}): Promise<SchemaSymbolIndex> {
  const entries: SchemaSymbolEntry[] = [];
  entries.push(...(await readRepoSchemaSymbols(opts.repoRoot, "head")));
  if (opts.baseRepoRoot) {
    entries.push(...(await readRepoSchemaSymbols(opts.baseRepoRoot, "base")));
  }
  return { entries };
}

export function expandSymbolsWithSchema(
  index: SchemaSymbolIndex,
  symbols: string[],
): string[] {
  const out = new Set<string>();
  const parsed = symbols.map(parseAffectedSymbol);

  for (const symbol of symbols) {
    addGenericSymbolVariants(out, symbol);
  }

  for (const entry of index.entries) {
    for (const candidate of parsed) {
      if (!candidate.column) continue;
      if (!sameIdentifier(entry.column, candidate.column)) continue;
      if (candidate.table && !sameTable(entry.table, candidate.table)) continue;

      out.add(entry.column);
      out.add(camelize(entry.column));
      out.add(snakeize(entry.column));
      out.add(`${entry.table}.${entry.column}`);
      out.add(`${entry.table}.${camelize(entry.column)}`);
      for (const codeSymbol of entry.codeSymbols) {
        out.add(codeSymbol);
      }
    }
  }

  return Array.from(out).filter(Boolean);
}

function addGenericSymbolVariants(out: Set<string>, symbol: string): void {
  out.add(symbol);
  const parsed = parseAffectedSymbol(symbol);
  if (parsed.table && parsed.column) {
    out.add(parsed.column);
    out.add(snakeize(parsed.column));
    if (/[_\s-]/.test(parsed.column)) {
      out.add(camelize(parsed.column));
      out.add(`${parsed.table}.${camelize(parsed.column)}`);
    }
    return;
  }

  out.add(snakeize(symbol));
  if (/[_\s-]/.test(symbol)) {
    out.add(camelize(symbol));
  }
}

async function readRepoSchemaSymbols(
  repoRoot: string,
  surface: SchemaSurface,
): Promise<SchemaSymbolEntry[]> {
  const [prisma, drizzle] = await Promise.all([
    readPrismaSchemaSymbols(repoRoot, surface),
    readDrizzleSchemaSymbols(repoRoot, surface),
  ]);
  return [...prisma, ...drizzle];
}

async function readPrismaSchemaSymbols(
  repoRoot: string,
  surface: SchemaSurface,
): Promise<SchemaSymbolEntry[]> {
  const files = await fg(["prisma/**/*.prisma", "**/*.prisma", "!**/node_modules/**"], {
    cwd: repoRoot,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });

  const entries: SchemaSymbolEntry[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    for (const model of extractPrismaModels(content)) {
      const table = model.tableName;
      for (const field of model.fields) {
        entries.push({
          source: "prisma",
          surface,
          file: toReportPath(repoRoot, file),
          table,
          column: field.columnName,
          codeSymbols: dedupe([
            field.fieldName,
            `${model.modelName}.${field.fieldName}`,
            `${lowerFirst(model.modelName)}.${field.fieldName}`,
            `${table}.${field.columnName}`,
          ]),
        });
      }
    }
  }
  return entries;
}

async function readDrizzleSchemaSymbols(
  repoRoot: string,
  surface: SchemaSurface,
): Promise<SchemaSymbolEntry[]> {
  const files = await fg(
    [
      "src/**/*.{ts,tsx,js,jsx,mts,cts}",
      "db/**/*.{ts,tsx,js,jsx,mts,cts}",
      "database/**/*.{ts,tsx,js,jsx,mts,cts}",
      "schema*.{ts,js,mts,cts}",
      "drizzle*.{ts,js,mts,cts}",
      "!**/node_modules/**",
      "!**/dist/**",
      "!**/build/**",
      "!**/.next/**",
    ],
    {
      cwd: repoRoot,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    },
  );

  const entries: SchemaSymbolEntry[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    for (const table of extractDrizzleTables(content)) {
      for (const column of table.columns) {
        entries.push({
          source: "drizzle",
          surface,
          file: toReportPath(repoRoot, file),
          table: table.tableName,
          column: column.columnName,
          codeSymbols: dedupe([
            column.fieldName,
            `${table.exportName}.${column.fieldName}`,
            `${table.tableName}.${column.columnName}`,
          ]),
        });
      }
    }
  }
  return entries;
}

interface PrismaModel {
  modelName: string;
  tableName: string;
  fields: Array<{ fieldName: string; columnName: string }>;
}

function extractPrismaModels(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const modelRe = /\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(content)) !== null) {
    const modelName = match[1]!;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(content, bodyStart - 1);
    if (bodyEnd === -1) continue;

    const body = content.slice(bodyStart, bodyEnd);
    const tableName = extractPrismaMap(body, "@@map") ?? modelName;
    const fields: PrismaModel["fields"] = [];

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1]!;
      const columnName = extractPrismaMap(line, "@map") ?? fieldName;
      fields.push({ fieldName, columnName });
    }

    models.push({ modelName, tableName, fields });
    modelRe.lastIndex = bodyEnd + 1;
  }
  return models;
}

function extractPrismaMap(text: string, attr: "@map" | "@@map"): string | null {
  const escapedAttr = attr.replace(/@/g, "@");
  const re = new RegExp(`${escapedAttr}\\s*\\(\\s*["']([^"']+)["']\\s*\\)`);
  return re.exec(text)?.[1] ?? null;
}

interface DrizzleTable {
  exportName: string;
  tableName: string;
  columns: Array<{ fieldName: string; columnName: string }>;
}

function extractDrizzleTables(content: string): DrizzleTable[] {
  const tables: DrizzleTable[] = [];
  const tableRe =
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*["'`]([^"'`]+)["'`]\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(content)) !== null) {
    const exportName = match[1]!;
    const tableName = match[2]!;
    const objectStart = content.indexOf("{", match.index + match[0].length);
    if (objectStart === -1) continue;
    const objectEnd = findMatchingBrace(content, objectStart);
    if (objectEnd === -1) continue;

    const objectBody = content.slice(objectStart + 1, objectEnd);
    const columns: DrizzleTable["columns"] = [];
    const columnRe =
      /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let columnMatch: RegExpExecArray | null;
    while ((columnMatch = columnRe.exec(objectBody)) !== null) {
      columns.push({
        fieldName: columnMatch[1]!,
        columnName: columnMatch[2]!,
      });
    }

    tables.push({ exportName, tableName, columns });
    tableRe.lastIndex = objectEnd + 1;
  }
  return tables;
}

function parseAffectedSymbol(symbol: string): {
  table?: string;
  column?: string;
} {
  const parts = symbol.split(".");
  if (parts.length >= 2) {
    const column = parts[parts.length - 1];
    if (!column) return {};
    return {
      table: parts.slice(0, -1).join("."),
      column,
    };
  }
  return { column: symbol };
}

function sameIdentifier(a: string, b: string): boolean {
  return snakeize(unquote(a)) === snakeize(unquote(b));
}

function sameTable(a: string, b: string): boolean {
  const aTail = unquote(a).split(".").at(-1) ?? a;
  const bTail = unquote(b).split(".").at(-1) ?? b;
  return sameIdentifier(aTail, bTail);
}

function unquote(input: string): string {
  return input.replace(/^["'`]|["'`]$/g, "");
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i] ?? "";
    const prev = text[i - 1] ?? "";
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function toReportPath(repoRoot: string, file: string): string {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

function lowerFirst(input: string): string {
  if (!input) return input;
  return input[0]!.toLowerCase() + input.slice(1);
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
