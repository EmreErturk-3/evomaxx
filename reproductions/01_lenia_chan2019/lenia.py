#!/usr/bin/env python3
"""
Lenia, after B. W.-C. Chan, "Lenia: Biology of Artificial Life", Complex Systems 28 (2019),
arXiv:1812.05433, with the Orbium of the author's own pattern library.

A state A(x) in [0, 1] on a torus. Each step (Eq. 16 of the paper):

    A <- clip(A + dt G(K * A), 0, 1),   dt = 1/T

K: a ring kernel of radius R, the exponential ("bump") core exp(4 - 1/(r(1 - r))), r = |x|/R,
   normalised to sum 1 (one shell, b = [1]);
G: the Gaussian growth mapping G(u) = 2 exp(-(u - mu)^2 / (2 sigma^2)) - 1.

Orbium unicaudatus (library code O2u): R = 13, T = 10, mu = 0.15, sigma = 0.015, b = [1].

  ./lenia.py            all experiments: results/*.png, results/orbium.gif, results/lenia.json
"""
import json
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from scipy import ndimage

RESULTS = Path(__file__).resolve().parent / "results"

# Orbium unicaudatus from Chan's library (github.com/Chakazul/Lenia, Python/animals.json,
# code "O2u"), decoded from its run-length code: values are k/255 at R = 13.
ORBIUM_255 = [
    [0, 0, 0, 0, 0, 0, 0, 13, 4, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 35, 53, 54, 21, 18, 25, 26, 18, 1, 65, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 22, 68, 91, 98, 87, 48, 47, 44, 47, 45, 27, 89, 0, 0, 0],
    [0, 0, 0, 0, 3, 17, 89, 116, 119, 97, 33, 20, 14, 16, 31, 55, 180, 0, 0, 0],
    [0, 0, 0, 9, 33, 47, 87, 103, 98, 72, 34, 0, 0, 0, 0, 12, 102, 84, 0, 0],
    [1, 0, 4, 35, 43, 34, 28, 63, 69, 67, 53, 0, 0, 0, 0, 0, 5, 220, 0, 0],
    [60, 0, 26, 44, 20, 0, 0, 51, 79, 94, 95, 61, 0, 0, 0, 0, 0, 116, 40, 0],
    [0, 31, 47, 28, 0, 0, 0, 69, 109, 129, 137, 130, 0, 0, 0, 0, 0, 0, 132, 0],
    [0, 150, 55, 8, 0, 0, 0, 48, 135, 162, 174, 174, 107, 0, 0, 0, 0, 0, 109, 0],
    [0, 141, 60, 0, 0, 0, 0, 7, 158, 193, 214, 218, 206, 27, 0, 0, 0, 0, 72, 25],
    [0, 0, 152, 0, 0, 0, 0, 0, 170, 223, 245, 253, 248, 143, 0, 0, 0, 0, 57, 36],
    [0, 0, 214, 0, 0, 0, 0, 0, 129, 247, 255, 255, 255, 233, 71, 0, 0, 6, 56, 34],
    [0, 0, 141, 19, 0, 0, 0, 0, 85, 255, 255, 250, 255, 248, 142, 40, 13, 30, 62, 22],
    [0, 0, 8, 114, 0, 0, 0, 0, 45, 217, 255, 228, 220, 221, 166, 85, 50, 55, 59, 10],
    [0, 0, 0, 108, 29, 0, 0, 0, 29, 158, 224, 210, 199, 189, 156, 104, 75, 68, 42, 0],
    [0, 0, 0, 20, 85, 19, 0, 0, 30, 108, 172, 184, 173, 160, 134, 103, 79, 57, 16, 0],
    [0, 0, 0, 0, 42, 66, 38, 30, 44, 86, 127, 142, 139, 127, 109, 86, 62, 30, 0, 0],
    [0, 0, 0, 0, 0, 37, 59, 60, 66, 81, 99, 108, 105, 92, 78, 58, 32, 5, 0, 0],
    [0, 0, 0, 0, 0, 0, 18, 43, 58, 64, 70, 71, 66, 59, 42, 24, 5, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 15, 26, 33, 34, 30, 20, 11, 0, 0, 0, 0, 0],
]
ORBIUM = np.array(ORBIUM_255, dtype=float) / 255
R0, T0, MU, SIGMA = 13, 10, 0.15, 0.015


def kernel_fft(size, R):
    """The bump kernel of radius R, normalised to 1, as the FFT of a size x size torus."""
    y, x = np.indices((size, size)) - size // 2
    r = np.hypot(x, y) / R
    with np.errstate(divide="ignore", over="ignore"):
        k = np.where((r > 0) & (r < 1), np.exp(4 - 1 / (r * (1 - r))), 0.0)
    return np.fft.fft2(np.fft.ifftshift(k / k.sum()))


def growth(u, mu, sigma):
    return 2 * np.exp(-((u - mu) ** 2) / (2 * sigma ** 2)) - 1


class Lenia:
    def __init__(self, size, R=R0, T=T0, mu=MU, sigma=SIGMA):
        self.size, self.R, self.dt, self.mu, self.sigma = size, R, 1 / T, mu, sigma
        self.K = kernel_fft(size, R)
        self.A = np.zeros((size, size))

    def place(self, pattern, scale=1.0):
        """The pattern at the centre, rescaled (bilinear) for R = 13 * scale."""
        p = np.clip(ndimage.zoom(pattern, scale, order=1), 0, 1) if scale != 1 else pattern
        h, w = p.shape
        c = self.size // 2
        self.A[c - h // 2:c - h // 2 + h, c - w // 2:c - w // 2 + w] = p

    def step(self):
        u = np.real(np.fft.ifft2(np.fft.fft2(self.A) * self.K))
        self.A = np.clip(self.A + self.dt * growth(u, self.mu, self.sigma), 0, 1)

    def centroid(self):
        """Centre of mass on the torus (circular means of the coordinates)."""
        angles = 2 * np.pi * np.arange(self.size) / self.size
        m = self.A.sum()
        if m <= 0:
            return np.full(2, self.size / 2)
        cy = np.angle((self.A.sum(1) * np.exp(1j * angles)).sum() / m) % (2 * np.pi)
        cx = np.angle((self.A.sum(0) * np.exp(1j * angles)).sum() / m) % (2 * np.pi)
        return np.array([cy, cx]) * self.size / (2 * np.pi)


def settled_orbium():
    """Orbium after 50 time units at R = 13, in a 40 x 40 window round its centre of mass.
    Rescaling this relaxed creature works at any R; the raw library seed, enlarged, can
    break up (see the README)."""
    world = Lenia(128)
    world.place(ORBIUM)
    for _ in range(50 * T0):
        world.step()
    c = np.round(world.centroid()).astype(int)
    A = np.roll(world.A, (64 - c[0], 64 - c[1]), (0, 1))
    return A[44:84, 44:84]


def run_orbium(R=R0, time_units=1000, size=None, record_every=None, seed=None):
    """Orbium at R = 13 k, on a torus of 128 k cells: the library seed at R = 13, the settled
    creature rescaled otherwise. Returns the mass (in units of R^2), the speed (in R per
    time unit) and whether it survived."""
    k = R / R0
    world = Lenia(size or int(round(128 * k)), R=R)
    world.place(ORBIUM if seed is None else seed, k)
    T = T0
    masses, positions, frames = [world.A.sum()], [world.centroid()], []
    unwrapped = [np.zeros(2)]
    for t in range(time_units * T):
        world.step()
        if record_every and t % record_every == 0:
            frames.append(world.A.copy())
        if (t + 1) % T == 0:
            c = world.centroid()
            d = (c - positions[-1] + world.size / 2) % world.size - world.size / 2
            positions.append(c); unwrapped.append(unwrapped[-1] + d)
            masses.append(world.A.sum())
    masses, unwrapped = np.array(masses), np.array(unwrapped)
    half = len(masses) // 2                       # measured over the second half
    distance = np.linalg.norm(unwrapped[-1] - unwrapped[half])
    speed = distance / (len(masses) - 1 - half) / R
    alive = bool(masses[-1] > 0.5 * masses[0] and masses[-1] < 2 * masses[0] and localised(world))
    return {"R": R, "mass": float(masses[half:].mean() / R ** 2), "mass_spread": float(masses[half:].std() / masses[half:].mean()),
            "speed": float(speed), "alive": alive, "masses": masses.tolist()}, frames, world


def localised(world):
    """Most of the mass lies within 2R of its centre of mass."""
    c = world.centroid()
    y, x = np.indices(world.A.shape)
    dy = (y - c[0] + world.size / 2) % world.size - world.size / 2
    dx = (x - c[1] + world.size / 2) % world.size - world.size / 2
    near = np.hypot(dx, dy) < 2 * world.R
    return world.A[near].sum() > 0.95 * world.A.sum()


def niche_cell(args):
    """Fate of Orbium at growth parameters (mu, sigma): survives, dies or explodes."""
    mu, sigma = args
    world = Lenia(128, mu=mu, sigma=sigma)
    world.place(ORBIUM)
    m0 = world.A.sum()
    for t in range(300 * T0):
        world.step()
        m = world.A.sum()
        if m < 0.05 * m0:
            return "dies"
        if m > 4 * m0:
            return "explodes"
    m = world.A.sum()
    return "survives" if localised(world) and 0.5 * m0 < m < 2 * m0 else ("explodes" if m > m0 else "dies")


def save_gif(frames, path, every=1, scale=3):
    from PIL import Image
    from matplotlib import cm
    images = [Image.fromarray((cm.viridis(f)[:, :, :3] * 255).astype(np.uint8)).resize(
              (f.shape[1] * scale, f.shape[0] * scale), Image.NEAREST) for f in frames[::every]]
    images[0].save(path, save_all=True, append_images=images[1:], duration=50, loop=0, optimize=True)


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    report = {}

    # 1. Orbium at R = 13 for 1000 time units: does it live, how fast does it go?
    base, frames, world = run_orbium(R0, time_units=1000, size=128, record_every=20)
    report["orbium"] = {k: v for k, v in base.items() if k != "masses"}
    print(f"Orbium R=13: alive {base['alive']}, mass {base['mass']:.4f} R^2 (spread {100 * base['mass_spread']:.2f} %), "
          f"speed {base['speed']:.4f} R per time unit")
    save_gif(frames[:150], RESULTS / "orbium.gif", every=1, scale=2)
    fig, axes = plt.subplots(1, 4, figsize=(12, 3.3))
    for ax, i in zip(axes, [0, 5, 25, 149]):
        f = frames[i]                                   # a 48 x 48 window round the creature
        m = f.sum(); ang = 2 * np.pi * np.arange(128) / 128
        cy = int(np.angle((f.sum(1) * np.exp(1j * ang)).sum() / m) % (2 * np.pi) * 128 / (2 * np.pi))
        cx = int(np.angle((f.sum(0) * np.exp(1j * ang)).sum() / m) % (2 * np.pi) * 128 / (2 * np.pi))
        window = np.roll(f, (64 - cy, 64 - cx), (0, 1))[40:88, 40:88]
        ax.imshow(window, cmap="viridis", vmin=0, vmax=1); ax.set_title(f"t = {i * 20 / T0:g}"); ax.axis("off")
    fig.suptitle("Orbium unicaudatus (R = 13, T = 10, μ = 0.15, σ = 0.015) gliding on a 128² torus")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_orbium.png", dpi=110); plt.close(fig)

    # 2. Space resolution: the same creature at R = 13, 26, 39, 52 (paper, Fig. 7: mass and speed
    #    stay roughly constant in units of R)
    scales, settled = [], settled_orbium()
    for R in [13, 26, 39, 52, 65]:
        r, _, _ = run_orbium(R, time_units=200, seed=settled)
        scales.append(r)
        print(f"  R = {R}: alive {r['alive']}, mass {r['mass']:.4f} R^2, speed {r['speed']:.4f} R / time unit")
    report["resolution"] = [{k: v for k, v in r.items() if k != "masses"} for r in scales]

    # 3. The niche: where in (mu, sigma) Orbium survives
    mus = np.round(np.linspace(0.10, 0.20, 21), 4)
    sigmas = np.round(np.linspace(0.006, 0.030, 25), 4)
    with Pool() as pool:
        fates = pool.map(niche_cell, [(m, s) for s in sigmas for m in mus])
    grid = np.array([{"dies": 0, "survives": 1, "explodes": 2}[f] for f in fates]).reshape(len(sigmas), len(mus))
    report["niche"] = {"mu": mus.tolist(), "sigma": sigmas.tolist(), "fate": grid.tolist(),
                       "survives": int((grid == 1).sum()), "cells": int(grid.size)}
    print(f"niche: Orbium survives in {(grid == 1).sum()} of {grid.size} (mu, sigma) cells")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    Rs = [r["R"] for r in scales]
    axes[0].plot(Rs, [r["mass"] / scales[0]["mass"] for r in scales], "o-", label="mass / R² (relative to R = 13)")
    axes[0].plot(Rs, [r["speed"] / scales[0]["speed"] for r in scales], "s-", label="speed in R per time unit (relative)")
    axes[0].axhline(1, color="grey", lw=0.8); axes[0].set_ylim(0.8, 1.2); axes[0].set_xlabel("kernel radius R (cells)")
    axes[0].set_title("Same creature, finer grids"); axes[0].legend()
    from matplotlib.colors import ListedColormap
    axes[1].imshow(grid, origin="lower", cmap=ListedColormap(["#202030", "#3fbf7f", "#e0a040"]), aspect="auto",
                   extent=[mus[0], mus[-1], sigmas[0], sigmas[-1]])
    axes[1].plot(MU, SIGMA, "w*", ms=12); axes[1].set_xlabel("growth centre μ"); axes[1].set_ylabel("growth width σ")
    axes[1].set_title("Orbium's niche: dies (dark), survives (green), explodes (orange)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_resolution_niche.png", dpi=110); plt.close(fig)
    (RESULTS / "lenia.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
