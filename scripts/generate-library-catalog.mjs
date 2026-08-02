import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateLibraryPackage } from './library-package-utils.mjs';

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = process.cwd();
const catalogPath = path.join(repositoryRoot, 'catalog.json');
const indexesRoot = path.join(repositoryRoot, 'indexes');
const packagePaths = await listZipPackages(path.join(repositoryRoot, 'libraries'));
const libraries = [];
const seen = new Set();

if (packagePaths.length === 0) {
  throw new Error('No ZIP packages found under libraries/**/*.zip.');
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
  libraries: sortCatalogEntries(libraries)
};

const catalogContent = toJsonContent(catalog);
const indexFiles = buildIndexFiles(catalog.libraries);

if (options.check) {
  await checkFile(catalogPath, catalogContent, 'catalog.json', 'node scripts/generate-library-catalog.mjs --write');
  await checkIndexFiles(indexFiles);
  if (process.exitCode !== 1) {
    console.log('catalog.json and indexes are current.');
  }
} else if (options.write) {
  await writeFile(catalogPath, catalogContent, 'utf8');
  await writeIndexFiles(indexFiles);
  console.log(`Wrote catalog.json with ${catalog.libraries.length} libraries.`);
  console.log(`Wrote ${indexFiles.length} index files under indexes/.`);
} else {
  console.log(catalogContent);
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
  const packages = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'source') continue;
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        packages.push(entryPath);
      }
    }
  }

  await visit(librariesRoot);
  return packages.sort((left, right) => left.localeCompare(right));
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

function buildIndexFiles(catalogLibraries) {
  const files = [
    ['indexes/search.json', buildSearchIndex(catalogLibraries)],
    ...buildGroupedIndexes('indexes/by-language', groupByLanguages(catalogLibraries)),
    ...buildGroupedIndexes('indexes/by-pair', groupByPairs(catalogLibraries)),
    ...buildGroupedIndexes('indexes/by-tag', groupByArrayField(catalogLibraries, 'tags')),
    ...buildGroupedIndexes('indexes/by-difficulty', groupByScalarField(catalogLibraries, 'difficulty'))
  ];

  return files
    .map(([relativePath, payload]) => ({
      relativePath,
      absolutePath: path.join(repositoryRoot, relativePath),
      content: toJsonContent(payload)
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function buildSearchIndex(catalogLibraries) {
  return {
    formatVersion: 1,
    libraries: catalogLibraries.map(toIndexEntry)
  };
}

function buildGroupedIndexes(rootPath, groups) {
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entries]) => [
      `${rootPath}/${slugifyIndexKey(key)}.json`,
      {
        formatVersion: 1,
        key,
        libraries: sortIndexEntries(entries)
      }
    ]);
}

function groupByLanguages(catalogLibraries) {
  const groups = new Map();
  for (const library of catalogLibraries) {
    for (const language of [library.languagePair?.source, library.languagePair?.target]) {
      addToGroup(groups, language, toIndexEntry(library));
    }
  }
  return groups;
}

function groupByPairs(catalogLibraries) {
  const groups = new Map();
  for (const library of catalogLibraries) {
    const source = library.languagePair?.source;
    const target = library.languagePair?.target;
    if (source && target) {
      addToGroup(groups, `${source}-${target}`, toIndexEntry(library));
      addToGroup(groups, `${target}-${source}`, toIndexEntry(library));
    }
  }
  return groups;
}

function groupByArrayField(catalogLibraries, fieldName) {
  const groups = new Map();
  for (const library of catalogLibraries) {
    for (const value of library[fieldName] ?? []) {
      addToGroup(groups, String(value), toIndexEntry(library));
    }
  }
  return groups;
}

function groupByScalarField(catalogLibraries, fieldName) {
  const groups = new Map();
  for (const library of catalogLibraries) {
    const value = library[fieldName];
    if (value) {
      addToGroup(groups, String(value), toIndexEntry(library));
    }
  }
  return groups;
}

function addToGroup(groups, key, entry) {
  if (!key) return;
  const group = groups.get(key) ?? [];
  group.push(entry);
  groups.set(key, sortIndexEntries(group));
}

function toIndexEntry(library) {
  return stripUndefined({
    id: library.id,
    version: library.version,
    title: library.title,
    description: library.description,
    languagePair: library.languagePair,
    zipPath: library.zipPath,
    sha256: library.sha256,
    sizeBytes: library.sizeBytes,
    author: library.author,
    license: library.license,
    difficulty: library.difficulty,
    targetAges: library.targetAges,
    questCount: library.questCount,
    senseCount: library.senseCount,
    challengeTypes: library.challengeTypes,
    hasImages: library.hasImages,
    hasAudio: library.hasAudio,
    tags: library.tags,
    minAppVersion: library.minAppVersion
  });
}

function sortCatalogEntries(entries) {
  return [...entries].sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
  );
}

function sortIndexEntries(entries) {
  return [...entries].sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
  );
}

function slugifyIndexKey(key) {
  return String(key)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

async function writeIndexFiles(files) {
  await rm(indexesRoot, { recursive: true, force: true });
  for (const file of files) {
    await mkdir(path.dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, file.content, 'utf8');
  }
}

async function checkIndexFiles(files) {
  for (const file of files) {
    await checkFile(file.absolutePath, file.content, file.relativePath, 'node scripts/generate-library-catalog.mjs --write');
  }

  const expectedPaths = new Set(files.map((file) => file.relativePath));
  for (const existingPath of await listExistingIndexFiles(indexesRoot)) {
    const relativePath = path.relative(repositoryRoot, existingPath).replaceAll(path.sep, '/');
    if (!expectedPaths.has(relativePath)) {
      console.error(`${relativePath} is stale.`);
      console.error('Run:');
      console.error('  node scripts/generate-library-catalog.mjs --write');
      console.error('Then commit the updated indexes/.');
      process.exitCode = 1;
    }
  }
}

async function checkFile(filePath, nextContent, displayPath, command) {
  let currentContent = '';
  try {
    currentContent = await readFile(filePath, 'utf8');
  } catch {
    console.error(`${displayPath} is missing.`);
    console.error('Run:');
    console.error(`  ${command}`);
    process.exitCode = 1;
    return;
  }

  if (currentContent !== nextContent) {
    console.error(`${displayPath} is stale.`);
    console.error('Run:');
    console.error(`  ${command}`);
    process.exitCode = 1;
  }
}

async function listExistingIndexFiles(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listExistingIndexFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function toJsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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
