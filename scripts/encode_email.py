#!/usr/bin/env python3
"""Encode an email address for _data/profile.yml, so the address is not stored as plain text.

    python3 scripts/encode_email.py            # asks for the address (keeps it out of shell history)
    python3 scripts/encode_email.py --check    # decodes the value now in _data/profile.yml

Paste the printed value into `email_code:` in _data/profile.yml. The page decodes it in the
browser (assets/js/main.js, "Email"). This hides the address from programs that scan source
files and pages for addresses; it is not encryption, since the page has to be able to undo it.
"""
import base64
import pathlib
import re
import sys

KEY = b"world.py"  # the same key as MAIL_KEY in assets/js/main.js


def mix(data: bytes) -> bytes:
    return bytes(byte ^ KEY[i % len(KEY)] for i, byte in enumerate(data))


def encode(address: str) -> str:
    return base64.b64encode(mix(address.strip().encode("utf-8"))).decode("ascii")


def decode(code: str) -> str:
    return mix(base64.b64decode(code)).decode("utf-8")


if __name__ == "__main__":
    if "--check" in sys.argv:
        profile = pathlib.Path(__file__).resolve().parent.parent / "_data" / "profile.yml"
        found = re.search(r'^email_code:\s*"?([A-Za-z0-9+/=]+)"?', profile.read_text(), re.M)
        print(decode(found.group(1)) if found else "no email_code in _data/profile.yml")
    else:
        address = sys.argv[1] if len(sys.argv) > 1 else input("Email address: ")
        print(encode(address))
