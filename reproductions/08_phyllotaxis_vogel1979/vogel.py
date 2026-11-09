#!/usr/bin/env python3
"""
Vogel's model of the sunflower head: H. Vogel, "A better way to construct the sunflower
head", Mathematical Biosciences 44 (1979) 145-174.

Floret n sits at

    r_n = c sqrt(n),     theta_n = n * 137.508 degrees (the golden angle, 360 (2 - phi))

The paper's points, checked here: (1) the golden angle packs the florets uniformly; a
divergence angle off by a fraction of a degree leaves gaps and visible spokes; (2) the
spirals one sees (parastichies) come in consecutive Fibonacci numbers, larger ones further
out.

  ./vogel.py            results/fig1_heads.png, results/fig2_packing.png, results/vogel.json
"""
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

RESULTS = Path(__file__).resolve().parent / "results"
GOLDEN = 360 * (2 - (1 + 5 ** 0.5) / 2)          # 137.5077...
FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]


def head(n, angle_deg):
    k = np.arange(1, n + 1)
    theta = np.radians(angle_deg) * k
    return np.column_stack([np.sqrt(k) * np.cos(theta), np.sqrt(k) * np.sin(theta)])


RINGS = [(0.01, 0.04), (0.04, 0.12), (0.12, 0.3), (0.3, 0.6), (0.6, 0.9)]


def packing(points):
    """Uniformity over the whole head: in each of five rings (by floret number), the
    coefficient of variation of the nearest-neighbour distances (0: all equally spaced);
    returns the worst ring, and the smallest nearest-neighbour distance (outer rim left out).
    A good angle must pack evenly at every radius, not just in one band."""
    n = len(points)
    d, _ = cKDTree(points).query(points, 2)
    nn = d[:, 1]
    cv = [nn[int(a * n):int(b * n)].std() / nn[int(a * n):int(b * n)].mean() for a, b in RINGS]
    return float(max(cv)), float(nn[int(0.01 * n):int(0.9 * n)].min())


def parastichies(points, start, end):
    """For florets start..end: the two commonest index differences to their four nearest
    neighbours: the parastichy numbers (the two families of visible spirals)."""
    _, idx = cKDTree(points).query(points[start:end], 5)
    diffs = np.abs(idx[:, 1:] - np.arange(start, end)[:, None]).ravel()
    values, counts = np.unique(diffs, return_counts=True)
    order = np.argsort(-counts)[:2]
    return sorted(int(v) for v in values[order])


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    report = {"golden_angle": GOLDEN}

    # 1. heads at and near the golden angle
    angles = [GOLDEN - 0.3, GOLDEN - 0.1, GOLDEN, GOLDEN + 0.1, 137.0]
    fig, axes = plt.subplots(1, len(angles), figsize=(16, 3.6))
    for ax, a in zip(axes, angles):
        p = head(1500, a)
        ax.scatter(p[:, 0], p[:, 1], s=4, c=np.arange(1500), cmap="YlOrBr_r"); ax.set_aspect("equal"); ax.axis("off")
        ax.set_title(f"{a:.3f}°" + (" (golden)" if a == GOLDEN else ""), fontsize=10)
    fig.suptitle("1500 florets, r = √n, θ = n · angle")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_heads.png", dpi=110); plt.close(fig)

    # 2. packing uniformity across divergence angles
    # the optimum is razor sharp: a fine scan around 137.5 degrees, with the golden angle itself
    scan = np.sort(np.append(np.arange(137.0, 138.0, 0.0005), GOLDEN))
    stats = np.array([packing(head(2000, a)) for a in scan])
    best = scan[np.argmin(stats[:, 0])]
    widest = scan[np.argmax(stats[:, 1])]
    report["packing"] = {"most_uniform_angle": float(best), "widest_spacing_angle": float(widest),
                         "worst_ring_cv": {f"{a:.3f}": packing(head(2000, a))[0] for a in (GOLDEN, GOLDEN - 0.1, GOLDEN + 0.1, 137.0)}}
    print(f"most uniform at {best:.3f}°, widest minimum spacing at {widest:.3f}° (golden angle {GOLDEN:.3f}°); worst-ring CV "
          + ", ".join(f"{k}°: {v:.3f}" for k, v in report["packing"]["worst_ring_cv"].items()))
    fig, ax = plt.subplots(figsize=(7, 3.6))
    ax.plot(scan, stats[:, 0]); ax.axvline(GOLDEN, color="orange", ls="--", label=f"golden angle {GOLDEN:.3f}°")
    ax.set_xlabel("divergence angle (°)"); ax.set_ylabel("worst ring: CV of neighbour distances"); ax.legend()
    ax.set_title("The golden angle packs most evenly, and the optimum is sharp")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_packing.png", dpi=110); plt.close(fig)

    # 3. parastichy numbers by ring
    p = head(5000, GOLDEN)
    rings = [(30, 80), (100, 250), (300, 700), (900, 1800), (2500, 4500)]
    report["parastichies"] = []
    for a, b in rings:
        pair = parastichies(p, a, b)
        report["parastichies"].append({"florets": [a, b], "numbers": pair, "fibonacci": all(v in FIBONACCI for v in pair)})
        consecutive = all(v in FIBONACCI for v in pair) and abs(FIBONACCI.index(pair[0]) - FIBONACCI.index(pair[1])) == 1
        report["parastichies"][-1]["consecutive"] = consecutive
        print(f"florets {a}-{b}: parastichies {pair}" + (" (consecutive Fibonacci)" if consecutive else ""))
    (RESULTS / "vogel.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
