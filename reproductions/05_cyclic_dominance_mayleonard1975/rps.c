/* The stochastic rock-paper-scissors lattice of T. Reichenbach, M. Mobilia and E. Frey,
 * "Mobility promotes and jeopardizes biodiversity in rock-paper-scissors games", Nature 448
 * (2007) 1046 (Methods): an L x L periodic lattice, every site empty (0) or of species A, B
 * or C (1, 2, 3). Repeatedly a random site and one of its four neighbours are drawn, and
 * a reaction is chosen in proportion to its rate:
 *   selection    (sigma)    AB -> A0, BC -> B0, CA -> C0     (A beats B beats C beats A)
 *   reproduction (mu)       A0 -> AA (any species into an empty neighbour)
 *   exchange     (epsilon)  XY -> YX (any two neighbours, empty sites included)
 * Time is counted in generations: N (sigma + mu + epsilon) draws per generation, so that
 * every site reacts at total rate sigma + mu + epsilon. Mobility M = 2 epsilon / N.
 * Built by rps.py with: cc -O2 -shared -fPIC rps.c -o librps.so
 */
#include <stdint.h>

/* xorshift64*, one state per run (runs go in parallel threads) */
static inline uint64_t next(uint64_t *s) { *s ^= *s >> 12; *s ^= *s << 25; *s ^= *s >> 27; return *s * 2685821657736338717ULL; }
static inline double uniform(uint64_t *s) { return (double)(next(s) >> 11) / 9007199254740992.0; }

/* Runs until time t_max (generations) or until at most one species is left. counts[0..3]
 * hold the numbers of empty sites and of A, B, C (kept up to date); seed: the run's own
 * random state. Returns the time reached. */
double run(int L, uint8_t *grid, long *counts, double sigma, double mu, double epsilon, double t_max, uint64_t seed) {
    uint64_t rng = seed ? seed : 1;
    for (int i = 0; i < 20; i++) next(&rng);
    const long N = (long)L * L;
    const double total = sigma + mu + epsilon, p_sel = sigma / total, p_rep = (sigma + mu) / total;
    const double dt = 1.0 / (N * total);
    double t = 0.0;
    static const int DX[4] = {1, -1, 0, 0}, DY[4] = {0, 0, 1, -1};
    while (t < t_max) {
        for (long k = 0; k < N; k++) {                     /* check extinction every N draws */
            long i = (long)(uniform(&rng) * N);
            int d = (int)(next(&rng) >> 62);
            int x = (int)(i % L), y = (int)(i / L);
            int nx = (x + DX[d] + L) % L, ny = (y + DY[d] + L) % L;
            long j = (long)ny * L + nx;
            uint8_t a = grid[i], b = grid[j];
            double r = uniform(&rng);
            if (r < p_sel) {                               /* selection */
                if (a && b && a != b) {
                    if (b == a % 3 + 1) { grid[j] = 0; counts[b]--; counts[0]++; }     /* a beats b */
                    else { grid[i] = 0; counts[a]--; counts[0]++; }                   /* b beats a */
                }
            } else if (r < p_rep) {                        /* reproduction */
                if (a && !b) { grid[j] = a; counts[a]++; counts[0]--; }
                else if (b && !a) { grid[i] = b; counts[b]++; counts[0]--; }
            } else {                                       /* exchange */
                grid[i] = b; grid[j] = a;
            }
            t += dt;
        }
        int alive = (counts[1] > 0) + (counts[2] > 0) + (counts[3] > 0);
        if (alive <= 1) break;
    }
    return t;
}
