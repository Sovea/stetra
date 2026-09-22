import { fileURLToPath } from 'node:url';

// This module lives in src/; bundled entry points live in dist/.
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
