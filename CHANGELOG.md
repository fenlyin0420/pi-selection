# Changelog

## [0.2.0] - 2026-10-24

### Changed

- `/selection` now sends only the range reference `[path:lines]` instead of inlining the selected
  source. The model reads the range itself, so the prompt no longer carries a copy that can go stale.
- Removed the language-fence inference and the 400-line / 24000-character truncation limits, which
  only existed to bound the inlined source.
- The unsaved-buffer warning now says line numbers may not match the file on disk rather than that
  attached content comes from disk.

## [0.1.0] - 2026-10-23

### Added

- `/selection` command: inlines the VS Code selection as `path:lines` plus the selected source, so the
  model does not need an extra `read` round.
- `/selection <question>` sends the attachment and the question in one turn.
- Selection handling: 1-based lines, trailing-line correction, cursor-line fallback, CRLF normalization,
  language-fence inference from the file extension.
- Safety signals: unsaved-buffer warning via `activeLineText`, stale-state warning after 10 minutes,
  truncation at 400 lines or 24000 characters.
