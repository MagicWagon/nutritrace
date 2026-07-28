/**
 * version-source.js — resolves the server's APP_VERSION at boot.
 *
 * Imports the SAME constant the web client uses (src/lib/version.js).
 * Env var override (TRACEAPPS_APP_VERSION) is honored first so Docker
 * builds can inject an authoritative value without needing the src/
 * directory in the runtime image.
 *
 * Earlier iteration read package.json via readFileSync + a relative
 * path from `import.meta.url`; that worked locally but resolved to
 * 'unknown' inside the deployed Docker container because the compiled
 * runtime layout differs from the source tree. Importing the shared
 * constant sidesteps the whole path-resolution question.
 */
import { APP_VERSION as CLIENT_APP_VERSION } from '../../src/lib/version.js';

export const APP_VERSION =
  process.env.TRACEAPPS_APP_VERSION ||
  CLIENT_APP_VERSION ||
  'unknown';
