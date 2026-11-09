#!/usr/bin/env python3
"""
Flow-Lenia, after E. Plantec, G. Hamon, M. Etcheverry, P.-Y. Oudeyer, C. Moulin-Frier and
B. W.-C. Chan, "Flow-Lenia: Towards open-ended evolution in cellular automata through mass
conservation and parameter localization", ALIFE 2023, arXiv:2212.07906, following the
authors' code (github.com/erwanplantec/FlowLenia) where the paper leaves values open.

Lenia computes an affinity map U from the state A, and A grows by U. Flow-Lenia instead
moves A along a flow and so conserves its total mass:

  U   = sum_k h_k G_k(K_k * A)                                   (Eq. 3)
  F   = (1 - alpha) grad U - alpha grad A,  alpha = clip((A / theta_A)^n, 0, 1)   (Eq. 5)
  A'(p) = sum_p' A(p') I(p', p)                                  (Eq. 6, 7)

I(p', p): the share of a uniform square of side 2s, centred at p' + dt F(p'), that falls
on cell p (reintegration tracking, Moroz 2020). Gradients by Sobel filters, as in the code.

  ./flow_lenia.py       results/*.png, results/flow_lenia.gif, results/flow_lenia.json
"""
import json
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from scipy import ndimage

RESULTS = Path(__file__).resolve().parent / "results"
SIZE, K = 128, 10                          # world side; kernels per rule (code default)
DT, DD, S, THETA, N = 0.2, 5, 0.65, 1.0, 2  # Table 1; theta_A = number of channels (code)


def bell(x, m, s):
    return np.exp(-(((x - m) / s) ** 2) / 2)


def random_rule(rng):
    """A random rule, from the code's sampling ranges (Table 1 of the paper)."""
    return {"R": rng.uniform(2, 25), "r": rng.uniform(0.2, 1, K), "m": rng.uniform(0.05, 0.5, K),
            "s": rng.uniform(0.001, 0.18, K), "h": rng.uniform(0.01, 1, K), "a": rng.uniform(0, 1, (K, 3)),
            "b": rng.uniform(0.001, 1, (K, 3)), "w": rng.uniform(0.01, 0.5, (K, 3))}


def kernels_fft(rule):
    """Eq. 1: K_k(x) = sum_j b_kj exp(-((|x| / (r_k R') - a_kj)^2) / (2 w_kj^2)), cut smoothly
    at |x| = r_k R' and normalised; R' = R + 15 as in the code (the paper writes R)."""
    y, x = np.indices((SIZE, SIZE)) - SIZE // 2
    dist = np.hypot(x, y)
    out = []
    for k in range(K):
        D = dist / ((rule["R"] + 15) * rule["r"][k])
        ker = 1 / (1 + np.exp((D - 1) * 10)) * sum(rule["b"][k, j] * bell(D, rule["a"][k, j], rule["w"][k, j]) for j in range(3))
        out.append(np.fft.fft2(np.fft.ifftshift(ker / ker.sum())))
    return np.array(out)


def affinity(A, fK, rule):
    """U = sum_k h_k G_k(K_k * A), G = 2 bell - 1 (Eq. 2, 3)."""
    fA = np.fft.fft2(A)
    U = np.real(np.fft.ifft2(fK * fA[None]))
    return np.einsum("k,kxy->xy", rule["h"], 2 * bell(U, rule["m"][:, None, None], rule["s"][:, None, None]) - 1)


SOBEL_X = np.array([[1, 0, -1], [2, 0, -2], [1, 0, -1]], dtype=float)


def gradient(f):
    """Sobel gradient (d/dy, d/dx) on the torus, as in the code."""
    return (ndimage.convolve(f, SOBEL_X.T, mode="wrap"), ndimage.convolve(f, SOBEL_X, mode="wrap"))


def reintegrate(A, Fy, Fx):
    """Eq. 6-7: each cell's matter, as a square of side 2s centred at its position moved by
    dt F (clipped to dd - s), is shared among the cells it overlaps. On the torus."""
    limit = DD - S
    my, mx = np.clip(DT * Fy, -limit, limit), np.clip(DT * Fx, -limit, limit)
    out = np.zeros_like(A)
    for dy in range(-DD, DD + 1):
        for dx in range(-DD, DD + 1):
            # matter arriving from the cell at offset -(dy, dx): its square is centred at
            # -(dy, dx) + (my, mx) relative to the receiving cell
            ry = np.roll(my, (dy, dx), (0, 1)) - dy
            rx = np.roll(mx, (dy, dx), (0, 1)) - dx
            wy = np.clip(0.5 - np.abs(ry) + S, 0, min(1, 2 * S))
            wx = np.clip(0.5 - np.abs(rx) + S, 0, min(1, 2 * S))
            out += np.roll(A, (dy, dx), (0, 1)) * wy * wx / (4 * S * S)
    return out


def flow_step(A, fK, rule):
    U = affinity(A, fK, rule)
    alpha = np.clip((A / THETA) ** N, 0, 1)
    gUy, gUx = gradient(U)
    gAy, gAx = gradient(A)
    return reintegrate(A, (1 - alpha) * gUy - alpha * gAy, (1 - alpha) * gUx - alpha * gAx)


def lenia_step(A, fK, rule):
    """The same rule as plain Lenia: A <- clip(A + dt U)."""
    return np.clip(A + DT * affinity(A, fK, rule), 0, 1)


def initial(seed):
    """A 40 x 40 patch of uniform noise at the centre (the paper's initial pattern)."""
    A = np.zeros((SIZE, SIZE))
    A[SIZE // 2 - 20:SIZE // 2 + 20, SIZE // 2 - 20:SIZE // 2 + 20] = np.random.default_rng(seed).uniform(0, 1, (40, 40))
    return A


def classify(A, mass0):
    """dead: under 1 % of the mass left. localised: compact (radius of gyration about the
    centre of mass, on the torus, under a quarter of the world) and dense (at least half
    the mass in cells above 0.1). spread: anything else."""
    m = A.sum()
    if m < 0.01 * mass0:
        return "dead"
    angles = 2 * np.pi * np.arange(SIZE) / SIZE
    cy = np.angle((A.sum(1) * np.exp(1j * angles)).sum()) % (2 * np.pi) * SIZE / (2 * np.pi)
    cx = np.angle((A.sum(0) * np.exp(1j * angles)).sum()) % (2 * np.pi) * SIZE / (2 * np.pi)
    y, x = np.indices(A.shape)
    dy = (y - cy + SIZE / 2) % SIZE - SIZE / 2
    dx = (x - cx + SIZE / 2) % SIZE - SIZE / 2
    gyration = np.sqrt((A * (dx ** 2 + dy ** 2)).sum() / m)
    dense = A[A > 0.1].sum() / m
    return "localised" if gyration < SIZE / 4 and dense >= 0.5 else "spread"


def run_pair(seed, steps=600):
    rule = random_rule(np.random.default_rng(seed))
    fK = kernels_fft(rule)
    A0 = initial(seed + 10_000)
    out = {}
    for name, step in (("flow", flow_step), ("lenia", lenia_step)):
        A, masses = A0.copy(), [A0.sum()]
        for _ in range(steps):
            A = step(A, fK, rule)
            masses.append(A.sum())
        out[name] = {"fate": classify(A, A0.sum()), "mass_drift": float(abs(masses[-1] - masses[0]) / masses[0]),
                     "mass_range": [float(min(masses)), float(max(masses))], "occupied": float((A > 0.1).mean())}
    return seed, out


def save_gif(frames, path, scale=2):
    from PIL import Image
    from matplotlib import cm
    images = [Image.fromarray((cm.magma(np.clip(f, 0, 1))[:, :, :3] * 255).astype(np.uint8)).resize(
              (f.shape[1] * scale, f.shape[0] * scale), Image.NEAREST) for f in frames]
    images[0].save(path, save_all=True, append_images=images[1:], duration=60, loop=0, optimize=True)


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    seeds = list(range(1, 81))
    with Pool() as pool:
        runs = dict(pool.map(run_pair, seeds))
    report = {"rules": len(seeds), "steps": 600, "world": SIZE}
    for name in ("flow", "lenia"):
        fates = [runs[s][name]["fate"] for s in seeds]
        report[name] = {f: fates.count(f) for f in ("localised", "spread", "dead")}
        report[name]["max_mass_drift"] = max(runs[s][name]["mass_drift"] for s in seeds)
        print(f"{name:5s}: localised {fates.count('localised')}, spread {fates.count('spread')}, dead {fates.count('dead')} of {len(seeds)}"
              f" · largest relative mass change {report[name]['max_mass_drift']:.2e}")
    both = sum(runs[s]["flow"]["fate"] == "localised" and runs[s]["lenia"]["fate"] != "localised" for s in seeds)
    neither = sum(runs[s]["lenia"]["fate"] == "localised" and runs[s]["flow"]["fate"] != "localised" for s in seeds)
    report["paired"] = {"flow_only_localised": both, "lenia_only_localised": neither}
    print(f"paired: localised only in Flow-Lenia {both}, only in Lenia {neither}")

    # pictures: the first rules that localise in Flow-Lenia, with Lenia beside them
    shown = [s for s in seeds if runs[s]["flow"]["fate"] == "localised"][:4]
    fig, axes = plt.subplots(2, len(shown), figsize=(3 * len(shown), 6.2))
    gif_frames = []
    for col, s in enumerate(shown):
        rule = random_rule(np.random.default_rng(s)); fK = kernels_fft(rule)
        for row, step in enumerate((flow_step, lenia_step)):
            A = initial(s + 10_000)
            for t in range(600):
                A = step(A, fK, rule)
                if col == 0 and row == 0 and t % 4 == 0:
                    gif_frames.append(A.copy())
            axes[row, col].imshow(A, cmap="magma", vmin=0, vmax=1); axes[row, col].axis("off")
            axes[row, col].set_title(f"rule {s} · {'Flow-Lenia' if row == 0 else 'Lenia'}", fontsize=9)
    fig.suptitle("The same random rules after 600 steps: Flow-Lenia (top) and Lenia (bottom)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_flow_vs_lenia.png", dpi=110); plt.close(fig)
    save_gif(gif_frames, RESULTS / "flow_lenia.gif")

    # mass over time for one rule
    s = shown[0]; rule = random_rule(np.random.default_rng(s)); fK = kernels_fft(rule)
    fig, ax = plt.subplots(figsize=(6, 3.5))
    for name, step in (("Flow-Lenia", flow_step), ("Lenia", lenia_step)):
        A, masses = initial(s + 10_000), []
        for _ in range(600):
            masses.append(A.sum()); A = step(A, fK, rule)
        ax.plot(np.array(masses) / masses[0], label=name)
    ax.set_xlabel("step"); ax.set_ylabel("total mass / initial"); ax.set_title(f"Mass, rule {s}"); ax.legend()
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_mass.png", dpi=110); plt.close(fig)
    (RESULTS / "flow_lenia.json").write_text(json.dumps({**report, "runs": runs}, indent=1))


if __name__ == "__main__":
    main()
