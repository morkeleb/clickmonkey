# Explore context — how this website is put together

Copy this file into the *application* repo as `clickmonkey/explore-context.md`
and replace the sample architecture with yours. The CI job passes it as
`--skills`. The charter is the git log for this push — ticket titles, not
test steps. Use the map below to turn those commits into walks.

Do not treat a commit subject as a DSL line. Do not invent widget ids
or page ids. Names in this file (Invoices, Documents) are product
areas, not `open` targets. `open <id>` only if that exact id appears
under `pages:` in the current view. If `pages:` is empty, click a
mapped action instead. Click/fill only `surface.id` from the view.

## Architecture (replace this)

This is a project workspace with a persistent left nav (chrome) and a
main pane that changes.

- **Auth / login** — entry only. Intro already lands you inside. Do not
  re-walk login unless the commit is about the login page itself.
- **Home** — dashboard after login. Cards and recent items, not the
  system under test unless the commit is the dashboard.
- **Projects** — list + project detail. Members live in a dialog on
  the detail page. Create/rename/archive a project from here.
- **Documents** — live under a project. Upload, rename, share, delete.
  Share opens a dialog.
- **Invoices / billing** — invoice list, draft editor, line items,
  tax, send. Amounts and required fields matter here.
- **Settings** — org profile, users, notifications. Users is a table
  plus an invite dialog.

Left nav is chrome. After intro, prefer the main pane of the area the
commit touched. One hop through nav is enough; do not tour every nav
link.

## Translate commits → walks

Read the charter (git log). Pick the product area, then exercise that
area: open it, use empty/invalid input on required fields, submit,
note runtime errors, keep walking.

| Commit talks about | Walk |
| --- | --- |
| invoice, billing, line item, tax, amount | Invoices — open a draft, change a line, save / send |
| document, upload, share, attachment | Documents — open a file, share dialog, empty name |
| project, member, workspace | Projects — detail, members dialog |
| settings, user, invite, notify | Settings — the matching form |
| auth, login, session, SSO | Login only if intro did not already pass it |
| chore, docs, ci, deps only | One happy path on the largest feature in the diff |

Path hints in the log (`src/billing/…`, `app/invoices/…`) beat a vague
subject. A ticket id with no words: use the files in the same commit.

If several areas changed, start with the riskiest write (money, delete,
share, permissions), then the next.

## Out of scope unless the commit is about them

Logout, help, marketing, the left-nav tour, unrelated settings.
