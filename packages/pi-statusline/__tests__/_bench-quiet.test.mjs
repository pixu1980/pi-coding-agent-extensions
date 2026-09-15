/**
 * pi-statusline - render bench quiet decision suite
 *
 * PERF-10 left the auto-detection comparison unexercised: the bench can only
 * prove the arms its override forces, and it cannot prove the measurement it
 * does on an idle host from a busy one. The decision is a pure function, so
 * every arm is asserted here instead.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveQuietArm } from "../bench/_quiet.mjs";

describe("resolveQuietArm", () => {
	it("measures the machine when no override is set", () => {
		assert.deepEqual(resolveQuietArm({ coreCount: 10, loadOneMinute: 3 }), { quiet: true, source: "measured" });
		assert.deepEqual(resolveQuietArm({ coreCount: 10, loadOneMinute: 11 }), { quiet: false, source: "measured" });
	});

	it("treats a load equal to the core count as loaded", () => {
		assert.equal(resolveQuietArm({ coreCount: 10, loadOneMinute: 10 }).quiet, false);
	});

	it("enforces when PI_BENCH_QUIET=1, whatever the machine reports", () => {
		assert.deepEqual(resolveQuietArm({ coreCount: 1, loadOneMinute: 99, override: "1" }), {
			quiet: true,
			source: "forced",
		});
		assert.deepEqual(resolveQuietArm({ coreCount: 99, loadOneMinute: 0, override: " 1 " }), {
			quiet: true,
			source: "forced",
		});
	});

	it("reports when PI_BENCH_QUIET=0, whatever the machine reports", () => {
		assert.deepEqual(resolveQuietArm({ coreCount: 99, loadOneMinute: 0, override: "0" }), {
			quiet: false,
			source: "forced",
		});
	});

	it("falls back to measuring on any other override value", () => {
		for (const override of ["", "true", "2", "yes"]) {
			assert.equal(resolveQuietArm({ coreCount: 10, loadOneMinute: 1, override }).source, "measured", override);
		}
	});
});
