#!/usr/bin/env python3
"""
The edge of chaos: C. G. Langton, "Computation at the edge of chaos: phase transitions and
emergent computation", Physica D 42 (1990) 12-37.

One-dimensional cellular automata with K = 4 states and neighbourhoods of N = 5 cells
(radius 2): a rule is a table of K^N = 1024 entries. State 0 is quiescent and the all-zero
neighbourhood maps to 0. Langton's parameter lambda is the share of the table that maps to a
non-quiescent state. His "table walk-through": start from the all-quiescent table and
replace entries one by one with random non-quiescent states, so lambda rises in small steps
while the rule changes as little as possible.

His findings, checked here: as lambda rises, behaviour passes from fixed (class I) and
periodic (class II) through a narrow transition region to chaotic (class III); in that
region the average single-cell entropy H rises steeply and transients become longest; and
the mutual information between a cell and itself one step later is largest at intermediate
entropy, neither ordered nor chaotic: where complex, computation-like behaviour (class IV)
lives.

  ./langton.py          results/*.png, results/langton.json
"""
import json
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
K, N, CELLS = 4, 5, 128
ENTRIES = K ** N


def run(table, steps, rng):
    """Run from a random start; returns the space-time array and the transient length (the
    step at which the configuration first repeats one seen before, capped at `steps`)."""
    x = rng.integers(0, K, CELLS)
    history, seen, transient = [x], {x.tobytes(): 0}, steps
    powers = K ** np.arange(N)[::-1]
    for t in range(1, steps):
        index = sum(np.roll(x, 2 - j) * powers[j] for j in range(N))
        x = table[index]
        history.append(x)
        key = x.tobytes()
        if transient == steps:
            if key in seen:
                transient = seen[key]
            else:
                seen[key] = t
    return np.array(history), transient


def entropy(space_time):
    """Average single-cell entropy (bits): the entropy of each cell's states over time,
    averaged over the cells."""
    h = 0.0
    for c in range(CELLS):
        p = np.bincount(space_time[:, c], minlength=K) / len(space_time)
        p = p[p > 0]; h -= (p * np.log2(p)).sum()
    return h / CELLS


def mutual_information(space_time):
    """Between a cell's state and its own state one step later (bits), pooled over cells."""
    a, b = space_time[:-1].ravel(), space_time[1:].ravel()
    joint = np.bincount(a * K + b, minlength=K * K).reshape(K, K) / len(a)
    pa, pb = joint.sum(1), joint.sum(0)
    nz = joint > 0
    return float((joint[nz] * np.log2(joint[nz] / np.outer(pa, pb)[nz])).sum())


def walk(rng, lambdas, steps=600, measure_from=300):
    """One table walk-through: H, I and the transient at each lambda."""
    table = np.zeros(ENTRIES, dtype=np.int64)
    order = rng.permutation(np.arange(1, ENTRIES))           # entry 0 (all quiescent) stays 0
    out, filled = [], 0
    for lam in lambdas:
        target = int(round(lam * ENTRIES))
        while filled < target:
            table[order[filled]] = rng.integers(1, K); filled += 1
        st, transient = run(table, steps, rng)
        late = st[measure_from:]
        out.append((entropy(late), mutual_information(late), transient))
    return np.array(out)


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    rng = np.random.default_rng(3)
    lambdas = np.round(np.arange(0, 0.751, 0.01), 3)
    walks = np.array([walk(rng, lambdas) for _ in range(40)])            # (walks, lambdas, 3)
    H, I, T = walks[..., 0], walks[..., 1], walks[..., 2]
    meanH, meanI, meanT = H.mean(0), I.mean(0), np.median(T, 0)
    steepest = lambdas[np.argmax(np.gradient(meanH))]
    beyond = lambdas[np.argmax(meanT >= 600)]            # the first lambda whose median transient exceeds the window
    # mutual information against entropy, pooled over all walks and lambdas
    bins = np.linspace(0, 2, 11)                        # 0.2-bit bins: finer bins in the middle hold under 10 runs
    which = np.digitize(H.ravel(), bins)
    mi = np.array([I.ravel()[which == b].mean() if (which == b).sum() >= 20 else np.nan for b in range(1, len(bins))])
    centres = 0.5 * (bins[1:] + bins[:-1])
    peak = centres[np.nanargmax(mi)]
    print(f"entropy rises most steeply at lambda = {steepest:.2f}; median transients grow from {meanT[0]:.0f} step at lambda = 0 "
          f"to beyond the 600-step window from lambda = {beyond:.2f} on")
    print(f"mutual information is largest in the entropy bin H = {peak - 0.1:.1f}-{peak + 0.1:.1f} bits (of 2): mean {np.nanmax(mi):.3f} bits, "
          f"{(which == np.nanargmax(mi) + 1).sum()} runs; by bin: {np.round(mi, 3).tolist()}")
    for lam in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
        i = int(round(lam * 100))
        print(f"  lambda {lam:.1f}: H {meanH[i]:.2f} bits, I {meanI[i]:.3f} bits, median transient {meanT[i]:.0f}")

    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    axes[0].plot(lambdas, H.T, color="#6060c0", alpha=0.08); axes[0].plot(lambdas, meanH, "k-", lw=2)
    axes[0].set_xlabel("λ"); axes[0].set_ylabel("average cell entropy H (bits)"); axes[0].set_title("A transition from order to chaos")
    axes[1].semilogy(lambdas, np.maximum(meanT, 1), "o-", ms=3); axes[1].set_xlabel("λ"); axes[1].set_ylabel("median transient (steps, capped at 600)")
    axes[1].set_title("Transients explode at the transition")
    axes[2].scatter(H.ravel(), I.ravel(), s=3, alpha=0.2); axes[2].plot(centres, mi, "r-", lw=2)
    axes[2].set_xlabel("H (bits)"); axes[2].set_ylabel("mutual information I (bits)"); axes[2].set_title("Information peaks at intermediate entropy")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_lambda.png", dpi=110); plt.close(fig)
    fig, axes = plt.subplots(1, 4, figsize=(14, 4))
    r2 = np.random.default_rng(7)
    for ax, lam in zip(axes, (0.15, 0.35, 0.45, 0.65)):
        table = np.zeros(ENTRIES, dtype=np.int64)
        idx = r2.permutation(np.arange(1, ENTRIES))[:int(lam * ENTRIES)]
        table[idx] = r2.integers(1, K, len(idx))
        st, _ = run(table, 200, r2)
        ax.imshow(st, cmap="magma", interpolation="nearest", aspect="auto"); ax.set_title(f"λ = {lam}"); ax.axis("off")
    fig.suptitle("Space (across) against time (down), one rule per λ")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_spacetime.png", dpi=110); plt.close(fig)
    (RESULTS / "langton.json").write_text(json.dumps({"lambda": lambdas.tolist(), "H": meanH.tolist(), "I": meanI.tolist(), "transient": meanT.tolist(),
                                                       "steepest_entropy_lambda": float(steepest), "transients_beyond_window_from": float(beyond),
                                                       "mi_peak_entropy": float(peak), "walks": 40}, indent=1))


if __name__ == "__main__":
    main()
