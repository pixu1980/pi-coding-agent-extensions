/**
 * pi-statusline - render bench quiet decision (PERF-10)
 *
 * The bench's wall-time budgets are only meaningful on an idle machine, so the
 * decision of whether to enforce them is separated from the bench process.
 * The bench exits, so an arm it does not take can never be observed from
 * inside it; as a pure function the decision has a test instead.
 */

/**
 * Decide whether wall-time budgets are enforced or reported.
 *
 * Unset: measure the machine, enforced when loadavg(1m) is below the core
 * count. `PI_BENCH_QUIET=1` forces the enforced arm, `PI_BENCH_QUIET=0` forces
 * the reporting arm; any other value falls back to measuring.
 *
 * @param {{ coreCount: number, loadOneMinute: number, override?: string }} input
 * @returns {{ quiet: boolean, source: "forced" | "measured" }}
 */
export function resolveQuietArm({ coreCount, loadOneMinute, override }) {
  const forced = override?.trim();

  if (forced === "1") {
    return { quiet: true, source: "forced" };
  }

  if (forced === "0") {
    return { quiet: false, source: "forced" };
  }

  return { quiet: loadOneMinute < coreCount, source: "measured" };
}
