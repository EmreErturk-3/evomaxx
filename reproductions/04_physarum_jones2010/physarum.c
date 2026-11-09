/* The particle model of Physarum polycephalum of J. Jones (Artificial Life 16, 2010;
 * Natural Computing 10, 2011), as described in the 2011 paper (Sect. 2, Figs. 1-2).
 *
 * Particles live on a periodic lattice, at most one per site. Each step:
 *   sensory stage (random order): sample the trail map at three sensors, offset SO ahead
 *     and at +-SA, and turn by RA (Fig. 1): keep going if the front is strongest, turn
 *     randomly if it is weakest, else turn towards the stronger side;
 *   motor stage (random order): move SS ahead if the site there is free and deposit depT on
 *     the trail; otherwise stay, deposit nothing, and pick a new random heading (as in
 *     Jones 2010);
 *   the trail diffuses (3 x 3 mean) and is damped by the factor (1 - dampT).
 * Built by physarum.py with: cc -O2 -shared -fPIC physarum.c -o libphysarum.so -lm
 */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uint64_t state = 88172645463325252ULL;
static double uniform(void) {            /* xorshift64*, in [0, 1) */
    state ^= state >> 12; state ^= state << 25; state ^= state >> 27;
    return (double)((state * 2685821657736338717ULL) >> 11) / 9007199254740992.0;
}
void seed(uint64_t s) { state = s ? s : 1; for (int i = 0; i < 20; i++) uniform(); }

static void shuffle(int *order, int n) {
    for (int i = n - 1; i > 0; i--) { int j = (int)(uniform() * (i + 1)); int t = order[i]; order[i] = order[j]; order[j] = t; }
}
static inline int wrap(int v, int n) { v %= n; return v < 0 ? v + n : v; }
static inline double sense(const double *trail, int w, int h, double x, double y, double angle, double offset) {
    return trail[wrap((int)floor(y + offset * sin(angle)), h) * w + wrap((int)floor(x + offset * cos(angle)), w)];
}

/* One scheduler step for n particles at (x, y) with headings a; occupied[site] is 1 where a
 * particle stands. sa, ra in radians. */
void step(int w, int h, double *trail, double *scratch, int *occupied, int n, double *x, double *y, double *a,
          int *order, double sa, double ra, double so, double ss, double dep, double damp) {
    for (int i = 0; i < n; i++) order[i] = i;
    shuffle(order, n);
    for (int k = 0; k < n; k++) {                         /* sensory stage */
        int i = order[k];
        double f = sense(trail, w, h, x[i], y[i], a[i], so);
        double fl = sense(trail, w, h, x[i], y[i], a[i] - sa, so);
        double fr = sense(trail, w, h, x[i], y[i], a[i] + sa, so);
        if (f > fl && f > fr) continue;
        else if (f < fl && f < fr) a[i] += uniform() < 0.5 ? -ra : ra;
        else if (fl < fr) a[i] += ra;
        else if (fr < fl) a[i] -= ra;
    }
    shuffle(order, n);
    for (int k = 0; k < n; k++) {                         /* motor stage */
        int i = order[k];
        double nx = x[i] + ss * cos(a[i]), ny = y[i] + ss * sin(a[i]);
        nx -= w * floor(nx / w); ny -= h * floor(ny / h);
        int from = wrap((int)floor(y[i]), h) * w + wrap((int)floor(x[i]), w);
        int to = wrap((int)floor(ny), h) * w + wrap((int)floor(nx), w);
        if (to == from || !occupied[to]) {
            occupied[from] = 0; occupied[to] = 1;
            x[i] = nx; y[i] = ny;
            trail[to] += dep;
        } else {
            a[i] = 2 * M_PI * uniform();
        }
    }
    for (int r = 0; r < h; r++)                           /* diffusion and damping */
        for (int c = 0; c < w; c++) {
            double s = 0;
            for (int dr = -1; dr <= 1; dr++)
                for (int dc = -1; dc <= 1; dc++) s += trail[wrap(r + dr, h) * w + wrap(c + dc, w)];
            scratch[r * w + c] = (1 - damp) * s / 9.0;
        }
    memcpy(trail, scratch, sizeof(double) * w * h);
}
