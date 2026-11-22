"""Kaivra's own brain: a small transformer language model written from scratch.

Everything here is plain NumPy: the forward pass, the hand-written backward pass
(backpropagation), the AdamW optimizer and the export to the phone format.
No machine-learning framework is used.

Architecture (decoder-only transformer):
  token embedding (tied with the output layer)
  N x [ RMSNorm -> multi-head causal self-attention with rotary positions -> residual
        RMSNorm -> SwiGLU feed-forward -> residual ]
  RMSNorm -> logits
"""
import json
import struct
import numpy as np

EPS = 1e-5
ROPE_THETA = 10000.0


class Config:
    def __init__(self, vocab=4096, dim=288, layers=6, heads=6, hidden=768, ctx=256):
        self.vocab, self.dim, self.layers, self.heads, self.hidden, self.ctx = vocab, dim, layers, heads, hidden, ctx
        assert dim % heads == 0 and (dim // heads) % 2 == 0
        self.head_dim = dim // heads

    def to_dict(self):
        return dict(vocab=self.vocab, dim=self.dim, layers=self.layers, heads=self.heads, hidden=self.hidden, ctx=self.ctx)

    @staticmethod
    def from_dict(d):
        return Config(**{k: int(d[k]) for k in ("vocab", "dim", "layers", "heads", "hidden", "ctx")})

    def n_params(self):
        d, h = self.dim, self.hidden
        return self.vocab * d + self.layers * (4 * d * d + 3 * d * h + 2 * d) + d


def init_params(cfg, seed=0, dtype=np.float32):
    rng = np.random.default_rng(seed)
    d, h, L = cfg.dim, cfg.hidden, cfg.layers
    std = 0.02
    out_std = std / np.sqrt(2 * L)
    p = {"emb": rng.normal(0, std, (cfg.vocab, d))}
    for l in range(L):
        p[f"l{l}.attn_norm"] = np.ones(d)
        p[f"l{l}.wqkv"] = rng.normal(0, std, (d, 3 * d))
        p[f"l{l}.wo"] = rng.normal(0, out_std, (d, d))
        p[f"l{l}.mlp_norm"] = np.ones(d)
        p[f"l{l}.w1"] = rng.normal(0, std, (d, h))
        p[f"l{l}.w3"] = rng.normal(0, std, (d, h))
        p[f"l{l}.w2"] = rng.normal(0, out_std, (h, d))
    p["norm"] = np.ones(d)
    return {k: v.astype(dtype) for k, v in p.items()}


def rope_tables(cfg, T, dtype):
    half = cfg.head_dim // 2
    freqs = ROPE_THETA ** (-np.arange(half) * 2.0 / cfg.head_dim)
    ang = np.arange(T)[:, None] * freqs[None, :]
    return np.cos(ang).astype(dtype), np.sin(ang).astype(dtype)


def rope(x, cos, sin):
    # x: (B, H, T, hd); rotates each (even, odd) pair by its position angle
    B, H, T, hd = x.shape
    xr = x.reshape(B, H, T, hd // 2, 2)
    x0, x1 = xr[..., 0], xr[..., 1]
    out = np.empty_like(xr)
    out[..., 0] = x0 * cos - x1 * sin
    out[..., 1] = x0 * sin + x1 * cos
    return out.reshape(B, H, T, hd)


def rope_back(dy, cos, sin):
    B, H, T, hd = dy.shape
    dr = dy.reshape(B, H, T, hd // 2, 2)
    d0, d1 = dr[..., 0], dr[..., 1]
    out = np.empty_like(dr)
    out[..., 0] = d0 * cos + d1 * sin
    out[..., 1] = -d0 * sin + d1 * cos
    return out.reshape(B, H, T, hd)


def rms(x, g):
    r = 1.0 / np.sqrt((x * x).mean(-1, keepdims=True) + EPS)
    xn = x * r
    return xn * g, (xn, r)


def rms_back(dy, cache, g, gacc):
    xn, r = cache
    gacc += (dy * xn).reshape(-1, xn.shape[-1]).sum(0)
    dxn = dy * g
    return r * (dxn - xn * (dxn * xn).mean(-1, keepdims=True))


def forward(p, cfg, idx, targets=None, weights=None, keep=True):
    """Returns (loss, logits, cache). idx, targets: (B, T) ints; weights: (B, T) loss weights."""
    B, T = idx.shape
    d, H, hd = cfg.dim, cfg.heads, cfg.head_dim
    dt = p["emb"].dtype
    cos, sin = rope_tables(cfg, T, dt)
    mask = np.triu(np.full((T, T), -1e9, dtype=dt), 1)
    scale = dt.type(1.0 / np.sqrt(hd))
    x = p["emb"][idx]
    layers = []
    for l in range(cfg.layers):
        c = {}
        h, c["n1"] = rms(x, p[f"l{l}.attn_norm"])
        hf = h.reshape(B * T, d)
        qkv = hf @ p[f"l{l}.wqkv"]
        qkv = qkv.reshape(B, T, 3, H, hd).transpose(2, 0, 3, 1, 4)  # 3, B, H, T, hd
        q = rope(qkv[0], cos, sin)
        k = rope(qkv[1], cos, sin)
        v = np.ascontiguousarray(qkv[2])
        s = (q @ k.transpose(0, 1, 3, 2)) * scale + mask
        s -= s.max(-1, keepdims=True)
        P = np.exp(s)
        P /= P.sum(-1, keepdims=True)
        o = P @ v  # B, H, T, hd
        o2 = o.transpose(0, 2, 1, 3).reshape(B * T, d)
        x = x + (o2 @ p[f"l{l}.wo"]).reshape(B, T, d)
        h2, c["n2"] = rms(x, p[f"l{l}.mlp_norm"])
        h2f = h2.reshape(B * T, d)
        u = h2f @ p[f"l{l}.w1"]
        g = h2f @ p[f"l{l}.w3"]
        sig = 1.0 / (1.0 + np.exp(-u))
        su = u * sig
        m = su * g
        x = x + (m @ p[f"l{l}.w2"]).reshape(B, T, d)
        if keep:
            c.update(hf=hf, q=q, k=k, v=v, P=P, o2=o2, h2f=h2f, u=u, g=g, sig=sig, su=su, m=m)
        layers.append(c)
    xf, nf = rms(x, p["norm"])
    xf2 = xf.reshape(B * T, d)
    logits = xf2 @ p["emb"].T
    cache = dict(idx=idx, layers=layers, nf=nf, xf2=xf2, cos=cos, sin=sin, scale=scale, B=B, T=T)
    if targets is None:
        return None, logits, cache
    tg = targets.reshape(-1)
    w = np.ones(B * T, dtype=dt) if weights is None else weights.reshape(-1).astype(dt)
    wsum = max(float(w.sum()), 1.0)
    mx = logits.max(-1, keepdims=True)
    ex = np.exp(logits - mx)
    se = ex.sum(-1, keepdims=True)
    lse = (np.log(se) + mx)[:, 0]
    nll = lse - logits[np.arange(B * T), tg]
    loss = float((nll * w).sum() / wsum)
    if keep:
        probs = ex / se
        probs *= (w / wsum)[:, None]
        probs[np.arange(B * T), tg] -= w / wsum
        cache["dlogits"] = probs
    return loss, logits, cache


def backward(p, cfg, cache):
    """Hand-written backpropagation through the whole network. Returns gradients for every parameter."""
    B, T = cache["B"], cache["T"]
    d, H, hd = cfg.dim, cfg.heads, cfg.head_dim
    cos, sin, scale = cache["cos"], cache["sin"], cache["scale"]
    grads = {k: np.zeros_like(v) for k, v in p.items()}
    dl = cache.pop("dlogits")
    grads["emb"] += dl.T @ cache["xf2"]
    dxf = (dl @ p["emb"]).reshape(B, T, d)
    del dl
    dx = rms_back(dxf, cache["nf"], p["norm"], grads["norm"])
    for l in reversed(range(cfg.layers)):
        c = cache["layers"][l]
        # feed-forward
        df = dx.reshape(B * T, d)
        grads[f"l{l}.w2"] += c["m"].T @ df
        dm = df @ p[f"l{l}.w2"].T
        dg = dm * c["su"]
        sig, u = c["sig"], c["u"]
        du = dm * c["g"] * (sig * (1.0 + u * (1.0 - sig)))
        grads[f"l{l}.w1"] += c["h2f"].T @ du
        grads[f"l{l}.w3"] += c["h2f"].T @ dg
        dh2 = du @ p[f"l{l}.w1"].T + dg @ p[f"l{l}.w3"].T
        dx = dx + rms_back(dh2.reshape(B, T, d), c["n2"], p[f"l{l}.mlp_norm"], grads[f"l{l}.mlp_norm"])
        # attention
        da = dx.reshape(B * T, d)
        grads[f"l{l}.wo"] += c["o2"].T @ da
        do = (da @ p[f"l{l}.wo"].T).reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        P, v, q, k = c["P"], c["v"], c["q"], c["k"]
        dP = do @ v.transpose(0, 1, 3, 2)
        dv = P.transpose(0, 1, 3, 2) @ do
        dS = P * (dP - (dP * P).sum(-1, keepdims=True)) * scale
        dq = rope_back(dS @ k, cos, sin)
        dk = rope_back(dS.transpose(0, 1, 3, 2) @ q, cos, sin)
        dqkv = np.stack([dq, dk, dv]).transpose(1, 3, 0, 2, 4).reshape(B * T, 3 * d)
        grads[f"l{l}.wqkv"] += c["hf"].T @ dqkv
        dh = (dqkv @ p[f"l{l}.wqkv"].T).reshape(B, T, d)
        dx = dx + rms_back(dh, c["n1"], p[f"l{l}.attn_norm"], grads[f"l{l}.attn_norm"])
    np.add.at(grads["emb"], cache["idx"].reshape(-1), dx.reshape(B * T, d))
    return grads


class AdamW:
    def __init__(self, params, lr=6e-4, b1=0.9, b2=0.95, eps=1e-8, wd=0.1):
        self.lr, self.b1, self.b2, self.eps, self.wd = lr, b1, b2, eps, wd
        self.t = 0
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}

    def step(self, params, grads, lr=None):
        lr = self.lr if lr is None else lr
        self.t += 1
        c1 = 1 - self.b1 ** self.t
        c2 = 1 - self.b2 ** self.t
        for k, p in params.items():
            g = grads[k]
            m, v = self.m[k], self.v[k]
            m *= self.b1
            m += (1 - self.b1) * g
            v *= self.b2
            v += (1 - self.b2) * (g * g)
            if p.ndim == 2:
                p *= 1 - lr * self.wd
            p -= (lr / c1) * m / (np.sqrt(v / c2) + self.eps)


def clip_grads(grads, max_norm=1.0):
    total = float(np.sqrt(sum(float((g * g).sum()) for g in grads.values())))
    if total > max_norm:
        f = max_norm / (total + 1e-6)
        for g in grads.values():
            g *= f
    return total


# ---------- export to the phone format (int8 weights, one scale per output row) ----------

MAGIC = b"KVB1"


def _q8(w_out_in):
    w = np.asarray(w_out_in, dtype=np.float32)
    s = np.abs(w).max(1) / 127.0
    s[s == 0] = 1.0
    q = np.clip(np.round(w / s[:, None]), -127, 127).astype(np.int8)
    return q, s.astype(np.float32)


def export_phone(p, cfg, merges, path, meta=None):
    """Writes brain.bin: header, tokenizer merges, then weights (matrices stored as [out][in] int8 + scales)."""
    d = cfg.dim
    with open(path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<7i", 1, cfg.vocab, cfg.dim, cfg.layers, cfg.heads, cfg.hidden, cfg.ctx))
        f.write(struct.pack("<2f", ROPE_THETA, EPS))
        f.write(struct.pack("<i", len(merges)))
        f.write(np.asarray(merges, dtype="<i4").reshape(-1).tobytes())
        mj = json.dumps(meta or {}).encode("utf-8")
        f.write(struct.pack("<i", len(mj)))
        f.write(mj)

        def mat(w_in_out):
            q, s = _q8(np.asarray(w_in_out).T)
            f.write(q.tobytes())
            f.write(s.astype("<f4").tobytes())

        def vec(v):
            f.write(np.asarray(v, dtype="<f4").tobytes())

        q, s = _q8(p["emb"])
        f.write(q.tobytes())
        f.write(s.astype("<f4").tobytes())
        for l in range(cfg.layers):
            vec(p[f"l{l}.attn_norm"])
            wqkv = p[f"l{l}.wqkv"]
            mat(wqkv[:, :d])
            mat(wqkv[:, d:2 * d])
            mat(wqkv[:, 2 * d:])
            mat(p[f"l{l}.wo"])
            vec(p[f"l{l}.mlp_norm"])
            mat(p[f"l{l}.w1"])
            mat(p[f"l{l}.w3"])
            mat(p[f"l{l}.w2"])
        vec(p["norm"])


def dequantized(p, cfg):
    """The weights exactly as the phone sees them (for checking the export)."""
    d = cfg.dim
    out = {}

    def dq(w_in_out):
        q, s = _q8(np.asarray(w_in_out).T)
        return (q.astype(np.float32) * s[:, None]).T

    q, s = _q8(p["emb"])
    out["emb"] = q.astype(np.float32) * s[:, None]
    for l in range(cfg.layers):
        w = p[f"l{l}.wqkv"]
        out[f"l{l}.wqkv"] = np.concatenate([dq(w[:, :d]), dq(w[:, d:2 * d]), dq(w[:, 2 * d:])], 1)
        for n in ("wo", "w1", "w3", "w2"):
            out[f"l{l}.{n}"] = dq(p[f"l{l}.{n}"])
        out[f"l{l}.attn_norm"] = p[f"l{l}.attn_norm"].astype(np.float32)
        out[f"l{l}.mlp_norm"] = p[f"l{l}.mlp_norm"].astype(np.float32)
    out["norm"] = p["norm"].astype(np.float32)
    return out
