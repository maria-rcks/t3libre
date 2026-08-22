#!/usr/bin/env python3
"""Update the coverage badge in README.md from coverage.xml data."""

import re
import sys
from pathlib import Path

from coverage_lib import read_line_rate


def read_coverage_percent(xml_path: Path) -> int:
    """Parse coverage.xml and return the line coverage percentage as an integer."""
    line_rate = read_line_rate(xml_path)
    if line_rate is None:
        if xml_path.exists():
            print(f"Error parsing coverage XML: {xml_path}", file=sys.stderr)
        return 0
    return int(round(line_rate * 100.0))


def update_readme(readme_path: Path, percent: int) -> bool:
    """Update the coverage badge URL in README.md with the given percentage.

    Returns True if the file was changed, False otherwise.
    """
    if not readme_path.exists():
        print("README.md not found", file=sys.stderr)
        return False

    try:
        content = readme_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print(f"Error reading README.md: {e}", file=sys.stderr)
        return False

    pattern = re.compile(
        r"(https://img\.shields\.io/badge/coverage-)(\d+)(%25-brightgreen)"
    )
    new_content, n = pattern.subn(r"\g<1>" + str(percent) + r"\g<3>", content)

    if n == 0:
        broad = re.sub(
            r"coverage-\d+%25-brightgreen",
            f"coverage-{percent}%25-brightgreen",
            content,
        )
        if broad == content:
            return False
        new_content = broad

    try:
        readme_path.write_text(new_content, encoding="utf-8")
    except OSError as e:
        print(f"Error writing README.md: {e}", file=sys.stderr)
        return False

    return new_content != content


def main() -> None:
    """Entry point: read coverage, update badge, exit with appropriate code."""
    project_root = Path(__file__).resolve().parents[1]
    readme_path = project_root / "README.md"
    coverage_xml = project_root / "coverage.xml"

    percent = read_coverage_percent(coverage_xml)
    changed = update_readme(readme_path, percent)

    if changed:
        print(f"Updated README coverage badge to {percent}%")
        print("PROCEED to commit and push from CI if desired.")
    else:
        print("No README updates needed for coverage badge.")
    sys.exit(0)


if __name__ == "__main__":
    main()
