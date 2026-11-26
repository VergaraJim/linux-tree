# Linux Tree

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

### Flatpak

```bash
npm run dist:flatpak         # package → dist/linux-tree_<version>_x86_64.flatpak
```

Host requirements and setup:

```bash
sudo apt install flatpak flatpak-builder
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 org.electronjs.Electron2.BaseApp//24.08
```

Install and run:

```bash
flatpak install --user dist/linux-tree_*_x86_64.flatpak
flatpak run link.vergara_jim.linuxtree
```

The Flatpak application id is the config `appId` with the dash turned into an underscore
(`link.vergara-jim.linuxtree` → `link.vergara_jim.linuxtree`).

Sandbox notes:

- `git` and the OpenSSH client are built into the bundle — a flatpak cannot run the host's `git`.
- `$HOME` is accessible read/write via `--filesystem=home`, so `~/.gitconfig`, `~/.ssh` and
  repositories under your home directory work as usual.
- The ssh-agent is forwarded via `--socket=ssh-auth`.
- Settings and recent repositories live in
  `~/.var/app/link.vergara_jim.linuxtree/config/Linux Tree/` instead of
  `~/.config/Linux Tree/` and are **not** migrated.
- HTTPS credentials only work through a git credential helper that exists inside the sandbox
  (`store` / `cache` in `~/.gitconfig` work; a helper at a host path such as
  `/usr/lib/git-core/git-credential-libsecret` does not).
- The AppArmor / `chrome-sandbox` notes below apply to the deb and dev runs only, not to the
  flatpak (zypak handles it).

### Chromium sandbox on Ubuntu 23.10+ (dev mode)

Ubuntu restricts unprivileged user namespaces via AppArmor, so a plain `npm run dev`
aborts with _"The SUID sandbox helper binary was found, but is not configured correctly"_.
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
  double-click to check out (remote branches create a tracking branch). A filter box for
  branches and tags above the list narrows them down; Enter checks out the first match.
- **Git-flow**: init / start / finish feature, release, hotfix. Uses Sourcetree-compatible
  `gitflow.*` config keys. Finish merges with `--no-ff`, tags releases/hotfixes, back-merges
  the tag into develop, deletes the branch (local + remote) and can push. If a merge conflicts,
  resolve, commit, and run Finish again — it picks up where it left off.
- **File status**: stage/unstage/discard whole files, **hunks or individual lines**
  (click lines, Shift+click for a range), conflict helpers (ours/theirs/mark resolved),
  commit with amend and push-after. Right-click new files → **Ignore…** (this file, its
  extension, a parent folder or a custom pattern; saved to .gitignore, .git/info/exclude
  or the global ignore file).
- **Interactive rebase** (right-click a commit): reorder, pick, reword, edit, squash, fixup,
  drop. Continue / Skip / Abort from the status bar when a rebase stops.
- **Reset** current branch to any commit: soft, mixed, keep or hard.
- Pull (merge, rebase or fast-forward only — the last choice is remembered), push (sets
  upstream automatically), fetch, merge, rebase, stash, tags.

## Keyboard shortcuts

| Keys                      | Action                                          |
| ------------------------- | ----------------------------------------------- |
| Ctrl+O                    | Open repository                                 |
| Ctrl+N                    | New repository                                  |
| Ctrl+T                    | Home screen (open another repository)           |
| Ctrl+W                    | Close tab                                       |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab (also Ctrl+PageDown/PageUp) |
| Ctrl+1…8, Ctrl+9          | Jump to tab, last tab                           |
| F5 or Ctrl+R              | Refresh                                         |
| Ctrl+Enter                | Commit (in the message box)                     |
| Ctrl+= / Ctrl+- / Ctrl+0  | Zoom in / out / reset                           |
| F12 or Ctrl+Shift+I       | Developer tools                                 |

App data (recent repositories, open tabs) lives in `~/.config/Linux Tree/settings.json`.

## Layout

```
build/             Icon + .deb install/remove scripts (AppArmor profile);
                   Flatpak module definitions live in package.json (build.flatpak)
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
