import { readFile, stat } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import YAML from 'yaml';

const openZip = promisify(yauzl.open);

export const LIMITS = {
  maxZipSizeBytes: 50 * 1024 * 1024,
  maxUnpackedSizeBytes: 100 * 1024 * 1024,
  maxSingleImageBytes: 2 * 1024 * 1024,
  maxSingleAudioBytes: 5 * 1024 * 1024,
  maxFileCount: 1000
};

const allowedExtensions = new Set([
  '.yaml',
  '.yml',
  '.json',
  '.md',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.mp3',
  '.ogg',
  '.wav',
  '.m4a'
]);

const executableExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.html',
  '.htm',
  '.svg',
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.php',
  '.py',
  '.rb',
  '.jar',
  '.class'
]);

const manifestNames = ['manifest.yaml', 'manifest.yml', 'manifest.json'];
const adventureNames = ['adventure.yaml', 'adventure.yml', 'adventure.json'];

export async function validateLibraryPackage(zipPath) {
  const absoluteZipPath = path.resolve(zipPath);
  const zipStat = await stat(absoluteZipPath);

  if (zipStat.size > LIMITS.maxZipSizeBytes) {
    throw new Error(`${zipPath} exceeds max ZIP size (${zipStat.size} bytes).`);
  }

  const zipBytes = await readFile(absoluteZipPath);
  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const files = await readZipEntries(absoluteZipPath);
  const errors = [];
  const packagePaths = new Set(files.keys());
  const unpackedSize = [...files.values()].reduce((total, entry) => total + entry.size, 0);

  if (files.size > LIMITS.maxFileCount) {
    errors.push(`Package contains too many files (${files.size}).`);
  }

  if (unpackedSize > LIMITS.maxUnpackedSizeBytes) {
    errors.push(`Package exceeds max unpacked size (${unpackedSize} bytes).`);
  }

  for (const [entryPath, entry] of files) {
    validateEntry(entryPath, entry, errors);
  }

  const manifestPath = manifestNames.find((candidate) => packagePaths.has(candidate));
  const adventurePath = adventureNames.find((candidate) => packagePaths.has(candidate));

  if (!manifestPath) errors.push('Package must contain manifest.yaml, manifest.yml, or manifest.json at ZIP root.');
  if (!adventurePath) errors.push('Package must contain adventure.yaml, adventure.yml, or adventure.json at ZIP root.');

  if (errors.length > 0) {
    throwPackageError(zipPath, errors);
  }

  const manifest = parseDataFile(manifestPath, files.get(manifestPath).data);
  const adventure = parseDataFile(adventurePath, files.get(adventurePath).data);
  validateManifest(manifest, manifestPath, errors);
  validateAdventure(manifest, adventure, adventurePath, errors);
  validateDictionaryAndQuestReferences(manifest, files, errors);

  if (errors.length > 0) {
    throwPackageError(zipPath, errors);
  }

  return {
    zipPath: absoluteZipPath,
    id: manifest.id,
    version: String(manifest.version),
    packageFormatVersion: normalizeFormatVersion(manifest.formatVersion),
    title: manifest.name,
    description: manifest.description,
    languages: normalizeStringArray(manifest.languages),
    languagePair: languagePairFromManifest(manifest),
    difficulty: manifest.difficulty ?? manifest.level,
    targetAges: normalizeTargetAges(manifest),
    authors: normalizeStringArray(manifest.authors),
    license: manifest.license,
    tags: normalizeStringArray(manifest.tags),
    minAppVersion: manifest.minimumAppVersion,
    sizeBytes: zipStat.size,
    sha256,
    fileCount: files.size,
    unpackedSizeBytes: unpackedSize,
    questCount: normalizeStringArray(manifest.lessons ?? manifest.quests).length,
    senseCount: countSenses(manifest, files),
    challengeTypes: collectChallengeTypes(manifest, files),
    hasImages: hasReferencedImages(manifest, files),
    hasAudio: hasReferencedAudio(manifest, files)
  };
}

async function readZipEntries(zipPath) {
  const zipFile = await openZip(zipPath, { lazyEntries: true, autoClose: true });
  const entries = new Map();

  return new Promise((resolve, reject) => {
    zipFile.readEntry();

    zipFile.on('entry', (entry) => {
      if (/\/$/.test(entry.fileName)) {
        zipFile.readEntry();
        return;
      }

      const safePath = normalizeZipPath(entry.fileName);
      if (!safePath) {
        entries.set(entry.fileName, {
          unsafe: true,
          size: entry.uncompressedSize,
          data: Buffer.alloc(0)
        });
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => {
          entries.set(safePath, {
            unsafe: false,
            size: entry.uncompressedSize,
            data: Buffer.concat(chunks)
          });
          zipFile.readEntry();
        });
      });
    });

    zipFile.on('end', () => resolve(entries));
    zipFile.on('error', reject);
  });
}

function validateEntry(entryPath, entry, errors) {
  if (entry.unsafe) {
    errors.push(`Unsafe ZIP entry path: ${entryPath}`);
    return;
  }

  const extension = path.posix.extname(entryPath).toLowerCase();
  if (executableExtensions.has(extension)) {
    errors.push(`Executable or unsafe file type is not allowed: ${entryPath}`);
  } else if (!allowedExtensions.has(extension)) {
    errors.push(`Unsupported file type: ${entryPath}`);
  }

  if (isImagePath(entryPath) && entry.size > LIMITS.maxSingleImageBytes) {
    errors.push(`Image exceeds max size: ${entryPath}`);
  }

  if (isAudioPath(entryPath) && entry.size > LIMITS.maxSingleAudioBytes) {
    errors.push(`Audio exceeds max size: ${entryPath}`);
  }
}

function validateManifest(manifest, manifestPath, errors) {
  requireValue(isObject(manifest), `${manifestPath} must be an object.`, errors);
  requireValue(isFormatV1Compatible(manifest.formatVersion), 'manifest formatVersion must be v1 compatible.', errors);
  requireValue(typeof manifest.id === 'string' && manifest.id.length > 0, 'manifest id is required.', errors);
  requireValue(typeof manifest.version === 'string' || typeof manifest.version === 'number', 'manifest version is required.', errors);
  requireValue(isLocalizedText(manifest.name), 'manifest name/title must be localized text or string.', errors);
  requireValue(Array.isArray(manifest.languages) && manifest.languages.length >= 2, 'manifest languages must contain at least two languages.', errors);
  requireValue(Array.isArray(manifest.dictionary) && manifest.dictionary.length > 0, 'manifest dictionary must list files.', errors);
  requireValue(Array.isArray(manifest.quests ?? manifest.lessons) && (manifest.quests ?? manifest.lessons).length > 0, 'manifest quests/lessons must list files.', errors);
  requireValue(typeof manifest.adventure === 'string', 'manifest adventure must reference adventure.yaml/json.', errors);
  requireValue(Array.isArray(manifest.authors) && manifest.authors.length > 0, 'manifest authors are required.', errors);
  requireValue(typeof manifest.license === 'string' && manifest.license.length > 0, 'manifest license is required.', errors);
}

function validateAdventure(manifest, adventure, adventurePath, errors) {
  requireValue(isObject(adventure), `${adventurePath} must be an object.`, errors);
  if (manifest.adventure && manifest.adventure !== adventurePath) {
    errors.push(`manifest adventure references ${manifest.adventure}, but ZIP root contains ${adventurePath}.`);
  }
  for (const questRef of normalizeStringArray(adventure.questRefs)) {
    if (!normalizeStringArray(manifest.quests ?? manifest.lessons).includes(questRef)) {
      errors.push(`${adventurePath} references unknown Quest ${questRef}.`);
    }
  }
}

function validateDictionaryAndQuestReferences(manifest, files, errors) {
  const senseIds = new Set();

  for (const dictionaryPath of normalizeStringArray(manifest.dictionary)) {
    const dictionary = parsePackageData(files, dictionaryPath, errors);
    const senses = normalizeArray(dictionary?.senses ?? dictionary?.items);

    for (const sense of senses) {
      if (!sense?.id || senseIds.has(sense.id)) {
        errors.push(`Duplicate or missing sense id in ${dictionaryPath}.`);
      } else {
        senseIds.add(sense.id);
      }

      for (const imageRef of normalizeArray(sense?.picture ?? sense?.image ?? sense?.imageRefs)) {
        requirePackagePath(files, imageRef, `${sense?.id ?? dictionaryPath} image`, errors);
      }

      for (const [language, terms] of Object.entries(sense?.terms ?? {})) {
        for (const [index, term] of normalizeArray(terms).entries()) {
          requireValue(typeof (term?.text ?? term?.value) === 'string', `${sense?.id}.${language}[${index}] text is required.`, errors);
          for (const audioRef of normalizeArray(term?.audio)) {
            requirePackagePath(files, audioRef, `${sense?.id}.${language}[${index}] audio`, errors);
          }
        }
      }

      for (const [language, refs] of Object.entries(sense?.audioRefs ?? {})) {
        for (const audioRef of normalizeArray(refs)) {
          requirePackagePath(files, audioRef, `${sense?.id}.${language} audio`, errors);
        }
      }
    }
  }

  for (const questPath of normalizeStringArray(manifest.quests ?? manifest.lessons)) {
    const quest = parsePackageData(files, questPath, errors);
    requireValue(isObject(quest), `${questPath} must be an object.`, errors);
    requireValue(typeof quest?.id === 'string', `${questPath} id is required.`, errors);
    requireValue(isLocalizedText(quest?.title), `${questPath} title must be localized text.`, errors);

    for (const senseId of normalizeStringArray(quest?.senseIds ?? quest?.vocabularyIds ?? quest?.vocabulary)) {
      if (!senseIds.has(senseId)) {
        errors.push(`${questPath} references unknown sense ${senseId}.`);
      }
    }
  }
}

function parsePackageData(files, entryPath, errors) {
  if (!files.has(entryPath)) {
    errors.push(`Required package file is missing: ${entryPath}`);
    return undefined;
  }

  try {
    return parseDataFile(entryPath, files.get(entryPath).data);
  } catch (error) {
    errors.push(`${entryPath} could not be parsed: ${error instanceof Error ? error.message : 'Unknown parse error'}`);
    return undefined;
  }
}

function parseDataFile(entryPath, buffer) {
  const content = buffer.toString('utf8');
  return path.posix.extname(entryPath).toLowerCase() === '.json'
    ? JSON.parse(content)
    : YAML.parse(content);
}

function requirePackagePath(files, entryPath, owner, errors) {
  if (typeof entryPath !== 'string') {
    errors.push(`${owner} reference must be a string.`);
    return;
  }

  const safePath = normalizeZipPath(entryPath);
  if (!safePath || !files.has(safePath)) {
    errors.push(`${owner} is missing: ${entryPath}`);
  }
}

function normalizeZipPath(entryPath) {
  if (
    typeof entryPath !== 'string' ||
    entryPath.includes('\\') ||
    entryPath.startsWith('/') ||
    /^[a-z]:/i.test(entryPath)
  ) {
    return '';
  }

  const normalized = path.posix.normalize(entryPath);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    return '';
  }

  return normalized;
}

function countSenses(manifest, files) {
  return normalizeStringArray(manifest.dictionary).reduce((total, dictionaryPath) => {
    const dictionary = parseDataFile(dictionaryPath, files.get(dictionaryPath).data);
    return total + normalizeArray(dictionary.senses ?? dictionary.items).length;
  }, 0);
}

function collectChallengeTypes(manifest, files) {
  const types = new Set();
  for (const questPath of normalizeStringArray(manifest.quests ?? manifest.lessons)) {
    const quest = parseDataFile(questPath, files.get(questPath).data);
    for (const type of normalizeStringArray(quest.quizTypes ?? quest.legacyHints?.quizTypes)) {
      types.add(type);
    }
    for (const challenge of normalizeArray(quest.challenges ?? quest.legacyHints?.challenges)) {
      if (typeof challenge.quizType === 'string') types.add(challenge.quizType);
    }
  }
  return [...types].sort();
}

function hasReferencedImages(manifest, files) {
  return normalizeStringArray(manifest.dictionary).some((dictionaryPath) => {
    const dictionary = parseDataFile(dictionaryPath, files.get(dictionaryPath).data);
    return normalizeArray(dictionary.senses ?? dictionary.items).some(
      (sense) => normalizeArray(sense.picture ?? sense.image ?? sense.imageRefs).length > 0
    );
  });
}

function hasReferencedAudio(manifest, files) {
  return normalizeStringArray(manifest.dictionary).some((dictionaryPath) => {
    const dictionary = parseDataFile(dictionaryPath, files.get(dictionaryPath).data);
    return normalizeArray(dictionary.senses ?? dictionary.items).some((sense) =>
      Object.values(sense.terms ?? {}).some((terms) =>
        normalizeArray(terms).some((term) => normalizeArray(term.audio).length > 0)
      ) || Object.values(sense.audioRefs ?? {}).some((refs) => normalizeArray(refs).length > 0)
    );
  });
}

function languagePairFromManifest(manifest) {
  const languages = normalizeStringArray(manifest.languages);
  const explicit = manifest.languagePair ?? manifest.canonicalPair;
  const [source, target] = typeof explicit === 'string'
    ? explicit.split('-')
    : languages;

  return {
    source: source ?? languages[0] ?? '',
    target: target ?? languages[1] ?? ''
  };
}

function normalizeTargetAges(manifest) {
  if (Array.isArray(manifest.targetAges)) return manifest.targetAges;
  const min = Number(manifest.audience?.minAge);
  const max = Number(manifest.audience?.maxAge);
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : undefined;
}

function normalizeStringArray(value) {
  return normalizeArray(value)
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item));
}

function normalizeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeFormatVersion(value) {
  const version = Number.parseFloat(String(value));
  return Number.isFinite(version) ? Math.trunc(version) : 1;
}

function isFormatV1Compatible(value) {
  return normalizeFormatVersion(value) === 1;
}

function isLocalizedText(value) {
  return typeof value === 'string' || Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImagePath(entryPath) {
  return /\.(?:png|jpe?g|webp)$/i.test(entryPath);
}

function isAudioPath(entryPath) {
  return /\.(?:mp3|ogg|wav|m4a)$/i.test(entryPath);
}

function requireValue(condition, message, errors) {
  if (!condition) errors.push(message);
}

function throwPackageError(zipPath, errors) {
  throw new Error(`Invalid library package ${zipPath}:\n- ${errors.join('\n- ')}`);
}
