import { readFile, writeFile } from 'node:fs/promises';

const [resultPath, imageId, sbomSha256, service, sourceSha] = process.argv.slice(2);
if (!resultPath || !imageId || !sbomSha256 || !service || !sourceSha) {
  process.stderr.write('record-built-image requires result, image id, sbom hash, service, and source SHA\n');
  process.exitCode = 1;
} else {
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  result.image = {
    service,
    sourceTag: `imeal/${service}:${sourceSha}`,
    imageId,
    sbomSha256,
    sbomPath: `build-image-sbom-${service}.spdx.json`,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
