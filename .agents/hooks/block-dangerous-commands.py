# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Hook: Block dangerous shell commands.
Multi-level security: catastrophic (block), critical paths (block), suspicious (warn).
"""

import json
import re
import sys

# Common regex prefixes
SUDO = r"(sudo\s+)?"
RM_MV = rf"{SUDO}(rm|mv)\s+(-[rfRF]+\s+)?"
RM_RF = rf"{SUDO}rm\s+(-[rfRF]+\s+)?"

CATASTROPHIC = [
    (rf"{RM_RF}(/\s*$|/[^a-zA-Z])", "rm on root directory"),
    (rf"{RM_RF}(~|\$HOME)/?(\s|$)", "rm on home directory"),
    (rf"{RM_RF}\*\s*$", "rm with bare wildcard"),
    (rf"{SUDO}rm\s+-[rfRF]*[rfRF]+\s+.*\*", "rm -rf with wildcards"),
    (rf"{SUDO}(dd\s+(if=|of=/dev))", "dd disk operations"),
    (rf"{SUDO}(mkfs\.|mkswap|fdisk|parted)\s", "filesystem operations"),
    (r">\s*/dev/(sd[a-z]|nvme|hd[a-z])", "direct disk write"),
    (r":(\(\))?\s*\{\s*:\s*\|\s*:\s*&\s*\}", "fork bomb"),
    (rf"{SUDO}chmod\s+(-R\s+)?777\s+/", "chmod 777 on root"),
    (rf"{SUDO}chown\s+(-R\s+)?[^\s]+\s+/?$", "chown on root"),
    (rf"{SUDO}(shred|truncate\s+-s\s*0)\s", "permanent data destruction"),
]

CRITICAL_PATHS = [
    (rf"{RM_MV}\.(claude|codex|gemini|agent|git|venv)(/|$|\s)", "protected directory"),
    (rf"{RM_MV}node_modules(/|$|\s)", "Node.js dependencies"),
    (rf"{RM_MV}[^\s]*\.env\b", "environment variables"),
    (rf"{RM_MV}[^\s]*package\.json\b", "package manifest"),
    (rf"{RM_MV}[^\s]*(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)\b", "lock file"),
    (rf"{RM_MV}[^\s]*(Cargo\.toml|go\.mod|pyproject\.toml)\b", "project manifest"),
    (rf"{RM_MV}[^\s]*requirements\.txt\b", "Python dependencies"),
    (r"\bgit\s+clean\s+(-[fdxFDX]+\s*)+", "git clean"),
    (r"\bgit\s+reset\s+--hard", "git reset --hard"),
]

SUSPICIOUS = [
    (r"\brm\s+.*\s+&&", "chained rm"),
    (r"\brm\s+[^\s/]*\*", "rm with wildcards"),
    (r"\bfind\s+.*-delete", "find -delete"),
    (r"\bxargs\s+.*\brm", "xargs with rm"),
]

CATASTROPHIC_TIPS = [
    "This command could cause IRREVERSIBLE system damage or data loss.",
    "",
    "Safety tips:",
    "  - Never use rm -rf with /, ~, or * wildcards",
    "  - Use specific file paths instead of wildcards",
]

CRITICAL_TIPS = [
    "This path contains critical project files.",
    "",
    "If needed, execute manually in your terminal.",
]


def block(icon: str, title: str, desc: str, cmd: str, tips: list[str]) -> None:
    lines = [f"{icon} {title}", "", f"Reason: {desc}", f"Command: {cmd[:100]}", ""] + tips
    print("\n".join(lines), file=sys.stderr)
    sys.exit(2)


def warn(desc: str, cmd: str) -> None:
    print(f"⚠️  WARNING: {desc}", file=sys.stderr)
    print(f"Command: {cmd[:100]}", file=sys.stderr)


def check_patterns(cmd: str, patterns: list, handler) -> bool:
    """Check command against patterns, call handler on match. Returns True if matched."""
    for pattern, desc in patterns:
        if re.search(pattern, cmd, re.IGNORECASE):
            handler(desc, cmd)
            return True
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return

    cmd = data.get("tool_input", {}).get("command", "")
    if not cmd:
        return

    block_catastrophic = lambda d, c: block("❌", "BLOCKED: Catastrophic command!", d, c, CATASTROPHIC_TIPS)
    block_critical = lambda d, c: block("🛑", "BLOCKED: Critical path protection!", d, c, CRITICAL_TIPS)

    check_patterns(cmd, CATASTROPHIC, block_catastrophic)
    check_patterns(cmd, CRITICAL_PATHS, block_critical)
    check_patterns(cmd, SUSPICIOUS, warn)


if __name__ == "__main__":
    main()
