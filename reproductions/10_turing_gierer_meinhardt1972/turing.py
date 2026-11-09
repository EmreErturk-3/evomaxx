#!/usr/bin/env python3
"""
Turing patterns: A. M. Turing, "The chemical basis of morphogenesis", Phil. Trans. R. Soc.
London B 237 (1952) 37-72, with the activator-inhibitor kinetics of A. Gierer and
H. Meinhardt, "A theory of biological pattern formation", Kybernetik 12 (1972) 30-39, in
the dimensionless form of J. D. Murray, Mathematical Biology II (3rd ed., 2003), Sect. 2.3:

    du/dt = a - b u + u^2 / v + lap u          (activator: makes itself, needs the inhibitor low)
    dv/dt = u^2 - v + d lap v                  (inhibitor: made by the activator, spreads d times faster)

Turing's point: a mixture that is stable when well stirred becomes unstable once its
species diffuse at different rates. Linear stability of the uniform state (u*, v*) gives a
growth rate lambda(k) for every wavenumber k; patterns appear when d exceeds a critical
d_c, with the wavelength of the fastest-growing mode. Both are checked here by simulation.

  ./turing.py           results/*.png, results/turing.json
"""
import json
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
A, B = 0.1, 1.0                                   # kinetics
U0 = (A + 1) / B; V0 = U0 ** 2                    # the uniform steady state
J = np.array([[-B + 2 / U0, -1 / U0 ** 2],        # its Jacobian: f_u, f_v
              [2 * U0, -1.0]])                    #                g_u, g_v


def growth_rate(k, d):
    """Largest real part of the eigenvalues of J - k^2 diag(1, d)."""
    M = J[None] - (k ** 2)[:, None, None] * np.diag([1.0, d])[None]
    return np.max(np.linalg.eigvals(M).real, axis=1)


def critical_d():
    """Turing's condition: d f_u + g_v > 2 sqrt(d det J); the smallest such d."""
    fu, fv, gu, gv = J.ravel(); det = np.linalg.det(J)
    # (d fu + gv)^2 = 4 d det  ->  fu^2 d^2 + (2 fu gv - 4 det) d + gv^2 = 0, larger root
    roots = np.roots([fu ** 2, 2 * fu * gv - 4 * det, gv ** 2])
    return float(max(r.real for r in roots if abs(r.imag) < 1e-12 and (r.real * fu + gv) > 0))


def simulate(d, n=512, dx=1.0, t_end=400.0, seed=0, dims=1):
    """Explicit Euler on a periodic grid from the uniform state plus 1 % noise. Returns the
    final u and the dominant wavelength of the early (linear) and final patterns."""
    rng = np.random.default_rng(seed)
    shape = (n,) * dims
    u = U0 * (1 + 0.01 * rng.standard_normal(shape)); v = V0 * (1 + 0.01 * rng.standard_normal(shape))
    dt = 0.5 * dx * dx / (2 * dims * max(1.0, d))       # half the diffusive stability limit
    def lap(f):
        return sum(np.roll(f, 1, ax) + np.roll(f, -1, ax) - 2 * f for ax in range(dims)) / dx ** 2
    early = None
    steps = int(t_end / dt)
    for s in range(steps):
        u, v = u + dt * (A - B * u + u * u / v + lap(u)), v + dt * (u * u - v + d * lap(v))
        if early is None and np.std(u) > 0.05 * U0:            # still small: the linear regime
            early = u.copy()
    return u, wavelength(early if early is not None else u, dx), wavelength(u, dx)


def wavelength(u, dx):
    """The wavelength of the strongest Fourier mode (radially averaged in 2D)."""
    f = np.abs(np.fft.fftn(u - u.mean())) ** 2
    if u.ndim == 1:
        k = np.fft.fftfreq(len(u), dx) * 2 * np.pi
        i = np.argmax(f[1:len(u) // 2]) + 1
        return float(2 * np.pi / abs(k[i]))
    n = u.shape[0]
    kx = np.fft.fftfreq(n, dx) * 2 * np.pi
    K = np.hypot(*np.meshgrid(kx, kx, indexing="ij"))
    bins = np.linspace(0, K.max(), 200)
    idx = np.digitize(K.ravel(), bins)
    power = np.bincount(idx, f.ravel(), len(bins) + 1)[1:-1]
    centres = 0.5 * (bins[1:] + bins[:-1])
    return float(2 * np.pi / centres[np.argmax(power[1:]) + 1])


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    RESULTS.mkdir(exist_ok=True)
    dc = critical_d()
    tr, det = np.trace(J), np.linalg.det(J)
    report = {"u0": U0, "v0": V0, "trace": tr, "det": det, "d_c": dc}
    print(f"uniform state u* = {U0:.3f}, v* = {V0:.3f}; stable without diffusion: trace {tr:.3f} < 0, det {det:.3f} > 0")
    print(f"critical diffusion ratio d_c = {dc:.3f}")

    # 1. onset: below d_c the noise dies away, above it a pattern grows
    onset = []
    for factor in (0.8, 0.95, 1.05, 1.5, 3.0):
        d = factor * dc
        u, _, _ = simulate(d, n=256, t_end=800)
        amp = float(u.std())
        onset.append({"d/d_c": factor, "d": d, "amplitude": amp, "max_growth_rate": float(growth_rate(np.linspace(0.01, 3, 600), d).max())})
        print(f"d = {factor:.2f} d_c: pattern amplitude {amp:.4f}; largest linear growth rate {onset[-1]['max_growth_rate']:+.4f}")
    report["onset"] = onset

    # 2. wavelength: the fastest-growing mode against simulation, for several d
    rows = []
    ks = np.linspace(0.01, 3, 3000)
    for factor in (1.5, 2.0, 3.0, 5.0, 8.0):
        d = factor * dc
        rates = growth_rate(ks, d)
        predicted = 2 * np.pi / ks[np.argmax(rates)]
        sims = [simulate(d, seed=s) for s in range(3)]
        early = np.mean([w for _, w, _ in sims]); final = np.mean([w for _, _, w in sims])
        rows.append({"d/d_c": factor, "predicted": float(predicted), "early": float(early), "final": float(final)})
        print(f"d = {factor:.1f} d_c: predicted wavelength {predicted:.2f}; simulated {early:.2f} (linear stage), {final:.2f} (final pattern)")
    report["wavelength"] = rows

    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    for factor in (0.8, 1.0, 1.5, 3.0):
        axes[0].plot(ks, growth_rate(ks, factor * dc), label=f"d = {factor} d_c")
    axes[0].axhline(0, color="grey", lw=0.8); axes[0].set_ylim(-0.3, 0.25); axes[0].set_xlim(0, 2)
    axes[0].set_xlabel("wavenumber k"); axes[0].set_ylabel("growth rate λ(k)"); axes[0].legend(); axes[0].set_title("Turing instability: a band of k grows")
    f = [r["d/d_c"] for r in rows]
    axes[1].plot(f, [r["predicted"] for r in rows], "k-", label="linear theory (fastest mode)")
    axes[1].plot(f, [r["early"] for r in rows], "o", label="simulation, linear stage")
    axes[1].plot(f, [r["final"] for r in rows], "s", label="simulation, final pattern")
    axes[1].set_xlabel("d / d_c"); axes[1].set_ylabel("wavelength"); axes[1].legend(); axes[1].set_title("Predicted against simulated wavelength")
    u2, _, w2 = simulate(3.0 * dc, n=128, dims=2, t_end=300)
    axes[2].imshow(u2, cmap="magma"); axes[2].axis("off"); axes[2].set_title(f"2D, d = 3 d_c: spots (wavelength {w2:.1f})")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_turing.png", dpi=110); plt.close(fig)
    report["2d_wavelength"] = w2
    (RESULTS / "turing.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
