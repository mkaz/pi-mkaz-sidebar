# Pi mkaz Sidebar

A fixed, read-only activity sidebar for [Pi](https://pi.dev). The sidebar holds session, tool, workspace, context, and usage detail. The footer deliberately stays quiet: status on the left; model and effort on the right.

## Install locally

```bash
pi -e .
```

The package is marked private because it is intended for personal use.

## Controls

```text
/sidebar                         # toggle the sidebar
/sidebar on|off                  # show or hide the sidebar
/sidebar disable|enable
```

The sidebar is 44 columns wide and appears only when the terminal has enough room to preserve 64 columns for Pi. It has no resize mode, mouse handling, or terminal-input interception.

## Configuration

User configuration is stored at:

```text
~/.pi/agent/pi-mkaz-sidebar.json
```

A trusted project may supply an override at:

```text
<project>/.pi/pi-mkaz-sidebar.json
```

The sidebar uses Pi's configured theme and needs no custom style settings.

## Privacy and local behavior

- Makes no telemetry, analytics, or external network requests.
- Does not store prompts, responses, credentials, or session content.
- Reads Pi usage/session metadata to render the sidebar.
- Runs read-only Git inspection to summarize the worktree; untracked file contents are never read.

## License

MIT

Inspired by [pi-atelier extension](https://github.com/michaelmjhhhh/pi-atelier).
