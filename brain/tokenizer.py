"""Kaivra's own tokenizer: byte-level BPE, trained from scratch on Kaivra's training text.

Text is first cut into pieces (the phone does exactly the same):
  piece = [one optional leading space] + (a run of letters/marks | one digit | one other character)
Each piece is turned into UTF-8 bytes (ids 0..255), then merged pair by pair in the order learned here.
"""
import heapq
import unicodedata
from collections import Counter, defaultdict

END, USER, KAIVRA, FACT = 256, 257, 258, 259
SPECIAL = {"<|end|>": END, "<|user|>": USER, "<|kaivra|>": KAIVRA, "<|fact|>": FACT}
FIRST_MERGE = 264

_cls_cache = {}


def char_class(ch):
    """'L' letter or combining mark, 'D' decimal digit, 'S' space, 'O' anything else."""
    c = _cls_cache.get(ch)
    if c is None:
        if ch == " ":
            c = "S"
        elif ch.isalpha() or unicodedata.category(ch)[0] == "M":
            c = "L"
        elif ch.isdecimal():
            c = "D"
        else:
            c = "O"
        _cls_cache[ch] = c
    return c


def pieces(text):
    out = []
    i, n = 0, len(text)
    while i < n:
        start = i
        ch = text[i]
        if ch == " " and i + 1 < n and text[i + 1] != " ":
            i += 1  # the space joins the next piece
        c = char_class(text[i])
        if c == "L":
            i += 1
            while i < n and char_class(text[i]) == "L":
                i += 1
        else:
            i += 1
        out.append(text[start:i])
    return out


def train(texts, vocab_size=4096, min_count=2, log=print):
    counts = Counter()
    for t in texts:
        counts.update(pieces(t))
    items = [(p.encode("utf-8"), c) for p, c in counts.items() if c >= min_count or len(p) == 1]
    words = [list(b) for b, _ in items]
    freq = [c for _, c in items]
    pair_count = defaultdict(int)
    where = defaultdict(set)
    for i, w in enumerate(words):
        for a, b in zip(w, w[1:]):
            pair_count[(a, b)] += freq[i]
            where[(a, b)].add(i)
    heap = [(-c, pr) for pr, c in pair_count.items()]
    heapq.heapify(heap)
    merges = []
    new_id = FIRST_MERGE
    n_merges = vocab_size - FIRST_MERGE
    while len(merges) < n_merges and heap:
        negc, pr = heapq.heappop(heap)
        if pair_count.get(pr, 0) != -negc or negc == 0:
            continue
        a, b = pr
        merges.append(pr)
        changed = set()
        for i in list(where[pr]):
            w = words[i]
            f = freq[i]
            if len(w) < 2:
                continue
            found = False
            for x, y in zip(w, w[1:]):
                if x == a and y == b:
                    found = True
                    break
            if not found:
                continue
            for pp in zip(w, w[1:]):
                pair_count[pp] -= f
                changed.add(pp)
            nw = []
            j = 0
            while j < len(w):
                if j + 1 < len(w) and w[j] == a and w[j + 1] == b:
                    nw.append(new_id)
                    j += 2
                else:
                    nw.append(w[j])
                    j += 1
            words[i] = nw
            for pp in zip(nw, nw[1:]):
                pair_count[pp] += f
                where[pp].add(i)
                changed.add(pp)
        pair_count.pop(pr, None)
        where.pop(pr, None)
        for pp in changed:
            c = pair_count.get(pp, 0)
            if c > 0 and pp != pr:
                heapq.heappush(heap, (-c, pp))
            elif c <= 0:
                pair_count.pop(pp, None)
        new_id += 1
        if log and len(merges) % 500 == 0:
            log(f"  tokenizer: {len(merges)} merges")
    return merges


class Tokenizer:
    def __init__(self, merges):
        self.merges = [tuple(m) for m in merges]
        self.rank = {pr: i for i, pr in enumerate(self.merges)}
        self.vocab = FIRST_MERGE + len(self.merges)
        self.bytes_of = {i: bytes([i]) for i in range(256)}
        for name, i in SPECIAL.items():
            self.bytes_of[i] = b""
        for i, (a, b) in enumerate(self.merges):
            self.bytes_of[FIRST_MERGE + i] = self.bytes_of[a] + self.bytes_of[b]
        self.cache = {}

    def encode_piece(self, p):
        ids = self.cache.get(p)
        if ids is not None:
            return ids
        w = list(p.encode("utf-8"))
        while len(w) > 1:
            best, bi = None, -1
            for j in range(len(w) - 1):
                r = self.rank.get((w[j], w[j + 1]))
                if r is not None and (best is None or r < best):
                    best, bi = r, j
            if best is None:
                break
            w = w[:bi] + [FIRST_MERGE + best] + w[bi + 2:]
        if len(self.cache) < 2_000_000:
            self.cache[p] = w
        return w

    def encode(self, text):
        out = []
        for p in pieces(text):
            out.extend(self.encode_piece(p))
        return out

    def decode(self, ids):
        return b"".join(self.bytes_of.get(i, b"") for i in ids).decode("utf-8", errors="replace")
