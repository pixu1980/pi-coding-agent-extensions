/**
 * pi-statusline - test barrel
 *
 * Entry point for the test suite; imports every suite so `node --test`
 * discovers all tests from a single file.
 */

import './_unit.test.mjs';
import './_e2e.test.mjs';
import './_swr.test.mjs';
import './_cache-stats.test.mjs';
import './_bench-quiet.test.mjs';
