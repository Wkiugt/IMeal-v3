import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXPECTED_LANE_IDS,
  SECRETLESS_QUALIFICATION,
  aggregateQualification,
  redact,
} from './ci-contracts.mjs';

function optionsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const [key, inline] = item.split('=', 2);
    options[key.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] =
      inline ?? argv[++i];
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function collectEvidence(root) {
  const evidence = [];
  const imageFiles = {};
  const imageInspections = {};
  const sourceDirs = {};
  for (const laneId of EXPECTED_LANE_IDS) {
    const directory = resolve(root, laneId);
    sourceDirs[laneId] = directory;
    evidence.push(await readJson(join(directory, 'producer-result.json')));
    if (laneId.startsWith('images-')) {
      const service = laneId.slice('images-'.length);
      try {
        imageFiles[laneId] = await readFile(join(directory, `build-image-sbom-${service}.spdx.json`));
      } catch {}
      try {
        imageInspections[laneId] = (await readFile(join(directory, 'image-inspection.txt'), 'utf8')).trim();
      } catch {}
    }
  }
  return { evidence, imageFiles, imageInspections, sourceDirs };
}

export async function aggregateFromDirectory({
  evidenceRoot,
  outputDirectory,
  needs,
  context,
}) {
  await mkdir(outputDirectory, { recursive: true });
  let report;
  let collected;
  try {
    collected = await collectEvidence(evidenceRoot);
    report = aggregateQualification({
      evidence: collected.evidence,
      needs,
      context: {
        ...context,
        imageFiles: collected.imageFiles,
        imageInspections: collected.imageInspections,
      },
    });
  } catch (error) {
    report = {
      schemaVersion: 2,
      type: 'imeal-ci-qualification',
      result: 'FAIL',
      releaseId: context.releaseId,
      verifiedStatuses: Object.fromEntries(EXPECTED_LANE_IDS.map((laneId) => [laneId, 'UNVERIFIED'])),
      failureDiagnostics: [
        ...(context.cancelled ? [{ diagnostics: ['workflow run was globally cancelled; qualification is not eligible'] }] : []),
        { diagnostics: [redact(error instanceof Error ? error.message : String(error))] },
      ],
      ...SECRETLESS_QUALIFICATION,
      provenance: {
        runId: String(context.runId),
        sourceSha: context.sourceSha,
        workflowSha: context.workflowSha,
        currentAttempt: context.currentAttempt,
        policy: 'complete producer evidence and provenance required',
      },
    };
  }
  const stepResult = (laneId, stepId) => {
    if (report?.verifiedStatuses?.[laneId] !== 'PASS') return 'UNVERIFIED';
    const item = collected?.evidence?.find((entry) => entry.laneId === laneId);
    return item?.steps?.find((step) => step.id === stepId)?.result ?? 'UNVERIFIED';
  };
  report.typecheck = stepResult('static', 'typecheck');
  report.lint = stepResult('static', 'lint');
  report.unit = stepResult('suites', 'unit');
  report.prisma = stepResult('db', 'migrate');
  report.db = ['domain-db', 'api-db', 'worker-db'].every(
    (stepId) => stepResult('db', stepId) === 'PASS',
  )
    ? 'PASS'
    : 'UNVERIFIED';
  report.compose = stepResult('tooling', 'compose');
  report.stagingTools = ['regression', 'production-boundary', 'production-boundary-verify'].every(
    (stepId) => stepResult('tooling', stepId) === 'PASS',
  )
    ? 'PASS'
    : 'UNVERIFIED';
  if (
    collected &&
    ['images-api', 'images-worker', 'images-admin-web'].every(
      (laneId) =>
        report?.verifiedStatuses?.[laneId] === 'PASS' &&
        collected.imageFiles?.[laneId] &&
        collected.imageInspections?.[laneId],
    )
  ) {
    report.sbom = 'artifacts/build-image-sbom-index.json';
  }
  await writeFile(join(outputDirectory, 'check-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (collected) {
    const producerDirectory = join(outputDirectory, 'producer-evidence');
    await mkdir(producerDirectory, { recursive: true });
    for (const laneId of EXPECTED_LANE_IDS) {
      await copyFile(
        join(collected.sourceDirs[laneId], 'producer-result.json'),
        join(producerDirectory, `${laneId}.json`),
      );
    }
    const sbomIndex = {};
    for (const laneId of EXPECTED_LANE_IDS.filter((item) => item.startsWith('images-'))) {
      const service = laneId.slice('images-'.length);
      const destination = `build-image-sbom-${service}.spdx.json`;
      if (!collected.imageFiles?.[laneId]) continue;
      await copyFile(
        join(collected.sourceDirs[laneId], destination),
        join(outputDirectory, destination),
      );
      sbomIndex[service === 'admin-web' ? 'adminWeb' : service] = `artifacts/${destination}`;
    }
    if (Object.keys(sbomIndex).length > 0) {
      await writeFile(join(outputDirectory, 'build-image-sbom-index.json'), `${JSON.stringify(sbomIndex, null, 2)}\n`);
    }
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const options = optionsFrom(argv);
  const needs = await readJson(resolve(options.needsJson));
  const report = await aggregateFromDirectory({
    evidenceRoot: resolve(options.evidenceRoot),
    outputDirectory: resolve(options.outputDirectory),
    needs,
    context: {
      releaseId: options.releaseId,
      runId: options.runId,
      currentAttempt: Number(options.runAttempt),
      sourceSha: options.sourceSha,
      workflowSha: options.workflowSha,
      cancelled: options.cancelled === 'true',
    },
  });
  process.stdout.write(`${report.result}\n`);
  if (report.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
