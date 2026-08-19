# Examples Directory

Working code examples go here — 1-3 files demonstrating the skill's concepts in practice.

**Guidelines:**

- **Descriptive filenames**: Use kebab-case that describes what the example shows (e.g., `managed-bo-with-actions.md`, `validation-example.md`).
- **Clean ABAP compliance**: All ABAP code in examples must follow Clean ABAP style:
  - No single-letter variables (use descriptive names like `invoice`, `customer`, `total_amount`)
  - Use modern syntax: `VALUE #(…)`, `NEW #(…)`, `DATA(var)` inline
  - Snake_case for ABAP identifiers
  - Meaningful method/class/variable names
- **Format**: Markdown files (.md) containing ABAP code blocks and explanatory text.
- **Completeness**: Each example should be self-contained and show best practice; avoid incomplete snippets.
- **Mention in SKILL.md**: Every file in this directory must be mentioned by relative path in the main SKILL.md (e.g., `[examples/managed-bo-with-actions.md](examples/managed-bo-with-actions.md)`).

**Do not put in examples/:**
- Anti-patterns or "what not to do" (use Common Mistakes § in SKILL.md for that)
- Incomplete code fragments
- Inline ABAP without explanation (wrap in a markdown file with context)
