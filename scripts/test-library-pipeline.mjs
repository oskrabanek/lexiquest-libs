import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LIMITS } from './library-package-utils.mjs';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const validateScript = path.join(repositoryRoot, 'scripts/validate-library-package.mjs');
const catalogScript = path.join(repositoryRoot, 'scripts/generate-library-catalog.mjs');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lexiquest-libs-test-'));

try {
  await testValidZipPasses();
  await testMissingManifestFails();
  await testMissingAudioFails();
  await testPathTraversalFails();
  await testExecutableFileFails();
  await testOversizedImageFails();
  await testCatalogGenerationAndCheck();
  await testDuplicateLibraryFails();
  console.log('Library pipeline tests passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function testValidZipPasses() {
  const zipPath = await writeFixtureZip('valid.zip');
  runNode([validateScript, zipPath], { label: 'valid ZIP passes' });
}

async function testMissingManifestFails() {
  const entries = createValidEntries();
  delete entries['manifest.yaml'];
  const zipPath = await writeFixtureZip('missing-manifest.zip', entries);
  runNode([validateScript, zipPath], {
    label: 'missing manifest fails',
    expectFailure: true,
    includes: 'manifest'
  });
}

async function testMissingAudioFails() {
  const entries = createValidEntries();
  delete entries['audio/en/hello.mp3'];
  const zipPath = await writeFixtureZip('missing-audio.zip', entries);
  runNode([validateScript, zipPath], {
    label: 'missing referenced audio fails',
    expectFailure: true,
    includes: 'audio/en/hello.mp3'
  });
}

async function testPathTraversalFails() {
  const entries = createValidEntries();
  entries['../evil.txt'] = 'nope';
  const zipPath = await writeFixtureZip('path-traversal.zip', entries);
  runNode([validateScript, zipPath], {
    label: 'path traversal fails',
    expectFailure: true,
    includes: 'invalid relative path'
  });
}

async function testExecutableFileFails() {
  const entries = createValidEntries();
  entries['scripts/evil.js'] = 'console.log("nope")';
  const zipPath = await writeFixtureZip('executable.zip', entries);
  runNode([validateScript, zipPath], {
    label: 'executable file fails',
    expectFailure: true,
    includes: 'Executable or unsafe file type'
  });
}

async function testOversizedImageFails() {
  const entries = createValidEntries();
  entries['images/hello.webp'] = Buffer.alloc(LIMITS.maxSingleImageBytes + 1, 1);
  const zipPath = await writeFixtureZip('oversized-image.zip', entries);
  runNode([validateScript, zipPath], {
    label: 'oversized image fails',
    expectFailure: true,
    includes: 'Image exceeds max size'
  });
}

async function testCatalogGenerationAndCheck() {
  const repo = await createTempRepository('catalog-current');
  await writeFixtureZip(path.join(repo, 'libraries/valid.zip'));

  runNode([catalogScript, '--write'], {
    cwd: repo,
    label: 'catalog write succeeds'
  });

  const firstCatalog = await readFile(path.join(repo, 'catalog.json'), 'utf8');
  const firstSearchIndex = await readFile(path.join(repo, 'indexes/search.json'), 'utf8');
  const firstLanguageIndex = await readFile(path.join(repo, 'indexes/by-language/en.json'), 'utf8');
  assert(firstSearchIndex.includes('org.lexiquest.test.valid'), 'search index includes library metadata');
  assert(firstLanguageIndex.includes('org.lexiquest.test.valid'), 'language index includes library metadata');

  runNode([catalogScript, '--check'], {
    cwd: repo,
    label: 'catalog check passes'
  });

  runNode([catalogScript, '--write'], {
    cwd: repo,
    label: 'catalog write is deterministic'
  });

  const secondCatalog = await readFile(path.join(repo, 'catalog.json'), 'utf8');
  const secondSearchIndex = await readFile(path.join(repo, 'indexes/search.json'), 'utf8');
  assert(firstCatalog === secondCatalog, 'catalog generation is deterministic');
  assert(firstSearchIndex === secondSearchIndex, 'index generation is deterministic');

  await writeFile(path.join(repo, 'catalog.json'), '{\n  "formatVersion": 1,\n  "libraries": []\n}\n', 'utf8');
  runNode([catalogScript, '--check'], {
    cwd: repo,
    label: 'stale catalog check fails',
    expectFailure: true,
    includes: 'catalog.json is stale'
  });

  runNode([catalogScript, '--write'], {
    cwd: repo,
    label: 'catalog rewrite restores indexes'
  });
  await writeFile(path.join(repo, 'indexes/search.json'), '{\n  "formatVersion": 1,\n  "libraries": []\n}\n', 'utf8');
  runNode([catalogScript, '--check'], {
    cwd: repo,
    label: 'stale index check fails',
    expectFailure: true,
    includes: 'indexes/search.json is stale'
  });
}

async function testDuplicateLibraryFails() {
  const repo = await createTempRepository('duplicate-library');
  await writeFixtureZip(path.join(repo, 'libraries/valid-a.zip'));
  await writeFixtureZip(path.join(repo, 'libraries/valid-b.zip'));
  await writeFile(path.join(repo, 'catalog.json'), '{\n  "formatVersion": 1,\n  "libraries": []\n}\n', 'utf8');

  runNode([catalogScript, '--check'], {
    cwd: repo,
    label: 'duplicate id/version fails',
    expectFailure: true,
    includes: 'Duplicate catalog library id/version'
  });
}

async function createTempRepository(name) {
  const repo = path.join(tempRoot, name);
  await mkdir(path.join(repo, 'libraries'), { recursive: true });
  return repo;
}

async function writeFixtureZip(fileName, entries = createValidEntries()) {
  const zipPath = path.isAbsolute(fileName) ? fileName : path.join(tempRoot, fileName);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await writeFile(zipPath, createZip(entries));
  return zipPath;
}

function createValidEntries() {
  return {
    'manifest.yaml': `formatVersion: 1
id: org.lexiquest.test.valid
version: "1.0.0"
name:
  en: Test Library
description:
  en: Test package
languages:
  - cs
  - en
languagePair: cs-en
adventure: adventure.yaml
dictionary:
  - dictionary/core.yaml
quests:
  - quests/quest-01.yaml
authors:
  - LexiQuest
license: CC-BY-4.0
tags:
  - test
minimumAppVersion: "0.1.0"
`,
    'adventure.yaml': `id: test-adventure
title:
  en: Test Adventure
questRefs:
  - quests/quest-01.yaml
`,
    'dictionary/core.yaml': `senses:
  - id: hello
    imageRefs:
      - images/hello.webp
    terms:
      en:
        - value: hello
          preferred: true
          audio:
            - audio/en/hello.mp3
      cs:
        - value: ahoj
          preferred: true
`,
    'quests/quest-01.yaml': `id: quest-01
title:
  en: First Quest
senseIds:
  - hello
quizTypes:
  - listen-picture
`,
    'images/hello.webp': Buffer.from([1, 2, 3, 4]),
    'audio/en/hello.mp3': Buffer.from([1, 2, 3, 4])
  };
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8'
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const passed = options.expectFailure ? result.status !== 0 : result.status === 0;
  assert(passed, `${options.label} returned ${result.status}\n${output}`);

  if (options.includes) {
    assert(output.includes(options.includes), `${options.label} output did not include ${options.includes}\n${output}`);
  }
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [entryName, entryValue] of Object.entries(entries)) {
    const name = Buffer.from(entryName, 'utf8');
    const data = Buffer.isBuffer(entryValue) ? entryValue : Buffer.from(String(entryValue), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createCrcTable() {
  return new Uint32Array(256).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

function crc32(buffer) {
  const table = createCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}



