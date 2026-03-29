#!/bin/bash
# Hook: Ensure bun is installed at session start
# Compatible with Claude Code and Gemini CLI
# Works on macOS, Linux, and Windows (via Git Bash)

set -euo pipefail

# Check if bun is available
bun_exists() {
    command -v bun &>/dev/null && return
    for p in "$HOME/.bun/bin/bun" "/usr/local/bin/bun"; do
        [ -x "$p" ] && return
    done
    return 1
}

bun_exists && exit 0

# Install bun
echo "Installing bun..." >&2
case "$(uname -s)" in
    Darwin|Linux)
        curl -fsSL https://bun.com/install | bash || echo "Failed to install bun" >&2
        ;;
    MINGW*|MSYS*|CYGWIN*)
        powershell -c "irm bun.sh/install.ps1|iex" || echo "Failed to install bun" >&2
        ;;
    *)
        echo "Unsupported OS: $(uname -s)" >&2
        ;;
esac

exit 0
