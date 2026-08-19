---
name: <kebab-case-skill-name>
description: "Use when <second-person opening describing when to load this skill, list of key concepts/triggers this skill covers, 50-150 words, max 1024 chars>. Includes <concept>, <concept>, and <concept>. Keep the whole value inside these double quotes - an unquoted ' #' or ': ' silently breaks the YAML and kills the skill's trigger."
---

<!-- SCAFFOLD NOTES:
- The two required YAML frontmatter fields are "name" and "description".
- name: must be kebab-case and match the directory name exactly (e.g., "my-skill-name")
- description: must START with "Use when" and list trigger phrases and concepts covered, 50-200 words
- The Body sections below follow a standard structure; use them in this order:
  1. # <Skill Title> — heading with the human-readable skill name
  2. ## Overview — 2-3 sentences stating the core principle
  3. ## Workflow — numbered decision steps (not a code walkthrough)
  4. ## <Topic Section> x N — topic sections (e.g., "## <Concept A>", "## <Concept B>"); each must have a correct code block
  5. ## Quick Reference — table or summary listing key patterns
  6. ## Common Mistakes — wrong/right example pairs showing anti-patterns
  7. ## References — public SAP URLs only (help.sap.com, github.com/SAP-samples, github.com/SAP/styleguides, etc.)
- Target: 300+ lines for this house skill (including code blocks and references)
- Every file under references/ and examples/ must be mentioned by relative path in this SKILL.md
- Inline HTML comments like these are removed before the skill is loaded; they are scaffold notes only
-->

# <Skill Title in Plain English>

<!-- Use a descriptive heading (not the technical name). Example: "RAP" becomes "RAP (RESTful ABAP Programming Model)" -->

## Overview

<!-- 2-3 sentences. State the core principle. Example: "RAP is ABAP's modern framework for building transactional applications. It separates data modeling (CDS), behavior definition (BDL), and service exposure into layers, so changes to one layer don't ripple through the others."
- Do not list all topics or summarize the workflow — the reader will see those next.
-->

<Core principle in 2-3 sentences>

## Workflow

<!-- Numbered decision steps for determining WHAT to do, not HOW to write it. Think: "when someone asks about <this skill>, what do I ask them first to decide direction?"
Example workflow:

1. **Determine the user's goal**:
   - Question A leading to direction X
   - Question B leading to direction Y

2. **Clarify the context**:
   - Is this greenfield or brownfield?
   - What constraints apply?

3. **Guide implementation**:
   - Suggest the pattern/approach
   - Point to the relevant topic section below
-->

1. **Determine the user's goal**:
   - <Goal 1 and how to identify it>
   - <Goal 2 and how to identify it>

2. **<Decision point or clarification>**:
   - <Context question 1>
   - <Context question 2>

3. **Guide implementation**:
   - <Recommended approach for scenario A>
   - <Recommended approach for scenario B>

## <Topic Section 1>

<!-- Each topic section covers a key concept and includes a code block.
Example sections: "Managed vs Unmanaged", "BDL Syntax", "EML Operations", "Exception Handling", etc.
Include a code block demonstrating the concept (correct syntax/pattern).
Reference any related files in references/ or examples/ with relative paths.
-->

<Explanation and context for topic 1>

```
<Code block demonstrating correct syntax or pattern>
<Example spans 10-30 lines, showing best practice>
```

<!-- Link to deeper reference if it exists -->
> For more details, see [references/reference-file.md](references/reference-file.md).

## <Topic Section 2>

<Explanation and context for topic 2>

```
<Code block demonstrating correct syntax or pattern>
```

<!-- Add more topic sections as needed. Aim for 3-5 major topics. -->

## Quick Reference

<!-- A table, checklist, or summary listing the most common patterns/choices.
Format: table with category, default/recommendation, and link to detailed section.
Example:

| Element | Syntax | When to Use |
|---------|--------|-------------|
| **Managed** | `managed implementation in class…` | Greenfield, standard CRUD |
| **Unmanaged** | `unmanaged implementation in class…` | Brownfield, custom logic |
| **Draft** | `with draft;` in BDEF header | Multi-step forms, user edits before commit |

-->

| Concept | Usage | See |
|---------|-------|-----|
| <Key1> | <when/how> | §<section> |
| <Key2> | <when/how> | §<section> |
| <Key3> | <when/how> | §<section> |

## Common Mistakes

<!-- Show anti-patterns and correct patterns side-by-side.
Format: **Wrong** / **Right** pairs with brief explanation.
Example:

**Wrong:**
```abap
CONCATENATE var1 var2 INTO result.
```

**Right:**
```abap
result = |{ var1 }{ var2 }|.
```

String concatenation using `|…|` template syntax is faster and more readable.

-->

**Wrong:**
```
<Anti-pattern code>
```

**Right:**
```
<Corrected pattern>
```

<Brief explanation of why the right version is preferred>

<!-- Add 2-3 wrong/right pairs. -->

## References

<!-- Public SAP sources only: help.sap.com, github.com/SAP-samples, github.com/SAP/styleguides.
Do not include proprietary material, internal docs, or third-party tutorials (except SAP's official repos).
Format: markdown links to public URLs, grouped by source/topic if helpful.
Example:

- [SAP ABAP Cheat Sheets — RAP BDL](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md)
- [SAP Help — RAP Development Guide](https://help.sap.com/docs/abap-cloud/abap-rap/abap-restful-application-programming-model)

-->

- [<SAP Help or SAP-samples URL>](<full-url>)
- [<Another SAP reference>](<full-url>)
