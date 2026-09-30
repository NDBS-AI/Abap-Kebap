// Issue triage: the decisions. Pure functions, no I/O, no dependencies.
// run.mjs reads the issue and the skill list, calls triage(), and applies the result.

export const MAX_SLUG_LENGTH = 64
export const MAX_DESCRIPTION_CHARS = 1024
export const MIN_DESCRIPTION_WORDS = 50

const SANITIZED = 'Before you submit'
const AGENTS = 'Which agents would use it?'

// Field labels in form order: the "### <label>" headings GitHub renders into the issue body.
// forms.test.mjs checks them against .github/ISSUE_TEMPLATE.
export const FORMS = {
  'wrong-output': {
    file: '1-wrong-output.yml',
    fields: [
      'Where did it go wrong?',
      'Skill involved',
      'Tool',
      'Plugin version',
      'Model',
      'SAP environment',
      'What did you ask?',
      'What did it produce?',
      'What is correct?',
      'Source for the correct behaviour',
      SANITIZED,
    ],
  },
  'skill-improvement': {
    file: '2-improve-skill.yml',
    fields: ['Skill', 'What is missing or wrong?', 'Proposed change', 'Sources', 'Contribution', SANITIZED],
  },
  'skill-request': {
    file: '3-request-skill.yml',
    fields: ['Topic', 'Proposed slug', 'What tasks would it cover?', AGENTS, 'Related existing skills', 'Sources', SANITIZED],
  },
  'skill-contribution': {
    file: '4-contribute-skill.yml',
    fields: ['Skill slug', 'Frontmatter description', 'Scope summary', AGENTS, 'Sources', 'Checklist', SANITIZED],
  },
}

export const TYPE_LABELS = Object.keys(FORMS)

export function detectForm(labels) {
  return TYPE_LABELS.find((label) => labels.includes(label)) ?? null
}

// Splits only on "### <heading>" lines whose heading belongs to the form, so an answer that
// contains its own "### ..." markdown stays inside its field.
export function parseForm(body, headings) {
  const known = new Set(headings)
  const parts = new Map()
  const preamble = []
  let current = null
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const heading = /^###[ \t]+(.+?)[ \t]*$/.exec(line)?.[1]
    if (heading !== undefined && known.has(heading)) {
      current = []
      parts.set(heading, [...(parts.get(heading) ?? []), current])
      continue
    }
    if (current === null) preamble.push(line)
    else current.push(line)
  }
  const fields = {}
  for (const heading of headings) {
    fields[heading] = (parts.get(heading) ?? [])
      .map((lines) => cleanValue(lines.join('\n')))
      .filter(Boolean)
      .join('\n\n')
  }
  return { preamble: preamble.join('\n').trim(), fields }
}

function cleanValue(text) {
  const value = text.trim()
  return value === '_No response_' ? '' : value
}

// --- sensitive content ---

const SECRET_WORDS = String.raw`(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)`
const PLACEHOLDER = /^(?:\*+|x+|\.+|<[^>]*>)$/i

// `value` is the capture group holding the secret, tested against PLACEHOLDER; 0 means none.
// \x60 is a backtick (ABAP string templates and JavaScript template literals).
const SENSITIVE_PATTERNS = [
  {
    kind: 'a password or key literal',
    pattern: new RegExp(String.raw`${SECRET_WORDS}\w*\)?['"]?(?:\s*[:=]\s*|\s+(?:TYPE\s+\S+\s+)?VALUE\s+)(['"\x60|])([^'"\x60|\s]{4,})\1`, 'gi'),
    value: 2,
  },
  {
    kind: 'a password or key assignment',
    pattern: new RegExp(String.raw`(?:^|[\s?&;])[\w-]*${SECRET_WORDS}=([^\s&'"\x60|]{4,})`, 'gim'),
    value: 1,
  },
  {
    kind: 'an HTTP authorization header',
    pattern: /authorization:\s*(?:basic|bearer)\s+([A-Za-z0-9+/=._~-]{8,})/gi,
    value: 1,
  },
  { kind: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gi, value: 0 },
  { kind: 'credentials in a URL', pattern: /https?:\/\/[^\s/:@]+:([^\s/@]+)@/gi, value: 1 },
]

// Reports which kind matched in which field; never the matched text.
export function findSensitive(sections) {
  const hits = []
  for (const { field, text } of sections) {
    for (const { kind, pattern, value } of SENSITIVE_PATTERNS) {
      const matches = [...String(text ?? '').matchAll(pattern)]
      if (matches.some((match) => value === 0 || !PLACEHOLDER.test(match[value]))) hits.push({ kind, field })
    }
  }
  return hits
}

// --- slug ---

// The prefixes validate_skills.py recognises for skill references.
const SLUG_PATTERN = /^(?:abap|rap|cds|fiori|enhancements)-[a-z0-9]+(?:-[a-z0-9]+)*$/

// Submitter-controlled text echoed into the bot comment goes through this first.
export function forCodeSpan(value) {
  return String(value ?? '').replace(/`/g, "'").replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 200)
}

export function normalizeSlug(raw) {
  return String(raw ?? '').trim().replace(/^`+|`+$/g, '').trim()
}

export function checkSlug(raw, existingSkills, { required }) {
  const slug = normalizeSlug(raw)
  if (!slug) return required ? [{ id: 'slug-missing', message: 'The skill slug is empty.' }] : []
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    return [{
      id: 'slug-format',
      message: `The slug \`${forCodeSpan(slug)}\` must be lowercase kebab-case, start with \`abap-\`, \`rap-\`, \`cds-\`, \`fiori-\` or \`enhancements-\`, and have at most ${MAX_SLUG_LENGTH} characters.`,
    }]
  }
  if (existingSkills.includes(slug)) {
    return [{
      id: 'slug-exists',
      message: `A skill named \`${slug}\` already exists. To change it, open an **Improve a skill** issue instead.`,
    }]
  }
  return []
}

// --- description (mirrors scripts/validate_skills.py) ---

export function normalizeDescription(raw) {
  const text = String(raw ?? '').trim().replace(/^description:[ \t]*/i, '')
  const quoted = /^(["'])([\s\S]*)\1$/.exec(text)
  return (quoted ? quoted[2] : text).trim()
}

export function checkDescription(raw) {
  const text = normalizeDescription(raw)
  if (!text) return [{ id: 'description-missing', message: 'The frontmatter description is empty.' }]
  const failures = []
  if (!text.startsWith('Use when')) {
    failures.push({ id: 'description-start', message: 'The description must start with "Use when".' })
  }
  const words = text.split(/\s+/).length
  if (words < MIN_DESCRIPTION_WORDS) {
    failures.push({
      id: 'description-short',
      message: `The description has ${words} words; it needs at least ${MIN_DESCRIPTION_WORDS}.`,
    })
  }
  const chars = [...text].length
  if (chars > MAX_DESCRIPTION_CHARS) {
    failures.push({
      id: 'description-long',
      message: `The description has ${chars} characters; the limit is ${MAX_DESCRIPTION_CHARS}.`,
    })
  }
  return failures
}

// --- sources ---

const SAP_HOSTS = new Set([
  'help.sap.com',
  'community.sap.com',
  'developers.sap.com',
  'api.sap.com',
  'learning.sap.com',
  'www.sap.com',
  'sap.github.io',
])
const SAP_GITHUB_OWNERS = new Set(['sap', 'sap-samples', 'sap-docs'])
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/gi

export function extractUrls(text) {
  return [...String(text ?? '').matchAll(URL_PATTERN)].map((match) => match[0].replace(/[.,;:]+$/, ''))
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isPublicSapSource(url) {
  const host = hostOf(url)
  if (SAP_HOSTS.has(host)) return true
  if (host !== 'github.com') return false
  const owner = new URL(url).pathname.split('/')[1] ?? ''
  return SAP_GITHUB_OWNERS.has(owner.toLowerCase())
}

export function checkSources(raw, { required }) {
  const urls = extractUrls(raw)
  if (!required && urls.length === 0) return { failures: [], otherHosts: [] }
  const otherHosts = [...new Set(urls.filter((url) => !isPublicSapSource(url)).map(hostOf).filter(Boolean))]
  if (urls.some(isPublicSapSource)) return { failures: [], otherHosts }
  return {
    failures: [{
      id: 'sources',
      message: 'Sources need at least one public SAP link: `help.sap.com`, `community.sap.com`, `developers.sap.com`, `api.sap.com`, `learning.sap.com`, `www.sap.com`, `sap.github.io`, or a GitHub repository of `SAP`, `SAP-samples` or `SAP-docs`. SAP Notes need a login and do not count on their own.',
    }],
    otherHosts,
  }
}

// --- decisions ---

export const NEEDS_INFO = 'needs-info'
export const STALE = 'stale'
export const TRIAGE_MARKER = '<!-- abap-kebap-triage -->'
export const PASS_COMMENT = `${TRIAGE_MARKER}\nAll automatic checks pass now.`
const BOT_LOGIN = 'github-actions[bot]'

// The stale job only looks at needs-info issues, so it never clears `stale` from a fixed issue.
const CLEARED_ON_PASS = [NEEDS_INFO, STALE]

// Maps, not object literals: an edited body can carry any text, including "constructor".
const AREA_LABELS = new Map([
  ['abap-kebap-architect', 'agent:architect'],
  ['abap-kebap-developer', 'agent:developer'],
  ['abap-kebap-reviewer', 'agent:reviewer'],
  ['released-objects MCP server', 'mcp:released-objects'],
])
const TOOL_LABELS = new Map([
  ['Claude Code', ['claude-code']],
  ['GitHub Copilot', ['copilot']],
  ['Both', ['claude-code', 'copilot']],
])

const SENSITIVE_ADVICE =
  'If a real credential was posted, rotate it now, edit the issue to remove it, and ask a maintainer ' +
  'to delete the old revision from the edit history: everyone with read access can open earlier revisions.'

export function derivedLabels(form, fields) {
  if (form !== 'wrong-output') return []
  const area = AREA_LABELS.get(fields['Where did it go wrong?'])
  return [...(area ? [area] : []), ...(TOOL_LABELS.get(fields.Tool) ?? [])]
}

export function runChecks(form, fields, existingSkills) {
  const failures = []
  let otherHosts = []
  const sources = (required) => {
    const result = checkSources(fields.Sources, { required })
    failures.push(...result.failures)
    otherHosts = result.otherHosts
  }
  switch (form) {
    case 'skill-improvement':
      sources(true)
      break
    case 'skill-request':
      failures.push(...checkSlug(fields['Proposed slug'], existingSkills, { required: false }))
      sources(false)
      break
    case 'skill-contribution':
      failures.push(...checkSlug(fields['Skill slug'], existingSkills, { required: true }))
      failures.push(...checkDescription(fields['Frontmatter description']))
      sources(true)
      break
    default:
      break
  }
  return { failures, otherHosts }
}

export function renderComment({ failures, notes, contributingUrl }) {
  const lines = [
    TRIAGE_MARKER,
    'The automatic checks found problems with this issue:',
    '',
    ...failures.map((failure) => `- ${failure.message}`),
  ]
  if (failures.some((failure) => failure.id === 'sensitive')) lines.push('', SENSITIVE_ADVICE)
  for (const note of notes) lines.push('', `Note: ${note}`)
  lines.push(
    '',
    'Edit this issue to fix them; the checks re-run on every edit. Issues labelled `needs-info` close after 14 days without activity.',
    `See [CONTRIBUTING.md](${contributingUrl}) for what each check expects.`,
  )
  return lines.join('\n')
}

export function triage({ title, body, labels, existingSkills, contributingUrl }) {
  const form = detectForm(labels)
  if (!form) return null
  const headings = FORMS[form].fields
  const { preamble, fields } = parseForm(body, headings)
  const sections = [
    { field: 'Title', text: title },
    { field: 'Text before the first field', text: preamble },
    ...headings.map((heading) => ({ field: heading, text: fields[heading] })),
  ]
  const sensitive = findSensitive(sections).map(({ kind, field }) => ({
    id: 'sensitive',
    message: `**${field}** may contain ${kind}. Remove it or replace the value with a placeholder such as \`<redacted>\` or \`****\`.`,
  }))
  const checks = runChecks(form, fields, existingSkills)
  const failures = [...sensitive, ...checks.failures]
  const notes = checks.otherHosts.length === 0
    ? []
    : [`Links from these hosts do not count as public SAP sources: ${checks.otherHosts.map((host) => `\`${forCodeSpan(host)}\``).join(', ')}.`]
  const wanted = [...derivedLabels(form, fields), ...(failures.length > 0 ? [NEEDS_INFO] : [])]
  return {
    form,
    failures,
    notes,
    addLabels: wanted.filter((label) => !labels.includes(label)),
    removeLabels: failures.length > 0 ? [] : CLEARED_ON_PASS.filter((label) => labels.includes(label)),
    comment: failures.length > 0 ? renderComment({ failures, notes, contributingUrl }) : PASS_COMMENT,
  }
}

// At most one bot comment per issue; skip the API call when the text would not change.
export function commentAction({ failures, body, existing }) {
  if (existing) {
    const current = String(existing.body ?? '').replace(/\r\n/g, '\n')
    return current === body ? { type: 'none' } : { type: 'update', id: existing.id, body }
  }
  return failures.length > 0 ? { type: 'create', body } : { type: 'none' }
}

export function findTriageComment(comments) {
  return comments.find(
    (comment) => comment.user?.login === BOT_LOGIN && String(comment.body ?? '').includes(TRIAGE_MARKER),
  ) ?? null
}
