# Linux Tree

A Sourcetree-style Git GUI for Linux with built-in git-flow.

Electron 33 · React 19 · TypeScript · [HeroUI v3](https://heroui.com) · Tailwind CSS v4

## Run

```bash
npm install
npm run dev                  # development with hot reload
npm run build && npm start   # production build
npm run dist:deb             # package → dist/linux-tree_<version>_amd64.deb
```

Requires `git` on your PATH. No `git-flow` CLI needed.

Install the package with `sudo apt install ./dist/linux-tree_*_amd64.deb`.

### Chromium sandbox on Ubuntu 23.10+ (dev mode)

Ubuntu restricts unprivileged user namespaces via AppArmor, so a plain `npm run dev`
aborts with *"The SUID sandbox helper binary was found, but is not configured correctly"*.
The **.deb handles this automatically** (it installs an AppArmor profile, like Chrome/VS Code).
For development, pick one:

```bash
# A) make the dev sandbox helper setuid root (redo after reinstalling node_modules)
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox

# B) or run without the sandbox (dev only)
npx electron-vite dev -- --no-sandbox
```

## Authentication (SSH only)

Remote operations use your normal SSH setup (`~/.ssh/config`, `core.sshCommand`, ssh-agent).
Git runs without a terminal, so it never hangs on a hidden prompt:

- Key without passphrase → works.
- Key with passphrase → the app asks for it in a dialog (via `SSH_ASKPASS`). To avoid
  being asked on every fetch/push, load it into your agent once: `ssh-add ~/.ssh/id_ed25519`.
- Unknown host → the app shows the host fingerprint and asks you to confirm.

## Features

- **Tabs**: open several repositories side by side. Tabs (order + active tab) are restored on
  the next launch; drag to reorder, middle-click or Ctrl+W to close. A dot marks tabs with
  uncommitted changes.
- **Home screen**: recent repositories with current branch and last-opened time, filter,
  "not found" detection for moved/deleted folders, remove from list, show in file manager.
- **New repository**: pick a name, location and initial branch; the folder is created and
  initialized. Opening a folder that isn't a repository offers to initialize it in place
  (with a warning for your home folder). Empty repositories open on the commit view.
- **Remotes**: add one from the + on the Remotes header (or press Push / Pull / Fetch in a
  repository without a remote: it asks for one, then carries on). Right-click a remote to
  fetch, edit its name / URL, copy the URL or remove it. Every remote is listed, even
  before it has any branches.
- **Light / dark / system theme** (button at the top right).
- **Auto-refresh** every 5 seconds (the faint line above Branches fills up to the next one):
  branches, tags, stashes, file status and commits pick up changes made outside the app.
  History only reloads when a branch/tag/HEAD moved, so selection and scroll are kept.
  Paused while a git command runs and while the tab or window is in the background.
  Remote branches still update only on Fetch.
- **Commit graph** across all branches (or current only), ref labels, search, infinite scroll,
  commit details + diffs. Right-click: checkout, branch/tag here, cherry-pick, revert, reset.
- **Branch folders**: `feature/x` shown as a collapsible tree, ↑ahead / ↓behind counts,
  double-click to check out (remote branches create a tracking branch).
- **Git-flow**: init / start / finish feature, release, hotfix. Uses Sourcetree-compatible
  `gitflow.*` config keys. Finish merges with `--no-ff`, tags releases/hotfixes, back-merges
  the tag into develop, deletes the branch (local + remote) and can push. If a merge conflicts,
  resolve, commit, and run Finish again — it picks up where it left off.
- **File status**: stage/unstage/discard whole files, **hunks or individual lines**
  (click lines, Shift+click for a range), conflict helpers (ours/theirs/mark resolved),
  commit with amend and push-after.
- **Interactive rebase** (right-click a commit): reorder, pick, reword, edit, squash, fixup,
  drop. Continue / Skip / Abort from the status bar when a rebase stops.
- **Reset** current branch to any commit: soft, mixed, keep or hard.
- Pull, push (sets upstream automatically), fetch, merge, rebase, stash, tags.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+O | Open repository |
| Ctrl+N | New repository |
| Ctrl+T | Home screen (open another repository) |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab (also Ctrl+PageDown/PageUp) |
| Ctrl+1…8, Ctrl+9 | Jump to tab, last tab |
| F5 or Ctrl+R | Refresh |
| Ctrl+Enter | Commit (in the message box) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| F12 or Ctrl+Shift+I | Developer tools |

App data (recent repositories, open tabs) lives in `~/.config/Linux Tree/settings.json`.

## Layout

```
build/             Icon + .deb install/remove scripts (AppArmor profile)
src/main/          Electron main process (runs git, dialogs, settings, SSH askpass)
src/preload/       Bridge exposed as window.api
src/renderer/src/
  lib/git.ts       Git commands + output parsing
  lib/gitflow.ts   git-flow implementation
  lib/graph.ts     Commit graph lane layout
  lib/patch.ts     Partial patches for hunk/line staging
  App.tsx          Shell: tabs, home screen, settings persistence, shortcuts, theme
  components/      RepoWorkspace (one per tab), TabBar, Home, Sidebar, HistoryView,
                   StatusView, DiffView, RebaseDialog, NewRepoDialog, RemoteDialog, Dialog, ContextMenu
```
