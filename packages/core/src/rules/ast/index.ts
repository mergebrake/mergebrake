import type { Finding, OrmStack, DatabaseDialect } from "mergebrake-shared";
import type { SqlBlock } from "../../parsers/orm-sql-extractor.js";
import type { ParsedStatement } from "../../parsers/postgres-ast.js";

import { astDropColumn } from "./destructive-drop-column.js";
import { astDropTable } from "./destructive-drop-table.js";
import { astRenameColumn } from "./destructive-rename-column.js";
import { astAddNotNullWithoutDefault } from "./locking-add-not-null-without-default.js";
import { astCreateIndexNonConcurrent } from "./locking-create-index-non-concurrent.js";
import { astAlterColumnType } from "./locking-alter-column-type.js";
import { astAddForeignKeyWithoutNotValid } from "./locking-add-foreign-key-without-not-valid.js";
import { astAddUniqueConstraint } from "./locking-add-unique-constraint.js";
import { astAddPrimaryKey } from "./locking-add-primary-key.js";
import { astAddCheckWithoutNotValid } from "./locking-add-check-without-not-valid.js";
import { astSetNotNull } from "./locking-set-not-null.js";
import { astSetDefaultVolatile } from "./safety-set-default-volatile.js";
import { astTruncate } from "./destructive-truncate.js";
import { astUpdateWithoutWhere } from "./safety-update-without-where.js";
import { astAlterEnum } from "./safety-alter-enum-value.js";
import { astDropIndex } from "./destructive-drop-index.js";
import { astDropConstraint } from "./destructive-drop-constraint.js";
import { astDropNotNull } from "./safety-drop-not-null.js";
import { astDropDefault } from "./safety-drop-default.js";
import { astCreateTableWithoutPk } from "./safety-create-table-without-pk.js";
import { astAddColumnVolatileDefault } from "./locking-add-column-volatile-default.js";

export interface AstRuleContext {
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  block: SqlBlock;
  statement: ParsedStatement;
}

export interface AstRule {
  id: string;
  scan(ctx: AstRuleContext): Finding[];
}

export const astRules: AstRule[] = [
  astDropColumn,
  astDropTable,
  astRenameColumn,
  astAddNotNullWithoutDefault,
  astCreateIndexNonConcurrent,
  astAlterColumnType,
  astAddForeignKeyWithoutNotValid,
  astAddUniqueConstraint,
  astAddPrimaryKey,
  astAddCheckWithoutNotValid,
  astSetNotNull,
  astSetDefaultVolatile,
  astTruncate,
  astUpdateWithoutWhere,
  astAlterEnum,
  // 6 new rules (v0.0.2)
  astDropIndex,
  astDropConstraint,
  astDropNotNull,
  astDropDefault,
  astCreateTableWithoutPk,
  astAddColumnVolatileDefault,
];

export function runAstRules(input: {
  ormStack: OrmStack;
  dialect: DatabaseDialect;
  block: SqlBlock;
  statements: ParsedStatement[];
}): Finding[] {
  const findings: Finding[] = [];
  for (const statement of input.statements) {
    for (const rule of astRules) {
      findings.push(
        ...rule.scan({
          ormStack: input.ormStack,
          dialect: input.dialect,
          block: input.block,
          statement,
        }),
      );
    }
  }
  return findings;
}
