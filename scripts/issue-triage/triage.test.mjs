import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMS, TYPE_LABELS, detectForm, parseForm, findSensitive, normalizeSlug, checkSlug,
  normalizeDescription, checkDescription, extractUrls, isPublicSapSource, checkSources, forCodeSpan,
  MAX_SLUG_LENGTH, MAX_DESCRIPTION_CHARS,
  NEEDS_INFO, TRIAGE_MARKER, PASS_COMMENT, derivedLabels, runChecks, triage, renderComment,
  commentAction, findTriageComment,
} from './triage.mjs'
import {
  renderIssue, contributionBody, wrongOutputBody, improvementBody, requestBody, GOOD_DESCRIPTION,
} from './fixtures.mjs'

const SKILLS = ['abap-clean-style', 'abap-odata']
const CONTRIBUTION = FORMS['skill-contribution'].fields
const FIELD = 'What did it produce?'
const sensitive = (text) => findSensitive([{ field: FIELD, text }])

// --- form detection and parsing ---

test('TYPE_LABELS lists the four forms in chooser order', () => {
  assert.deepEqual(TYPE_LABELS, ['wrong-output', 'skill-improvement', 'skill-request', 'skill-contribution'])
})

test('detectForm picks the type label and ignores the rest', () => {
  assert.equal(detectForm(['needs-info', 'skill-request']), 'skill-request')
  assert.equal(detectForm(['bug']), null)
  assert.equal(detectForm([]), null)
})

test('parseForm maps each heading to its trimmed value', () => {
  const { fields, preamble } = parseForm(contributionBody(), CONTRIBUTION)
  assert.equal(fields['Skill slug'], 'abap-channels')
  assert.equal(fields['Frontmatter description'], GOOD_DESCRIPTION)
  assert.equal(preamble, '')
})

test('parseForm maps _No response_ to an empty string', () => {
  assert.equal(parseForm(contributionBody({ Sources: '' }), CONTRIBUTION).fields.Sources, '')
})

test('parseForm tolerates CRLF line endings', () => {
  const { fields } = parseForm(contributionBody().replace(/\n/g, '\r\n'), CONTRIBUTION)
  assert.equal(fields['Skill slug'], 'abap-channels')
  assert.ok(!fields['Which agents would use it?'].includes('\r'))
})

test('parseForm returns empty fields for a null or blank body', () => {
  for (const body of [null, undefined, '']) {
    const { fields, preamble } = parseForm(body, CONTRIBUTION)
    assert.equal(preamble, '')
    assert.ok(CONTRIBUTION.every((heading) => fields[heading] === ''))
  }
})

test('parseForm keeps a ### line that is not a field heading inside the answer', () => {
  const answer = 'First part.\n\n### Notes from the run\n\nSecond part.'
  assert.equal(parseForm(contributionBody({ 'Scope summary': answer }), CONTRIBUTION).fields['Scope summary'], answer)
})

test('parseForm keeps text before the first heading as the preamble', () => {
  const { preamble, fields } = parseForm(`Added by hand.\n\n${contributionBody()}`, CONTRIBUTION)
  assert.equal(preamble, 'Added by hand.')
  assert.equal(fields['Skill slug'], 'abap-channels')
})

test('parseForm joins the values of a repeated heading', () => {
  const body = `${renderIssue({ Sources: 'https://help.sap.com/a' })}\n\n${renderIssue({ Sources: 'https://help.sap.com/b' })}`
  assert.equal(parseForm(body, CONTRIBUTION).fields.Sources, 'https://help.sap.com/a\n\nhttps://help.sap.com/b')
})

// --- sensitive content ---

test('findSensitive flags credential literals in ABAP and other code', () => {
  for (const text of [
    "lv_password = 'Init1234'.",
    "DATA(lv_password) = 'Init1234'.",
    "CONSTANTS lc_password TYPE string VALUE 'Init1234'.",
    'lv_api_key = `abcd1234efgh`.',
    'lv_secret = |abcd1234|.',
    'clientSecret: "abcd1234"',
  ]) {
    assert.deepEqual(sensitive(text), [{ kind: 'a password or key literal', field: FIELD }], text)
  }
})

test('findSensitive flags assignments, auth headers, private keys and URL credentials', () => {
  assert.deepEqual(sensitive('password=abc123'), [{ kind: 'a password or key assignment', field: FIELD }])
  assert.deepEqual(sensitive('https://host.example.com/sap?sap-client=100&pwd=abc123'), [{ kind: 'a password or key assignment', field: FIELD }])
  assert.deepEqual(sensitive('Authorization: Basic dXNlcjpwYXNzd29yZA=='), [{ kind: 'an HTTP authorization header', field: FIELD }])
  assert.deepEqual(sensitive('-----BEGIN RSA PRIVATE KEY-----'), [{ kind: 'a private key', field: FIELD }])
  assert.deepEqual(sensitive('https://user:s3cret99@host.example.com/'), [{ kind: 'credentials in a URL', field: FIELD }])
})

test('findSensitive ignores variable assignments, prose and redaction placeholders', () => {
  for (const text of [
    'lv_password = iv_password.',
    'Enter the password in the logon screen.',
    "lv_password = '****'.",
    "lv_password = 'xxxxxxxx'.",
    "lv_password = '<redacted>'.",
    'password=<redacted>',
    'Authorization: Bearer xxxxxxxxxxxx',
    'https://user:****@host.example.com/sap/bc',
  ]) {
    assert.deepEqual(sensitive(text), [], text)
  }
})

test('findSensitive flags JSON and YAML quoted keys', () => {
  for (const text of [
    '{"user":"x","password":"Init1234"}',
    '"client_secret": "abcd1234efgh"',
    "{'api_key': 'abcd1234efgh'}",
  ]) {
    assert.deepEqual(sensitive(text), [{ kind: 'a password or key literal', field: FIELD }], text)
  }
})

test('findSensitive flags prefixed assignment names such as sap-password and DB_PASSWORD', () => {
  for (const text of [
    'https://host.example.com/sap/bc/x?sap-user=DEV&sap-password=Init1234',
    'DB_PASSWORD=hunter2xx',
    'X-Api-Key=abcd1234efgh',
  ]) {
    assert.deepEqual(sensitive(text), [{ kind: 'a password or key assignment', field: FIELD }], text)
  }
})

test('findSensitive still ignores placeholders behind quoted keys and prefixed names', () => {
  for (const text of ['{"password": "<redacted>"}', '{"password":"****"}', 'sap-password=<redacted>', 'DB_PASSWORD=****']) {
    assert.deepEqual(sensitive(text), [], text)
  }
})

test('findSensitive reports each kind once per field and never the matched text', () => {
  const hits = findSensitive([{ field: 'Title', text: "lv_pwd = 'abcd1234'. lv_password = 'Init1234'." }])
  assert.deepEqual(hits, [{ kind: 'a password or key literal', field: 'Title' }])
  assert.ok(!JSON.stringify(hits).includes('Init1234'))
})

// --- slug ---

test('normalizeSlug trims whitespace and wrapping backticks', () => {
  assert.equal(normalizeSlug('  `abap-channels`  '), 'abap-channels')
  assert.equal(normalizeSlug(null), '')
})

test('checkSlug accepts a new kebab-case slug with a known prefix', () => {
  for (const slug of ['abap-channels', 'rap-draft', 'cds-analytics', 'fiori-elements-charts', 'enhancements-badi-filters']) {
    assert.deepEqual(checkSlug(slug, SKILLS, { required: true }), [], slug)
  }
})

test('checkSlug accepts exactly the maximum length', () => {
  const slug = `abap-${'a'.repeat(MAX_SLUG_LENGTH - 5)}`
  assert.equal(slug.length, MAX_SLUG_LENGTH)
  assert.deepEqual(checkSlug(slug, SKILLS, { required: true }), [])
})

test('checkSlug rejects a wrong prefix, case, characters or length', () => {
  for (const slug of ['channels', 'ABAP-Channels', 'abap_channels', 'abap-', 'abap--channels', 'abap-channels-', 'sap-channels', `abap-${'a'.repeat(MAX_SLUG_LENGTH)}`]) {
    assert.deepEqual(checkSlug(slug, SKILLS, { required: true }).map((f) => f.id), ['slug-format'], slug)
  }
})

test('checkSlug points an existing slug at the improve form', () => {
  const [failure] = checkSlug('abap-clean-style', SKILLS, { required: true })
  assert.equal(failure.id, 'slug-exists')
  assert.match(failure.message, /Improve a skill/)
})

test('checkSlug treats an empty slug as missing only when required', () => {
  assert.deepEqual(checkSlug('', SKILLS, { required: true }).map((f) => f.id), ['slug-missing'])
  assert.deepEqual(checkSlug('  ', SKILLS, { required: false }), [])
})

test('checkSlug neutralises the echoed slug', () => {
  const [failure] = checkSlug('abap `x`\ninjected', SKILLS, { required: true })
  assert.equal(failure.id, 'slug-format')
  assert.ok(!failure.message.includes('\n'))
  assert.ok(!failure.message.includes('`x`'))
})

// --- description ---

test('normalizeDescription strips a pasted key and one pair of quotes', () => {
  assert.equal(normalizeDescription(`description: "${GOOD_DESCRIPTION}"`), GOOD_DESCRIPTION)
  assert.equal(normalizeDescription(`'${GOOD_DESCRIPTION}'`), GOOD_DESCRIPTION)
  assert.equal(normalizeDescription(null), '')
})

test('checkDescription accepts what validate_skills.py accepts', () => {
  assert.deepEqual(checkDescription(GOOD_DESCRIPTION), [])
  assert.deepEqual(checkDescription(`description: "${GOOD_DESCRIPTION}"`), [])
})

test('checkDescription reports each broken rule', () => {
  assert.deepEqual(checkDescription('').map((f) => f.id), ['description-missing'])
  assert.deepEqual(checkDescription(GOOD_DESCRIPTION.replace('Use when', 'Load when')).map((f) => f.id), ['description-start'])
  assert.deepEqual(checkDescription('Use when you build channels.').map((f) => f.id), ['description-short'])
  assert.deepEqual(checkDescription(`${GOOD_DESCRIPTION} ${'word '.repeat(200)}`).map((f) => f.id), ['description-long'])
})

test('checkDescription counts characters as code points', () => {
  const fill = MAX_DESCRIPTION_CHARS - GOOD_DESCRIPTION.length - 1
  const atLimit = `${GOOD_DESCRIPTION} ${'\u{1F600}'.repeat(fill)}`
  assert.ok(atLimit.length > MAX_DESCRIPTION_CHARS)
  assert.deepEqual(checkDescription(atLimit), [])
  assert.deepEqual(checkDescription(`${atLimit}\u{1F600}`).map((f) => f.id), ['description-long'])
})

// --- sources ---

test('extractUrls strips trailing punctuation and markdown wrappers', () => {
  assert.deepEqual(
    extractUrls('See https://help.sap.com/docs/abap-cloud. And [x](https://github.com/SAP-samples/abap-cheat-sheets), <https://example.com/a>;'),
    ['https://help.sap.com/docs/abap-cloud', 'https://github.com/SAP-samples/abap-cheat-sheets', 'https://example.com/a'],
  )
  assert.deepEqual(extractUrls(null), [])
})

test('isPublicSapSource accepts public SAP hosts and SAP GitHub owners', () => {
  for (const url of [
    'https://help.sap.com/docs/abap-cloud',
    'https://community.sap.com/t5/technology-blogs-by-sap/x',
    'https://developers.sap.com/tutorials/x.html',
    'https://api.sap.com/api/x',
    'https://learning.sap.com/learning-journeys/x',
    'https://www.sap.com/products.html',
    'https://sap.github.io/styleguides/',
    'https://github.com/SAP/styleguides',
    'https://github.com/sap-samples/abap-cheat-sheets',
    'https://github.com/SAP-docs/abap-cloud',
    'HTTPS://HELP.SAP.COM/docs',
  ]) {
    assert.ok(isPublicSapSource(url), url)
  }
})

test('isPublicSapSource rejects SAP Notes, look-alikes and other hosts', () => {
  for (const url of [
    'https://me.sap.com/notes/123456',
    'https://launchpad.support.sap.com/#/notes/123456',
    'https://help.sap.com.example.net/docs',
    'https://github.com/SAPfoo/repo',
    'https://github.com/someone/SAP',
    'https://example.com/?ref=help.sap.com',
    'https://docs.abapgit.org/',
    'not a url',
  ]) {
    assert.ok(!isPublicSapSource(url), url)
  }
})

test('checkSources needs one public SAP link when required', () => {
  assert.deepEqual(checkSources('https://help.sap.com/docs/abap-cloud', { required: true }), { failures: [], otherHosts: [] })
  assert.deepEqual(checkSources('', { required: true }).failures.map((f) => f.id), ['sources'])
  assert.deepEqual(checkSources('https://me.sap.com/notes/123456', { required: true }).failures.map((f) => f.id), ['sources'])
  assert.deepEqual(
    checkSources('https://me.sap.com/notes/123456 https://help.sap.com/docs/x', { required: true }),
    { failures: [], otherHosts: ['me.sap.com'] },
  )
})

test('checkSources lists other hosts only, never full URLs', () => {
  const { otherHosts } = checkSources('https://docs.abapgit.org/a?token=abc https://docs.abapgit.org/b', { required: true })
  assert.deepEqual(otherHosts, ['docs.abapgit.org'])
})

test('checkSources skips an optional field without links', () => {
  assert.deepEqual(checkSources('The ABAP keyword documentation.', { required: false }), { failures: [], otherHosts: [] })
  assert.deepEqual(checkSources('https://example.com/x', { required: false }).failures.map((f) => f.id), ['sources'])
})

test('forCodeSpan replaces backticks, collapses newlines and caps length', () => {
  assert.equal(forCodeSpan('a`b\n\nc'), "a'b c")
  assert.equal(forCodeSpan('x'.repeat(300)).length, 200)
  assert.equal(forCodeSpan(null), '')
})

// --- decisions ---

const CONTRIBUTING_URL = 'https://github.com/o/r/blob/main/CONTRIBUTING.md'
const run = (labels, body, title = 'A title') =>
  triage({ title, body, labels, existingSkills: SKILLS, contributingUrl: CONTRIBUTING_URL })

test('derivedLabels maps area and tool on the wrong-output form only', () => {
  assert.deepEqual(derivedLabels('wrong-output', { 'Where did it go wrong?': 'abap-kebap-reviewer', Tool: 'Both' }), ['agent:reviewer', 'claude-code', 'copilot'])
  assert.deepEqual(derivedLabels('wrong-output', { 'Where did it go wrong?': 'released-objects MCP server', Tool: 'GitHub Copilot' }), ['mcp:released-objects', 'copilot'])
  assert.deepEqual(derivedLabels('wrong-output', { 'Where did it go wrong?': 'Not sure', Tool: '' }), [])
  assert.deepEqual(derivedLabels('skill-request', { Tool: 'Both' }), [])
})

test('derivedLabels ignores edited values that happen to be object keys', () => {
  assert.deepEqual(derivedLabels('wrong-output', { 'Where did it go wrong?': 'constructor', Tool: 'toString' }), [])
})

test('runChecks applies the checks each form owns', () => {
  const ids = (form, fields) => runChecks(form, fields, SKILLS).failures.map((f) => f.id)
  assert.deepEqual(ids('wrong-output', {}), [])
  assert.deepEqual(ids('skill-improvement', { Sources: '' }), ['sources'])
  assert.deepEqual(ids('skill-request', { 'Proposed slug': '', Sources: '' }), [])
  assert.deepEqual(ids('skill-request', { 'Proposed slug': 'abap-odata', Sources: 'https://example.com' }), ['slug-exists', 'sources'])
  assert.deepEqual(ids('skill-contribution', {}), ['slug-missing', 'description-missing', 'sources'])
})

test('triage returns null without a type label', () => {
  assert.equal(run(['bug'], contributionBody()), null)
})

test('triage passes a complete contribution and clears needs-info and stale', () => {
  const result = run(['skill-contribution', NEEDS_INFO, 'stale'], contributionBody())
  assert.equal(result.form, 'skill-contribution')
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.addLabels, [])
  assert.deepEqual(result.removeLabels, [NEEDS_INFO, 'stale'])
  assert.equal(result.comment, PASS_COMMENT)
})

test('triage removes only labels that are present', () => {
  assert.deepEqual(run(['skill-contribution'], contributionBody()).removeLabels, [])
})

test('triage adds needs-info to a failing issue once', () => {
  const body = contributionBody({ 'Skill slug': 'abap-clean-style' })
  const first = run(['skill-contribution'], body)
  assert.deepEqual(first.failures.map((f) => f.id), ['slug-exists'])
  assert.deepEqual(first.addLabels, [NEEDS_INFO])
  assert.deepEqual(first.removeLabels, [])
  assert.deepEqual(run(['skill-contribution', NEEDS_INFO], body).addLabels, [])
})

test('triage fails a contribution whose body was blanked by an edit', () => {
  for (const body of [null, '']) {
    assert.deepEqual(run(['skill-contribution'], body).failures.map((f) => f.id), ['slug-missing', 'description-missing', 'sources'])
  }
})

test('triage passes a blanked wrong-output body, which has no content checks', () => {
  assert.deepEqual(run(['wrong-output'], null).failures, [])
})

test('triage adds the area and tool labels for wrong output', () => {
  assert.deepEqual(run(['wrong-output'], wrongOutputBody({ Tool: 'Both' })).addLabels, ['agent:developer', 'claude-code', 'copilot'])
})

test('triage scans the title, the preamble and every field for secrets', () => {
  const inTitle = run(['wrong-output'], wrongOutputBody(), "lv_password = 'Init1234'.")
  assert.match(inTitle.failures[0].message, /\*\*Title\*\*/)
  const inPreamble = run(['wrong-output'], `pwd=abc12345\n\n${wrongOutputBody()}`)
  assert.match(inPreamble.failures[0].message, /Text before the first field/)
  const inField = run(['skill-request'], requestBody({ 'What tasks would it cover?': 'Authorization: Bearer abcdefgh12345678' }))
  assert.match(inField.failures[0].message, /What tasks would it cover\?/)
})

test('the comment for a leaked credential never contains it and says to rotate', () => {
  const result = run(['wrong-output'], wrongOutputBody({ 'What did it produce?': "lv_password = 'Init1234'." }))
  assert.deepEqual(result.failures.map((f) => f.id), ['sensitive'])
  assert.ok(!result.comment.includes('Init1234'))
  assert.match(result.comment, /rotate/)
  assert.deepEqual(result.addLabels, ['agent:developer', 'claude-code', NEEDS_INFO])
})

test('a failing comment names other hosts but not their URLs', () => {
  const result = run(['skill-improvement'], improvementBody({ Sources: 'https://docs.abapgit.org/guide?token=abc' }))
  assert.match(result.comment, /`docs\.abapgit\.org`/)
  assert.ok(!result.comment.includes('token=abc'))
})

test('renderComment lists failures, notes, the edit hint and the guide link', () => {
  const comment = renderComment({
    failures: [{ id: 'sources', message: 'Sources need a link.' }],
    notes: ['Links from these hosts do not count as public SAP sources: `example.com`.'],
    contributingUrl: CONTRIBUTING_URL,
  })
  assert.ok(comment.startsWith(TRIAGE_MARKER))
  assert.match(comment, /^- Sources need a link\.$/m)
  assert.match(comment, /^Note: Links from these hosts/m)
  assert.match(comment, /close after 14 days/)
  assert.ok(comment.includes(CONTRIBUTING_URL))
  assert.doesNotMatch(comment, /rotate/)
})

test('commentAction follows the decision table', () => {
  const passing = { id: 5, body: PASS_COMMENT }
  const failing = { id: 5, body: 'X' }
  assert.deepEqual(commentAction({ failures: [{}], body: 'X', existing: null }), { type: 'create', body: 'X' })
  assert.deepEqual(commentAction({ failures: [{}], body: 'Y', existing: failing }), { type: 'update', id: 5, body: 'Y' })
  assert.deepEqual(commentAction({ failures: [{}], body: 'X', existing: failing }), { type: 'none' })
  assert.deepEqual(commentAction({ failures: [], body: PASS_COMMENT, existing: failing }), { type: 'update', id: 5, body: PASS_COMMENT })
  assert.deepEqual(commentAction({ failures: [], body: PASS_COMMENT, existing: passing }), { type: 'none' })
  assert.deepEqual(commentAction({ failures: [], body: PASS_COMMENT, existing: null }), { type: 'none' })
})

test('commentAction treats a CRLF copy of the same text as unchanged', () => {
  assert.deepEqual(commentAction({ failures: [{}], body: 'a\nb', existing: { id: 5, body: 'a\r\nb' } }), { type: 'none' })
})

test('findTriageComment needs both the marker and the bot author', () => {
  const bot = { login: 'github-actions[bot]' }
  const comments = [
    { id: 1, user: { login: 'someone' }, body: `${TRIAGE_MARKER} copied` },
    { id: 2, user: bot, body: 'Another workflow' },
    { id: 3, user: bot, body: `${TRIAGE_MARKER}\nx` },
  ]
  assert.equal(findTriageComment(comments).id, 3)
  assert.equal(findTriageComment([]), null)
})
