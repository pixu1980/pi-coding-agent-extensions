<p align="center">
  <img src="./lib/banner.svg" alt="pi-statusline — terminal workspace telemetry" width="1100">
</p>

# pi-statusline

> Statusline extension for [pi](https://pi.dev) — replicates `/statusline` from Claude Code with customizable templates, git status, model info, and context usage with gradient colors.

## Install

```bash
pi install npm:@pixu1980/pi-statusline
```

## Features

A dual-line status display for `pi-coding-agent`:

- **Line 1 (widget, below editor):** project name, git branch/status, model info, thinking level, and context usage with a gradient color scale.
- **Line 2 (footer, replaces native):** MCP server status on the left, provider/model info on the right.

## Commands

| Command | Description |
| --- | --- |
| `/statusline` | Print the current statusline in the output |
| `/statusline settings` | Open the interactive settings panel |
| `/statusline template` | Set a custom template string |
| `/statusline reload` | Reload settings from disk |

## Customization

Templates support placeholders for project, git branch, git status (ahead/behind/modified/untracked), model name, provider, thinking level, context usage, and MCP server counts. See the settings panel (`/statusline settings`) for the full list and live preview.

## License

MIT
