import { PrismaClient } from '@prisma/client';

import {
  formatLocalSeedTarget,
  localSeedHelp,
  parseLocalSeedConfig,
} from './config.js';
import { assertLocalSeedPlan, buildLocalSeedPlan } from './plan.js';
import type {
  LocalSeedCliResult,
  LocalSeedConfig,
  LocalSeedPlan,
  SeedWriteResult,
} from './types.js';
import { writeLocalSeed } from './writer.js';

export interface LocalSeedCliDeps {
  readonly createPrisma?: (databaseUrl: string) => PrismaClient;
  readonly writePlan?: (
    prisma: PrismaClient,
    plan: LocalSeedPlan,
  ) => Promise<SeedWriteResult>;
}

export async function runLocalSeed(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: LocalSeedCliDeps = {},
): Promise<LocalSeedCliResult> {
  if (argv.includes('--help')) {
    return { kind: 'help', text: localSeedHelp() };
  }

  const config = parseLocalSeedConfig(argv, env);
  const plan = buildLocalSeedPlan(config);
  assertLocalSeedPlan(plan);
  const targetSummary = formatTargetSummary(config);

  if (config.dryRun) {
    return {
      kind: 'dry-run',
      plan,
      summary: formatSummary(targetSummary, plan),
    };
  }

  const createPrisma =
    deps.createPrisma ??
    ((databaseUrl: string) =>
      new PrismaClient({
        datasources: {
          db: { url: databaseUrl },
        },
      }));
  const writePlan = deps.writePlan ?? writeLocalSeed;
  const prisma = createPrisma(config.databaseUrl);

  try {
    const result = await writePlan(prisma, plan);
    return {
      kind: 'written',
      plan,
      result,
      summary: formatSummary(targetSummary, plan, result),
    };
  } finally {
    await prisma.$disconnect();
  }
}

function formatTargetSummary(config: LocalSeedConfig): string {
  return `${formatLocalSeedTarget(config)} baseEmail=${config.baseEmail}`;
}

function formatSummary(
  targetSummary: string,
  plan: LocalSeedPlan,
  result?: SeedWriteResult,
): string {
  const counts = [
    `${plan.counts.users} users`,
    `${plan.counts.locations} locations`,
    `${plan.counts.assignments} assignments`,
    `${plan.counts.registrations} registrations`,
    `${plan.counts.mealServings} servings`,
  ].join(' / ');
  const mode = result === undefined ? 'DRY-RUN: no database writes' : 'WRITE COMPLETE';
  const writes =
    result === undefined
      ? ''
      : `\nwrite: created=${result.created} updated=${result.updated} unchanged=${result.unchanged}`;

  return `${targetSummary}\n${mode}\ncounts: ${counts}${writes}`;
}

export type { LocalSeedCliResult } from './types.js';
