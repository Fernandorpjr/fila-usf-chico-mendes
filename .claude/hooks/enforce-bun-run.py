# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Hook: Intercept node/npx commands and wrap them with bun/bunx.
Compatible with Claude Code (PreToolUse) and Gemini CLI (BeforeTool).
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

NODE_PATTERN = re.compile(r"^(\s*)(node)\b(.*)$")
NPX_PATTERN = re.compile(r"^(\s*)(npx)\b(.*)$")
BUN_PATTERN = re.compile(r"^\s*(bun|bunx|.*[/\\]bun(\.exe)?)\s+")


def find_bun() -> str | None:
    """Find bun binary, checking PATH first then common install locations."""
    # Check PATH
    bun = shutil.which("bun")
    if bun:
        return bun

    # Common install locations
    home = Path.home()
    candidates = [
        home / ".bun" / "bin" / "bun",
        Path("/usr/local/bin/bun"),
    ]

    # Windows: check LOCALAPPDATA
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        candidates.append(Path(localappdata) / "bun" / "bun.exe")

    for p in candidates:
        if p.is_file():
            return str(p)

    return None


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    if tool_name not in ("Bash", "run_shell_command") or not command:
        return

    if BUN_PATTERN.match(command):
        return

    bun_path = find_bun()
    if not bun_path:
        return

    # Check for node commands -> bun
    match = NODE_PATTERN.match(command)
    if match:
        whitespace, _, rest = match.groups()
        new_command = f"{whitespace}{bun_path}{rest}"
    else:
        # Check for npx commands -> bunx
        match = NPX_PATTERN.match(command)
        if not match:
            return
        whitespace, _, rest = match.groups()
        bunx_path = str(Path(bun_path).parent / "bunx")
        new_command = f"{whitespace}{bunx_path}{rest}"

    # Output format based on CLI
    if data.get("hook_event_name") == "BeforeTool":
        output = {"decision": "approve", "updatedInput": {"command": new_command}}
    else:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": {"command": new_command},
            }
        }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
