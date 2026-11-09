#!/usr/bin/env python3
"""
The local activator-inhibitor model of D. A. Young, "A local activator-inhibitor model of
vertebrate skin patterns", Mathematical Biosciences 72 (1984) 51-58, as restated with its
parameters by R. Piasecki, W. Olchawa and K. Smaga, "Sensitivity to initial conditions in
an extended activator-inhibitor model for the formation of patterns", Acta Physica
Polonica B 49 (2018) 961 (Eqs. 1-2, Sect. 3).

Cells on a periodic L x L grid are differentiated (DC, 1) or not (UC, 0). Every DC adds w1
to the field of all cells within distance R1 (activation) and w2 < 0 to those at
R1 < r <= R2 (inhibition):

    W(x) = sum_{DC at r <= R1} w1 + sum_{DC at R1 < r <= R2} w2          (Eq. 1)

All cells are updated at once: W > eps -> DC, W < eps -> UC, W = eps -> unchanged (Eq. 2;
eps = 0 is Young's original model). The local activation, long-range inhibition kernel is
the "Mexican hat" of EvoMaxx.

  ./young.py            results/*.png, results/young.json
"""
import json
from pathlib import Path

import numpy as np
from scipy import ndimage

RESULTS = Path(__file__).resolve().parent / "results"
L, R1, R2, W1 = 83, 1.5, 6.0, 1.0     # Sect. 3 of Piasecki et al.


def kernel_fft(w2, self_included=True, size=L):
    y, x = np.indices((size, size)) - size // 2
    r = np.hypot(x, y)
    k = np.where(r <= R1, W1, 0.0) + np.where((r > R1) & (r <= R2), w2, 0.0)
    if not self_included:
        k[size // 2, size // 2] = 0.0
    return np.fft.fft2(np.fft.ifftshift(k))


def step(cells, kfft, eps=0.0):
    W = np.rint(np.real(np.fft.ifft2(np.fft.fft2(cells) * kfft)) * 1e6) / 1e6   # exact sums of w1, w2
    return np.where(W > eps, 1, np.where(W < eps, 0, cells))


def evolve(cells, w2, eps=0.0, self_included=True, max_steps=500):
    """Iterate until n+(j) = n-(j) = 0 (no cell changes); returns the final pattern, the
    final step j (counted as in the paper: the first iteration that changes nothing) and
    the population at every step. Stops early on a cycle."""
    kfft = kernel_fft(w2, self_included, cells.shape[0])
    history, seen = [int(cells.sum())], {cells.tobytes(): 0}
    for j in range(1, max_steps + 1):
        new = step(cells, kfft, eps)
        if np.array_equal(new, cells):
            return cells, j, history, "stable"
        cells = new
        history.append(int(cells.sum()))
        key = cells.tobytes()
        if key in seen:
            return cells, j, history, f"cycle of {j - seen[key]}"
        seen[key] = j
    return cells, max_steps, history, "unfinished"


def single_cell(size=L):
    c = np.zeros((size, size), dtype=np.int8)
    c[size // 2, size // 2] = 1     # (42, 42) of the paper, counting from 0
    return c


def random_cells(seed, n=455, size=L):
    """n_init DCs at distinct random sites (the R-system of Piasecki et al.)."""
    c = np.zeros(size * size, dtype=np.int8)
    c[np.random.default_rng(seed).choice(size * size, n, replace=False)] = 1
    return c.reshape(size, size)


def shape_of(cells):
    """Spots or stripes: the mean elongation (major / minor axis) of the DC components."""
    labels, n = ndimage.label(cells, structure=np.ones((3, 3)))
    elongation = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(labels == i)
        if len(ys) < 3:
            continue
        ev = np.sort(np.linalg.eigvalsh(np.cov(np.vstack((ys, xs))) + 1e-9 * np.eye(2)))
        elongation.append(np.sqrt(ev[1] / ev[0]))
    return n, float(np.median(elongation)) if elongation else float("nan")


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    report = {}

    # 1. The test patterns of Fig. 2: one DC at the centre, w2 = -0.08
    for self_included in (True, False):
        for eps, paper in ((0.0, 115), (0.04, 71)):
            final, steps, _, end = evolve(single_cell(), -0.08, eps, self_included)
            report[f"single_cell eps={eps} self={self_included}"] = {"steps": steps, "paper": paper, "end": end, "DCs": int(final.sum())}
            print(f"single DC, eps {eps}, cell counts itself: {self_included}: {end} after {steps} iterations (paper: {paper}), {final.sum()} DCs")
    fig, axes = plt.subplots(1, 2, figsize=(7, 3.6))
    for ax, eps in zip(axes, (0.0, 0.04)):
        final, steps, _, _ = evolve(single_cell(), -0.08, eps)
        ax.imshow(1 - final, cmap="gray"); ax.set_title(f"ε = {eps}: final at j = {steps}"); ax.axis("off")
    fig.suptitle("One DC at the centre (L = 83, R1 = 1.5, R2 = 6, w1 = 1, w2 = −0.08)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_single_cell.png", dpi=110); plt.close(fig)

    # 2. Random starts (455 DCs) over the inhibition strength w2: what forms, how fast
    w2s = [-0.04, -0.06, -0.08, -0.10, -0.12, -0.16, -0.20, -0.25, -0.30]
    rows, gallery = [], []
    for w2 in w2s:
        outcomes = [evolve(random_cells(seed), w2) for seed in range(20)]
        steps = [o[1] for o in outcomes if o[3] == "stable"]
        shapes = [shape_of(o[0]) for o in outcomes]
        row = {"w2": w2, "stable": len(steps), "cycles": sum(o[3].startswith("cycle") for o in outcomes),
               "iterations_median": float(np.median(steps)) if steps else None,
               "DC_fraction": float(np.mean([o[0].mean() for o in outcomes])),
               "components": float(np.mean([s[0] for s in shapes])), "elongation": float(np.nanmedian([s[1] for s in shapes]))}
        rows.append(row); gallery.append(outcomes[0][0])
        print(f"w2 {w2:+.2f}: stable {row['stable']}/20 (cycles {row['cycles']}), median {row['iterations_median']} iterations, "
              f"DC fraction {row['DC_fraction']:.2f}, {row['components']:.0f} patches, elongation {row['elongation']:.2f}")
    report["random"] = rows
    fig, axes = plt.subplots(1, len(w2s), figsize=(2.1 * len(w2s), 2.6))
    for ax, w2, g in zip(axes, w2s, gallery):
        ax.imshow(1 - g, cmap="gray"); ax.set_title(f"w2 = {w2}", fontsize=9); ax.axis("off")
    fig.suptitle("From 455 random DCs: weak inhibition gives stripes, strong inhibition spots")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_inhibition.png", dpi=110); plt.close(fig)
    (RESULTS / "young.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
