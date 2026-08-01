import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateLibraryPackage } from './library-package-utils.mjs';

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = process.cwd();
const catalogPath = path.join(repositoryRoot, 'catalog.json');
const packagePaths = await listZipPackages(path.join(repositoryRoot, 'libraries'));
const libraries = [];
const seen = new Set();

if (packagePaths.length === 0) {
  throw new Error('No ZIP packages found under libraries/*.zip.');
}

for (const packagePath of packagePaths) {
  const metadata = await validateLibraryPackage(packagePath);
  const key = `${metadata.id}@${metadata.version}`;
  if (seen.has(key)) {
    throw new Error(`Duplicate catalog library id/version: ${key}`);
  }
  seen.add(key);
  libraries.push(toCatalogEntry(repositoryRoot, metadata));
}

const catalog = {
  formatVersion: 1,
  libraries: libraries.sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
  )
};

const nextContent = `${JSON.stringify(catalog, null, 2)}\n`;

if (options.check) {
  const currentContent = await readFile(catalogPath, 'utf8');
  if (currentContent !== nextContent) {
    console.error('catalog.json is stale.');
    console.error('Run:');
    console.error('  node scripts/generate-library-catalog.mjs --write');
    console.error('Then commit the updated catalog.json.');
    process.exitCode = 1;
  } else {
    console.log('catalog.json is current.');
  }
} else if (options.write) {
  await writeFile(catalogPath, nextContent, 'utf8');
  console.log(`Wrote catalog.json with ${catalog.libraries.length} libraries.`);
} else {
  console.log(nextContent);
}

function parseArgs(args) {
  const parsed = {
    write: false,
    check: false
  };

  for (const arg of args) {
    if (arg === '--write') {
      parsed.write = true;
    } else if (arg === '--check') {
      parsed.check = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (parsed.write && parsed.check) {
    throw new Error('Use either --write or --check, not both.');
  }

  return parsed;
}

async function listZipPackages(librariesRoot) {
  const entries = await readdir(librariesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
    .map((entry) => path.join(librariesRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function toCatalogEntry(repositoryRoot, metadata) {
  return stripUndefined({
    id: metadata.id,
    version: metadata.version,
    title: metadata.title,
    description: metadata.description,
    languagePair: metadata.languagePair,
    packageFormatVersion: metadata.packageFormatVersion,
    zipPath: path.relative(repositoryRoot, metadata.zipPath).replaceAll(path.sep, '/'),
    sha256: metadata.sha256,
    sizeBytes: metadata.sizeBytes,
    tags: metadata.tags,
    minAppVersion: metadata.minAppVersion,
    author: metadata.authors[0],
    license: metadata.license,
    difficulty: metadata.difficulty,
    targetAges: metadata.targetAges,
    questCount: metadata.questCount,
    senseCount: metadata.senseCount,
    challengeTypes: metadata.challengeTypes,
    hasImages: metadata.hasImages,
    hasAudio: metadata.hasAudio
  });
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)])
  );
}
