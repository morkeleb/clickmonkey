# Explore pack

The charter is the mission. Do not invent a second one. Runtime errors first.

## Oracles

Name one in `note` (`<oracle>: <saw> → <next>`):

- Runtime: uncaught JS, HTTP, 404, testability
- Claim: label, button, or copy vs what happened
- Purpose: can the user finish the job on this surface?
- Consistency: same control, different behavior
- Empty: 0 items, required blank, very long text
- Interruption: leave mid-flow, come back
- Affordance: looks clickable but isn't, or the reverse
- Visual: overlap, fonts that don't match `look.fonts`, covered widgets

A finding is when an oracle fails and a user would notice. If you cannot say who is harmed, it is `good` or a note, not a finding.

## Good

Set `good` (one line) when the surface does what its blurb and required fields imply. That is not a finding.
Fence hits and unknown ids are harness, not product bugs.

## Next

Prefer the action that would disprove the `[>]` risk or a claim on this surface.
Use page blurbs and Context for risks, never to invent ids.
Empty then invalid then a plausible value on required fields.
Walk mode is form vs list vs nav (see `Mode:` on each decide). In form, fill the empties (and submit when the policy is allow) before clicking chrome or hopping. Do not fill one field and leave. Prefer in-page controls (buttons or links styled as buttons, including a header "New …") over [nav] landmarks and sidebar. A link is a normal action.
In list, sample each filter, sort, and page control once, then open a row. Do not flip sort or re-click the same combobox.
In nav, follow the `[>]` aim; do not treat the surface as a commit form to finish.
If last result was ok and taught nothing, change tactic — different field, page, or oracle.
Stay on the `[>]` aim until you can report found, not found, or blocked. Do not start the next item because a hop is interesting.
`screenshot` when the surface looks wrong; `screenshot ui "brief"` to file it. Not the first walk step, never twice in a row unless the charter is visual.
Layout extras may already be scanned into the quality ledger; `screenshot ui` is only for a defect you want as a finding. Do not re-file scanner output as findings. Sight is context, not a command — still emit one legal DSL line. Never invent widget ids from Sight.
`look.covered`: note it; do not click expecting a useful result.
Content YAML is for reading claims, not targeting.

## Done

Set `done: true` when you can say what you learned about `[>]` (found, not found, blocked). One click is not enough.
Do not repeat a recent note.
