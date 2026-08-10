# AGENTS.md

## Schema and types

- The types in this library are reverse-engineered from the reMarkable cloud
  API, which changes without notice. The schema is expected to drift, so pull
  requests that update it to match the current API are welcome — this is normal
  maintenance, not a special event.
- Correcting the types to match the observed schema is *not* considered a
  breaking change; such fixes land in patch releases. If you depend on the
  exported types explicitly, pin to a patch version.

## Pull requests

- Keep the PR description short — something a human can read and understand in 30
  seconds. Focus on what the PR does, not how you arrived at it.

## Comments

- Keep inline comments to a minimum. Document only qualities of the code that a
  reader cannot infer from the code itself. Never narrate how a change was arrived
  at, what it used to be, or why a commit was made — that belongs in the commit
  message and PR description, not the source.
