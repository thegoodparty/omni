# Nest boot speed spike (no PR)

Report: `/tmp/gp-api-test-audit/round2/nest-boot-speed.md`.

- `src/nest-boot-bench.test.ts`: in-process boot loop. Skipped unless `BENCH_RUNS` is set.
  `BENCH_VARIANTS=base,all,lazy,...` interleaves variants per boot (monkey-patched Nest DI,
  lazy Prisma passthrough, Nest factory options). `BENCH_CPU_PROFILE=<file>` writes a CPU profile.
- `@nestjs+core+11.1.27.patch`: the DI patch in patch-package format.
- `nb-proc.py`: process-level A/B (Node version, NODE_OPTIONS, Nest version swapped in node_modules).
- `run-nest-full.sh`: one full suite on the per-file-boot harness (99591655f6 harness plus
  bebd44bb2b phase marks, copied to `/tmp/gp-api-test-audit/round2/nest/harness/`).
- Spike-only toggles: `SPIKE_LAZY_PASSTHROUGH` (prisma.util.ts), `SPIKE_FS_MODULE_CACHE`
  (vitest.config.ts), `SPIKE_SKIP_NODE_GUARD` (contracts node guard), `globalThis.__spikeNestOptions`
  and `__spikeSkipUseLogger` (app.ts).
