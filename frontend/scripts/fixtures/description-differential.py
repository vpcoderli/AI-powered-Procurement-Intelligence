"""Offline cross-language differential for the description classifier.

Prints a JSON list of {"text", "title", "issue"} where "issue" is Python's body_issue. The
TypeScript test classifies the same pairs with getBidDescriptionIssue and expects the same
codes. Descriptions are built from the shared contract fixture, which pins every rule piece:
its words in random order, its texts with random edits, splices and joins. Near misses and
every whitespace character the two runtimes once disagreed on are mixed in.

usage: python description-differential.py <seed> <count>
"""

import json
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "crawler"))

from apsi_crawler.content_quality import body_issue  # noqa: E402

CONTRACT = json.loads((ROOT / "crawler/tests/fixtures/description_quality_contract.json").read_text(encoding="utf-8"))
TEXTS = [case["text"] for case in CONTRACT["cases"] if case["text"]]
# Rule words that are joined, split or extended, which a rule has to tell apart.
NEAR_MISSES = [
    "login", "signin", "signup", "loggedin", "log-in", "registered", "viewing", "accessible", "humans",
    "javascripts", "browsers", "copyrights", "copyright2024", "20245", "(4030)", "error403", "404notfound",
    "attention", "required!", "streets", "6270", "627011", "62701-12", "<htmlx>", "<bodyguard>", "https:/x",
    "n/a.", "tbd.", "©", "(c)", "&", "/", "-", "#",
]
WORDS = sorted({word for text in TEXTS for word in text.split()}) + NEAR_MISSES
WHITESPACE = [" "] * 12 + [
    "  ", "\t", "\n", "\r\n", "\r", "\x0b", "\x0c", "\xa0", " ", " ", "　", " ", " ",
    "﻿", "\x85", "\x1c", "\x1d", "\x1e", "\x1f", "​", "",
]
PUNCTUATION = list(".,:;!?-–—_*/'\"()[]{}。，、：；！？…’|·#&©") + ["...", ". ", ", ", ": ", " - ", " | ", "\n"]

rng = random.Random(int(sys.argv[1]))


def casing(text):
    roll = rng.random()
    if roll < 0.55:
        return text
    if roll < 0.7:
        return text.upper()
    if roll < 0.85:
        return text.title()
    return "".join(ch.upper() if rng.random() < 0.5 else ch for ch in text)


def separator():
    roll = rng.random()
    if roll < 0.7:
        return rng.choice(WHITESPACE)
    if roll < 0.9:
        return rng.choice(PUNCTUATION) + rng.choice([" ", ""])
    return rng.choice(WHITESPACE) + rng.choice(PUNCTUATION) + rng.choice(WHITESPACE)


def words(count):
    text = casing(rng.choice(WORDS))
    for _ in range(count - 1):
        text += separator() + casing(rng.choice(WORDS))
    return text


def edit(text):
    chars = list(text)
    for _ in range(rng.randint(1, 3)):
        roll = rng.random()
        position = rng.randint(0, len(chars))
        if roll < 0.25 and chars:
            index = min(position, len(chars) - 1)
            chars[index] = rng.choice(WHITESPACE) if chars[index] == " " else chars[index].swapcase()
        elif roll < 0.45:
            chars.insert(position, rng.choice(PUNCTUATION))
        elif roll < 0.6 and chars:
            del chars[min(position, len(chars) - 1)]
        elif roll < 0.8:
            chars[position:position] = list(rng.choice(WHITESPACE) + casing(rng.choice(WORDS)) + rng.choice(WHITESPACE))
        else:
            chars[position:position] = list(rng.choice(WHITESPACE))
    return "".join(chars)


def splice():
    left, right = rng.choice(TEXTS), rng.choice(TEXTS)
    return left[:rng.randint(0, len(left))] + right[rng.randint(0, len(right)):]


def join():
    parts = [casing(rng.choice(TEXTS + WORDS)) for _ in range(rng.randint(1, 5))]
    return rng.choice(["|", " | ", "\n", " · ", "·", " / ", ", "]).join(parts)


def pair():
    roll = rng.random()
    title = CONTRACT["title"]
    if roll < 0.3:
        text = words(rng.randint(1, 8))
    elif roll < 0.55:
        text = edit(rng.choice(TEXTS))
    elif roll < 0.65:
        text = rng.choice(WHITESPACE + PUNCTUATION) + casing(rng.choice(TEXTS)) + rng.choice(WHITESPACE + PUNCTUATION)
    elif roll < 0.8:
        text = splice()
    elif roll < 0.9:
        text = join()
    else:
        title = words(rng.randint(1, 3))
        text = rng.choice(WHITESPACE + PUNCTUATION) + edit(title) + rng.choice(WHITESPACE + PUNCTUATION) if rng.random() < 0.5 else title
    if rng.random() < 0.05:
        title = None
    return text, title


cases = []
for _ in range(int(sys.argv[2])):
    text, title = pair()
    cases.append({"text": text, "title": title, "issue": body_issue(text, title)})
json.dump(cases, sys.stdout, ensure_ascii=True)
