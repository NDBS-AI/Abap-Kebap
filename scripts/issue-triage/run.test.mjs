import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, main } from './run.mjs'
import { NEEDS_INFO, PASS_COMMENT, TRIAGE_MARKER } from './triage.mjs'
import { contributionBody } from './fixtures.mjs'

const BOT = { login: 'github-actions[bot]' }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

// A fake GitHub: issue #7 in repo o/r, with the given labels, body and comments.
function harness({ labels, body = contributionBody(), comments = [], failWith = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'issue-triage-'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(join(skillsDir, 'abap-clean-style'), { recursive: true })
  writeFileSync(join(skillsDir, 'abap-clean-style', 'SKILL.md'), '---\nname: abap-clean-style\n---\n')
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ issue: { number: 7 }, repository: { default_branch: 'main' } }))
  const calls = []
  const headers = []
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url)
    calls.push({ method: init.method, path: pathname, body: init.body ? JSON.parse(init.body) : undefined })
    headers.push(init.headers)
    const status = failWith[`${init.method} ${pathname}`]
    if (status) return json({ message: 'failed' }, status)
    if (init.method === 'GET' && pathname === '/repos/o/r/issues/7') {
      return json({ number: 7, title: 'A title', body, labels: labels.map((name) => ({ name })) })
    }
    if (init.method === 'GET' && pathname === '/repos/o/r/issues/7/comments') {
      const page = Number(searchParams.get('page'))
      return json(comments.slice((page - 1) * 100, page * 100))
    }
    return json({}, init.method === 'POST' ? 201 : 200)
  }
  const env = {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 'test-token',
    GITHUB_SERVER_URL: 'https://github.com',
  }
  return {
    options: { env, fetchImpl, skillsDir, log: () => {} },
    calls,
    headers,
    writes: () => calls.filter((call) => call.method !== 'GET'),
  }
}

test('listSkills returns sorted folders that contain SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'))
  for (const name of ['rap-eml', 'abap-odata', 'no-skill-md']) mkdirSync(join(dir, name))
  writeFileSync(join(dir, 'rap-eml', 'SKILL.md'), '')
  writeFileSync(join(dir, 'abap-odata', 'SKILL.md'), '')
  writeFileSync(join(dir, 'README.md'), '')
  assert.deepEqual(listSkills(dir), ['abap-odata', 'rap-eml'])
  assert.deepEqual(listSkills(join(dir, 'missing')), [])
})

test('an issue without an intake type label is left alone', async () => {
  const h = harness({ labels: ['bug'] })
  await main(h.options)
  assert.deepEqual(h.writes(), [])
})

test('requests carry the GitHub API headers and the token', async () => {
  const h = harness({ labels: ['bug'] })
  await main(h.options)
  assert.equal(h.headers[0].Authorization, 'Bearer test-token')
  assert.equal(h.headers[0].Accept, 'application/vnd.github+json')
  assert.equal(h.headers[0]['X-GitHub-Api-Version'], '2022-11-28')
})

test('a failing issue gets needs-info and one new comment', async () => {
  const h = harness({ labels: ['skill-contribution'], body: contributionBody({ 'Skill slug': 'abap-clean-style' }) })
  await main(h.options)
  const writes = h.writes()
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[0], { method: 'POST', path: '/repos/o/r/issues/7/labels', body: { labels: [NEEDS_INFO] } })
  assert.equal(writes[1].method, 'POST')
  assert.equal(writes[1].path, '/repos/o/r/issues/7/comments')
  assert.ok(writes[1].body.body.startsWith(TRIAGE_MARKER))
  assert.ok(writes[1].body.body.includes('https://github.com/o/r/blob/main/CONTRIBUTING.md'))
})

test('a fixed issue loses needs-info and its comment found on page 2 flips to passing', async () => {
  const others = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { login: 'someone' }, body: 'thanks' }))
  const h = harness({
    labels: ['skill-contribution', NEEDS_INFO],
    comments: [...others, { id: 555, user: BOT, body: `${TRIAGE_MARKER}\nold failures` }],
  })
  await main(h.options)
  assert.deepEqual(h.writes(), [
    { method: 'DELETE', path: `/repos/o/r/issues/7/labels/${NEEDS_INFO}`, body: undefined },
    { method: 'PATCH', path: '/repos/o/r/issues/comments/555', body: { body: PASS_COMMENT } },
  ])
  const commentPages = h.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/comments'))
  assert.equal(commentPages.length, 2)
})

test('an unchanged comment is not edited again', async () => {
  const h = harness({ labels: ['skill-contribution'], comments: [{ id: 9, user: BOT, body: PASS_COMMENT }] })
  await main(h.options)
  assert.deepEqual(h.writes(), [])
})

test('a 404 on label removal is tolerated', async () => {
  const h = harness({
    labels: ['skill-contribution', NEEDS_INFO],
    failWith: { [`DELETE /repos/o/r/issues/7/labels/${NEEDS_INFO}`]: 404 },
  })
  await main(h.options)
  assert.deepEqual(h.writes().map((call) => call.method), ['DELETE'])
})

test('any other API error fails the run', async () => {
  const h = harness({
    labels: ['skill-contribution'],
    body: contributionBody({ 'Skill slug': '' }),
    failWith: { 'POST /repos/o/r/issues/7/labels': 500 },
  })
  await assert.rejects(main(h.options), /POST \/repos\/o\/r\/issues\/7\/labels failed with HTTP 500/)
})

test('a missing token fails before any request', async () => {
  const h = harness({ labels: ['skill-contribution'] })
  await assert.rejects(main({ ...h.options, env: { ...h.options.env, GITHUB_TOKEN: '' } }), /GITHUB_TOKEN/)
  assert.deepEqual(h.calls, [])
})
