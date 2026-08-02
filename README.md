# LexiQuest Libraries

This repository publishes resource-only Adventure libraries for LexiQuest.

The app-facing entry point is:

```text
catalog.json
```

Published libraries are ZIP packages under `libraries/<language-pair>/<library-slug>/releases/<version>/library.zip`. The app does not consume unpacked source folders directly, and published library sources are not kept in this repository. Optional generated indexes under `indexes/` are derived from the same validated package metadata as `catalog.json`.

## Current commands

```powershell
npm ci
npm run library:validate
npm run library:catalog
npm run library:catalog:check
npm test
npm run library:check
```

`library:validate` validates every recursive release package ZIP under `libraries/**/*.zip`.

`library:catalog` regenerates deterministic `catalog.json` and optional `indexes/*.json` from the ZIP packages, including SHA-256 checksums and ZIP sizes.

`library:catalog:check` fails when the committed catalog or generated indexes are stale.

`npm test` creates temporary ZIP fixtures and checks valid packages, missing references, unsafe paths, executable files, oversized media, duplicate catalog entries, deterministic catalog generation, and stale catalog detection.

## Package safety

Library packages are data and media only. The validator rejects executable/code files, SVG files for MVP, unsafe paths, wrapper directories, unsupported file types, missing references, and size-limit violations.

## Published packages

- `libraries/cs-en/super-minds-second-edition-starter-companion/releases/1.0.0/library.zip`
- `libraries/cs-en/super-minds-second-edition-starter-template/releases/1.0.0/library.zip`

More libraries can be added by committing a valid release ZIP at `libraries/<language-pair>/<library-slug>/releases/<version>/library.zip`, running `npm run library:catalog`, and committing the updated `catalog.json` plus generated `indexes/` files.




