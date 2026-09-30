// Issue triage: the I/O shell. Reads the issues event, re-reads the issue, lists the skills,
// and applies what triage.mjs decides through the GitHub REST API. Node 20 built-ins only.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { commentAction, findTriageComment, triage } from './triage.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAGE_SIZE = 100

export function listSkills(skillsDir) {
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

function githubClient({ token, apiUrl, fetchImpl }) {
  return async function request(method, path, { body, allow404 = false } = {}) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'abap-kebap-issue-triage',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 404 && allow404) return null
    if (!response.ok) throw new Error(`${method} ${path.split('?')[0]} failed with HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
}

async function listComments(request, issuePath) {
  const comments = []
  for (let page = 1; ; page += 1) {
    const batch = await request('GET', `${issuePath}/comments?per_page=${PAGE_SIZE}&page=${page}`)
    comments.push(...batch)
    if (batch.length < PAGE_SIZE) return comments
  }
}

export async function main({
  env = process.env,
  fetchImpl = globalThis.fetch,
  skillsDir = join(ROOT, '.claude', 'skills'),
  log = console.log,
} = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const repo = env.GITHUB_REPOSITORY
  const number = event.issue.number
  const issuePath = `/repos/${repo}/issues/${number}`
  const request = githubClient({
    token: env.GITHUB_TOKEN,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    fetchImpl,
  })

  // Re-read the issue: a queued run must judge the current text and labels, not the event's snapshot.
  const issue = await request('GET', issuePath)
  const labels = (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name))
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
  const branch = event.repository?.default_branch ?? 'main'
  const result = triage({
    title: issue.title,
    body: issue.body,
    labels,
    existingSkills: listSkills(skillsDir),
    contributingUrl: `${server}/${repo}/blob/${branch}/CONTRIBUTING.md`,
  })
  if (!result) {
    log(`#${number}: no intake type label, nothing to do`)
    return
  }

  if (result.addLabels.length > 0) {
    await request('POST', `${issuePath}/labels`, { body: { labels: result.addLabels } })
  }
  for (const label of result.removeLabels) {
    await request('DELETE', `${issuePath}/labels/${encodeURIComponent(label)}`, { allow404: true })
  }
  const existing = findTriageComment(await listComments(request, issuePath))
  const action = commentAction({ failures: result.failures, body: result.comment, existing })
  if (action.type === 'create') {
    await request('POST', `${issuePath}/comments`, { body: { body: action.body } })
  }
  if (action.type === 'update') {
    await request('PATCH', `/repos/${repo}/issues/comments/${action.id}`, { body: { body: action.body } })
  }
  log(`#${number} ${result.form}: ${result.failures.length} failure(s), comment ${action.type}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
