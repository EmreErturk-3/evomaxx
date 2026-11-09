#!/usr/bin/env python3
"""
Random Boolean networks: S. A. Kauffman, "Metabolic stability and epigenesis in randomly
constructed genetic nets", Journal of Theoretical Biology 22 (1969) 437-467; with the
annealed approximation of B. Derrida and Y. Pomeau, "Random networks of automata: a simple
annealed approximation", Europhysics Letters 1 (1986) 45-49.

N genes, each on or off, each regulated by K randomly chosen genes through a random Boolean
function (each output 1 with probability 1/2); all genes update at once. Kauffman's
findings: with K = 2 the networks are ordered (short cycles, few attractors, roughly
sqrt(N) of each, perturbations stay small); with large K they are chaotic. Derrida and
Pomeau: a small damage (Hamming distance d between two states) maps to
d' = (1 - (1 - d)^K) / 2, whose slope at d = 0 is K / 2: the transition is exactly at K = 2.

  ./rbn.py              results/*.png, results/rbn.json
"""
import json
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"


class Network:
    def __init__(self, n, k, rng):
        self.n, self.k = n, k
        self.inputs = np.array([rng.choice(n, k, replace=False) for _ in range(n)])   # K distinct inputs per gene
        self.table = rng.integers(0, 2, (n, 2 ** k), dtype=np.uint8)                   # random Boolean functions
        self.weights = 1 << np.arange(k)[::-1]

    def step(self, states):
        """states: (m, n) array of 0/1; all genes at once."""
        index = (states[:, self.inputs] * self.weights).sum(-1)
        return self.table[np.arange(self.n), index]


def damage(n, k, d0, steps, rng, pairs=200):
    """Mean Hamming distance (as a fraction) after `steps` steps between pairs of states
    that started a fraction d0 apart, over fresh networks."""
    out = []
    for _ in range(pairs // 20):
        net = Network(n, k, rng)
        a = rng.integers(0, 2, (20, n), dtype=np.uint8)
        b = a.copy()
        flip = rng.random((20, n)) < d0
        b[flip] ^= 1
        for _ in range(steps):
            a, b = net.step(a), net.step(b)
        out.append((a != b).mean())
    return float(np.mean(out))


def annealed(d, k):
    return (1 - (1 - d) ** k) / 2


def attractors(n, k, rng, starts=1000, max_steps=None):
    """Kauffman's method: from random starts, run until a state repeats; count the distinct
    cycles and their lengths (sampling, as in the paper)."""
    net = Network(n, k, rng)
    max_steps = max_steps or 50 * n
    found = {}
    states = rng.integers(0, 2, (starts, n), dtype=np.uint8)
    for s in states:
        seen, state, t = {}, s[None], 0
        while t < max_steps:
            key = state.tobytes()
            if key in seen:
                length = t - seen[key]
                # identify the cycle by its smallest state
                cycle, x = [], state
                for _ in range(length):
                    cycle.append(x.tobytes()); x = net.step(x)
                found[min(cycle)] = length
                break
            seen[key] = t
            state = net.step(state); t += 1
    return len(found), float(np.mean(list(found.values()))) if found else float("nan")


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    rng = np.random.default_rng(1)
    report = {}

    # 1. The Derrida map: one step of damage, measured against the annealed approximation
    ds = np.linspace(0.01, 0.5, 25)
    maps = {k: [damage(500, k, d, 1, rng) for d in ds] for k in (1, 2, 3, 5)}
    slopes = {k: float(np.polyfit(ds[:4], maps[k][:4], 1)[0]) for k in maps}
    report["derrida_slope"] = {str(k): {"measured": slopes[k], "annealed": k / 2} for k in maps}
    for k in maps:
        print(f"K = {k}: slope of the damage map near 0: {slopes[k]:.2f} (annealed: {k / 2:.2f}); "
              f"largest deviation from the annealed map {max(abs(m - annealed(d, k)) for m, d in zip(maps[k], ds)):.3f}")

    # 2. Damage after many steps: it dies out for K < 2 and stays finite for K > 2
    long = {}
    for k in (1, 2, 3, 4, 5):
        long[k] = damage(1000, k, 0.01, 200, rng)
        fixed = 0.0
        for _ in range(500):
            fixed = annealed(fixed if fixed else 0.01, k)
        print(f"K = {k}: damage after 200 steps from 1 %: {long[k]:.3f} (annealed fixed point {fixed:.3f})")
        report.setdefault("long_damage", {})[str(k)] = {"measured": long[k], "annealed": fixed}

    # 3. Kauffman's attractors for K = 2 (sampled from 300 random starts per network)
    rows = []
    for n in (16, 32, 64, 128, 256):
        counts, lengths = zip(*[attractors(n, 2, rng, starts=300) for _ in range(20)])
        rows.append({"N": n, "attractors": float(np.median(counts)), "cycle_length": float(np.nanmedian(lengths)), "sqrtN": n ** 0.5})
        print(f"K = 2, N = {n:3d}: median {rows[-1]['attractors']:.1f} attractors found, median cycle length {rows[-1]['cycle_length']:.1f} (sqrt N = {n ** 0.5:.1f})")
    report["attractors_K2"] = rows
    kc = [{"N": n, "cycle_length": float(np.nanmedian([attractors(n, n, rng, starts=20, max_steps=20000)[1] for _ in range(10)]))} for n in (8, 12, 16, 20)]
    for r in kc:
        print(f"K = N = {r['N']}: median cycle length {r['cycle_length']:.0f} (2^(N/2) = {2 ** (r['N'] / 2):.0f})")
    report["cycles_KN"] = kc

    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    for k, colour in zip(maps, ["#4060e0", "#30a060", "#e08020", "#d03040"]):
        axes[0].plot(ds, maps[k], "o", color=colour, ms=4); axes[0].plot(ds, annealed(ds, k), "-", color=colour, label=f"K = {k}")
    axes[0].plot(ds, ds, "k:", lw=0.8); axes[0].set_xlabel("damage d(t)"); axes[0].set_ylabel("d(t+1)")
    axes[0].set_title("Derrida map: dots measured, lines annealed"); axes[0].legend()
    axes[1].plot(list(long), list(long.values()), "o-"); axes[1].axvline(2, color="grey", ls=":")
    axes[1].set_xlabel("K"); axes[1].set_ylabel("damage after 200 steps (from 1 %)"); axes[1].set_title("Order below K = 2, chaos above")
    N = [r["N"] for r in rows]
    axes[2].loglog(N, [r["attractors"] for r in rows], "o-", label="attractors found (K = 2)")
    axes[2].loglog(N, [r["cycle_length"] for r in rows], "s-", label="cycle length (K = 2)")
    axes[2].loglog(N, np.sqrt(N), "k:", label="√N"); axes[2].set_xlabel("N"); axes[2].legend(); axes[2].set_title("Kauffman's √N (sampled)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_rbn.png", dpi=110); plt.close(fig)
    (RESULTS / "rbn.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
