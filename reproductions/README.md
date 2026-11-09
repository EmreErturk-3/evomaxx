# EvoMaxx: the reproductions

EvoMaxx borrows from a handful of papers in artificial life, dynamical systems, evolutionary
computation and music. Each is reproduced here on its own, before any EvoMaxx: the paper's
model as stated, its published results measured again, and what could not be reproduced said
plainly. Each folder has the code, the figures and a README that ends with what EvoMaxx takes
from it. [EXPLAINED.md](../EXPLAINED.md) puts them together into the whole of EvoMaxx.

**▶ All of them live:** [the reproductions viewer](https://emreerturk-3.github.io/evomaxx/reproductions/live/) (WebGL 2, in the browser).

| | source | what is reproduced | result | in EvoMaxx |
|---|---|---|---|---|
| [01](01_lenia_chan2019/) | **Lenia**, Chan 2019 | Orbium from the author's library; its mass and speed across resolutions; its niche | glides at 0.473 R per time unit; mass 0.4207 R² at every R from 13 to 65; lives in 51 of 525 (μ, σ) cells | Lenia shell kernel, Lenia delta, Gaussian response, the gene structure |
| [02](02_flow_lenia_plantec2023/) | **Flow-Lenia**, Plantec et al. 2023 | mass conservation; random rules form creatures where Lenia does not | mass constant to 10⁻¹⁴; 78 of 80 random rules localise, against 1 in Lenia | reintegration tracking in every transport physics |
| [03](03_activator_inhibitor_young1984/) | **Activator–inhibitor**, Young 1984 | the test patterns; spots against stripes | stable at exactly step 115 and 71, as published; stripes for weak inhibition, spots for strong | the Mexican hat kernel of the default rule |
| [04](04_physarum_jones2010/) | **Physarum**, Jones 2010 | spontaneous transport networks; the effect of sensor and rotation angles | a network forms and coarsens (49 → 8 lacunae); the angle effect *not* reproduced by our measures | the physarum physics behind EvoMaxx's creatures |
| [05](05_cyclic_dominance_mayleonard1975/) | **Cyclic dominance**, May & Leonard 1975; Reichenbach et al. 2007 | the heteroclinic cycle; the mobility threshold for biodiversity | stays grow by 1.483 per turn (theory 1.5); below M_c extinction vanishes with lattice size; above it, near-certain only at 4× the stated time | the cyclic dominance delta, the colour game |
| [06](06_kuramoto1975/) | **Kuramoto** 1975 | the synchronisation transition, r = √(1 − K_c/K) | matches the exact result to 3 decimals above K_c | colour flocking |
| [07](07_map_elites_mouret2015/) | **MAP-Elites**, Mouret & Clune 2015 | more and better solutions than random sampling or an optimiser | 72.5 % of cells against 43.0 % and 31.9 %, and better elites | the Discover atlas |
| [08](08_phyllotaxis_vogel1979/) | **Phyllotaxis**, Vogel 1979 | the golden angle's packing; Fibonacci parastichies | best packing exactly at 137.508°; parastichies 13/21 … 89/144 | the phyllotaxis kernel |
| [09](09_euclidean_rhythms_toussaint2005/) | **Euclidean rhythms**, Toussaint 2005 | the paper's 21 rhythms and their classification | 20 of 21 symbol for symbol (the 21st is a typo in the paper); classification 22 of 22 | the Euclidean drums |
| [10](10_turing_gierer_meinhardt1972/) | **Turing patterns**, Turing 1952; Gierer & Meinhardt 1972 | the diffusion threshold d_c; the wavelength of the fastest mode | no pattern at 0.95 d_c, a pattern at 1.05 d_c (d_c = 8.24); early wavelength within 8 % of theory | v1's reaction–diffusion update; multi-scale spreading |
| [11](11_boolean_networks_kauffman1969/) | **Random Boolean networks**, Kauffman 1969; Derrida & Pomeau 1986 | order for K ≤ 2, chaos above; the damage map; attractor counts | damage map within 0.005 of the annealed formula; long-run damage 0.384 / 0.454 / 0.482 against 0.382 / 0.456 / 0.481 | the genome as a gene regulatory network; dead / alive / noise |
| [12](12_edge_of_chaos_langton1990/) | **Edge of chaos**, Langton 1990 | λ and the order–chaos transition; information at intermediate entropy | entropy rises most steeply at λ ≈ 0.37, where transients explode; information peaks at mid entropy (0.155 bits at H = 0.8–1.0, against 0.03 and 0.01 at the ends) | the health classes; v1's fitness |

## Running

Every folder runs on its own:

```bash
cd 01_lenia_chan2019 && ./lenia.py
```

Python 3 with NumPy, SciPy, Matplotlib and Pillow; folders 04 and 05 also need a C
compiler (`cc`), which their scripts call themselves. The live viewer needs only a browser
with WebGL 2.
