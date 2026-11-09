# evomaxx

Open-ended evolution of reaction-diffusion Gene Regulatory Networks on the GPU.  
**190 lines of Python. RGB channels are the three chemical species. The shader IS the organism.**

## What it is

Each organism is a Gene Regulatory Network compiled directly into a GLSL compute shader.  
8 Gaussian interaction rules wire up 3 chemical species (R, G, B) across 3 spatial scales.  
Evolution runs in real time — mutation and crossover every few seconds, fitness evaluated from the field itself.  
The display IS the simulation. No render step. No representation layer. Chemistry = pixels.

## Requirements

- Windows 10/11
- GPU with OpenGL 4.3 support (any GPU from ~2012 onwards)

## Run from source

```
pip install pygame moderngl numpy
python main.py
```

## Build exe

```
pip install pyinstaller
pyinstaller evomaxx.spec
```
Exe appears in `dist/evomaxx.exe`

## Controls

| Input | Action |
|-------|--------|
| Left click | Paint biomass into field |
| Right click | Erase biomass |
| SPACE | Extinction event — reset field + pool, keep best genome |
| ESC | Quit |

## How it works

```
genome (8 rules) → compile → GLSL compute shader
shader runs on GPU → RGB field updated every frame
field scored for complexity/diversity → fitness
mutation + crossover → new shaders → better organisms
```

The update equation:
```
next = current * (1 - decay) + speed * GRN_output
```
Multiplicative decay means the field never drains to zero — chemistry always has a floor.

## Modes you'll see

- **Turing patterns** — stripes, spots, labyrinths
- **Territorial dynamics** — species competing for space  
- **Individuated organisms** — discrete membrane-bound bodies
- **Domain boundaries** — crystalline grain structure
- **Traveling waves** — moving fronts and pulses

All emergent. None designed.
