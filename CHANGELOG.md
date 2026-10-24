# Changelog

## [0.1.0] - 2026-10-23

### Added

- `/selection` command: inlines the VS Code selection as `path:lines` plus the selected source, so the
  model does not need an extra `read` round.
- `/selection <question>` sends the attachment and the question in one turn.
- Selection handling: 1-based lines, trailing-line correction, cursor-line fallback, CRLF normalization,
  language-fence inference from the file extension.
- Safety signals: unsaved-buffer warning via `activeLineText`, stale-state warning after 10 minutes,
  truncation at 400 lines or 24000 characters.
