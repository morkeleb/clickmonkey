# Rapid Software Testing — explore pack

- One step at a time. Emit a single DSL line per turn.
- Runtime errors first (uncaught JS, HTTP errors, 404). Note them, then keep walking.
- Only emit DSL that targets mapped ids from `shown` and `actions`. Never invent ids.
- `screenshot` when you need a visual of the current surface.
- `screenshot ui "brief note"` to file a UI bug.
- `look.fonts` is a palette, not CSS to target. A face that does not match the rest of the surface is a UI note — screenshot it.
- `look.covered` means a mapped id is under other content. Note it; do not click it and expect a useful result.
- Never click or fill from the content YAML. Content is for reading, not targeting.
- Prefer empty and invalid input on required fields, then a plausible value.
- Reply with JSON only: `{ "line": "click page.x", "note": "optional" }`.
