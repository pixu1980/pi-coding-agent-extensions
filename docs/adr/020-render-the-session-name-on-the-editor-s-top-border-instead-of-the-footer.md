# 020: Render the session name on the editor's top border instead of the footer

- **Date**: 2026-11-27
- **Status**: accepted
- **Tags**: pi-statusline, tui, editor, session-name, pi
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi prints the streaming spinner, compaction and retry status on the top border of the prompt editor, left aligned, and shows the session name only inside its built-in footer as `pwd • name`. pi-statusline replaces that footer with MCP and model info, so a renamed chat had no visible name anywhere near the prompt in the one package that already owns the status surfaces.

## Decision

Mirror the session name on the right edge of the editor's top border, opposite pi's status block, from a CustomEditor subclass that overrides the protected renderTopBorder hook and calls super first. The extension reads the name through pi.getSessionName() on every render, repaints from the session_info_changed event, and leaves the line untouched when the session has no name, when the terminal is too narrow, or when the name would take more than half the border.

## Consequences

Buys: the label inherits pi's own border composition, so the spinner, the `↑ N more` overflow label and app keybindings keep working untouched; a rename appears without reloading extensions; and nothing is drawn for sessions that were never named. Costs: pi-statusline now installs an editor component, so another extension that also calls setEditorComponent wins and the name disappears there; the component is pinned to the CustomEditor API rather than to a rendering-neutral widget.

## What would end this

pi exposes a supported hook for decorating the editor border, or pi itself renders the session name next to its status block.

## Alternatives Considered

1. A setStatus entry or a below-editor widget (both already used by this package): rejected because the line the request targets is the border pi composes, and a widget cannot place glyphs inside it. Replacing the whole editor render() and rewriting line 0, as the border-status-editor example does: rejected because it would delete the embedded working status. Appending the name to the widget below the editor: rejected as a different place from the one asked for.
