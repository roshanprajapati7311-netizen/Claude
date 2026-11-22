"""Reads Kaivra's knowledge library (library.bin) and finds the article a question is about.
The phone (Library.java) follows exactly the same rules."""
import re
import struct

import numpy as np

from data import norm_key

LEADS = [
    "tell me something about", "tell me about", "what do you know about", "do you know about", "do you know",
    "what is meant by", "what is the meaning of", "meaning of", "what does", "information about", "info about",
    "search for", "look up", "define", "describe", "explain",
    "what is", "what s", "whats", "what are", "what was", "what were",
    "who is", "who s", "whos", "who was", "who are", "who were",
    "where is", "where s", "wheres", "where was", "where are", "where were",
    "when was", "when is",
]
FILLERS = ["hey kaivra", "ok kaivra", "kaivra", "please", "can you", "could you", "would you", "will you", "can u"]
TAILS = [" mean", " means", " please", " for me", " kaivra"]


def subject_of(question):
    """'What is a black hole?' -> 'black hole' (already normalised), or '' if the question has no clear subject."""
    q = norm_key(question)
    changed = True
    while changed:
        changed = False
        for f in FILLERS:
            if q == f:
                return ""
            if q.startswith(f + " "):
                q = q[len(f) + 1:]
                changed = True
    found = False
    for lead in LEADS:
        if q.startswith(lead + " "):
            q = q[len(lead) + 1:]
            found = True
            break
    for t in TAILS:
        if q.endswith(t):
            q = q[:-len(t)]
    words = q.split()
    while words and words[0] in ("the", "a", "an"):
        words = words[1:]
    q = " ".join(words)
    if not found and len(words) > 4:
        return ""
    return q


class Library:
    def __init__(self, path):
        b = open(path, "rb").read()
        assert b[:4] == b"KVL1"
        na, nk = struct.unpack("<2i", b[4:12])
        o = 12
        self.art_off = np.frombuffer(b, "<i4", na + 1, o); o += 4 * (na + 1)
        self.key_off = np.frombuffer(b, "<i4", nk + 1, o); o += 4 * (nk + 1)
        self.key_art = np.frombuffer(b, "<i4", nk, o); o += 4 * nk
        self.art_base = o
        self.key_base = o + int(self.art_off[-1])
        self.b = b
        self.nk = nk

    def key(self, i):
        return self.b[self.key_base + self.key_off[i]:self.key_base + self.key_off[i + 1]]

    def article(self, i):
        s = self.b[self.art_base + self.art_off[i]:self.art_base + self.art_off[i + 1]].decode("utf-8")
        t, f = s.split("\t", 1)
        return t, f

    def find_key(self, k):
        kb = k.encode("utf-8")
        lo, hi = 0, self.nk - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            mk = self.key(mid)
            if mk == kb:
                return int(self.key_art[mid])
            if mk < kb:
                lo = mid + 1
            else:
                hi = mid - 1
        return -1

    def lookup(self, question):
        """Returns (title, fact) or None."""
        s = subject_of(question)
        if not s:
            return None
        tries = [s]
        if s.endswith("ies"):
            tries.append(s[:-3] + "y")
        if s.endswith("es"):
            tries.append(s[:-2])
        if s.endswith("s"):
            tries.append(s[:-1])
        for t in tries:
            i = self.find_key(t)
            if i >= 0:
                return self.article(i)
        return None
