#!/usr/bin/env python3
"""
The particle approximation of Physarum polycephalum of J. Jones, "Characteristics of
pattern formation and evolution in approximations of Physarum transport networks",
Artificial Life 16 (2010) 127-153, and "Influences on the formation and evolution of
Physarum polycephalum inspired emergent transport networks", Natural Computing 10 (2011)
1345-1369, whose Fig. 2 gives the parameters. The model itself is in physarum.c.

  ./physarum.py         results/*.png, results/physarum.gif, results/physarum.json
"""
import ctypes
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy import ndimage

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
LIB = HERE / "libphysarum.so"

# Fig. 2 of Jones (2011): typical values
SIZE, POPULATION = 200, 0.15          # lattice side; particles as a share of the sites (1-15 %)
SO, SS, DEP, DAMP = 9.0, 1.0, 5.0, 0.1  # sensor offset 5-9; step size; deposition; damping


def library():
    if not LIB.exists() or LIB.stat().st_mtime < (HERE / "physarum.c").stat().st_mtime:
        subprocess.run(["cc", "-O2", "-shared", "-fPIC", str(HERE / "physarum.c"), "-o", str(LIB), "-lm"], check=True)
    lib = ctypes.CDLL(str(LIB))
    D, I = ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int)
    lib.step.argtypes = [ctypes.c_int, ctypes.c_int, D, D, I, ctypes.c_int, D, D, D, I] + [ctypes.c_double] * 6
    lib.seed.argtypes = [ctypes.c_uint64]
    return lib


class Plasmodium:
    def __init__(self, sa_deg, ra_deg, seed=1, size=SIZE, population=POPULATION):
        self.lib = library()
        self.lib.seed(seed)
        rng = np.random.default_rng(seed)
        self.size, self.sa, self.ra = size, np.radians(sa_deg), np.radians(ra_deg)
        n = int(population * size * size)
        sites = rng.choice(size * size, n, replace=False)        # one particle per site
        self.x = (sites % size + 0.5).astype(float)
        self.y = (sites // size + 0.5).astype(float)
        self.a = rng.uniform(0, 2 * np.pi, n)
        self.occupied = np.zeros(size * size, dtype=np.int32); self.occupied[sites] = 1
        self.trail, self.scratch = np.zeros(size * size), np.zeros(size * size)
        self.order = np.zeros(n, dtype=np.int32)

    def step(self, count=1):
        p = lambda arr, t: arr.ctypes.data_as(ctypes.POINTER(t))
        for _ in range(count):
            self.lib.step(self.size, self.size, p(self.trail, ctypes.c_double), p(self.scratch, ctypes.c_double),
                          p(self.occupied, ctypes.c_int), len(self.x), p(self.x, ctypes.c_double), p(self.y, ctypes.c_double),
                          p(self.a, ctypes.c_double), p(self.order, ctypes.c_int), self.sa, self.ra, SO, SS, DEP, DAMP)

    def map(self):
        return self.trail.reshape(self.size, self.size)


def network(trail):
    """The network: sites whose trail exceeds the mean. Lacunae: the gaps it encloses
    (background components of at least 4 sites, on the torus)."""
    net = trail > trail.mean()
    gaps, n = ndimage.label(~net)
    # join labels across the periodic edges
    parent = list(range(n + 1))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for a, b in list(zip(gaps[0], gaps[-1])) + list(zip(gaps[:, 0], gaps[:, -1])):
        if a and b:
            parent[find(a)] = find(b)
    roots = np.array([find(i) for i in range(n + 1)])
    merged = roots[gaps]
    sizes = np.bincount(merged.ravel())[1:]
    sizes = sizes[sizes > 0]
    return {"network": float(net.mean()), "lacunae": int((sizes >= 4).sum()),
            "mean_lacuna": float(sizes[sizes >= 4].mean()) if (sizes >= 4).any() else 0.0}


def save_gif(frames, path, scale=2):
    from PIL import Image
    images = []
    for f in frames:
        g = np.clip(f / np.percentile(f, 99.5), 0, 1) ** 0.6
        rgb = np.stack([0.95 * g, 0.85 * g ** 1.3, 0.25 * g ** 2], -1)
        images.append(Image.fromarray((rgb * 255).astype(np.uint8)).resize((f.shape[1] * scale, f.shape[0] * scale), Image.NEAREST))
    images[0].save(path, save_all=True, append_images=images[1:], duration=60, loop=0, optimize=True)


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    report = {}

    # 1. Spontaneous network formation and its evolution (SA 22.5, RA 45, SO 9)
    p = Plasmodium(22.5, 45, seed=1)
    times, stats, snaps, frames = [], [], {}, []
    for t in range(1, 3001):
        p.step()
        if t % 25 == 0:
            times.append(t); stats.append(network(p.map()))
        if t in (50, 300, 1000, 3000):
            snaps[t] = p.map().copy()
        if t % 15 == 0 and t <= 1500:
            frames.append(p.map().copy())
    report["evolution"] = {"t": times, **{k: [s[k] for s in stats] for k in stats[0]}}
    print("lacunae at t = 100, 500, 1000, 2000, 3000:", [stats[times.index(t)]["lacunae"] for t in (100, 500, 1000, 2000, 3000)])
    save_gif(frames, RESULTS / "physarum.gif")
    fig, axes = plt.subplots(1, 5, figsize=(17, 3.6))
    for ax, t in zip(axes, snaps):
        ax.imshow(np.clip(snaps[t] / np.percentile(snaps[t], 99.5), 0, 1), cmap="inferno"); ax.set_title(f"t = {t}"); ax.axis("off")
    axes[4].plot(times, [s["lacunae"] for s in stats]); axes[4].set_xlabel("step"); axes[4].set_ylabel("lacunae")
    axes[4].set_title("The network coarsens")
    fig.suptitle("Spontaneous transport network (SA 22.5°, RA 45°, SO 9, 15 % of 200² sites)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_network.png", dpi=110); plt.close(fig)

    # 2. Sensor angle against rotation angle (Jones: RA = SA contracts, RA < SA contracts
    #    more, RA > SA branches)
    cases = [(45, 45, "RA = SA"), (45, 22.5, "RA < SA"), (22.5, 45, "RA > SA"), (11.25, 45, "RA >> SA")]
    fig, axes = plt.subplots(1, len(cases), figsize=(14, 3.8))
    report["angles"] = []
    for ax, (sa, ra, label) in zip(axes, cases):
        runs = []
        for seed in range(1, 6):
            q = Plasmodium(sa, ra, seed=seed)
            q.step(2000)
            runs.append(network(q.map()))
            if seed == 1:
                m = q.map(); ax.imshow(np.clip(m / np.percentile(m, 99.5), 0, 1), cmap="inferno"); ax.axis("off")
        row = {"SA": sa, "RA": ra, "case": label, **{k: float(np.mean([r[k] for r in runs])) for k in runs[0]}}
        report["angles"].append(row)
        ax.set_title(f"SA {sa}°, RA {ra}° ({label})\n{row['lacunae']:.0f} lacunae, network {100 * row['network']:.0f} %", fontsize=9)
        print(f"SA {sa:5.2f} RA {ra:5.2f} ({label}): lacunae {row['lacunae']:.1f}, network {100 * row['network']:.1f} % of the sites")
    fig.suptitle("Sensor angle against rotation angle, after 2000 steps (mean of 5 seeds)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_angles.png", dpi=110); plt.close(fig)
    (RESULTS / "physarum.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
