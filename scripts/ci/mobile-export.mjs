import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runOwnedProcess } from './mobile-process.mjs';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, '../..');
export const mobileRoot = join(repositoryRoot, 'apps', 'mobile');
const yarnCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function requiredFile(filePath, label, { javascript = false } = {}) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    throw fail(`${label} is missing: ${filePath}`, { cause: error });
  }
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw fail(`${label} is empty or not a regular file: ${filePath}`);
  }
  if (javascript && !filePath.endsWith('.hbc')) {
    const contents = await readFile(filePath, 'utf8');
    const trimmed = contents.trimStart();
    if (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[')
    ) {
      throw fail(`${label} is HTML or JSON instead of JavaScript: ${filePath}`);
    }
  }
  return { path: filePath, bytes: fileStat.size };
}

function resolveInside(root, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw fail(`${label} must be a non-empty relative path`);
  }
  const path = resolve(root, relativePath);
  const rootPath = resolve(root);
  const relativePathFromRoot = relative(rootPath, path);
  if (
    relativePathFromRoot === '..' ||
    relativePathFromRoot.startsWith(`..${path.includes('\\') ? '\\' : '/'}`) ||
    isAbsolute(relativePathFromRoot)
  ) {
    throw fail(`${label} escapes export directory: ${relativePath}`);
  }
  return path;
}

function readScriptSources(html) {
  return [
    ...html.matchAll(
      /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3]);
}

export async function validateExportOutput(outputDir) {
  const metadataPath = join(outputDir, 'metadata.json');
  const metadataFile = await requiredFile(metadataPath, 'Expo metadata');
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    throw fail(`Expo metadata is not valid JSON: ${metadataPath}`, { cause: error });
  }
  const fileMetadata = metadata?.fileMetadata;
  if (!fileMetadata || typeof fileMetadata !== 'object') {
    throw fail(`Expo metadata has no fileMetadata object: ${metadataPath}`);
  }
  const platformMetadata = {};
  for (const platform of ['android', 'ios']) {
    const platformEntry = fileMetadata[platform];
    if (!platformEntry || typeof platformEntry.bundle !== 'string') {
      throw fail(`Expo metadata has no ${platform} bundle`);
    }
    const bundlePath = resolveInside(outputDir, platformEntry.bundle, `${platform} bundle`);
    const bundleFile = await requiredFile(bundlePath, `${platform} bundle`, {
      javascript: true,
    });
    const assets = Array.isArray(platformEntry.assets) ? platformEntry.assets : [];
    const assetMetadata = [];
    for (const [index, asset] of assets.entries()) {
      const assetPath = resolveInside(
        outputDir,
        asset?.path,
        `${platform} metadata asset ${index}`,
      );
      const assetFile = await requiredFile(assetPath, `${platform} metadata asset ${index}`);
      assetMetadata.push({
        path: relative(outputDir, assetPath).replaceAll('\\', '/'),
        bytes: assetFile.bytes,
      });
    }
    platformMetadata[platform] = {
      bundle: relative(outputDir, bundlePath).replaceAll('\\', '/'),
      bytes: bundleFile.bytes,
      assets: assetMetadata,
    };
  }

  const htmlPath = join(outputDir, 'index.html');
  const htmlFile = await requiredFile(htmlPath, 'web index');
  const html = await readFile(htmlPath, 'utf8');
  const scriptSources = readScriptSources(html);
  if (scriptSources.length === 0) {
    throw fail('web index does not reference a generated JavaScript bundle');
  }
  const webJavaScriptFiles = [];
  for (const [index, source] of scriptSources.entries()) {
    let scriptUrl;
    try {
      scriptUrl = new URL(source, 'http://imeal.invalid/');
    } catch (error) {
      throw fail(`web script reference ${index} is not a valid URL: ${source}`, {
        cause: error,
      });
    }
    if (scriptUrl.origin !== 'http://imeal.invalid' || scriptUrl.protocol !== 'http:') {
      throw fail(`web script reference ${index} is remote: ${source}`);
    }
    const scriptPath = resolveInside(
      outputDir,
      scriptUrl.pathname.replace(/^\/+/, ''),
      `web script reference ${index}`,
    );
    const scriptFile = await requiredFile(scriptPath, `web script reference ${index}`, {
      javascript: true,
    });
    webJavaScriptFiles.push({
      path: relative(outputDir, scriptPath).replaceAll('\\', '/'),
      bytes: scriptFile.bytes,
    });
  }
  platformMetadata.web = {
    bundle: webJavaScriptFiles[0].path,
    bytes: webJavaScriptFiles[0].bytes,
    scripts: webJavaScriptFiles,
    index: relative(outputDir, htmlPath).replaceAll('\\', '/'),
    indexBytes: htmlFile.bytes,
  };
  const allFiles = await listFiles(outputDir);
  return {
    outputDir,
    metadata: {
      version: metadata.version,
      bundler: metadata.bundler,
    },
    metadataBytes: metadataFile.bytes,
    platforms: platformMetadata,
    files: allFiles.length,
  };
}

async function makeFreshOutputDir(outputDir) {
  if (outputDir) {
    const path = resolve(outputDir);
    try {
      await mkdir(path);
      return path;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw fail(`Export output directory already exists; refusing to remove it: ${path}`);
      }
      throw error;
    }
  }
  return mkdtemp(join(tmpdir(), 'imeal-mobile-export-'));
}

function childEnvironment() {
  const blocked = /(TOKEN|SECRET|PASSWORD|PRIVATE|COOKIE|AUTH|CREDENTIAL|KEY)/i;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !blocked.test(name)),
  );
  delete environment.NPM_CONFIG_USERCONFIG;
  delete environment.YARN_NPM_AUTH_TOKEN;
  environment.CI = 'true';
  return environment;
}

export async function resolvedProjectMetadata(projectRoot) {
  const require = createRequire(import.meta.url);
  const configModule = require('@expo/config');
  const pathsModule = require('@expo/config/paths');
  const projectConfig = configModule.getConfig(projectRoot);
  const platforms = projectConfig.exp.platforms ?? ['android', 'ios', 'web'];
  const entryPoints = Object.fromEntries(
    platforms.map((platform) => [
      platform,
      pathsModule.resolveEntryPoint(projectRoot, {
        platform,
        pkg: projectConfig.pkg,
      }),
    ]),
  );
  return {
    name: projectConfig.exp.name,
    slug: projectConfig.exp.slug,
    platforms,
    main: projectConfig.pkg.main,
    entryPoint: entryPoints.android ?? Object.values(entryPoints)[0],
    entryPoints,
  };
}

async function runCommand({ args, cwd, logPath, runner }) {
  return runner({
    command: yarnCommand,
    args: ['yarn', ...args],
    cwd,
    env: childEnvironment(),
    logPath,
    timeoutMs: 20 * 60 * 1_000,
  });
}

export async function prepareMobileBuild({
  root = repositoryRoot,
  logPath,
  runner = runOwnedProcess,
} = {}) {
  const resolvedRoot = resolve(root);
  return runCommand({
    args: ['turbo', 'run', 'build', '--filter=@imeal/core', '--filter=@imeal/contracts'],
    cwd: resolvedRoot,
    logPath,
    runner,
  });
}

export async function exportMobile({
  root = repositoryRoot,
  outputDir,
  logPath,
  runner = runOwnedProcess,
  keepOutput = false,
} = {}) {
  const resolvedRoot = resolve(root);
  const resolvedMobileRoot = join(resolvedRoot, 'apps', 'mobile');
  const destination = await makeFreshOutputDir(outputDir);
  const actualLogPath =
    logPath ??
    join(tmpdir(), `imeal-mobile-export-${process.pid}-${Date.now()}.log`);
  let failure;
  try {
    const preparation = await prepareMobileBuild({
      root: resolvedRoot,
      logPath: actualLogPath,
      runner,
    });
    if (preparation?.result?.code !== 0) {
      throw fail(`Shared mobile build preparation did not exit successfully (code ${preparation?.result?.code})`);
    }
    const result = await runCommand({
      args: [
        'workspace',
        '@imeal/mobile',
        'exec',
        'expo',
        'export',
        '--clear',
        '--platform',
        'all',
        '--output-dir',
        destination,
      ],
      cwd: resolvedMobileRoot,
      logPath: actualLogPath,
      runner,
    });
    if (result?.result?.code !== 0) {
      throw fail(`Expo export did not exit successfully (code ${result?.result?.code})`);
    }
    const exportReport = await validateExportOutput(destination);
    return {
      result: 'PASS',
      commandExitCode: result.result.code,
      entryPoint: await resolvedProjectMetadata(resolvedMobileRoot),
      logPath: actualLogPath,
      ...exportReport,
    };
  } catch (error) {
    failure = error;
    error.outputDir = destination;
    error.logPath = actualLogPath;
    throw error;
  } finally {
    if (!keepOutput) {
      try {
        await rm(destination, { recursive: true, force: true });
      } catch (cleanupError) {
        if (failure) failure.cleanupError = cleanupError;
        else throw cleanupError;
      }
    }
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') values.outputDir = argv[++index];
    else if (arg === '--log') values.logPath = argv[++index];
    else if (arg === '--keep-output') values.keepOutput = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await exportMobile(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function failureExitCode(error) {
  const code =
    error?.result?.code ??
    error?.exitResult?.code ??
    error?.cause?.result?.code ??
    error?.cleanupError?.result?.code;
  return Number.isInteger(code) && code > 0 && code < 256 ? code : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = failureExitCode(error);
  });
}
