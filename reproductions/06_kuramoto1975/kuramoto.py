#!/usr/bin/env python3
"""
The Kuramoto model: Y. Kuramoto, "Self-entrainment of a population of coupled non-linear
oscillators", International Symposium on Mathematical Problems in Theoretical Physics,
Lecture Notes in Physics 39 (1975) 420-422; see also S. H. Strogatz, "From Kuramoto to
Crawford", Physica D 143 (2000) 1-20, for the results checked here.

N phase oscillators with natural frequencies omega_i drawn from g(omega):

    d theta_i / dt = omega_i + (K / N) sum_j sin(theta_j - theta_i)

The order parameter r = |mean of exp(i theta)| measures synchrony. For a Lorentzian g of
width gamma, Kuramoto's self-consistency gives, exactly in the limit N -> infinity,

    r = 0 for K < K_c = 2 gamma,      r = sqrt(1 - K_c / K) above it.

  ./kuramoto.py         results/fig1_transition.png, results/kuramoto.json
"""
import json
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
GAMMA = 1.0


def frequencies(n, gamma=GAMMA):
    """Lorentzian (Cauchy) frequencies at the n quantiles (a regular sample, as is usual for
    this check: no sampling noise in g)."""
    q = (np.arange(n) + 0.5) / n
    return gamma * np.tan(np.pi * (q - 0.5))


def simulate(K, n=4000, t_end=200.0, dt=0.02, seed=0):
    """RK4 in the mean-field form: d theta_i/dt = omega_i + K r sin(psi - theta_i). Returns
    the time-averaged r over the second half."""
    rng = np.random.default_rng(seed)
    omega, theta = frequencies(n), rng.uniform(0, 2 * np.pi, n)

    def f(th):
        z = np.exp(1j * th).mean()
        return omega + K * np.abs(z) * np.sin(np.angle(z) - th)

    steps, rs = int(t_end / dt), []
    for s in range(steps):
        k1 = f(theta); k2 = f(theta + 0.5 * dt * k1); k3 = f(theta + 0.5 * dt * k2); k4 = f(theta + dt * k3)
        theta = theta + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        if s >= steps // 2:
            rs.append(np.abs(np.exp(1j * theta).mean()))
    return float(np.mean(rs))


def theory(K):
    Kc = 2 * GAMMA
    return np.sqrt(np.clip(1 - Kc / np.asarray(K), 0, None))


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    Ks = np.round(np.arange(0.5, 6.01, 0.25), 2)
    measured = [simulate(K) for K in Ks]
    expected = theory(Ks)
    above = Ks >= 2.5
    err = np.abs(np.array(measured) - expected)
    print("K   r measured   r theory")
    for K, m, e in zip(Ks, measured, expected):
        print(f"{K:4.2f}  {m:.3f}        {e:.3f}")
    print(f"largest |error| for K >= 2.5: {err[above].max():.3f}")
    fig, ax = plt.subplots(figsize=(6, 4))
    k = np.linspace(0.5, 6, 300)
    ax.plot(k, theory(k), "k-", label="theory: r = √(1 − 2γ/K)")
    ax.plot(Ks, measured, "o", label="simulation, N = 4000")
    ax.axvline(2 * GAMMA, color="grey", ls=":", label="K_c = 2γ")
    ax.set_xlabel("coupling K"); ax.set_ylabel("synchrony r"); ax.legend(); ax.set_title("Lorentzian frequencies, γ = 1")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_transition.png", dpi=110); plt.close(fig)
    (RESULTS / "kuramoto.json").write_text(json.dumps({"K": Ks.tolist(), "measured": measured, "theory": expected.tolist(),
                                                        "max_error_above_2.5": float(err[above].max())}, indent=1))


if __name__ == "__main__":
    main()
