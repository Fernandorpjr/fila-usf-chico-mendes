# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Hook: Remind Claude to use appropriate skills based on file type keywords.
Runs on UserPromptSubmit event.
One consolidated recommendation per file type with priority order.
"""

import json
import sys

# File type configurations: keywords and prioritized skill recommendations
FILE_TYPE_REMINDERS = {
    "word": {
        "keywords": [
            "docx",
            "word",
            "document",
            "file",
            "contract",
            "add",
            "insert",
            "edit",
            "update",
            "modify",
            "comment",
            "review",
            "track",
            "redline",
            "markup",
        ],
        "message": (
            "Skill priority for Word/.docx tasks:\n"
            "1. `docx-processing-lawvable`: ALWAYS preferred if available\n"
            "2. `docx-processing-anthropic`: if #1 unavailable only\n"
            "3. Last resort: custom scripts with python-docx in ./temp/ folder, run with `uv run`"
        ),
    },
    "pdf": {
        "keywords": [
            "pdf",
            "text",
            "content",
            "extract",
            "read",
            "parse",
            "fill",
            "create",
            "generate",
            "merge",
        ],
        "message": (
            "Skill priority for PDF/.pdf tasks:\n"
            "1. `pdf-processing-anthropic`: always preferred if available\n"
            "2. Last resort: custom scripts with pypdf/pdfplumber in ./temp/ folder, run with `uv run`"
        ),
    },
    "excel": {
        "keywords": [
            "excel",
            "xlsx",
            "csv",
            "spreadsheet",
            "worksheet",
            "workbook",
            "extract",
            "read",
            "parse",
            "fill",
            "create",
            "generate",
            "merge",
            "edit",
        ],
        "message": (
            "Skill priority for Excel/.xlsx tasks:\n"
            "1. `xlsx-processing-anthropic`: always preferred if available\n"
            "2. Last resort: custom scripts with openpyxl in ./temp/ folder, run with `uv run`"
        ),
    },
    "powerpoint": {
        "keywords": [
            "powerpoint",
            "pptx",
            "presentation",
            "slides",
            "deck",
            "create",
            "edit",
        ],
        "message": (
            "Skill priority for PowerPoint/.pptx tasks:\n"
            "1. `pptx-processing-anthropic`: always preferred if available\n"
            "2. Last resort: custom scripts with python-pptx in ./temp/ folder, run with `uv run`"
        ),
    },
}


def check_keywords(text: str, keywords: list[str]) -> bool:
    """Check if any keyword is present in the text."""
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in keywords)


def get_reminders(prompt: str) -> list[str]:
    """Get list of relevant reminders based on prompt content (one per file type)."""
    reminders = []

    for file_type, config in FILE_TYPE_REMINDERS.items():
        if check_keywords(prompt, config["keywords"]):
            reminders.append(config["message"])

    return reminders


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return

    prompt = data.get("prompt", "")
    if not prompt:
        return

    reminders = get_reminders(prompt)

    if reminders:
        # stdout with exit code 0 adds context to Claude (per docs)
        # Use double newline to separate multiple reminders clearly
        print("\n\n".join(reminders))


if __name__ == "__main__":
    main()
