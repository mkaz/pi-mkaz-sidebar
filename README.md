# Pi mkaz Sidebar

A fixed, read-only activity sidebar for [Pi](https://pi.dev). The sidebar displays session, tool, workspace, context, and usage detail. Updates the footer to minimal status line since the sidebar now contains most of the information.

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
```

The sidebar is 44 columns wide and appears only when the terminal has enough room to preserve 64 columns for Pi. It has no resize mode, mouse handling, or terminal-input interception.

## Customization

The sidebar is intentionally fixed to its built-in defaults and uses Pi's configured theme. To change its behavior or appearance, use Pi to edit the extension source to customize to your taste.

## Privacy and local behavior

- Makes no telemetry, analytics, or external network requests.
- Does not store prompts, responses, credentials, or session content.
- Reads Pi usage/session metadata to render the sidebar.
- Runs read-only Git inspection to summarize the worktree; untracked file contents are never read.

## License

MIT

Inspired by [pi-atelier extension](https://github.com/michaelmjhhhh/pi-atelier).
