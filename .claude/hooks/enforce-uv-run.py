# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Hook: Intercept python commands and wrap them with uv run.
Compatible with Claude Code (PreToolUse) and Gemini CLI (BeforeTool).
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

PYTHON_PATTERN = re.compile(r"^(\s*)(python3?(?:\.\d+)?)\b(.*)$")
UV_RUN_PATTERN = re.compile(r"^\s*(uv|.*[/\\]uv(\.exe)?)\s+run\s+")


def find_uv() -> str | None:
    """Find uv binary, checking PATH first then common install locations."""
    # Check PATH
    uv = shutil.which("uv")
    if uv:
        return uv

    # Common install locations
    home = Path.home()
    candidates = [
        home / ".local" / "bin" / "uv",
        home / ".cargo" / "bin" / "uv",
        Path("/usr/local/bin/uv"),
    ]

    # Windows: check LOCALAPPDATA
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        candidates.append(Path(localappdata) / "uv" / "uv.exe")

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

    if UV_RUN_PATTERN.match(command):
        return

    match = PYTHON_PATTERN.match(command)
    if not match:
        return

    uv_path = find_uv()
    if not uv_path:
        return

    whitespace, python_cmd, rest = match.groups()
    new_command = f"{whitespace}{uv_path} run {python_cmd}{rest}"

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
