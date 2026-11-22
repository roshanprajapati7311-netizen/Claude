"""Builds Kaivra's training data and knowledge library from a Simple English Wikipedia dump.

  python data.py --dump simplewiki.xml.bz2 --out work [--tokenizer work/tokenizer.json]

Writes: tokenizer.json (unless given), corpus.bin (uint16 tokens), library.bin, data_stats.json
Wikipedia text is CC BY-SA, by the Wikipedia community (Wikimedia Foundation, a nonprofit).
"""
import argparse
import bz2
import html
import json
import os
import random
import re
import struct
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET

import numpy as np

import talk
from tokenizer import END, FACT, KAIVRA, USER, Tokenizer, train as train_bpe

# ---------------- wikitext -> plain text (my own cleaner) ----------------

STOP_HEADINGS = {"references", "other websites", "related pages", "notes", "sources", "further reading",
                 "external links", "bibliography", "footnotes", "gallery", "see also", "citations"}
DROP_LINK_NS = ("file:", "image:", "category:", "media:", "wikipedia:", "wp:", "template:", "help:", "portal:",
                "special:", "user:", "talk:", "wikt:", "wiktionary:", "commons:", "s:", "q:", "n:", "b:", "v:", "mw:", "simple:")
DROP_TAGS = ("gallery", "math", "code", "syntaxhighlight", "source", "timeline", "score", "imagemap", "chem", "ce",
             "graph", "mapframe", "hiero", "references", "templatedata", "noinclude", "includeonly", "poem")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

_re_comment = re.compile(r"<!--.*?-->", re.S)
_re_ref_self = re.compile(r"<ref\b[^>]*/>", re.I)
_re_ref = re.compile(r"<ref\b[^>]*>.*?</ref\s*>", re.I | re.S)
_re_drop_tags = re.compile(r"<(%s)\b[^>]*>.*?</\1\s*>" % "|".join(DROP_TAGS), re.I | re.S)
_re_tag = re.compile(r"</?[a-zA-Z][^>]*>")
_re_tpl = re.compile(r"\{\{|\}\}")
_re_tbl = re.compile(r"\{\||\|\}")
_re_lnk = re.compile(r"\[\[|\]\]")
_re_ext = re.compile(r"\[(?:https?:)?//[^\s\]]+\s*([^\]]*)\]")
_re_url = re.compile(r"https?://\S+")
_re_quotes = re.compile(r"'{2,}")
_re_magic = re.compile(r"__[A-Z]+__")
_re_heading = re.compile(r"^(=+)\s*(.*?)\s*=+\s*$")


def _date(params):
    nums = [p.strip() for p in params if p.strip().isdigit()]
    if len(nums) >= 3 and 1 <= int(nums[1]) <= 12:
        return f"{int(nums[2])} {MONTHS[int(nums[1]) - 1]} {nums[0]}"
    if nums:
        return nums[0]
    return ""


def _template(inner):
    parts = inner.split("|")
    name = parts[0].strip().lower().replace("_", " ")
    params = [p for p in parts[1:] if "=" not in p.split("|")[0][:20]]
    if name in ("convert", "cvt") and len(params) >= 2:
        big = {"e3": "thousand", "e6": "million", "e9": "billion", "e12": "trillion"}.get(params[1].strip())
        if big:
            return f"{params[0].strip()} {big}" + (f" {params[2].strip()}" if len(params) > 2 else "")
        if params[1].strip() in ("-", "to", "and", "–") and len(params) >= 4:
            return f"{params[0].strip()} to {params[2].strip()} {params[3].strip()}"
        return f"{params[0].strip()} {params[1].strip()}"
    if name in ("lang", "nowrap", "nobold", "noitalic", "small", "big", "nobr", "transl") and params:
        return params[-1].strip()
    if name in ("birth date", "birth date and age", "death date", "death date and age", "start date", "end date", "dob", "film date"):
        return _date(params)
    if name in ("circa", "c."):
        return ("c. " + params[0].strip()) if params else "c."
    if name in ("ndash", "–"):
        return "–"
    if name in ("mdash",):
        return "—"
    if name == "snd":
        return " – "
    return ""


def remove_templates(t):
    out, depth, last, start = [], 0, 0, 0
    for m in _re_tpl.finditer(t):
        if m.group() == "{{":
            if depth == 0:
                out.append(t[last:m.start()])
                start = m.start()
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0:
                last = m.end()
                inner = t[start + 2:m.start()]
                if "{{" in inner:
                    inner = remove_templates(inner)
                out.append(_template(inner))
    if depth == 0:
        out.append(t[last:])
    return "".join(out)


def remove_tables(t):
    out, depth, last = [], 0, 0
    for m in _re_tbl.finditer(t):
        if m.group() == "{|":
            if depth == 0:
                out.append(t[last:m.start()])
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0:
                last = m.end()
    if depth == 0:
        out.append(t[last:])
    return "".join(out)


def _link(inner):
    s = inner.strip()
    low = s.lower().lstrip(":")
    if low.startswith(DROP_LINK_NS):
        return ""
    if s.startswith(":"):
        s = s[1:]
    if "|" in s:
        label = s.split("|")[-1].strip()
        if label:
            return label
        target = s.split("|")[0]
        return re.sub(r"\s*\(.*?\)\s*$", "", target.split(":")[-1])
    return s.split("#")[0] if not s.startswith("#") else s[1:]


def replace_links(t):
    out, stack, last = [], [], 0
    for m in _re_lnk.finditer(t):
        if m.group() == "[[":
            if not stack:
                out.append(t[last:m.start()])
            stack.append(m.start())
        elif stack:
            st = stack.pop()
            if not stack:
                last = m.end()
                inner = t[st + 2:m.start()]
                if "[[" in inner:
                    if inner.strip().lower().startswith(DROP_LINK_NS):
                        continue
                    inner = replace_links(inner)
                out.append(_link(inner))
    if not stack:
        out.append(t[last:])
    return "".join(out)


def tidy(s):
    s = s.replace(" ", " ").replace("​", "")
    s = re.sub(r"\(\s*[,;:–\-]*\s*\)", "", s)
    s = re.sub(r"\(\s*[,;]\s*", "(", s)
    s = re.sub(r"\s*[,;]\s*\)", ")", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" ([,.;:!?%)])", r"\1", s)
    s = re.sub(r"\( ", "(", s)
    s = re.sub(r",{2,}", ",", s)
    s = re.sub(r"\.{2,}(?!\.)", ".", s) if "..." not in s else s
    return s.strip()


def clean(wikitext):
    """Returns (paragraphs of the lead, list of all paragraphs)."""
    t = _re_comment.sub("", wikitext)
    t = _re_ref_self.sub("", t)
    t = _re_ref.sub("", t)
    t = _re_drop_tags.sub("", t)
    t = remove_templates(t)
    t = remove_tables(t)
    t = replace_links(t)
    t = _re_ext.sub(r"\1", t)
    t = _re_url.sub("", t)
    t = _re_tag.sub("", t)
    t = _re_magic.sub("", t)
    t = html.unescape(t)
    t = _re_quotes.sub("", t)
    lead, paras, cur = [], [], []
    in_lead = True

    def flush():
        if cur:
            p = tidy(" ".join(cur))
            if len(p) >= 20:
                paras.append(p)
                if in_lead:
                    lead.append(p)
            cur.clear()

    for line in t.split("\n"):
        line = line.strip()
        h = _re_heading.match(line)
        if h:
            flush()
            in_lead = False
            if h.group(2).strip().lower() in STOP_HEADINGS:
                break
            continue
        if not line:
            flush()
            continue
        if line[0] in "|!{}":
            continue
        if line[0] in "*#:;":
            flush()
            item = tidy(line.lstrip("*#:; "))
            if len(item) >= 40 and not in_lead:
                paras.append(item)
            continue
        cur.append(line)
    flush()
    return lead, paras


_abbrev = re.compile(r"(?:\b[A-Z]|\bMr|\bMrs|\bMs|\bDr|\bSt|\bJr|\bSr|\bMt|\bNo|\bvs|\betc|\be\.g|\bi\.e|\bc|\bca|\bU\.S|\bU\.K|\bInc|\bLtd|\bCo|\bJan|\bFeb|\bAug|\bSept?|\bOct|\bNov|\bDec|\bapprox|\bfl|\bb|\bd)\.$")


def sentences(p):
    out, start = [], 0
    for m in re.finditer(r"[.!?](?=\s+[A-Z0-9\"'(])", p):
        chunk = p[start:m.end()]
        if _abbrev.search(chunk):
            continue
        out.append(chunk.strip())
        start = m.end()
    rest = p[start:].strip()
    if rest:
        out.append(rest)
    return out


def take(sents, max_chars, max_sents):
    out = ""
    for i, s in enumerate(sents[:max_sents]):
        if out and len(out) + 1 + len(s) > max_chars:
            break
        out = (out + " " + s).strip()
    if len(out) > max_chars + 120:
        cut = out[:max_chars]
        out = cut[:cut.rfind(" ")].rstrip(",;:") + "."
    return out


# ---------------- normalised keys (the phone uses exactly the same rule) ----------------

def norm_key(s):
    s = unicodedata.normalize("NFKD", s.lower().replace("&", " and "))
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] != "M")
    s = "".join(ch if (ch.isalpha() or ch.isdecimal()) else " " for ch in s)
    words = s.split()
    while words and words[0] in ("the", "a", "an"):
        words = words[1:]
    return " ".join(words)


def base_title(title):
    return re.sub(r"\s*\([^)]*\)\s*$", "", title).strip()


# ---------------- questions about an article ----------------

PLACE_WORDS = r"(?:city|town|village|country|commune|county|state|province|region|district|island|islands|river|lake|mountain|" \
              r"capital|municipality|suburb|neighbourhood|neighborhood|continent|ocean|sea|desert|valley|peninsula|place|area|" \
              r"prefecture|department|canton|parish|borough|territory|kingdom|republic|nation|planet|moon|star|galaxy)"
_re_place = re.compile(r"\b(?:is|was|are|were) (?:a|an|the|one of the)? ?(?:[\w'-]+ ){0,4}" + PLACE_WORDS + r"\b")
_re_person = re.compile(r"\((?:born|b\.)\s|\(\s*\d{0,2}\s*[A-Z]?[a-z]*\s*\d{3,4}\s*[–-]|\bwas born\b|\(c\. \d{3,4}|\(\d{3,4}\s*[–-]\s*\d{3,4}\)")
_re_be = re.compile(r"\b(is|was|are|were)\b")


def subject_phrase(title, first):
    b = base_title(title)
    m = re.match(r"^(The|A|An)\s+", first)
    if m and first[m.end():].lower().startswith(b.lower()):
        return m.group(1).lower() + " " + first[m.end():m.end() + len(b)]
    if first.lower().startswith(b.lower()):
        return first[:len(b)]
    return b


def questions_for(r, title, lead_first):
    subj = subject_phrase(title, lead_first)
    be = _re_be.search(lead_first[:200])
    verb = be.group(1) if be else "is"
    person = bool(_re_person.search(lead_first[:250]))
    place = (not person) and bool(_re_place.search(lead_first[:200]))
    plain = base_title(title)
    if not person and plain[:1].isupper() and plain[:1].lower() + plain[1:] in lead_first[:120]:
        plain = plain[:1].lower() + plain[1:]  # a common noun: "black hole", not "Black hole"
    if person:
        qs = [f"who {verb} {subj}", f"who is {plain}", f"tell me about {plain}", f"do you know {plain}",
              f"what do you know about {plain}", f"who {verb} {plain}", f"tell me something about {plain}"]
    elif place:
        qs = [f"what {verb} {subj}", f"where is {plain}", f"tell me about {plain}", f"what do you know about {plain}",
              f"where {verb} {plain}", f"what {verb} {plain}"]
    else:
        qs = [f"what {verb} {subj}", f"tell me about {subj}", f"what do you know about {plain}", f"explain {subj}",
              f"what does {plain} mean", f"define {plain}", f"what {verb} {plain}", f"tell me about {plain}", f"{plain}"]
    q = r.choice(qs)
    if r.random() < 0.5:
        q = q.lower()
    else:
        q = q[0].upper() + q[1:] + ("?" if q.split()[0] in ("who", "what", "where", "do") else "")
    if r.random() < 0.1:
        q = r.choice(["kaivra ", "hey kaivra ", "please "]) + q
    return q


# ---------------- reading the dump ----------------

def read_dump(path, log, limit=0):
    """Yields (title, lead_paragraphs, all_paragraphs) for articles, and collects redirects."""
    opener = bz2.open if path.endswith(".bz2") else open
    redirects = {}
    n = 0
    with opener(path, "rb") as f:
        ctx = ET.iterparse(f, events=("end",))
        title = ns = text = redirect = None
        for ev, el in ctx:
            tag = el.tag.rsplit("}", 1)[-1]
            if tag == "title":
                title = el.text or ""
            elif tag == "ns":
                ns = el.text
            elif tag == "redirect":
                redirect = el.get("title")
            elif tag == "text":
                text = el.text or ""
            elif tag == "page":
                if ns == "0" and title:
                    if redirect:
                        redirects[title] = redirect
                    elif not re.search(r"\{\{\s*(disambig|disambiguation|dab|set index|surname|given name)", text[:6000], re.I) \
                            and not title.startswith("List of"):
                        lead, paras = clean(text)
                        if lead and "may refer to" not in lead[0] and "can mean" not in lead[0][:200]:
                            yield title, lead, paras
                            n += 1
                            if n % 20000 == 0:
                                log(f"  read {n} articles")
                            if limit and n >= limit:
                                break
                title = ns = text = redirect = None
                el.clear()
    read_dump.redirects = redirects


# ---------------- library file ----------------

def write_library(path, articles, keys):
    """articles: list of (title, fact); keys: dict normalised key -> article index."""
    art_blob = bytearray()
    art_off = [0]
    for t, fct in articles:
        art_blob += (t + "\t" + fct).encode("utf-8")
        art_off.append(len(art_blob))
    items = sorted(((k.encode("utf-8"), i) for k, i in keys.items()), key=lambda x: x[0])
    key_blob = bytearray()
    key_off = [0]
    for kb, _ in items:
        key_blob += kb
        key_off.append(len(key_blob))
    with open(path, "wb") as f:
        f.write(b"KVL1")
        f.write(struct.pack("<2i", len(articles), len(items)))
        f.write(np.asarray(art_off, dtype="<i4").tobytes())
        f.write(np.asarray(key_off, dtype="<i4").tobytes())
        f.write(np.asarray([i for _, i in items], dtype="<i4").tobytes())
        f.write(bytes(art_blob))
        f.write(bytes(key_blob))


# ---------------- sequences ----------------

def seq_qa(tk, q, a, fact=None, history=()):
    ids = []
    for hq, ha in history:
        ids += [USER] + tk.encode(hq) + [KAIVRA] + tk.encode(ha) + [END]
    if fact:
        ids += [FACT] + tk.encode(fact)
    ids += [USER] + tk.encode(q) + [KAIVRA] + tk.encode(a) + [END]
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tokenizer", default="")
    ap.add_argument("--vocab", type=int, default=4096)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()

    def log(s):
        print(f"[data {time.time() - t0:6.0f}s] {s}", flush=True)

    r = random.Random(args.seed)
    log("reading the Wikipedia dump")
    docs, leads = [], []  # docs: article texts; leads: (title, fact, answer, first sentence, size)
    for title, lead, paras in read_dump(args.dump, log, args.limit):
        body = "\n".join(paras)[:6000]
        docs.append(body)
        sents = sentences(" ".join(lead[:2]))
        if not sents or len(sents[0]) < 30:
            continue
        fact = take(sents, 420, 3)
        ans = take(sents, 260, 2)
        leads.append((title, fact, ans, sents[0], len(body)))
    redirects = getattr(read_dump, "redirects", {})
    log(f"{len(docs)} articles, {len(leads)} with a usable lead, {len(redirects)} redirects")

    # knowledge library: best article per key
    articles = [(t, f) for t, f, _, _, _ in leads]
    size_of = [s for *_, s in leads]
    index_of_title = {t: i for i, (t, *_rest) in enumerate(leads)}
    keys = {}

    def add_key(k, i):
        if not k:
            return
        j = keys.get(k)
        if j is None or size_of[i] > size_of[j]:
            keys[k] = i

    for i, (t, *_rest) in enumerate(leads):
        add_key(norm_key(t), i)
    for i, (t, *_rest) in enumerate(leads):
        b = norm_key(base_title(t))
        if b not in keys:
            add_key(b, i)
    for src, dst in redirects.items():
        i = index_of_title.get(dst)
        if i is not None:
            k = norm_key(src)
            if k and k not in keys:
                keys[k] = i
    write_library(os.path.join(args.out, "library.bin"), articles, keys)
    log(f"library: {len(articles)} articles, {len(keys)} keys, {os.path.getsize(os.path.join(args.out, 'library.bin')) / 1e6:.1f} MB")

    # text examples
    qa = []
    for title, fact, ans, first, _ in leads:
        n = 1 + (r.random() < 0.5)
        for _ in range(n):
            q = questions_for(r, title, first)
            qa.append((q, ans, fact if r.random() < 0.7 else None))
    dls = talk.dialogs(max(40000, len(leads) // 3), args.seed)
    log(f"{len(qa)} question-answer examples, {len(dls)} Kaivra conversations")

    # tokenizer
    if args.tokenizer and os.path.exists(args.tokenizer):
        merges = json.load(open(args.tokenizer))["merges"]
        log(f"using the existing tokenizer ({len(merges)} merges)")
    else:
        sample = []
        budget = 12_000_000
        for d in r.sample(docs, min(len(docs), 40000)):
            sample.append(d)
            budget -= len(d)
            if budget < 4_000_000:
                break
        sample += [f"{q} {a} {f or ''}" for q, a, f in r.sample(qa, min(len(qa), 30000))]
        sample += [" ".join(q + " " + a for q, a in d) for d in dls[:20000]]
        log(f"training the tokenizer on {sum(len(s) for s in sample) / 1e6:.1f} MB of text")
        merges = train_bpe(sample, vocab_size=args.vocab, log=log)
        json.dump({"merges": merges}, open(os.path.join(args.out, "tokenizer.json"), "w"))
        log(f"tokenizer: {len(merges)} merges")
    tk = Tokenizer(merges)

    # sequences, mixed together
    seqs = []
    for d in docs:
        seqs.append(tk.encode(d) + [END])
    log("encoded articles")
    for q, a, f in qa:
        hist = []
        if r.random() < 0.1:
            hist = [talk.exchange(r)]
        seqs.append(seq_qa(tk, q, a, f, hist))
    log("encoded questions")
    for _rep in range(2):
        for d in dls:
            seqs.append(seq_qa(tk, d[-1][0], d[-1][1], None, d[:-1]))
        dls = talk.dialogs(len(dls), args.seed + 1)
    log("encoded conversations")
    r.shuffle(seqs)
    total = sum(len(s) for s in seqs)
    arr = np.empty(total, dtype=np.uint16)
    pos = 0
    for s in seqs:
        arr[pos:pos + len(s)] = s
        pos += len(s)
    arr.tofile(os.path.join(args.out, "corpus.bin"))
    stats = dict(articles=len(docs), leads=len(leads), redirects=len(redirects), library_keys=len(keys),
                 qa=len(qa), dialogs=len(dls) * 2, tokens=int(total), seconds=int(time.time() - t0))
    json.dump(stats, open(os.path.join(args.out, "data_stats.json"), "w"), indent=1)
    log(f"corpus: {total / 1e6:.1f}M tokens")
    # a few examples for the log
    with open(os.path.join(args.out, "data_samples.txt"), "w") as f:
        for q, a, fc in qa[:12]:
            f.write(f"Q: {q}\nA: {a}\nFACT: {fc}\n\n")
        for d in docs[:3]:
            f.write(d[:600] + "\n\n")


if __name__ == "__main__":
    sys.exit(main())
