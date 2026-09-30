// Test helper: builds issue bodies the way GitHub renders a submitted issue form
// ("### <label>", blank line, value; "_No response_" for an empty optional field).

export const SANITIZED_ANSWER =
  '- [X] I removed customer code, customer and system names, hostnames, users and credentials.'

export const GOOD_DESCRIPTION =
  'Use when you build ABAP Channels messaging: push notifications from the backend to Fiori apps ' +
  'with ABAP Messaging Channels (AMC), WebSocket communication with ABAP Push Channels (APC), ' +
  'channel design in the repository, message types and producer and consumer classes, ' +
  'authorization of channel access, testing channels without a browser, and the restrictions ' +
  'that apply in ABAP Cloud. Includes AMC, APC, and WebSocket.'

const AGENTS_ANSWER = '- [ ] abap-kebap-architect\n- [X] abap-kebap-developer\n- [ ] abap-kebap-reviewer'

export function renderIssue(fields) {
  return Object.entries(fields)
    .map(([heading, value]) => `### ${heading}\n\n${value === '' ? '_No response_' : value}`)
    .join('\n\n')
}

export function wrongOutputBody(overrides = {}) {
  return renderIssue({
    'Where did it go wrong?': 'abap-kebap-developer',
    'Skill involved': 'abap-clean-style',
    Tool: 'Claude Code',
    'Plugin version': '0.3.0',
    Model: '',
    'SAP environment': 'ABAP Cloud (BTP ABAP environment)',
    'What did you ask?': 'Write a method that sums the open items of ZCL_DEMO_ITEMS.',
    'What did it produce?': '```abap\nLOOP AT mt_items INTO DATA(e).\nENDLOOP.\n```',
    'What is correct?': 'A descriptive loop variable such as ls_item.',
    'Source for the correct behaviour': 'https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md',
    'Before you submit': SANITIZED_ANSWER,
    ...overrides,
  })
}

export function improvementBody(overrides = {}) {
  return renderIssue({
    Skill: 'abap-sql-performance',
    'What is missing or wrong?': 'Nothing on buffering of CDS views.',
    'Proposed change': 'Add a section on table buffering and CDS view buffering.',
    Sources: 'https://help.sap.com/docs/abap-cloud',
    Contribution: '- [ ] I would like to make this change myself through a pull request',
    'Before you submit': SANITIZED_ANSWER,
    ...overrides,
  })
}

export function requestBody(overrides = {}) {
  return renderIssue({
    Topic: 'ABAP Channels (AMC and APC)',
    'Proposed slug': 'abap-channels',
    'What tasks would it cover?': 'Designing channels and pushing messages to Fiori apps.',
    'Which agents would use it?': AGENTS_ANSWER,
    'Related existing skills': 'abap-odata, abap-cloud-development',
    Sources: '',
    'Before you submit': SANITIZED_ANSWER,
    ...overrides,
  })
}

export function contributionBody(overrides = {}) {
  return renderIssue({
    'Skill slug': 'abap-channels',
    'Frontmatter description': GOOD_DESCRIPTION,
    'Scope summary': 'AMC and APC from channel design to tests.',
    'Which agents would use it?': AGENTS_ANSWER,
    Sources: 'https://help.sap.com/docs/abap-cloud',
    Checklist: '- [X] I started from templates/skill\n- [X] All content is in English',
    'Before you submit': SANITIZED_ANSWER,
    ...overrides,
  })
}
