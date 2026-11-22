"""Trains Kaivra's brain for a time budget, resuming from the last checkpoint, then exports it for the phone.

  python train.py --work work --minutes 300
Reads work/corpus.bin, work/tokenizer.json, work/library.bin (optional) and work/ckpt.npz (optional).
Writes work/ckpt.npz, work/brain.bin, work/train_stats.json, work/samples.txt
"""
import argparse
import json
import os
import time

import numpy as np

from model import AdamW, Config, clip_grads, dequantized, export_phone, forward, init_params, backward
from tokenizer import END, FACT, KAIVRA, USER, Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))


def chat_prompt(tk, question, fact=None, history=()):
    ids = [END]
    for q, a in history:
        ids += [USER] + tk.encode(q) + [KAIVRA] + tk.encode(a) + [END]
    if fact:
        ids += [FACT] + tk.encode(fact)
    ids += [USER] + tk.encode(question) + [KAIVRA]
    return ids


def generate(p, cfg, tk, ids, max_new=70, temperature=0.0, rng=None):
    ids = list(ids)
    start = len(ids)
    for _ in range(max_new):
        ctx = np.array([ids[-cfg.ctx:]])
        _, logits, _ = forward(p, cfg, ctx, keep=False)
        lg = logits[-1].astype(np.float64)
        if temperature <= 0:
            nxt = int(lg.argmax())
        else:
            lg = lg / temperature
            top = np.argsort(lg)[-40:]
            pr = np.exp(lg[top] - lg[top].max())
            nxt = int(rng.choice(top, p=pr / pr.sum()))
        if nxt == END:
            break
        ids.append(nxt)
    return tk.decode(ids[start:])


SAMPLE_QUESTIONS = ["hello", "who are you", "who made you", "what can you do", "are you google", "how are you",
                    "what is the sun", "who was mahatma gandhi", "tell me about india", "what is a black hole",
                    "what is water", "where is paris", "write a poem", "tell me a joke", "qwzx plorb"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--minutes", type=float, default=None)
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    args = ap.parse_args()
    W = lambda n: os.path.join(args.work, n)
    conf = json.load(open(args.config))
    minutes = args.minutes if args.minutes is not None else float(conf["train_minutes"])
    merges = json.load(open(W("tokenizer.json")))["merges"]
    tk = Tokenizer(merges)
    cfg = Config(vocab=tk.vocab, **conf["model"])
    B, T = int(conf["batch"]), cfg.ctx
    data = np.memmap(W("corpus.bin"), dtype=np.uint16, mode="r")
    n = len(data)
    val_start = int(n * 0.995)
    t0 = time.time()
    logf = open(W("train.log"), "a")

    def log(s):
        line = f"[train {time.time() - t0:6.0f}s] {s}"
        print(line, flush=True)
        logf.write(line + "\n")
        logf.flush()

    step, tokens = 0, 0
    p = opt = ema = None
    if os.path.exists(W("ckpt.npz")):
        z = np.load(W("ckpt.npz"))
        saved = json.loads(str(z["config"]))
        if saved == cfg.to_dict():
            p = {k[2:]: z[k].copy() for k in z.files if k.startswith("p_")}
            ema = {k[2:]: z[k].copy() for k in z.files if k.startswith("e_")}
            opt = AdamW(p, lr=conf["lr"], wd=conf["weight_decay"])
            opt.m = {k[2:]: z[k].copy() for k in z.files if k.startswith("m_")}
            opt.v = {k[2:]: z[k].copy() for k in z.files if k.startswith("v_")}
            step, tokens = int(z["step"]), int(z["tokens"])
            opt.t = step
            log(f"resumed from step {step} ({tokens / 1e6:.1f}M tokens seen)")
        else:
            log(f"model size changed ({saved} -> {cfg.to_dict()}): starting a new brain")
    if p is None:
        p = init_params(cfg, seed=int(conf.get("seed", 0)))
        ema = {k: v.copy() for k, v in p.items()}
        opt = AdamW(p, lr=conf["lr"], wd=conf["weight_decay"])
        log(f"new brain: {cfg.n_params() / 1e6:.2f}M parameters, corpus {n / 1e6:.1f}M tokens")

    rng = np.random.default_rng(step * 7919 + int(time.time()) % 100000)
    vrng = np.random.default_rng(12345)
    val_ix = vrng.integers(val_start, n - T - 1, 16)

    def val_loss(params):
        tot = 0.0
        for i in range(0, len(val_ix), 4):
            b = np.stack([data[j:j + T + 1] for j in val_ix[i:i + 4]]).astype(np.int64)
            l, _, _ = forward(params, cfg, b[:, :-1], b[:, 1:], keep=False)
            tot += l
        return tot / (len(val_ix) / 4)

    warm = int(conf["warmup_steps"])
    lr = float(conf["lr"])
    ema_decay = float(conf["ema"])
    run_steps, run_t0, bad = 0, time.time(), 0
    avg = None
    v0 = val_loss(ema)
    log(f"start: validation loss {v0:.3f}")
    budget = minutes * 60
    while time.time() - t0 < budget:
        ix = rng.integers(0, val_start - T - 1, B)
        batch = np.stack([data[i:i + T + 1] for i in ix]).astype(np.int64)
        loss, _, cache = forward(p, cfg, batch[:, :-1], batch[:, 1:])
        grads = backward(p, cfg, cache)
        del cache
        gn = clip_grads(grads, 1.0)
        if not np.isfinite(loss) or not np.isfinite(gn):
            bad += 1
            log(f"skipped a bad step (loss {loss}, grad norm {gn})")
            if bad > 20:
                raise SystemExit("training became unstable")
            continue
        lr_t = lr * min(1.0, (step + 1) / warm)
        opt.step(p, grads, lr_t)
        d = min(ema_decay, (1 + step) / (10 + step))
        for k in p:
            e = ema[k]
            e *= d
            e += (1 - d) * p[k]
        step += 1
        run_steps += 1
        tokens += B * T
        avg = loss if avg is None else 0.98 * avg + 0.02 * loss
        if step % 50 == 0:
            rate = run_steps * B * T / (time.time() - run_t0)
            log(f"step {step}  loss {avg:.3f}  grad {gn:.2f}  lr {lr_t:.2e}  {rate:.0f} tokens/s")
        if step % 1000 == 0:
            log(f"step {step}  validation loss {val_loss(ema):.3f}")

    vl = val_loss(ema)
    log(f"finished: {run_steps} steps this run, {step} in total, {tokens / 1e6:.1f}M tokens, validation loss {vl:.3f}")
    arrays = {"config": np.array(json.dumps(cfg.to_dict())), "step": np.array(step), "tokens": np.array(tokens)}
    for k in p:
        arrays["p_" + k] = p[k]
        arrays["e_" + k] = ema[k]
        arrays["m_" + k] = opt.m[k]
        arrays["v_" + k] = opt.v[k]
    np.savez(W("ckpt.npz.tmp.npz"), **arrays)
    os.replace(W("ckpt.npz.tmp.npz"), W("ckpt.npz"))
    meta = dict(steps=step, tokens=tokens, val_loss=round(vl, 4), params=cfg.n_params(), trained=time.strftime("%Y-%m-%d"))
    export_phone(ema, cfg, merges, W("brain.bin"), meta)

    # samples, using exactly the weights the phone gets
    pq = dequantized(ema, cfg)
    lib = None
    if os.path.exists(W("library.bin")):
        from library import Library
        lib = Library(W("library.bin"))
    srng = np.random.default_rng(1)
    with open(W("samples.txt"), "w") as f:
        for q in SAMPLE_QUESTIONS:
            hit = lib.lookup(q) if lib else None
            fact = hit[1] if hit else None
            a = generate(pq, cfg, tk, chat_prompt(tk, q, fact))
            f.write(f"Q: {q}\n" + (f"   (library: {hit[0]})\n" if hit else "") + f"A: {a}\n")
            if fact:
                a2 = generate(pq, cfg, tk, chat_prompt(tk, q, None))
                f.write(f"A without library: {a2}\n")
            f.write("\n")
        a = generate(pq, cfg, tk, [END], max_new=80, temperature=0.8, rng=srng)
        f.write(f"Free writing: {a}\n")
    json.dump(dict(meta, run_steps=run_steps, run_minutes=round((time.time() - t0) / 60, 1),
                   tokens_per_second=round(run_steps * B * T / max(1.0, time.time() - run_t0))),
              open(W("train_stats.json"), "w"), indent=1)
    log("exported brain.bin and samples")


if __name__ == "__main__":
    main()
