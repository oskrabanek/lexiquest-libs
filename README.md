# LexiQuest Libraries

This repository publishes resource-only Adventure libraries for LexiQuest.

The app-facing entry point is:

```text
catalog.json
```

Published libraries are ZIP packages under top-level `libraries/*.zip`. The app does not consume unpacked source folders directly.

## Current commands

```powershell
npm ci
npm run library:validate
npm run library:catalog
npm run library:catalog:check
npm run library:check
```

`library:validate` validates every top-level package ZIP.

`library:catalog` regenerates deterministic `catalog.json` from the ZIP packages, including SHA-256 checksums and ZIP sizes.

`library:catalog:check` fails when the committed catalog is stale.

## Package safety

Library packages are data and media only. The validator rejects executable/code files, SVG files for MVP, unsafe paths, wrapper directories, unsupported file types, missing references, and size-limit violations.

## Published packages

- `libraries/cs-en-super-minds-2-starter-companion-1.0.0.zip`

More libraries can be added by committing a valid ZIP to `libraries/`, running `npm run library:catalog`, and committing the updated `catalog.json`.
