#!/usr/bin/env python3
"""
Cyclic dominance: the May-Leonard equations and the rock-paper-scissors lattice.

1. R. M. May and W. J. Leonard, "Nonlinear aspects of competition between three species",
   SIAM J. Appl. Math. 29 (1975) 243-253. Three competitors,

       dN1/dt = N1 (1 - N1 - alpha N2 - beta N3)     (and cyclically for N2, N3)

   With alpha < 1 < beta and alpha + beta > 2 the interior fixed point is unstable and the
   system approaches a heteroclinic cycle: each species in turn nearly takes over, for ever
   longer stretches. Near the cycle, each stay lasts (beta - 1) / (1 - alpha) times as long
   as the one before (the ratio of the contracting to the expanding eigenvalue at a saddle).

2. T. Reichenbach, M. Mobilia and E. Frey, "Mobility promotes and jeopardizes biodiversity
   in rock-paper-scissors games", Nature 448 (2007) 1046: the stochastic lattice (rps.c).
   Below a critical mobility M_c = (4.5 +- 0.5) x 10^-4 (sigma = mu = 1) the three species
   coexist in spiral waves; above it two go extinct. Extinction probability at t = N.

  ./rps.py              results/*.png, results/rps.json
"""
import ctypes
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from os import cpu_count
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
LIB = HERE / "librps.so"


# ---------------------------------------------------------------- May-Leonard
def may_leonard(alpha, beta):
    def f(t, n):
        n1, n2, n3 = n
        return [n1 * (1 - n1 - alpha * n2 - beta * n3), n2 * (1 - beta * n1 - n2 - alpha * n3), n3 * (1 - alpha * n1 - beta * n2 - n3)]
    return f


def residence_times(alpha=0.8, beta=1.3, t_end=2500.0):
    """Integrate in log variables (the populations come within 1e-30 of zero) and return
    the stretches during which one species holds more than half of the total."""
    def f(t, u):
        n = np.exp(u)
        return [1 - n[0] - alpha * n[1] - beta * n[2], 1 - beta * n[0] - n[1] - alpha * n[2], 1 - alpha * n[0] - beta * n[1] - n[2]]
    sol = solve_ivp(f, (0, t_end), np.log([0.3, 0.25, 0.2]), rtol=1e-10, atol=1e-12, max_step=0.5)
    t = sol.t; n = np.exp(sol.y)
    leader = np.argmax(n, 0)
    switches = np.nonzero(np.diff(leader))[0]
    stays = np.diff(t[switches])
    return t, n, stays


# ---------------------------------------------------------------- lattice
def library():
    if not LIB.exists() or LIB.stat().st_mtime < (HERE / "rps.c").stat().st_mtime:
        subprocess.run(["cc", "-O2", "-shared", "-fPIC", str(HERE / "rps.c"), "-o", str(LIB)], check=True)
    lib = ctypes.CDLL(str(LIB))
    lib.run.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint8), ctypes.POINTER(ctypes.c_long),
                        ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_uint64]
    lib.run.restype = ctypes.c_double
    return lib


def lattice(L, M, t_max, seed, lib=None):
    """One realisation from a random start (each site empty, A, B or C with probability
    1/4; not stated in the paper). Returns the final grid and whether two species died."""
    lib = lib or library()
    rng = np.random.default_rng(seed)
    grid = rng.integers(0, 4, L * L).astype(np.uint8)
    counts = np.bincount(grid, minlength=4).astype(np.int64)
    epsilon = M * L * L / 2
    lib.run(L, grid.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8)), counts.ctypes.data_as(ctypes.POINTER(ctypes.c_long)),
            1.0, 1.0, epsilon, t_max, seed * 2654435761 % 2 ** 63 + 1)
    extinct = sum(c == 0 for c in counts[1:]) >= 2
    return grid.reshape(L, L), bool(extinct)


def extinction_probability(L, M, runs, base_seed=0):
    """P_ext: the share of runs in which two species are extinct at t = N = L^2."""
    lib = library()     # ctypes releases the GIL, so threads run in parallel
    with ThreadPoolExecutor(cpu_count()) as pool:
        out = list(pool.map(lambda k: lattice(L, M, L * L, base_seed + 1000 * k + L, lib)[1], range(runs)))
    return float(np.mean(out))


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    RESULTS.mkdir(exist_ok=True)
    report = {}

    # 1. May-Leonard: ever longer stays, by a constant ratio
    alpha, beta = 0.8, 1.3
    t, n, stays = residence_times(alpha, beta)
    ratios = stays[1:] / stays[:-1]
    predicted = (beta - 1) / (1 - alpha)
    report["may_leonard"] = {"alpha": alpha, "beta": beta, "stays": stays.tolist(), "ratios": ratios.tolist(), "predicted_ratio": predicted}
    print(f"May-Leonard alpha {alpha}, beta {beta}: stays {np.round(stays[:8], 1).tolist()} ..., "
          f"late ratios {np.round(ratios[-4:], 3).tolist()} (predicted {predicted})")
    fig, axes = plt.subplots(1, 2, figsize=(12, 3.6))
    for i, c in enumerate(["#e04040", "#40b040", "#4060e0"]):
        axes[0].plot(t, n[i], color=c, lw=1)
    axes[0].set_xlabel("time"); axes[0].set_ylabel("population"); axes[0].set_title("Each species in turn, for ever longer")
    axes[1].semilogy(stays, "o-", label="measured stays"); axes[1].semilogy(stays[0] * predicted ** np.arange(len(stays)), "--", label=f"ratio {predicted}")
    axes[1].set_xlabel("stay number"); axes[1].set_ylabel("length"); axes[1].legend(); axes[1].set_title("Stays grow geometrically")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_may_leonard.png", dpi=110); plt.close(fig)

    # 2. The lattice: spirals at low mobility
    cmap = ListedColormap(["#101018", "#e04040", "#40c060", "#4070ff"])
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.2))
    for ax, M in zip(axes, [3e-6, 3e-5, 3e-4]):
        grid, _ = lattice(200, M, 400, seed=5)
        ax.imshow(grid, cmap=cmap, vmin=0, vmax=3, interpolation="nearest"); ax.axis("off"); ax.set_title(f"M = {M:g}")
    fig.suptitle("200 × 200 lattice after 400 generations: spirals grow with mobility (σ = μ = 1)")
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_spirals.png", dpi=110); plt.close(fig)

    # 3. Extinction probability against mobility, for growing lattices
    Ms = [1e-4, 2e-4, 3e-4, 4.5e-4, 7e-4, 1e-3, 2e-3]
    curves = {}
    for L in (50, 80, 120):
        runs = 200
        curves[L] = [extinction_probability(L, M, runs) for M in Ms]
        print(f"L = {L}: P_ext = {np.round(curves[L], 2).tolist()}")
    report["extinction"] = {"M": Ms, "P_ext": {str(L): v for L, v in curves.items()}, "paper_Mc": 4.5e-4}
    fig, ax = plt.subplots(figsize=(6, 4))
    for L, v in curves.items():
        ax.semilogx(Ms, v, "o-", label=f"{L} × {L}")
    ax.axvspan(4.0e-4, 5.0e-4, color="grey", alpha=0.25, label="paper: M_c = (4.5 ± 0.5)·10⁻⁴")
    ax.set_xlabel("mobility M = 2ε / N"); ax.set_ylabel("P_ext at t = N"); ax.legend()
    ax.set_title("Coexistence below M_c, extinction above")
    fig.tight_layout(); fig.savefig(RESULTS / "fig3_extinction.png", dpi=110); plt.close(fig)
    (RESULTS / "rps.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
