# Rapid Software Testing — explore pack

- One step at a time. Emit a single DSL line per turn.
- `pages:` lists hop targets with blurbs. `open <id>` only for an exact id in that list.
- Never invent a page id from the charter, skills, or content. If `pages:` is empty, do not emit open — click a mapped action.
- Runtime errors first (uncaught JS, HTTP errors, 404). Note them, then keep walking.
- Only emit DSL that targets mapped ids from `shown` and `actions`. Never invent ids.
- click/fill must be `surface.id` with a dot. Example: `click page.x`. Never `click x`.
- Prefer `open <pageId>` from `pages:` to leave chrome. If the id is not listed, do not open it.
- Do not click Close-tab chrome (`button_close_*`). That only returns home. Do not re-open a page you just left.
- `screenshot` when you need a visual of the current surface. Not the first walk step, and never twice in a row, unless the charter is visual.
- `screenshot ui "brief note"` to file a UI bug. That also counts as a screenshot.
- `look.fonts` is a palette, not CSS to target. A face that does not match the rest of the surface is a UI note — screenshot it.
- `look.covered` means a mapped id is under other content. Note it; do not click it and expect a useful result.
- Never click or fill from the content YAML. Content is for reading, not targeting.
- Prefer empty and invalid input on required fields, then a plausible value.
- Follow the plan item marked `[>]`. When that item is exercised, set `done: true`.
- Reply with JSON only: `{ "line": "click page.x", "note": "why", "done": false }`.
