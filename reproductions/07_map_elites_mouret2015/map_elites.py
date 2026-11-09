#!/usr/bin/env python3
"""
MAP-Elites: J.-B. Mouret and J. Clune, "Illuminating search spaces by mapping elites",
arXiv:1504.04909 (2015).

MAP-Elites keeps one elite per cell of a grid over chosen features of a solution
("behaviour"). After a random start it repeats: pick a random elite, mutate it, evaluate the
child, and keep it if its cell is empty or it beats that cell's elite. The paper's claim:
for the same number of evaluations, it finds solutions in far more cells, and better ones
in them, than random sampling or an optimiser of the fitness alone.

Domain (not from the paper, which uses soft robots and networks; this is the standard
planar arm of later quality-diversity work, e.g. Vassiliades et al. 2018): an arm of 12
joints, angles in [-pi, pi], links of length 1/12. Behaviour: the hand's position in
[-1, 1]^2, on a 64 x 64 grid. Fitness: minus the standard deviation of the angles (smooth
arms).

  ./map_elites.py       results/fig1_archives.png, results/fig2_progress.png, results/map_elites.json
"""
import json
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
JOINTS, GRID = 12, 64
BUDGET, INITIAL, BATCH = 200_000, 2_000, 200


def evaluate(genomes):
    """genomes in [0, 1]^12 -> (fitness, hand position)."""
    angles = (genomes - 0.5) * 2 * np.pi
    cumulative = np.cumsum(angles, axis=1)
    hand = np.stack([np.cos(cumulative).sum(1), np.sin(cumulative).sum(1)], 1) / JOINTS
    return -np.std(angles, axis=1), hand


def cells(hand):
    return np.clip(((hand + 1) / 2 * GRID).astype(int), 0, GRID - 1) @ np.array([GRID, 1])


class Archive:
    def __init__(self):
        self.fitness = np.full(GRID * GRID, -np.inf)
        self.genome = np.zeros((GRID * GRID, JOINTS))

    def add(self, genomes, fitness, hand):
        for g, f, c in zip(genomes, fitness, cells(hand)):
            if f > self.fitness[c]:
                self.fitness[c], self.genome[c] = f, g

    def coverage(self):
        return float(np.isfinite(self.fitness).mean())

    def qd_score(self):
        """Sum over filled cells of the fitness shifted to be positive (fitness >= -pi)."""
        f = self.fitness[np.isfinite(self.fitness)]
        return float((f + np.pi).sum())


def map_elites(rng, sigma=0.1):
    archive, history = Archive(), []
    g = rng.uniform(0, 1, (INITIAL, JOINTS))
    archive.add(g, *evaluate(g))
    done = INITIAL
    while done < BUDGET:
        filled = np.nonzero(np.isfinite(archive.fitness))[0]
        parents = archive.genome[rng.choice(filled, BATCH)]
        children = np.clip(parents + rng.normal(0, sigma, parents.shape), 0, 1)     # Gaussian mutation
        archive.add(children, *evaluate(children))
        done += BATCH
        history.append((done, archive.coverage(), archive.qd_score()))
    return archive, history


def random_search(rng):
    archive, history, done = Archive(), [], 0
    while done < BUDGET:
        g = rng.uniform(0, 1, (BATCH, JOINTS))
        archive.add(g, *evaluate(g))
        done += BATCH
        history.append((done, archive.coverage(), archive.qd_score()))
    return archive, history


def optimiser(rng, sigma=0.1):
    """A (mu + lambda) evolution strategy on the fitness alone, its solutions put in an
    archive only to measure them the same way."""
    archive, history = Archive(), []
    pop = rng.uniform(0, 1, (BATCH, JOINTS))
    fit, hand = evaluate(pop); archive.add(pop, fit, hand); done = BATCH
    while done < BUDGET:
        children = np.clip(pop + rng.normal(0, sigma, pop.shape), 0, 1)
        cf, ch = evaluate(children); archive.add(children, cf, ch); done += BATCH
        allp, allf = np.vstack([pop, children]), np.concatenate([fit, cf])
        keep = np.argsort(-allf)[:BATCH]
        pop, fit = allp[keep], allf[keep]
        history.append((done, archive.coverage(), archive.qd_score()))
    return archive, history


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    methods = {"MAP-Elites": map_elites, "random sampling": random_search, "fitness optimiser": optimiser}
    report, finals, histories = {}, {}, {}
    for name, method in methods.items():
        runs = [method(np.random.default_rng(seed)) for seed in range(5)]
        cov = [r[0].coverage() for r in runs]; qd = [r[0].qd_score() for r in runs]
        mean_fit = [float(np.mean(r[0].fitness[np.isfinite(r[0].fitness)])) for r in runs]
        report[name] = {"coverage": cov, "qd_score": qd, "mean_elite_fitness": mean_fit}
        finals[name], histories[name] = runs[0][0], [r[1] for r in runs]
        print(f"{name:18s} coverage {100 * np.mean(cov):5.1f} % (sd {100 * np.std(cov):.1f}), "
              f"QD score {np.mean(qd):7.0f}, mean elite fitness {np.mean(mean_fit):.3f}")
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.3))
    for ax, (name, archive) in zip(axes, finals.items()):
        img = np.where(np.isfinite(archive.fitness), archive.fitness, np.nan).reshape(GRID, GRID)
        im = ax.imshow(img, origin="lower", extent=[-1, 1, -1, 1], cmap="viridis", vmin=-np.pi, vmax=0)
        ax.set_title(f"{name}: {100 * archive.coverage():.0f} % of cells"); ax.set_xlabel("hand x"); ax.set_ylabel("hand y")
    fig.colorbar(im, ax=axes, shrink=0.8, label="fitness (−std of angles)")
    fig.suptitle(f"Archives after {BUDGET:,} evaluations (12-joint arm)")
    fig.savefig(RESULTS / "fig1_archives.png", dpi=110, bbox_inches="tight"); plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for name, hs in histories.items():
        h = np.array(hs[0])
        axes[0].plot(h[:, 0], 100 * h[:, 1], label=name); axes[1].plot(h[:, 0], h[:, 2], label=name)
    axes[0].set_ylabel("cells filled (%)"); axes[1].set_ylabel("QD score")
    for ax in axes:
        ax.set_xlabel("evaluations"); ax.legend()
    fig.tight_layout(); fig.savefig(RESULTS / "fig2_progress.png", dpi=110); plt.close(fig)
    (RESULTS / "map_elites.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
