#!/usr/bin/env python3
"""Find one option's section in a UX options page and hash it.

Usage: option_section.py <src.html> <option-id>
Prints sha256:<hex>, the hash a build-shape fragment records on its first line:
<!-- build-shape-for: option-a sha256:<hex> -->

An option's section runs from the <section> tag whose id is the option id through
its matching </section>, nested sections included. The hash is SHA-256 of that
text, byte for byte as UTF-8, in src.html (not index.html, where the fragments
are inlined). Any edit inside the section, whitespace included, changes it.
build.py, check.py and the build-shape skill all use this file.
"""
import hashlib
import re
import sys
from pathlib import Path

OPTION_IDS = ('option-a', 'option-b', 'option-c')
FRAGMENT_HEADER = re.compile(r'\s*<!-- build-shape-for: (option-[a-c]) (sha256:[0-9a-f]{64}) -->')


def section_span(html, oid):
    """(start, close, end): the section's first char, its </section>, and one past it."""
    start = re.search(rf'<section\b[^>]*\bid="{re.escape(oid)}"[^>]*>', html)
    if not start:
        return None
    depth = 0
    for tag in re.compile(r'<section\b|</section\s*>').finditer(html, start.start()):
        depth += -1 if tag.group().startswith('</') else 1
        if depth == 0:
            return start.start(), tag.start(), tag.end()
    return None


def option_hash(html, oid):
    span = section_span(html, oid)
    if not span:
        return None
    return 'sha256:' + hashlib.sha256(html[span[0]:span[2]].encode()).hexdigest()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    digest = option_hash(Path(sys.argv[1]).read_text(), sys.argv[2])
    if not digest:
        sys.exit(f'no <section id="{sys.argv[2]}"> in {sys.argv[1]}')
    print(digest)
