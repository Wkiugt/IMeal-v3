import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yarnCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

function runYarnResult(cwd, args, { databaseUrl } = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
  };
  if (databaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = databaseUrl;
  }
  return spawnSync(yarnCommand, ['yarn', ...args], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env,
  });
}

function runYarn(cwd, args, options) {
  const result = runYarnResult(cwd, args, options);
  assert.equal(
    result.status,
    0,
    `${args.join(' ')} failed${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  );
}

function shouldCopy(sourcePath) {
  const relativePath = relative(repositoryRoot, sourcePath);
  if (relativePath === '') return true;
  const segments = relativePath.split(/[\\/]/);
  const basename = segments.at(-1) ?? '';
  if (
    segments.some((segment) =>
      [
        '.git',
        '.turbo',
        '.yarn',
        'coverage',
        'dist',
        'generated',
        'node_modules',
      ].includes(segment),
    )
  ) {
    return false;
  }
  if (basename.endsWith('.tsbuildinfo')) return false;
  if (basename === '.env' || basename.startsWith('.env.')) return false;
  return true;
}
async function prepareCleanCopy() {
  const temporaryParent = await mkdtemp(join(tmpdir(), 'imeal-build-order-'));
  const temporaryRoot = join(temporaryParent, 'repo');
  try {
    await cp(repositoryRoot, temporaryRoot, {
      recursive: true,
      filter: shouldCopy,
    });
    runYarn(temporaryRoot, ['install', '--immutable']);
    return { temporaryParent, temporaryRoot };
  } catch (error) {
    try {
      await rm(temporaryParent, { recursive: true, force: true });
    } catch {
      // Preserve the original copy or install failure.
    }
    throw error;
  }
}
async function assertGeneratedClient(root, modelName) {
  const clientPath = join(
    root,
    'packages',
    'domain',
    'src',
    'generated',
    'prisma',
    'client.ts',
  );
  await readFile(clientPath, 'utf8');
  await readFile(
    join(
      root,
      'packages',
      'domain',
      'dist',
      'generated',
      'prisma',
      'models',
      `${modelName}.js`,
    ),
    'utf8',
  );
  const moduleUrl = pathToFileURL(
    join(root, 'packages', 'domain', 'dist', 'index.js'),
  ).href;
  const delegateName = `${modelName[0].toLowerCase()}${modelName.slice(1)}`;
  const consumerScript = [
    `const module = await import(${JSON.stringify(moduleUrl)});`,
    `const prisma = module.createPrismaClient(${JSON.stringify('postgresql://127.0.0.1:5432/imeal_build?schema=public')});`,
    `if (typeof prisma.${delegateName}?.findUnique !== 'function') process.exit(2);`,
    'await prisma.$disconnect();',
  ].join('\n');
  const consumer = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', consumerScript],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(
    consumer.status,
    0,
    `${modelName} consumer failed\nstdout:\n${consumer.stdout}\nstderr:\n${consumer.stderr}`,
  );
}

test('core build regenerates Prisma metadata in a clean copy and after schema changes', async () => {
  const { temporaryParent, temporaryRoot } = await prepareCleanCopy();
  try {

    const buildCommand = ['turbo', 'run', 'build', '--filter=@imeal/core'];
    runYarn(temporaryRoot, buildCommand);
    await assertGeneratedClient(temporaryRoot, 'User');

    await rm(join(temporaryRoot, 'packages', 'domain', 'src', 'generated'), {
      recursive: true,
      force: true,
    });
    await rm(join(temporaryRoot, 'packages', 'domain', 'dist'), {
      recursive: true,
      force: true,
    });
    runYarn(temporaryRoot, buildCommand);
    await assertGeneratedClient(temporaryRoot, 'User');

    const schemaPath = join(
      temporaryRoot,
      'packages',
      'domain',
      'prisma',
      'schema.prisma',
    );
    await writeFile(
      schemaPath,
      `${await readFile(schemaPath, 'utf8')}\nmodel BuildOrderSchemaProbe {\n  id String @id @default(uuid())\n  name String\n}\n`,
    );
    await rm(join(temporaryRoot, 'packages', 'domain', 'src', 'generated'), {
      recursive: true,
      force: true,
    });
    await rm(join(temporaryRoot, 'packages', 'domain', 'dist'), {
      recursive: true,
      force: true,
    });

    runYarn(temporaryRoot, buildCommand);
    await assertGeneratedClient(temporaryRoot, 'BuildOrderSchemaProbe');
    const validSchema = await readFile(schemaPath, 'utf8');
    await writeFile(schemaPath, `${validSchema}\nmodel BrokenSchemaProbe {\n`);
    const failedBuild = runYarnResult(temporaryRoot, [
      'turbo',
      'run',
      'build',
      '--filter=@imeal/api...',
    ]);
    assert.notEqual(failedBuild.status, 0);
    assert.match(
      `${failedBuild.stdout ?? ''}${failedBuild.stderr ?? ''}`,
      /Prisma schema validation|P1012/i,
    );
    await writeFile(schemaPath, validSchema);
    const contractsPackagePath = join(
      temporaryRoot,
      'packages',
      'contracts',
      'package.json',
    );
    const contractsPackage = JSON.parse(
      await readFile(contractsPackagePath, 'utf8'),
    );
    contractsPackage.scripts.build =
      "node -e \"console.error('intentional-contract-build-failure'); process.exit(23)\"";
    await writeFile(
      contractsPackagePath,
      `${JSON.stringify(contractsPackage, null, 2)}\n`,
    );
    const failedUnitRun = runYarnResult(temporaryRoot, ['test:unit']);
    assert.notEqual(failedUnitRun.status, 0);
    assert.match(
      `${failedUnitRun.stdout ?? ''}${failedUnitRun.stderr ?? ''}`,
      /intentional-contract-build-failure/,
    );
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});

test('root typecheck prepares a clean copy without prior artifacts', async () => {
  const { temporaryParent, temporaryRoot } = await prepareCleanCopy();
  try {
    runYarn(temporaryRoot, ['typecheck']);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});

test('root unit smoke prepares a clean copy without prior artifacts', async () => {
  const { temporaryParent, temporaryRoot } = await prepareCleanCopy();
  try {
    runYarn(temporaryRoot, ['test:unit']);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});
