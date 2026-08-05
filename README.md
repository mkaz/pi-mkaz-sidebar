# Pi mkaz Sidebar

A fixed activity sidebar for [Pi](https://pi.dev). The sidebar displays session, tool, workspace, context, and usage detail, with optional control of one project server command. Updates the footer to minimal status line since the sidebar now contains most of the information.

![Screenshot of Sidebar in Pi Coding Harness](https://github.com/user-attachments/assets/e68ecccf-53f8-4d85-8663-0ce01720f02e)

## Install locally

I recommend cloning/forking the repo and customizing to your own taste.


**Development:** To clone and launch Pi loading the extension:

```bash
git clone https://github.com/mkaz/pi-mkaz-sidebar
cd pi-mkaz-sidebar
pi -e .
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
/server [start|stop|restart|status]
```

The sidebar is 44 columns wide and appears only when the terminal has enough room to preserve 64 columns for Pi. It has no resize mode, mouse handling, or terminal-input interception.

## Server command

Optionally configure one project server command in `.pi/mkaz-sidebar.json`:

```json
{
  "serverCommand": "npm run dev",
  "serverUrl": "http://localhost:3000"
}
```

The command runs from the project root. It can be any shell command, such as `just run` or `just serve`. `serverUrl` is optional and is displayed in the sidebar. Start, stop, and restart with `/server ...`. The sidebar keeps the last three non-empty lines of combined standard output and error, truncating them to its width. Pi stops the process when the session shuts down.

After adding or changing the file, restart Pi or use `/reload` before starting the server.

## Customization

The sidebar is intentionally fixed to its built-in defaults and uses Pi's configured theme. To change its behavior or appearance, use Pi to edit the extension source to customize to your taste.

## Privacy and local behavior

- Makes no telemetry, analytics, or external network requests. A configured server command may make its own connections.
- Does not store prompts, responses, credentials, or session content.
- Reads Pi usage/session metadata to render the sidebar.
- Reads `.pi/mkaz-sidebar.json` only for trusted projects when server control is configured.
- Runs read-only Git inspection to summarize the worktree; untracked file contents are never read.

## License

MIT

Inspired by [pi-atelier extension](https://github.com/michaelmjhhhh/pi-atelier).
