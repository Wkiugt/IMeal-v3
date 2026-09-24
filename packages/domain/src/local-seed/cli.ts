import { LocalSeedConfigError } from './config.js';
import { LocalSeedPlanError } from './plan.js';
import { runLocalSeed } from './index.js';
import { LocalSeedWriteError } from './writer.js';

export { runLocalSeed } from './index.js';
export type { LocalSeedCliDeps } from './index.js';

async function main(): Promise<void> {
  try {
    const result = await runLocalSeed(process.argv.slice(2), process.env);
    process.stdout.write(`${result.kind === 'help' ? result.text : result.summary}\n`);
  } catch (error) {
    if (error instanceof LocalSeedConfigError) {
      process.stderr.write(`${error.code}\n`);
    } else if (error instanceof LocalSeedPlanError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else if (error instanceof LocalSeedWriteError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write('LOCAL_SEED_FAILED\n');
    }
    process.exitCode = 1;
  }
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1]?.replaceAll('\\', '/');
  return (
    entrypoint === 'cli.ts' ||
    entrypoint === 'cli.js' ||
    entrypoint?.endsWith('/cli.ts') === true ||
    entrypoint?.endsWith('/cli.js') === true
  );
}

if (isCliEntrypoint()) {
  void main();
}
