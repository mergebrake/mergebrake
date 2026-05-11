import { parse as pgParse } from "libpg-query";

/**
 * Minimal typed view of the libpg_query AST nodes we actually inspect.
 *
 * We deliberately keep the surface narrow: every node shape we touch in rules
 * is declared here, and unknown fields are kept as `Record<string, unknown>`
 * so future Postgres versions don't break the build.
 */

export interface ParseResult {
  version: number;
  stmts: ParsedRawStmt[];
}

export interface ParsedRawStmt {
  stmt: RawStmt;
  /** Byte offset of the statement inside the original SQL (1st stmt may omit). */
  stmt_location?: number;
  stmt_len?: number;
}

export type RawStmt =
  | { AlterTableStmt: AlterTableStmt }
  | { IndexStmt: IndexStmt }
  | { RenameStmt: RenameStmt }
  | { DropStmt: DropStmt }
  | { AlterEnumStmt: AlterEnumStmt }
  | { TruncateStmt: TruncateStmt }
  | { UpdateStmt: UpdateStmt }
  | { VariableSetStmt: VariableSetStmt }
  | Record<string, unknown>;

export interface RangeVar {
  schemaname?: string;
  relname?: string;
  inh?: boolean;
  location?: number;
}

export interface AlterTableStmt {
  relation?: RangeVar;
  cmds?: Array<{ AlterTableCmd: AlterTableCmd }>;
  objtype?: string;
}

export type AlterTableCmdSubtype =
  | "AT_AddColumn"
  | "AT_DropColumn"
  | "AT_AlterColumnType"
  | "AT_AddConstraint"
  | "AT_DropConstraint"
  | "AT_DropNotNull"
  | "AT_SetNotNull"
  | "AT_ColumnDefault"
  | "AT_DropDefault"
  | "AT_DropIdentity"
  | "AT_AddIdentity"
  | (string & {});

export interface AlterTableCmd {
  subtype: AlterTableCmdSubtype;
  name?: string;
  num?: number;
  newowner?: unknown;
  def?: AlterTableCmdDef;
  behavior?: "DROP_RESTRICT" | "DROP_CASCADE" | string;
  missing_ok?: boolean;
}

export type AlterTableCmdDef =
  | { Constraint: Constraint }
  | { ColumnDef: ColumnDef }
  | { FuncCall: FuncCall }
  | { TypeName: TypeName }
  | Record<string, unknown>;

export type ConstraintType =
  | "CONSTR_NULL"
  | "CONSTR_NOTNULL"
  | "CONSTR_DEFAULT"
  | "CONSTR_IDENTITY"
  | "CONSTR_CHECK"
  | "CONSTR_PRIMARY"
  | "CONSTR_UNIQUE"
  | "CONSTR_EXCLUSION"
  | "CONSTR_FOREIGN"
  | (string & {});

export interface Constraint {
  contype: ConstraintType;
  conname?: string;
  /** When true, the constraint is added as NOT VALID (validation deferred). */
  skip_validation?: boolean;
  /** Postgres calls this `initially_valid: false` in some versions; for AT_AddConstraint+NOT VALID we mostly rely on `skip_validation`. */
  initially_valid?: boolean;
  indexname?: string;
  raw_expr?: unknown;
  pktable?: RangeVar;
  fk_attrs?: unknown[];
  pk_attrs?: unknown[];
  fk_matchtype?: string;
  fk_upd_action?: string;
  fk_del_action?: string;
  is_no_inherit?: boolean;
}

export interface ColumnDef {
  colname?: string;
  typeName?: TypeName;
  constraints?: Array<{ Constraint: Constraint }>;
  is_not_null?: boolean;
  raw_default?: unknown;
}

export interface TypeName {
  names?: Array<{ String: { sval: string } }>;
  typmods?: unknown[];
  typemod?: number;
}

export interface FuncCall {
  funcname?: Array<{ String: { sval: string } }>;
  args?: unknown[];
}

export interface IndexStmt {
  idxname?: string;
  relation?: RangeVar;
  accessMethod?: string;
  indexParams?: Array<{ IndexElem: { name?: string } }>;
  unique?: boolean;
  concurrent?: boolean;
  if_not_exists?: boolean;
}

export interface RenameStmt {
  renameType: string; // OBJECT_TABLE | OBJECT_COLUMN | OBJECT_INDEX | ...
  relationType?: string;
  relation?: RangeVar;
  subname?: string;
  newname?: string;
  missing_ok?: boolean;
}

export interface DropStmt {
  objects?: unknown[];
  removeType: string; // OBJECT_TABLE | OBJECT_COLUMN | OBJECT_INDEX | ...
  behavior?: "DROP_RESTRICT" | "DROP_CASCADE" | string;
  missing_ok?: boolean;
  concurrent?: boolean;
}

export interface AlterEnumStmt {
  typeName?: Array<{ String: { sval: string } }>;
  oldVal?: string;
  newVal?: string;
  newValNeighbor?: string;
  newValIsAfter?: boolean;
  skipIfNewValExists?: boolean;
}

export interface TruncateStmt {
  relations?: Array<{ RangeVar: RangeVar }>;
  restart_seqs?: boolean;
  behavior?: "DROP_RESTRICT" | "DROP_CASCADE" | string;
}

export interface UpdateStmt {
  relation?: RangeVar;
  targetList?: unknown[];
  whereClause?: unknown;
  fromClause?: unknown[];
}

export interface VariableSetStmt {
  kind?: string;
  name?: string;
  args?: unknown[];
  is_local?: boolean;
}

/* ---------------------------------------------------------------------------
 * Higher-level "parsed statement" abstraction used by the rule engine.
 * Each statement carries its line position (1-based, relative to the original
 * SQL block) and a discriminated payload that's cheap to pattern match on.
 * ------------------------------------------------------------------------- */

export type ParsedStatement = {
  /** Statement kind (top-level AST node name, e.g. "AlterTableStmt"). */
  kind: string;
  /** Underlying AST node (typed lazily). */
  node: unknown;
  /** 1-based line within the SQL block where the statement begins. */
  startLine: number;
  /** 1-based byte offset within the SQL block (0 means start of input). */
  byteOffset: number;
};

export interface ParsePostgresOptions {
  sql: string;
  /** Line at which this SQL block sits in the source file (1-based). */
  startLine?: number;
}

export interface ParsePostgresResult {
  statements: ParsedStatement[];
  /**
   * Parse errors raised by libpg_query, when the SQL is not well-formed Postgres.
   * Callers should treat errors as a hint to fall back to regex / skip the block.
   */
  error: Error | null;
}

/**
 * Parse a SQL block using libpg_query. Returns a list of statement descriptors
 * with computed line numbers, or an error object when the parser refuses the
 * input. The function never throws — callers can react to `result.error`.
 */
export async function parsePostgres(
  opts: ParsePostgresOptions,
): Promise<ParsePostgresResult> {
  const baseLine = opts.startLine ?? 1;
  const sql = opts.sql ?? "";
  let raw: ParseResult;
  try {
    raw = (await pgParse(sql)) as ParseResult;
  } catch (err) {
    return {
      statements: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  const statements: ParsedStatement[] = [];
  for (const wrapped of raw.stmts ?? []) {
    if (!wrapped || !wrapped.stmt) continue;
    const stmt = wrapped.stmt as Record<string, unknown>;
    const keys = Object.keys(stmt);
    const kind = keys[0];
    if (!kind) continue;
    const byteOffset = wrapped.stmt_location ?? 0;
    const startLine = baseLine + countNewlines(sql.slice(0, byteOffset));
    statements.push({
      kind,
      node: (stmt as Record<string, unknown>)[kind],
      startLine,
      byteOffset,
    });
  }
  return { statements, error: null };
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/* ---------------------------------------------------------------------------
 * Type narrowing helpers — kept here so rule files can stay tiny.
 * ------------------------------------------------------------------------- */

export function isAlterTable(
  s: ParsedStatement,
): s is ParsedStatement & { node: AlterTableStmt } {
  return s.kind === "AlterTableStmt";
}

export function isIndexStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: IndexStmt } {
  return s.kind === "IndexStmt";
}

export function isRenameStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: RenameStmt } {
  return s.kind === "RenameStmt";
}

export function isDropStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: DropStmt } {
  return s.kind === "DropStmt";
}

export function isTruncateStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: TruncateStmt } {
  return s.kind === "TruncateStmt";
}

export function isUpdateStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: UpdateStmt } {
  return s.kind === "UpdateStmt";
}

export function isAlterEnumStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: AlterEnumStmt } {
  return s.kind === "AlterEnumStmt";
}

export function isVariableSetStmt(
  s: ParsedStatement,
): s is ParsedStatement & { node: VariableSetStmt } {
  return s.kind === "VariableSetStmt";
}

export function relationName(rel?: RangeVar): string {
  if (!rel?.relname) return "";
  return rel.schemaname ? `${rel.schemaname}.${rel.relname}` : rel.relname;
}

export function typeNameString(t?: TypeName): string {
  if (!t?.names) return "";
  return t.names
    .map((n) => n.String?.sval ?? "")
    .filter(Boolean)
    .join(".");
}

export function funcCallName(f?: FuncCall): string {
  if (!f?.funcname) return "";
  return f.funcname
    .map((n) => n.String?.sval ?? "")
    .filter(Boolean)
    .join(".");
}

/**
 * Walk a small expression subtree and return the first function call name.
 * Defaults may be wrapped in TypeCast/A_Expr nodes, so rule files should not
 * assume `cmd.def.FuncCall` is always the top-level shape.
 */
export function funcCallNameFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  const direct = (record["FuncCall"] as FuncCall | undefined) ?? undefined;
  const directName = funcCallName(direct);
  if (directName) return directName;

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = funcCallNameFromNode(item);
        if (nested) return nested;
      }
      continue;
    }
    const nested = funcCallNameFromNode(value);
    if (nested) return nested;
  }

  return "";
}

/**
 * Returns the set of column constraint types declared inline on a ColumnDef.
 */
export function columnInlineConstraints(col: ColumnDef): Set<ConstraintType> {
  const out = new Set<ConstraintType>();
  for (const c of col.constraints ?? []) {
    if (c.Constraint?.contype) out.add(c.Constraint.contype);
  }
  return out;
}

/**
 * Function defaults worth surfacing in reviews. This intentionally includes
 * stable time functions such as now()/current_timestamp: they may not rewrite a
 * table on modern Postgres, but they still deserve an explicit deploy review.
 */
export const VOLATILE_FUNC_NAMES = new Set([
  "now",
  "current_timestamp",
  "clock_timestamp",
  "transaction_timestamp",
  "random",
  "gen_random_uuid",
  "uuid_generate_v1",
  "uuid_generate_v1mc",
  "uuid_generate_v4",
  "nextval",
]);

/**
 * Known volatile defaults that cannot use Postgres' fast-default path when
 * added to an existing table, so every existing row must be materialized.
 */
export const TABLE_REWRITE_DEFAULT_FUNC_NAMES = new Set([
  "clock_timestamp",
  "random",
  "gen_random_uuid",
  "uuid_generate_v1",
  "uuid_generate_v1mc",
  "uuid_generate_v4",
  "nextval",
]);
