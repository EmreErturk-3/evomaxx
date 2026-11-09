# EvoMaxx explained

*From a small seed to v10: what EvoMaxx is made of, where each idea comes from, and what is
its own. For readers who want the mathematics. Each borrowed idea has a reproduction of its
source in [reproductions/](reproductions/), and all of them run live in the
[reproductions viewer](reproductions/live/index.html).*

## 1. The seed: EvoMaxx v1

EvoMaxx began as EvoMaxx v1, about 200 lines of Python and OpenGL by its author, kept
untouched in [legacy/v1/](legacy/v1/). Its README opens: *"Open-ended evolution of
reaction-diffusion Gene Regulatory Networks on the GPU. RGB channels are the three chemical
species. The shader IS the organism."* The idea that everything else grew from:

> **The three colour channels of an image are three chemicals.** Every pixel holds an
> amount of red, green and blue, and a genome decides how each chemical responds to the
> others around it. Nothing is drawn: every colour on the screen is a concentration, and
> every pattern is grown by the rule.

v1 compiles its genome into a GLSL compute shader. Eight genes each have a source chemical,
a target chemical, one of three neighbourhoods (a 3 × 3 box, a 7 × 7 box, a 7 × 7 lattice of
spacing 2), a weight ρ, a centre μ and a width σ:

    growth_c = bias + Σ_{genes i with target c} ρ_i · exp(−((N_i[source_i] − μ_i) / σ_i)²)
    x_c ← clip(x_c (1 − decay) + speed · growth_c, 0, 1)

It evolves in real time on one living world (1280 × 720, a torus). A pool of 12 organisms;
every 90 frames a mutated child takes over the world, every 270 frames the two fittest are
crossed, and every 60 frames the running organism's fitness moves towards a score read from
the field. SPACE is an extinction event: a fresh pool, the best kept, the field re-noised.
The field is never reset when organisms change, so each rule inherits the world its parent
made. That is a genetic algorithm (Holland 1975) whose fitness is the picture itself.

v1 had, without knowing it, the gene structure of **multi-channel Lenia** (Chan 2020): a
kernel reads one channel, a growth function maps the result, and the output is added to a
channel. It reached it independently, with boxes instead of rings and decay instead of
centred growth. Later versions moved EvoMaxx into the browser. By V4 it had five response
functions (Gaussian, sine, step, absolute, tangent) but no longer evolved: the genome was
redrawn every 20 s, and V4's experiment with 3D is not kept.

**What v1 does, measured.** [legacy/v1-analysis/](legacy/v1-analysis/) runs v1's own code
headless, 10 runs of 3 minutes per condition ([legacy/README.md](legacy/README.md) has the
details):

- Left alone, 4 of 10 worlds go flat and stay flat: v1 has no noise, and its player was
  meant to bring variation back by painting and pressing SPACE.
- **Heredity keeps a world alive.** With fresh random organisms in place of mutation and
  crossover, v1's score fell from 9.96 to 2.55, lower in all 10 paired runs (p = 0.002).
- **Selection by v1's score had no clear effect** (median 9.76 against 9.77 with a
  meaningless score, p = 0.32). The score has a flaw: a world of one pure colour scores
  11.16, more than most patterns. v1's patterns came from its rules and heredity, not from
  its fitness.
- At start-up every fitness is 0, and v1's "crossover while no fitness exceeds 0.5" fires
  on every frame: 60 genomes in the first second. In one run where the whole pool fell
  below 0.5, it fired for the rest of the run, about 10,700 genomes in 3 minutes.

v1's own rule, measured with v10's health classes, is lifelike for 7 % of fresh genomes.
The seed was full of possibility but rarely alive, and its evolution could not tell a
pattern from a solid colour. The rest of EvoMaxx's history is about what that seed could
become once it was measured.

## 2. From v1 to v10

| version | what changed |
|---|---|
| **v1** (the seed) | Python and OpenGL compute shaders: three chemicals, an eight-gene regulatory network compiled into the shader, three box neighbourhoods, one Gaussian response, decay; real-time evolution of a pool of 12 with mutation, crossover, a fitness read from the field, and extinction events |
| **V2–V4** | EvoMaxx moves into the browser as a single WebGL page. By V4 four more responses have joined the Gaussian (sine, step, absolute, tangent), the genome is redrawn every 20 s instead of evolved, and the world is wrapped around 3D fractals. That 3D branch is not kept |
| **V5** | rebuilt: the genome becomes data (live sliders, copy, paste, share links), health measured over the whole world, a codex, breeding, MAP-Elites discovery, a Lenia engine beside the original one |
| **V6** | **colour physics**: the colour of a cell is treated as a vector, and its hue becomes a direction of motion (§4) |
| **V7** | **the big experiment**: kernels, update rules (deltas), responses and physics all become interchangeable, 13 × 8 × 14 × 8 candidates. About 7,900 worlds pick the winners. Default: Mexican hat · v1 decay · tangent · hue transport, lifelike for 93–95 % of fresh genomes |
| **v10** | new core math (gaze kernel, physarum physics, cyclic dominance, …) tested on 5,760 + 400 worlds; physarum makes creatures for 80–82 % of genomes. The lava lamp. The music. A consumer app, with v1's own evolution back as the first mode of the Evolve tab |

## 3. One step of v10, piece by piece

Each step of an EvoMaxx world:

1. **Sense.** Three neighbourhood fields N₀, N₁, N₂ (three sizes of one kernel family).
2. **Respond.** Gene i adds w_i f((N_ring[src] − μ)/σ) to its target chemical.
3. **Update.** A delta turns the summed growth G into the new colour.
4. **Move.** An optional colour physics turns colours locally, or moves matter with
   mass-conserving transport.

| piece | EvoMaxx | comes from | reproduced in |
|---|---|---|---|
| the update | x ← x(1 − decay) + speed · (bias + growth): reaction plus spreading at three ranges | reaction–diffusion: Turing 1952, Gierer & Meinhardt 1972 | [10 Turing patterns](reproductions/10_turing_gierer_meinhardt1972/) |
| the genome | eight genes, each a rule by which one chemical regulates another | gene regulatory networks: Kauffman 1969 | [11 Boolean networks](reproductions/11_boolean_networks_kauffman1969/) |
| gene structure | kernel → growth → target channel | multi-channel Lenia (Chan 2020); reached independently in v1 | [01 Lenia](reproductions/01_lenia_chan2019/) |
| Lenia shell kernel, Gaussian response, Lenia delta x + sG | as in Lenia | Chan 2019 | [01 Lenia](reproductions/01_lenia_chan2019/) |
| Mexican hat kernel | difference of Gaussians, positive centre, negative surround | local activation, lateral inhibition: Turing 1952, Young 1984 | [03 activator–inhibitor](reproductions/03_activator_inhibitor_young1984/) |
| phyllotaxis kernel | taps on the sunflower spiral | Vogel 1979 | [08 phyllotaxis](reproductions/08_phyllotaxis_vogel1979/) |
| cyclic dominance delta | x_c += ρ x_c (x_{c+1} − x_{c−1}) | May & Leonard 1975; spatial: Reichenbach, Mobilia & Frey 2007 | [05 cyclic dominance](reproductions/05_cyclic_dominance_mayleonard1975/) |
| colour game physics | replicator dynamics on the colour mix | Taylor & Jonker 1978 (with 05) | [05 cyclic dominance](reproductions/05_cyclic_dominance_mayleonard1975/) |
| mass-conserving transport | reintegration tracking | Moroz 2020; Flow-Lenia (Plantec et al. 2023) | [02 Flow-Lenia](reproductions/02_flow_lenia_plantec2023/) |
| colour flocking | hue turns towards the neighbourhood hue | Kuramoto 1975 (sine coupling); Vicsek et al. 1995 (alignment) | [06 Kuramoto](reproductions/06_kuramoto1975/) |
| physarum physics | sense ahead-left and ahead-right, turn, move | Jones 2010 | [04 Physarum](reproductions/04_physarum_jones2010/) |
| health classes | dead, frozen, alive, noise; v1's fitness rewards neither-flat-nor-saturated | Langton's λ and the edge of chaos (1990) | [12 edge of chaos](reproductions/12_edge_of_chaos_langton1990/) |
| Discover | an 8 × 8 atlas of elites | MAP-Elites (Mouret & Clune 2015) | [07 MAP-Elites](reproductions/07_map_elites_mouret2015/) |
| Euclidean drums | E(k, 16), k from the world | Toussaint 2005 | [09 Euclidean rhythms](reproductions/09_euclidean_rhythms_toussaint2005/) |
| harmony from colour | hue around the circle of fifths | Scriabin's colour-key circle (*Prometheus*, 1910) | – |

## 4. What is EvoMaxx's own

The sources above give EvoMaxx its parts. These ideas are its own. Searches of the Lenia,
Flow-Lenia and continuous-automaton literature found nothing like them:

- **Colour as chemistry** (v1). The three channels are not a palette over a hidden state:
  they *are* the state, three interacting chemicals.
- **The shader is the organism** (v1). The genome is not interpreted: it is compiled into
  the GPU program that runs the world, and the field that program writes is both the
  organism's body and the picture. v1 read its fitness from that field directly.
- **Hue is heading** (V6). A cell's chroma, c = (r − (g + b)/2, (√3/2)(g − b)), is a vector in
  the plane orthogonal to grey. In **hue transport** every cell moves by v = τ c / max(r, g, b):
  its hue is the direction of motion and its saturation the speed; grey stays still. Matter
  is then moved by reintegration tracking, so each chemical is conserved. Red drifts east,
  green and blue at 120° and 240°. Colour decides where matter goes.
- **Colour physics as rotations** (V6). Because colour is a 3-vector, rotations about the grey
  axis change hue but keep brightness. **Colour flocking** turns a cell's hue towards its
  neighbourhood's (Kuramoto coupling on the colour wheel), and since hue is heading, aligned
  colours are aligned motion: matter flocks. **Colour precession** spins a colour around its
  neighbourhood colour like a magnetic moment (Landau–Lifshitz).
- **The gaze kernel** (v10). A cell senses rings weighted towards the direction of *its own*
  hue (von Mises, κ = 4 × saturation): it looks where it would go.
- **Physarum on the colour wheel** (v10). Jones's slime-mould rule without particles: the
  hue is the heading, the cell senses its own colour ahead-left and ahead-right, turns its
  hue, and moves by hue transport.
- **The organism's voice** (v10). The genome chooses the music (§6).
- **Measuring life.** Health from 8 × 8-cell block statistics: alive, frozen, noise or dead,
  with motion, drift and emptiness. The experiments are built on these measures.

## 5. What the experiments found

All experiments ran the app's own engine, nine worlds at a time on the GPU in headless
Firefox. Each used fresh random genomes, a randomised screen, then confirmation on
**held-out** genomes, compared pairwise with exact McNemar tests.

- **V7 screen**: 4,050 worlds with a random kernel, delta, response and physics each.
- **V7 confirmation**: 128 combinations × 30 fresh genomes. Mexican hat · v1 decay · tangent
  · hue transport was lifelike for **93 %** of genomes, against **7 %** for v1's own rule
  (box neighbourhoods · v1 decay · Gaussian · no physics, with v1's gene ranges)
  (+26 / −0, p = 3 × 10⁻⁸). Hue transport was the strongest single ingredient.
- **V7 creatures**: 192 combinations × 18 genomes. Gaussian / exponential kernels with the
  multiplicative or logit delta and the Gabor response, plus colour flocking, gave localised,
  creature-like worlds up to 44–78 % of the time.
- **v10 screen**: 288 combinations × 20 genomes (5,760 worlds). Bessel-ring kernels and the
  Hill response failed. Physarum led the physics, and gaze localised most.
- **v10 confirmation**: 40 held-out genomes per combination. For **creatures**, gaze ·
  multiplicative · Gabor · physarum was localised for **82 %** and Gaussian · multiplicative
  · Gabor · physarum for **80 %**, against **22 %** for the V7 creature rule (+24 / −0,
  p = 1.2 × 10⁻⁷). For **lifelike** worlds nothing beat the V7 winner (95 %), so it stays the
  default.

The failures are reported too: most centred deltas, the colour game and chemotaxis did not
help; Bessel rings and the Hill response rarely live.

## 6. The music

The world plays itself. All sound is synthesised with WebAudio, and every note comes from
the world.

- **Three channel strips**, one per chemical. Each note goes through the strip of the
  chemical it came from.
- **The music box** sweeps a bar across the world: the bright cells under it sound, pitched
  by position and voiced by their dominant chemical.
- **The genome melody** plays the eight genes as a sequence: μ is pitch, |w| loudness (weak
  genes rest), σ length, and inhibitory genes sound an octave down. When the genome mutates,
  the melody mutates.
- **Bells** ring when a body forms; a low note sounds when one fades.
- **The drums** follow the world's motion, or play Euclidean rhythms whose pulse counts are
  the numbers of bodies of each colour.
- **The organism's voice.** The rule picks a palette of instrument families. The genes
  feeding each chemical pick its instrument, octave and brightness. The global numbers pick
  the tempo, swing and envelope. 400 random genomes gave 383 different voices. Small
  mutations shift the sound; a lineage keeps its character.
- **Harmony from colour.** The key follows the mean hue around the circle of fifths (after
  Scriabin), changing only on bar lines. The colour balance picks each bar's chord, which the
  strong beats and the drone follow.
- **The colour instrument** builds each note's spectrum from the colour of its cell.

## 7. The lava lamp

A display only; the chemistry is unchanged. The 2D world becomes an endless floor (the
torus tiles), and its bright matter floats above it as *wax*: a slowly lagging copy of the
field, so bodies rise as they heat up and sink as they cool. It is ray-marched per pixel
through a height field built from blurred levels of the world, with shadows, light through
thin wax, a wet mirror floor, fog and bloom.

## References

- B. W.-C. Chan, *Lenia: Biology of Artificial Life*, Complex Systems 28 (2019); *Lenia and
  Expanded Universe*, ALIFE 2020.
- E. Plantec et al., *Flow-Lenia*, ALIFE 2023; M. Moroz, reintegration tracking (2020).
- A. M. Turing, *The chemical basis of morphogenesis*, Phil. Trans. R. Soc. B 237 (1952);
  A. Gierer & H. Meinhardt, Kybernetik 12 (1972); J. D. Murray, *Mathematical Biology II*
  (2003); D. A. Young, Math. Biosci. 72 (1984); R. Piasecki et al., Acta Phys. Pol. B 49 (2018).
- S. A. Kauffman, J. Theor. Biol. 22 (1969); B. Derrida & Y. Pomeau, Europhys. Lett. 1 (1986);
  B. Samuelsson & C. Troein, Phys. Rev. Lett. 90 (2003).
- C. G. Langton, *Computation at the edge of chaos*, Physica D 42 (1990).
- J. Jones, Artificial Life 16 (2010); Natural Computing 10 (2011).
- R. M. May & W. J. Leonard, SIAM J. Appl. Math. 29 (1975); T. Reichenbach, M. Mobilia &
  E. Frey, Nature 448 (2007); P. D. Taylor & L. B. Jonker, Math. Biosci. 40 (1978).
- Y. Kuramoto, Lecture Notes in Physics 39 (1975); S. H. Strogatz, Physica D 143 (2000);
  T. Vicsek et al., Phys. Rev. Lett. 75 (1995).
- J.-B. Mouret & J. Clune, arXiv:1504.04909 (2015).
- H. Vogel, Math. Biosci. 44 (1979).
- G. T. Toussaint, BRIDGES (2005).
- J. H. Holland, *Adaptation in Natural and Artificial Systems* (1975): the genetic algorithm behind v1's loop.
- A. Scriabin, *Prometheus: The Poem of Fire* (1910).
