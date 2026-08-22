#!/usr/bin/env python3
"""Print the current coverage percentage from coverage.xml."""

import argparse
import json
from pathlib import Path

from coverage_lib import read_line_rate


def read_coverage(xml_path: Path) -> float:
    """Parse coverage.xml and return the line coverage percentage as a float."""
    line_rate = read_line_rate(xml_path)
    if line_rate is None and xml_path.exists():
        print(f"Error parsing coverage XML: {xml_path}", file=sys.stderr)
        return 0.0
    return line_rate * 100.0 if line_rate is not None else 0.0


def main() -> None:
    """Parse CLI arguments and print coverage summary."""
    parser = argparse.ArgumentParser(
        description="Print current coverage percentage from coverage.xml."
    )
    parser.add_argument(
        "path",
        nargs="?",
        default="coverage.xml",
        help="Path to coverage.xml (default: coverage.xml)",
    )
    args = parser.parse_args()

    cov = read_coverage(Path(args.path))
    print(f"Current coverage: {cov:.2f}%")
    print(json.dumps({"coverage": round(cov, 2)}))


if __name__ == "__main__":
    main()
