import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const corepackCandidates = [
  process.env.IMEAL_COREPACK_JS,
  process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'corepack', 'dist', 'corepack.js') : undefined,
].filter(Boolean);
const corepackScript = corepackCandidates.find((candidate) => existsSync(candidate));
export function yarnArgs(...args) {
  if (process.platform === 'win32') {
    if (!corepackScript) throw new Error('Corepack JS runtime is unavailable for Windows Yarn commands');
    return [process.execPath, corepackScript, 'yarn', ...args];
  }
  return ['yarn', ...args];
}
export const nodeArgs = (...args) => [process.execPath, ...args];
const NON_DOCKER_TOOLING = [
  'scripts/staging/alert-rules.test.mjs',
  'scripts/staging/backup-restore.test.mjs',
  'scripts/staging/evidence.test.mjs',
  'scripts/staging/image-scan.test.mjs',
  'scripts/staging/phase0-backfill.test.mjs',
  'scripts/staging/phase0-preflight.test.mjs',
  'scripts/staging/phase0-validate.test.mjs',
  'scripts/staging/release-manifest.test.mjs',
  'scripts/staging/runtime-integration.test.mjs',
  'scripts/staging/smoke-staging.test.mjs',
  'scripts/staging/staging-lib.test.mjs',
];
export function commandCatalogue({ lane, outputDirectory, service, kind, trivyImage } = {}) {
  const output = resolve(outputDirectory ?? process.cwd());
  if (lane === 'static') return [
    { id: 'typecheck', argv: yarnArgs('typecheck') },
    { id: 'lint', argv: yarnArgs('lint') },
  ];
  if (lane === 'suites') return [
    { id: 'unit', argv: yarnArgs('test:unit') },
    { id: 'client-suites', argv: yarnArgs('turbo', 'run', 'test', '--filter=@imeal/mobile', '--filter=@imeal/admin-web', '--filter=@imeal/observability', '--concurrency=1') },
    { id: 'build-order', argv: yarnArgs('test:build-order') },
    { id: 'ci-behavior', argv: nodeArgs('--test', 'scripts/ci/ci-contracts.test.mjs', 'scripts/ci/ci-dispatcher.test.mjs', 'scripts/ci/ci-verify.test.mjs', 'scripts/ci/workflow-graph.test.mjs', 'scripts/ci/mobile-process.test.mjs', 'scripts/ci/mobile-export.test.mjs', 'scripts/ci/metro-smoke.test.mjs', 'scripts/ci/security-audit.test.mjs') },
  ];
  if (lane === 'mobile-export') return [
    { id: 'expo-install-check', argv: yarnArgs('workspace', '@imeal/mobile', 'exec', 'expo', 'install', '--check') },
    { id: 'expo-doctor', argv: yarnArgs('dlx', 'expo-doctor@1.20.4', 'apps/mobile') },
    { id: 'export', argv: nodeArgs('scripts/ci/mobile-export.mjs', '--output-dir', resolve(output, 'output'), '--keep-output', '--log', resolve(output, 'export.log')) },
    { id: 'export-negative', argv: nodeArgs('--test', 'scripts/ci/mobile-real.test.mjs') },
  ];
  if (lane === 'mobile-smoke') return [{ id: 'smoke', argv: nodeArgs('scripts/ci/metro-smoke.mjs', '--log', resolve(output, 'metro.log')) }];
  if (lane === 'db') return [
    { id: 'prep-build', argv: yarnArgs('build') },
    { id: 'prisma-validate', dependsOn: ['prep-build'], argv: yarnArgs('workspace', '@imeal/core', 'exec', 'prisma', 'validate', '--schema', 'prisma/schema.prisma') },
    { id: 'migrate', dependsOn: ['prisma-validate'], argv: yarnArgs('workspace', '@imeal/core', 'exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma') },
    { id: 'domain-db', dependsOn: ['migrate'], argv: yarnArgs('workspace', '@imeal/core', 'test:db') },
    { id: 'api-db', dependsOn: ['migrate'], argv: yarnArgs('workspace', '@imeal/api', 'test:db') },
    { id: 'worker-db', dependsOn: ['migrate'], argv: yarnArgs('workspace', '@imeal/worker', 'test:db') },
  ];
  if (lane === 'tooling') return [
    { id: 'regression', argv: nodeArgs('--test', ...NON_DOCKER_TOOLING) },
    { id: 'production-boundary', argv: nodeArgs('--test', 'scripts/verify-production-boundary.test.mjs') },
    { id: 'production-boundary-verify', argv: nodeArgs('scripts/verify-production-boundary.mjs') },
    { id: 'compose', requiresDocker: true, argv: nodeArgs('--test', 'scripts/staging/compose-config.test.mjs') },
  ];
  if (lane === 'security-audit') return [{ id: 'audit', argv: nodeArgs('scripts/ci/security-audit.mjs') }];
  if (lane === 'security-secrets') return [{ id: 'secrets', argv: ['docker', 'run', '--rm', '--volume', `${process.cwd()}:/repo:ro`, 'zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f', 'detect', '--source=/repo', '--redact', '--no-banner', '--exit-code=1'] }];
  if (lane?.startsWith('images-')) {
    const imageService = service ?? lane.slice('images-'.length);
    const dockerfile = imageService === 'api' ? 'apps/api/Dockerfile' : imageService === 'worker' ? 'apps/worker/Dockerfile' : 'apps/admin-web/Dockerfile';
    const image = `imeal/${imageService}:${process.env.GITHUB_SHA ?? 'local'}`;
    return [
      { id: 'build', argv: ['docker', 'build', '--file', dockerfile, '--tag', image, '.'], imageTag: image },
      { id: 'scan', dependsOn: ['build'], imageTag: image, argv: ['docker', 'run', '--rm', '--volume', '/var/run/docker.sock:/var/run/docker.sock', trivyImage ?? process.env.TRIVY_IMAGE ?? '', 'image', '--image-src', 'docker', '--timeout', '15m', '--exit-code', '1', '--severity', 'HIGH,CRITICAL', '--ignore-unfixed', '{{IMAGE_ID}}'] },
      { id: 'sbom', dependsOn: ['build'], imageTag: image, argv: ['docker', 'run', '--rm', '--volume', '/var/run/docker.sock:/var/run/docker.sock', '--volume', `${output}:/out`, 'anchore/syft@sha256:b8c170b8e51bfc4779ec3ef4399942c57290f5ce76a9c3af564c9d00d4946a6b', 'docker:{{IMAGE_ID}}', '--output', `spdx-json=/out/build-image-sbom-${imageService}.spdx.json`] },
    ];
  }
  if (lane === 'tooling-nondocker') return [{ id: 'regression', argv: nodeArgs('--test', ...NON_DOCKER_TOOLING) }, { id: 'production-boundary', argv: nodeArgs('--test', 'scripts/verify-production-boundary.test.mjs') }, { id: 'production-boundary-verify', argv: nodeArgs('scripts/verify-production-boundary.mjs') }];
  throw new Error(`unknown CI lane ${lane}`);
}

export async function writeCatalogue({ lane, outputDirectory, ...options }) {
  const path = resolve(outputDirectory, 'commands.json');
  await mkdir(resolve(outputDirectory), { recursive: true });
  await writeFile(path, `${JSON.stringify(commandCatalogue({ lane, outputDirectory, ...options }), null, 2)}\n`);
  return path;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = Object.fromEntries(process.argv.slice(2).map((item, index, values) => item.startsWith('--') ? [item.slice(2), values[index + 1]] : []).filter(Boolean));
  writeCatalogue({ lane: args.lane, outputDirectory: args.output, service: args.service, kind: args.kind, trivyImage: args.trivy })
    .then((path) => process.stdout.write(`${path}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
