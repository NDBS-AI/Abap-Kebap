#!/usr/bin/env node
// Refreshes the committed fallback list of partner namespaces.
// Run: npm run update-partner-index   (needs network; GitHub rate limits apply)
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const API_URL = 'https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src/partner'
const TEMPLATE_FILE = 'objectClassifications_NAMESPACE.json'
const FILE_PREFIX = 'objectClassifications_'

const namespaceFromFileName = (fileName) => {
  if (fileName === TEMPLATE_FILE) return null
  if (!fileName.startsWith(FILE_PREFIX) || !fileName.endsWith('.json')) return null
  const middle = fileName.slice(FILE_PREFIX.length, -'.json'.length)
  if (!middle || middle === 'SAP') return null
  return `/${middle.toUpperCase()}/`
}

const response = await fetch(API_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'abap-kebap-released-objects' } })
if (!response.ok) {
  console.error(`Listing failed: ${response.status} ${response.statusText}`)
  process.exit(1)
}

const namespaces = []
for (const item of await response.json()) {
  if (item.type !== 'file') continue
  const namespace = namespaceFromFileName(item.name)
  if (namespace && !namespaces.some((entry) => entry.namespace === namespace)) {
    namespaces.push({ namespace, file: item.name })
  }
}
namespaces.sort((left, right) => left.namespace.localeCompare(right.namespace))

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'partner-index.json')
await writeFile(
  target,
  `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), source: 'https://github.com/SAP/abap-atc-cr-cv-s4hc/tree/main/src/partner', namespaces }, null, 2)}\n`,
  'utf8',
)
console.error(`Wrote ${namespaces.length} namespaces to ${target}`)
