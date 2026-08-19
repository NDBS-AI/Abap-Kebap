#!/usr/bin/env node
// Tier-1 static regression checker. Pure substring grep over repo files.
// Zero model tokens, deterministic. Run: `node evals/run-static.mjs`
// Exit code 0 = all pass, 1 = at least one failure.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

const root = process.cwd()
const cfg = JSON.parse(readFileSync(join(root, 'evals', 'static-checks.json'), 'utf8'))
const exts = cfg.extensions || ['.md', '.json']

function walk(dir, acc) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (exts.some((e) => name.endsWith(e))) acc.push(full)
  }
  return acc
}

// Collect files once; key by repo-relative path with forward slashes.
const files = []
for (const d of cfg.scanDirs) walk(join(root, d), files)
// Also include explicit root-level files (e.g. CLAUDE.md) that live outside scanDirs.
for (const f of cfg.scanFiles || []) {
  const full = join(root, f)
  if (existsSync(full)) files.push(full)
}
const docs = files.map((f) => ({
  path: f.slice(root.length + 1).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}))

function linesWith(text, pattern) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(pattern)) out.push(i + 1)
  return out
}

let failures = 0
const results = []

for (const rule of cfg.rules) {
  if (rule.kind === 'forbidden') {
    let scope = rule.in ? docs.filter((d) => d.path.includes(rule.in)) : docs
    if (rule.exclude && rule.exclude.length) {
      scope = scope.filter((d) => !rule.exclude.some((x) => d.path.includes(x)))
    }
    const hits = []
    for (const d of scope) for (const ln of linesWith(d.text, rule.pattern)) hits.push(`${d.path}:${ln}`)
    if (hits.length) {
      failures++
      results.push({ id: rule.id, pass: false, detail: `forbidden "${rule.pattern}" found at ${hits.join(', ')}` })
    } else {
      results.push({ id: rule.id, pass: true })
    }
  } else if (rule.kind === 'required') {
    const scope = docs.filter((d) => d.path.includes(rule.in))
    if (!scope.length) {
      failures++
      results.push({ id: rule.id, pass: false, detail: `no file matched "${rule.in}"` })
    } else if (!scope.some((d) => d.text.includes(rule.pattern))) {
      failures++
      results.push({ id: rule.id, pass: false, detail: `required "${rule.pattern}" missing from ${rule.in}` })
    } else {
      results.push({ id: rule.id, pass: true })
    }
  } else {
    failures++
    results.push({ id: rule.id, pass: false, detail: `unknown rule kind "${rule.kind}"` })
  }
}

const passed = results.filter((r) => r.pass).length
console.log(`ABAP static checks — ${passed}/${results.length} passed (${docs.length} files scanned)\n`)
for (const r of results) {
  if (r.pass) console.log(`  PASS  ${r.id}`)
  else console.log(`  FAIL  ${r.id} — ${r.detail}`)
}
if (failures) {
  console.log(`\n${failures} failure(s).`)
  process.exitCode = 1
} else {
  console.log(`\nAll static checks passed.`)
}
