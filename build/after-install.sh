#!/bin/bash
# Linux Tree post-install (replaces electron-builder's default template).

APP_DIR='/opt/Linux Tree'
BIN="$APP_DIR/linux-tree"

if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/linux-tree' ] && [ -e '/usr/bin/linux-tree' ] && [ "$(readlink '/usr/bin/linux-tree')" != '/etc/alternatives/linux-tree' ]; then
        rm -f '/usr/bin/linux-tree'
    fi
    update-alternatives --install '/usr/bin/linux-tree' 'linux-tree' "$BIN" 100 || ln -sf "$BIN" '/usr/bin/linux-tree'
else
    ln -sf "$BIN" '/usr/bin/linux-tree'
fi

# Chromium's sandbox needs unprivileged user namespaces. Ubuntu 23.10+ restricts
# them with AppArmor (kernel.apparmor_restrict_unprivileged_userns=1), in which
# case `unshare --user` can still succeed but Electron aborts at startup.
# Like Chrome and VS Code, ship an AppArmor profile that allows userns.
if [ -d /etc/apparmor.d ] && [ -f /etc/apparmor.d/abi/4.0 ]; then
    cat > /etc/apparmor.d/linux-tree <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile linux-tree "/opt/Linux Tree/linux-tree" flags=(unconfined) {
  userns,

  include if exists <local/linux-tree>
}
PROFILE
    if hash apparmor_parser 2>/dev/null; then
        apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/linux-tree || true
    fi
    chmod 0755 "$APP_DIR/chrome-sandbox" || true
elif ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # No user namespaces at all: fall back to the SUID sandbox helper.
    chmod 4755 "$APP_DIR/chrome-sandbox" || true
else
    chmod 0755 "$APP_DIR/chrome-sandbox" || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
