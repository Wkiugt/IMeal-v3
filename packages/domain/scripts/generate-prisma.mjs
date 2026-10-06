import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'generate', '--schema', 'prisma/schema.prisma'],
  {
    env: {
      ...process.env,
      DATABASE_URL:
        'postgresql://127.0.0.1:5432/imeal_build?schema=public',
    },
    stdio: 'inherit',
    cwd: process.cwd(),
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
