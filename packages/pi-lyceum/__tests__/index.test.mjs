/**
 * pi-lyceum - test barrel
 *
 * Entry point for the suite; imports every file so `node --test` discovers all
 * tests from a single command, matching the rest of the monorepo.
 */

import './_api-key.test.mjs';
import './_catalog.test.mjs';
import './_discovery.test.mjs';
import './_extension.test.mjs';
import './source-egress.test.mjs';
