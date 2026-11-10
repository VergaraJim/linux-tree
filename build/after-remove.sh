#!/bin/bash
# Linux Tree post-remove.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'linux-tree' '/opt/Linux Tree/linux-tree' || true
else
    rm -f '/usr/bin/linux-tree'
fi
if [ -f /etc/apparmor.d/linux-tree ]; then
    if hash apparmor_parser 2>/dev/null; then
        apparmor_parser --remove /etc/apparmor.d/linux-tree 2>/dev/null || true
    fi
    rm -f /etc/apparmor.d/linux-tree
fi
