#!/usr/bin/env python3
"""
EvoMaxx v1, run headless and measured.

The organisms are v1's own: ../v1/genome.py is imported unchanged. The loop and the fitness
function are ../v1/main.py's, line for line, without the window (main.py imports pygame for
its window and input; here an offscreen OpenGL 4.3 context runs the same compute shaders).
Nobody paints and no extinction event is triggered.

Left alone, a v1 world soon goes flat (uniform) and stays flat: v1 has no noise, and on a
uniform field almost no rule can break the symmetry again. In v1 the player brings the
variation back, by painting and by SPACE (an extinction: a fresh pool, the best genome kept,
the field re-noised). So the conditions, with the same timing and scored by v1's own
score(), are:
  as written     v1 untouched, nobody playing
  v1             v1, with a player who presses SPACE after 5 s of a flat screen
  no selection   the same, but every score is replaced by a random number in the range
                 v1's scores take (8 to 12): the loop runs as usual, fitness carries no
                 information; the true score is still recorded
  no heredity    the same player, but a brand-new random organism every 90 frames instead
                 of mutation and crossover (selection kept, inheritance removed)

  PYTHONPATH=<moderngl> ./run_v1.py [runs] [frames] [condition ...]
                        results/<condition>.json, summary.json, fig1_evolution.png, gallery_*.png
"""
import copy
import json
import random
import sys
from pathlib import Path

import moderngl
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "v1"))
from genome import Organism          # noqa: E402  (v1, unchanged)

RESULTS = HERE / "results"
W, H, POP, STRIDE = 1280, 720, 12, 12  # main.py


def score(raw):
    """main.py's score(), verbatim."""
    a = np.frombuffer(raw, dtype=np.float32).reshape(H, W, 4)[::STRIDE, ::STRIDE, :3]
    g = np.mean(np.abs(a[1:] - a[:-1]), axis=(0, 1))
    b = float(a.mean())
    if b < 0.005 or b > 0.995: return -10.0
    if np.std(a) < 0.03:       return -5.0
    return (np.mean(1.0 - np.abs(g - 0.20)) * 8.0
          + np.std(a.mean(axis=(0, 1))) * 6.0
          + (1.0 - abs(b - 0.35) * 2.0) * 2.0
          + np.mean([np.std(a[:, :, c]) for c in range(3)]) * 4.0)


def structure(raw):
    """Independent of v1's score: the share of the field's variation that lives above the
    pixel scale (std of 8 x 8 block means / std of the field), and its overall std. Pixel
    noise gives a small share; organised patterns a large one."""
    a = np.frombuffer(raw, dtype=np.float32).reshape(H, W, 4)[:, :, :3]
    blocks = a.reshape(H // 8, 8, W // 8, 8, 3).mean(axis=(1, 3))
    s = float(a.std())
    return (float(blocks.std() / s) if s > 1e-6 else 0.0), s


def run(condition, seed, frames, snapshot_every):
    """One run; returns a log (every 60 frames) and snapshots."""
    random.seed(seed); np.random.seed(seed)
    ctx = moderngl.create_standalone_context(require=430, backend="egl")
    ta = ctx.texture((W, H), 4, dtype="f4"); tb = ctx.texture((W, H), 4, dtype="f4")
    ta.write(np.random.rand(H, W, 4).astype("f4").tobytes())
    noise = random.Random(seed + 99)
    rate = (lambda raw: noise.uniform(8.0, 12.0)) if condition == "no selection" else score
    pool = [Organism(ctx) for _ in range(POP)]
    cur, genomes, log, snaps, flat, extinctions = pool[0], POP, [], [], 0, 0
    for frame in range(1, frames + 1):
        if condition == "no heredity":
            if frame % 90 == 0:
                child = Organism(ctx); genomes += 1
                if child.valid: cur = child
        else:
            if frame % 90 == 0:
                child = copy.deepcopy(cur); child.mutate(); child._compile(ctx); genomes += 1
                if child.valid:
                    pool.append(child)
                    if len(pool) > POP: pool.remove(min(pool, key=lambda o: o.fit))
                    cur = child
            if frame % 270 == 0 or max(o.fit for o in pool) < 0.5:
                v = sorted([o for o in pool if o.valid], key=lambda o: o.fit, reverse=True)
                if len(v) >= 2:
                    child = v[0].crossover(v[1]); child._compile(ctx); genomes += 1
                    if child.valid:
                        pool.append(child)
                        if len(pool) > POP: pool.remove(min(pool, key=lambda o: o.fit))
                        cur = child
        if frame % 60 == 0:
            raw = tb.read()
            s = score(raw)
            cur.fit = cur.fit * 0.7 + rate(raw) * 0.3
            share, std = structure(raw)
            log.append({"frame": frame, "score": s, "fit": cur.fit, "share": share, "std": std, "genomes": genomes, "extinctions": extinctions})
            flat = flat + 1 if s <= -5 else 0
            if flat >= 5 and condition != "as written":           # the player presses SPACE: main.py's extinction()
                best = max(pool, key=lambda o: o.fit)
                pool = [Organism(ctx) for _ in range(POP - 1)] + [copy.deepcopy(best)]
                cur = pool[0]; genomes += POP - 1; extinctions += 1; flat = 0
                ta.write(np.random.rand(H, W, 4).astype("f4").tobytes())
            if frame % snapshot_every == 0:
                a = np.frombuffer(raw, dtype=np.float32).reshape(H, W, 4)[::-4, ::4, :3]     # display: pow 0.75, as main.py
                snaps.append((frame, (np.clip(a, 0, 1) ** 0.75 * 255).astype(np.uint8)))
        ta.bind_to_image(0, read=True, write=False); tb.bind_to_image(1, read=False, write=True)
        if cur.shader:
            cur.shader["R"].value = (float(W), float(H))
            try:
                cur.shader["u_time"].value = frame / 60
            except KeyError:
                pass                      # unused uniforms are optimised away (main.py ignores this too)
            cur.shader.run(W // 16 + 1, H // 16 + 1)
        ctx.finish()
        ta, tb = tb, ta
    ctx.release()
    return log, snaps


CONDITIONS = ["as written", "v1", "no selection", "no heredity"]


def main():
    """./run_v1.py runs frames [condition ...]: runs the conditions (default all), saves one
    results/<condition>.json each, then summarises every condition that has a file."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    RESULTS.mkdir(exist_ok=True)
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    frames = int(sys.argv[2]) if len(sys.argv) > 2 else 3_600       # one minute at 60 fps
    chosen = sys.argv[3:] or CONDITIONS
    for condition in chosen:
        logs, gallery = [], []
        for seed in range(runs):
            log, snaps = run(condition, seed, frames, snapshot_every=frames // 3)
            logs.append(log)
            if seed < 4:
                gallery.append([s[1] for s in snaps])
            last = log[-30:]                                                # the last 30 seconds
            print(f"{condition:12s} run {seed}: genomes tried {log[-1]['genomes']:5d}, extinctions {log[-1]['extinctions']}, "
                  f"score (last 30 s) {np.mean([r['score'] for r in last]):6.2f}, structure share {np.mean([r['share'] for r in last]):.2f}", flush=True)
        (RESULTS / f"{condition.replace(' ', '_')}.json").write_text(json.dumps({"runs": runs, "frames": frames, "logs": logs}))
        rows = [np.concatenate(g, axis=1) for g in gallery]
        Image.fromarray(np.concatenate(rows, axis=0)).save(RESULTS / f"gallery_{condition.replace(' ', '_')}.png")

    report, summary = {}, {}
    for condition in CONDITIONS:
        f = RESULTS / f"{condition.replace(' ', '_')}.json"
        if f.exists():
            report[condition] = json.loads(f.read_text())["logs"]
    for condition, logs in report.items():
        late = [np.mean([r["score"] for r in log[-30:]]) for log in logs]
        early = [np.mean([r["score"] for r in log[:30]]) for log in logs]
        share = [np.mean([r["share"] for r in log[-30:]]) for log in logs]
        flat = [np.mean([r["score"] <= -5 for r in log]) for log in logs]
        summary[condition] = {"first_30s": float(np.mean(early)), "last_30s": float(np.mean(late)), "last_30s_runs": [float(x) for x in late],
                              "structure_share_last_30s": float(np.mean(share)), "time_flat": float(np.mean(flat)),
                              "genomes_tried": float(np.mean([log[-1]["genomes"] for log in logs])),
                              "extinctions": float(np.mean([log[-1]["extinctions"] for log in logs]))}
        print(f"{condition:12s}: score {summary[condition]['first_30s']:.2f} in the first 30 s -> {summary[condition]['last_30s']:.2f} in the last; "
              f"flat {100 * summary[condition]['time_flat']:.0f} % of the time; structure share {summary[condition]['structure_share_last_30s']:.2f}; "
              f"{summary[condition]['genomes_tried']:.0f} genomes tried, {summary[condition]['extinctions']:.1f} extinctions")
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=1))

    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    for condition, colour in zip(CONDITIONS, ["#c0a040", "#d04080", "#4080d0", "#909090"]):
        if condition not in report:
            continue
        t = np.array([r["frame"] for r in report[condition][0]]) / 60
        sc = np.array([[r["score"] for r in log] for log in report[condition]])
        axes[0].plot(t, np.median(sc, 0), color=colour, label=condition)
        axes[0].fill_between(t, np.percentile(sc, 25, 0), np.percentile(sc, 75, 0), color=colour, alpha=0.15)
        sh = np.array([[r["share"] for r in log] for log in report[condition]])
        axes[1].plot(t, np.median(sh, 0), color=colour, label=condition)
    axes[0].set_xlabel("seconds (at 60 fps)"); axes[0].set_ylabel("v1's score (median, quartiles)"); axes[0].legend()
    axes[1].set_xlabel("seconds"); axes[1].set_ylabel("structure above the pixel scale"); axes[1].set_title("Independent measure")
    fig.tight_layout(); fig.savefig(RESULTS / "fig1_evolution.png", dpi=110); plt.close(fig)


if __name__ == "__main__":
    main()
