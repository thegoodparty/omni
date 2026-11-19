#!/usr/bin/env node
// Duration-aware sharding. Playwright's own --shard cuts the suite into equal
// test COUNTS in file order, so one shard collects every long contacts and
// 10DLC test and finishes minutes after the rest. This assigns each test to
// the least-loaded shard, longest first, using the durations of the last main
// run, and prints the `file:line` locations for one shard.
//
//   node plan-shards.mjs durations <results.json>
//     -> prints {"<file> › <title path>": seconds} from a JSON-reporter result
//   node plan-shards.mjs plan <list.json> <durations.json|''> <shard> <total>
//     -> prints this shard's locations, one per line
//
// <list.json> is `playwright test --list --reporter=json` with the same
// filters the shard run uses. A test with no recorded duration (new or
// renamed) is planned at the median, so a missing or stale durations file
// degrades to a count split, never to a broken run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const specsOf = (report) => {
  const out = []
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      out.push({ spec, key: [spec.file, ...path, spec.title].join(' › ') })
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title])
  }
  for (const fileSuite of report.suites ?? []) walk(fileSuite, [])
  return out
}

const [mode, ...args] = process.argv.slice(2)

if (mode === 'durations') {
  const durations = {}
  for (const { spec, key } of specsOf(
    JSON.parse(readFileSync(args[0], 'utf8')),
  )) {
    const results = spec.tests.flatMap((t) => t.results)
    const last = results[results.length - 1]
    if (last) durations[key] = Math.round(last.duration / 100) / 10
  }
  process.stdout.write(JSON.stringify(durations))
} else if (mode === 'plan') {
  const [listPath, durationsPath, shardArg, totalArg] = args
  const list = JSON.parse(readFileSync(listPath, 'utf8'))
  let durations = {}
  try {
    durations = durationsPath
      ? JSON.parse(readFileSync(durationsPath, 'utf8'))
      : {}
  } catch {
    console.error(`[plan-shards] no usable durations at ${durationsPath}`)
  }
  const known = Object.values(durations).sort((a, b) => a - b)
  const median = known.length ? known[Math.floor(known.length / 2)] : 30

  // Tests in a serial block depend on each other, so their whole file must
  // land on one shard. Several tests generated in a loop share one line, and
  // a `file:line` filter runs all of them, so the line is the unit.
  const testDir = list.config.rootDir ?? list.config.projects?.[0]?.testDir
  const serialFiles = new Map()
  const isSerial = (file) => {
    if (!serialFiles.has(file)) {
      const src = readFileSync(join(testDir, file), 'utf8')
      serialFiles.set(file, /describe\.serial|mode:\s*'serial'/.test(src))
    }
    return serialFiles.get(file)
  }
  const units = new Map()
  for (const { spec, key } of specsOf(list)) {
    const location = isSerial(spec.file)
      ? join(testDir, spec.file)
      : `${join(testDir, spec.file)}:${spec.line}`
    const seconds = (durations[key] ?? median) * spec.tests.length
    units.set(location, (units.get(location) ?? 0) + seconds)
  }

  const total = Number(totalArg)
  const loads = Array.from({ length: total }, () => ({
    seconds: 0,
    locations: [],
  }))
  const ordered = [...units].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  for (const [location, seconds] of ordered) {
    const lightest = loads.reduce((min, l) =>
      l.seconds < min.seconds ? l : min,
    )
    lightest.seconds += seconds
    lightest.locations.push(location)
  }
  const mine = loads[Number(shardArg) - 1]
  console.error(
    `[plan-shards] ${units.size} units, ${known.length} known durations; ` +
      `planned seconds per shard: ${loads.map((l) => Math.round(l.seconds)).join(' ')}`,
  )
  process.stdout.write(mine.locations.join('\n'))
} else {
  console.error(
    'usage: plan-shards.mjs durations <results.json> | plan <list.json> <durations.json> <shard> <total>',
  )
  process.exit(2)
}
