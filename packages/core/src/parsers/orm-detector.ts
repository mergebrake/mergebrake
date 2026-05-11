import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import type { OrmStack } from "mergebrake-shared";

interface OrmSignal {
  stack: OrmStack;
  paths: string[];
  weight: number;
}

const SIGNALS: OrmSignal[] = [
  { stack: "prisma", paths: ["prisma/schema.prisma", "prisma/migrations/**/migration.sql"], weight: 100 },
  { stack: "drizzle", paths: ["drizzle.config.ts", "drizzle.config.js", "drizzle/**/*.sql"], weight: 90 },
  { stack: "knex", paths: ["knexfile.ts", "knexfile.js", "migrations/**/*.{ts,js}"], weight: 60 },
  { stack: "sequelize", paths: [".sequelizerc", "migrations/**/*-*.{ts,js}"], weight: 50 },
  { stack: "typeorm", paths: ["src/migrations/**/*.ts", "ormconfig.json", "ormconfig.ts"], weight: 50 },
  { stack: "raw-sql", paths: ["migrations/**/*.sql", "db/migrations/**/*.sql", "sql/migrations/**/*.sql"], weight: 30 },
];

export async function detectOrmStack(repoRoot: string): Promise<OrmStack> {
  let best: { stack: OrmStack; score: number } = { stack: "raw-sql", score: 0 };

  for (const signal of SIGNALS) {
    let score = 0;
    for (const pattern of signal.paths) {
      const matches = await fg(pattern, {
        cwd: repoRoot,
        dot: false,
        followSymbolicLinks: false,
        onlyFiles: true,
      });
      if (matches.length > 0) {
        score += signal.weight + Math.min(matches.length, 10);
      }
    }
    if (score > best.score) {
      best = { stack: signal.stack, score };
    }
  }

  // package.json sniff as tiebreaker
  if (best.score < 50) {
    try {
      const pkgRaw = await fs.readFile(
        path.join(repoRoot, "package.json"),
        "utf-8",
      );
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (allDeps["@prisma/client"] || allDeps["prisma"]) return "prisma";
      if (allDeps["drizzle-orm"] || allDeps["drizzle-kit"]) return "drizzle";
      if (allDeps["knex"]) return "knex";
      if (allDeps["sequelize"]) return "sequelize";
      if (allDeps["typeorm"]) return "typeorm";
    } catch {
      // package.json missing or invalid — that's fine
    }
  }

  return best.stack;
}
