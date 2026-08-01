import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateLibraryPackage } from './library-package-utils.mjs';

const packagePaths = await expandPackageArgs(process.argv.slice(2));

if (packagePaths.length === 0) {
  throw new Error('No library ZIP packages found. Pass libraries/*.zip or one or more ZIP paths.');
}

for (const packagePath of packagePaths) {
  const metadata = await validateLibraryPackage(packagePath);
  console.log(`Valid ${metadata.id}@${metadata.version}`);
  console.log(`- path: ${path.relative(process.cwd(), packagePath).replaceAll(path.sep, '/')}`);
  console.log(`- sizeBytes: ${metadata.sizeBytes}`);
  console.log(`- sha256: ${metadata.sha256}`);
}

console.log(`Validated ${packagePaths.length} package${packagePaths.length === 1 ? '' : 's'}.`);

async function expandPackageArgs(args) {
  const expanded = [];
  const rawArgs = args.length > 0 ? args : ['libraries/*.zip'];

  for (const arg of rawArgs) {
    if (arg.includes('*')) {
      expanded.push(...await expandSimpleZipGlob(arg));
    } else {
      expanded.push(path.resolve(arg));
    }
  }

  return [...new Set(expanded)].sort((left, right) => left.localeCompare(right));
}

async function expandSimpleZipGlob(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  if (!normalized.endsWith('/*.zip')) {
    throw new Error(`Only simple directory ZIP globs are supported: ${pattern}`);
  }

  const directory = path.resolve(normalized.slice(0, -'/*.zip'.length));
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
    .map((entry) => path.join(directory, entry.name));
}
