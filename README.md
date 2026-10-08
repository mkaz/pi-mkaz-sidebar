# Pi mkaz Sidebar

A fixed activity sidebar for [Pi](https://pi.dev). The sidebar displays agent, session, workspace, context, and optional usage details, with access to recipes in a project justfile. It also replaces the footer with a minimal status line.

![Screenshot of Sidebar in Pi Coding Harness](https://github.com/user-attachments/assets/e68ecccf-53f8-4d85-8663-0ce01720f02e)

## Install locally

I recommend cloning/forking the repo and customizing to your own taste.


**Development:** To clone, install dev dependencies, and launch Pi loading the extension:

```bash
git clone https://github.com/mkaz/pi-mkaz-sidebar
cd pi-mkaz-sidebar
npm install
pi -e .
```

Typecheck the sources with:

```bash
npm run check
```

**Install:** To make available to all instances, create symlink:

```bash
ln -s /DIR/TO/SRC/pi-mkaz-sidebar ~/.pi/agent/extensions
```

Or you can add a symlink in a project's `.pi/` directory.


## Controls

```text
/sidebar                         # toggle the sidebar
/sidebar on|off                  # show or hide the sidebar
/sidebar disable|enable
/ticket                          # open the current ticket in your browser
/ticket status                   # show the detected ID and URL
/ticket <ID|URL>                  # pin a ticket for this session
/ticket auto                      # return to automatic detection
/just [recipe [arguments...]]
/just --stop|--restart|--status
```

The sidebar is 44 columns wide and appears only when the terminal has enough room to preserve 64 columns for Pi. It has no resize mode, mouse handling, or terminal-input interception.

## Current ticket

WORKSPACE shows a ticket when the extension can identify one locally. It prefers a pinned ticket, then the latest user message containing a single ticket reference, the session name, and the Git branch (for example `mkaz/FAM-1234-fix`). Messages without a ticket reference leave the previous ticket selected. As a fallback, it uses ticket links in the conversation when they identify only one ticket.

- **Linear and Jira:** IDs such as `FAM-1234` work regardless of phrasing: “work on FAM-1234,” “this fixes FAM-1234,” or “Linear ticket FAM-1234.”
- **GitHub:** Supports issue URLs and `owner/repo#123` references. Phrases such as “This change addresses GitHub issue #2,” “fix issue #2,” and “work on #2” use the repository from the Git `origin` remote. Without a GitHub origin, a single repository identified by GitHub issue links or qualified references in the conversation supplies the context.

If “GitHub issue #2” has no repository context, the sidebar still shows `GitHub #2`, but opening it requires a URL. Bare numbers alone are not treated as tickets. Detection uses local pattern matching, not a skill or an additional model request.

`/ticket` (or `/ticket open`) opens the ticket in your default browser. The URL must be a Linear issue, Jira `/browse/`, or GitHub issue link found in the active session history or supplied with `/ticket <URL>`. Qualified GitHub references supply their own browser URL (for example `/ticket mkaz/pi-mkaz-sidebar#123`); it does not guess workspace domains or fetch ticket metadata. If only an ID is known, the command asks for its URL. Pinned tickets survive reloads and compaction, and follow the active session branch. `/ticket auto` removes the pin.

## Justfile recipes

If the trusted project has a `justfile` (also `.justfile`, `Justfile`, or `.Justfile`) and [`just`](https://just.systems/) is installed, run its recipes directly with `/just`:

```text
/just test
/just run --port 3000
```

The recipe runs from the project root. The sidebar displays its status, command, and the last three non-empty lines of combined standard output and error in a `JUSTFILE` panel. Use `/just --stop` to stop a long-running recipe, `/just --restart` to rerun the most recent recipe, or `/just --status` (or `/just`) for its status. Pi stops a running recipe when the session shuts down.

The extension reads the justfile when the session starts. After adding or changing one, restart Pi or use `/reload`.

## TODO tool

The optional `todo` tool lets the model create and track session tasks with `pending`, `in_progress`, and `completed` states. Tasks appear in a `TODO` sidebar panel. The full task snapshot is stored in each tool result, so the list follows session branches and survives `/reload` and compaction without a separate data file.

The tool supports `create`, `update`, `list`, `get`, `delete`, and `clear`. It does not add a separate overlay or `/todos` display because the list is already visible in the sidebar.

## Settings

Edit [`settings.json`](settings.json) in the extension directory:

```json
{
  "todo": true,
  "usage": false
}
```

Set `todo` to `false` to omit the tool and its sidebar panel. Set `usage` to `false` to hide the `USAGE` panel. Run `/reload` after changing the file. Missing settings default to `true`; an invalid settings file uses the defaults and prints a warning.

The rest of the sidebar uses its built-in defaults and Pi's configured theme. To change its behavior or appearance, edit the extension source.

## Privacy and local behavior

- Makes no telemetry, analytics, or external network requests. A just recipe may make its own connections.
- Does not store prompts, responses, credentials, or session content outside Pi's session history.
- Stores TODO snapshots in Pi tool results; it does not create a separate TODO data file.
- Reads `settings.json` from the extension directory.
- Reads Pi usage/session metadata and conversation text to render the sidebar and identify ticket IDs/URLs.
- Stores ticket pins in Pi session entries; opens ticket URLs only on an explicit `/ticket` command.
- Reads project justfiles only for trusted projects.
- Runs read-only Git inspection to summarize the worktree and read the `origin` remote for GitHub issue context; untracked file contents are never read.

## License

MIT

Inspired by [pi-atelier extension](https://github.com/michaelmjhhhh/pi-atelier).
