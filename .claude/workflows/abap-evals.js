export const meta = {
  name: 'abap-evals',
  description: 'Regression eval net for the ABAP agents: run known-correct Q&A cases through the target agent, grade with deterministic string assertions plus a judge for rubric cases; or, for routing cases, grade the skill-cluster routing decision itself. Report pass/fail.',
  whenToUse: 'MILESTONES ONLY (e.g. before publishing) - this tier costs real agent tokens. Per-change regressions are covered free by scripts/validate_skills.py and node evals/run-static.mjs; do not run this workflow per edit. Read evals/cases/abap-core.json (answer-content cases) and/or evals/cases/abap-routing.json (routing-decision cases) and pass the combined array as args.',
  phases: [
    { title: 'Run', detail: 'dispatch each case prompt (or routing-only preflight) to its target agent' },
    { title: 'Grade', detail: 'string assertions / routing-set assertions in JS + judge for rubric cases' },
  ],
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
}

// A case with a `routing` field asks the agent to report ONLY its
// skill-routing preflight decision (no implementation) - much cheaper than a
// full answer, and it's the only way to test the router itself rather than
// inferring routing from whether the final text happens to be correct (an
// agent can answer right from pretrained knowledge without ever consulting
// the cluster it was supposed to select).
const ROUTING_SCHEMA = {
  type: 'object',
  properties: {
    clusters: { type: 'array', items: { type: 'string' } },
    standalone_skills: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['clusters', 'standalone_skills'],
}

function contains(haystack, needle) {
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase())
}

// cases come via args (workflows have no filesystem access).
// args may be the array, or { cases, model } to override the cheap eval model.
const cases = Array.isArray(args) ? args : (args && Array.isArray(args.cases) ? args.cases : null)
const evalModel = !Array.isArray(args) && args && args.model ? args.model : 'haiku'
if (!cases) {
  log('No cases supplied. Read evals/cases/abap-core.json and pass the array as args.')
  return { error: 'no cases', total: 0, passed: 0, failed: 0, results: [] }
}

log(`Running ${cases.length} eval cases on model "${evalModel}" (skill-only, no web).`)

// Each case runs independently: get the answer, then grade it. No barrier.
const results = await pipeline(
  cases,
  // Stage 1 — Run: ask the target agent on a cheap model, SKILL-ONLY.
  // No WebFetch/WebSearch: the eval tests what the skills teach, not the live
  // web (grounding here would both cost a lot and mask a skill regression).
  (c) => {
    if (c.routing) {
      return agent(
        `${c.prompt}\n\n(Eval mode: perform ONLY your mandatory Skill Routing Protocol exactly as defined by your agent instructions — do not re-derive it here, follow the agent file's own preflight steps. Do NOT implement, write code, or produce a full answer. Do NOT use WebSearch or WebFetch. Return only the routing decision: which cluster(s) — if any — apply for your role, and which standalone skill(s) — if any.)`,
        {
          agentType: c.target_agent || 'abap-kebap-developer',
          model: evalModel,
          label: `route:${c.id}`,
          phase: 'Run',
          schema: ROUTING_SCHEMA,
        },
      )
    }
    return agent(
      `${c.prompt}\n\n(Eval mode: answer from your loaded skills and your own knowledge only. Do NOT use WebSearch or WebFetch — this is a test of the skill content, not the live web. Be concise.)`,
      {
        agentType: c.target_agent || 'abap-kebap-developer',
        model: evalModel,
        label: `eval:${c.id}`,
        phase: 'Run',
      },
    )
  },
  // Stage 2 — Grade: deterministic string checks + optional rubric judge;
  // or, for a routing case, deterministic required/forbidden set checks
  // against the reported clusters and standalone skills.
  async (answer, c) => {
    if (c.routing) {
      if (answer == null) {
        return { id: c.id, pass: false, reason: 'agent returned no routing decision' }
      }
      const clusters = Array.isArray(answer.clusters) ? answer.clusters : []
      const standalone = Array.isArray(answer.standalone_skills) ? answer.standalone_skills : []
      const requiredClusters = c.routing.required_clusters || []
      const forbiddenClusters = c.routing.forbidden_clusters || []
      const requiredStandalone = c.routing.required_standalone_skills || []
      const forbiddenStandalone = c.routing.forbidden_standalone_skills || []

      const missingClusters = requiredClusters.filter((name) => !clusters.includes(name))
      const presentForbidden = forbiddenClusters.filter((name) => clusters.includes(name))
      const missingStandalone = requiredStandalone.filter((name) => !standalone.includes(name))
      const presentForbiddenStandalone = forbiddenStandalone.filter((name) => standalone.includes(name))

      const pass =
        missingClusters.length === 0 &&
        presentForbidden.length === 0 &&
        missingStandalone.length === 0 &&
        presentForbiddenStandalone.length === 0
      const reasons = []
      if (missingClusters.length) reasons.push(`missing required clusters: ${missingClusters.join(', ')}`)
      if (presentForbidden.length) reasons.push(`selected forbidden clusters: ${presentForbidden.join(', ')}`)
      if (missingStandalone.length) reasons.push(`missing required standalone skills: ${missingStandalone.join(', ')}`)
      if (presentForbiddenStandalone.length)
        reasons.push(`selected forbidden standalone skills: ${presentForbiddenStandalone.join(', ')}`)
      const seen = `(reported clusters: ${clusters.join(', ') || 'none'}; standalone: ${standalone.join(', ') || 'none'})`
      return { id: c.id, pass, reason: pass ? `ok ${seen}` : `${reasons.join(' | ')} ${seen}` }
    }
    if (answer == null) {
      return { id: c.id, pass: false, reason: 'agent returned no answer' }
    }
    const mustContain = c.must_contain || []
    const mustNot = c.must_not_contain || []
    const missing = mustContain.filter((n) => !contains(answer, n))
    const present = mustNot.filter((n) => contains(answer, n))
    const stringPass = missing.length === 0 && present.length === 0

    let rubricPass = true
    let rubricReason = ''
    if (c.rubric) {
      const verdict = await agent(
        `You are grading an ABAP answer against a rubric. Pass ONLY if the answer satisfies the rubric. Be strict but fair.\n\nRubric: ${c.rubric}\n\nAnswer:\n${answer}\n\nReturn pass (boolean) and a one-line reason.`,
        { model: 'haiku', schema: GRADE_SCHEMA, label: `judge:${c.id}`, phase: 'Grade' },
      )
      rubricPass = !!(verdict && verdict.pass)
      rubricReason = verdict ? verdict.reason : 'judge returned no verdict'
    }

    const pass = stringPass && rubricPass
    const reasons = []
    if (missing.length) reasons.push(`missing: ${missing.join(', ')}`)
    if (present.length) reasons.push(`forbidden present: ${present.join(', ')}`)
    if (c.rubric && !rubricPass) reasons.push(`rubric: ${rubricReason}`)
    return { id: c.id, pass, reason: pass ? 'ok' : reasons.join(' | ') }
  },
)

const graded = results.filter(Boolean)
const passed = graded.filter((r) => r.pass)
const failed = graded.filter((r) => !r.pass)

const lines = []
lines.push(`# ABAP Evals — ${passed.length}/${graded.length} passed`)
lines.push('')
if (failed.length) {
  lines.push('## Failures')
  for (const r of failed) lines.push(`- ❌ ${r.id} — ${r.reason}`)
  lines.push('')
}
lines.push('## Passed')
for (const r of passed) lines.push(`- ✅ ${r.id}`)

return {
  total: graded.length,
  passed: passed.length,
  failed: failed.length,
  results: graded,
  report: lines.join('\n'),
}
