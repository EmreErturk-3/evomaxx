"""
evomaxx
-------
Open-ended evolution of reaction-diffusion Gene Regulatory Networks on the GPU.
RGB channels = three chemical species. The shader IS the organism.

Controls
--------
  Left click   paint biomass
  Right click  erase biomass  
  SPACE        extinction event — nuke & restart, keep best genome
  ESC          quit
"""
import copy, random, sys, os
import pygame, moderngl
import numpy as np
from genome import Organism

W, H   = 1280, 720
POP    = 12
STRIDE = 12
TITLE  = "evomaxx  |  LMB paint  RMB erase  SPC extinction  ESC quit"

def score(raw):
    a = np.frombuffer(raw, dtype=np.float32).reshape(H,W,4)[::STRIDE,::STRIDE,:3]
    g = np.mean(np.abs(a[1:]-a[:-1]), axis=(0,1))
    b = float(a.mean())
    if b < 0.005 or b > 0.995: return -10.0
    if np.std(a) < 0.03:       return -5.0
    return (np.mean(1.0 - np.abs(g - 0.20)) * 8.0
          + np.std(a.mean(axis=(0,1))) * 6.0
          + (1.0 - abs(b - 0.35) * 2.0) * 2.0
          + np.mean([np.std(a[:,:,c]) for c in range(3)]) * 4.0)

def main():
    pygame.init()
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MAJOR_VERSION, 4)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MINOR_VERSION, 3)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_PROFILE_MASK,
                                    pygame.GL_CONTEXT_PROFILE_CORE)
    pygame.display.set_mode((W,H), pygame.OPENGL|pygame.DOUBLEBUF)
    pygame.display.set_caption(TITLE)
    ctx = moderngl.create_context()

    ta = ctx.texture((W,H), 4, dtype="f4")
    tb = ctx.texture((W,H), 4, dtype="f4")
    ta.write(np.random.rand(H,W,4).astype("f4").tobytes())

    dp = ctx.program(
        vertex_shader=  "#version 330\nin vec2 p,uv;out vec2 v;void main(){gl_Position=vec4(p,0,1);v=uv;}",
        fragment_shader="#version 330\nuniform sampler2D t;in vec2 v;out vec4 c;void main(){c=vec4(pow(clamp(texture(t,v).rgb,0,1),vec3(0.75)),1);}")
    q   = np.array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1],dtype="f4")
    vao = ctx.vertex_array(dp, [(ctx.buffer(q),"2f 2f","p","uv")])

    pool  = [Organism(ctx) for _ in range(POP)]
    cur   = pool[0]
    frame = 0
    t_gl  = 0.0
    clock = pygame.time.Clock()

    def paint(tx, mx, my, val, radius=40):
        r  = radius
        x0, y0 = max(0, mx-r), max(0, H-my-r)
        x1, y1 = min(W, mx+r), min(H, H-my+r)
        pw, ph = x1-x0, y1-y0
        if pw <= 0 or ph <= 0: return
        tx.write(np.full((ph,pw,4), val, dtype="f4").tobytes(),
                 viewport=(x0,y0,pw,ph))

    def extinction():
        nonlocal pool, cur
        best = max(pool, key=lambda o: o.fit)
        pool = [Organism(ctx) for _ in range(POP-1)] + [copy.deepcopy(best)]
        cur  = pool[0]
        ta.write(np.random.rand(H,W,4).astype("f4").tobytes())

    while True:
        dt     = clock.tick(60) / 1000.0
        t_gl  += dt
        frame += 1
        mb     = pygame.mouse.get_pressed()
        mx, my = pygame.mouse.get_pos()

        for ev in pygame.event.get():
            if ev.type == pygame.QUIT: return
            if ev.type == pygame.KEYDOWN:
                if ev.key == pygame.K_ESCAPE: return
                if ev.key == pygame.K_SPACE:  extinction()

        if mb[0]: paint(ta, mx, my, 1.0)
        if mb[2]: paint(ta, mx, my, 0.0)

        if frame % 90 == 0:
            child = copy.deepcopy(cur); child.mutate(); child._compile(ctx)
            if child.valid:
                pool.append(child)
                if len(pool) > POP: pool.remove(min(pool, key=lambda o: o.fit))
                cur = child

        if frame % 270 == 0 or max(o.fit for o in pool) < 0.5:
            v = sorted([o for o in pool if o.valid], key=lambda o: o.fit, reverse=True)
            if len(v) >= 2:
                child = v[0].crossover(v[1]); child._compile(ctx)
                if child.valid:
                    pool.append(child)
                    if len(pool) > POP: pool.remove(min(pool, key=lambda o: o.fit))
                    cur = child

        if frame % 60 == 0:
            cur.fit = cur.fit * 0.7 + score(tb.read()) * 0.3

        ta.bind_to_image(0, read=True,  write=False)
        tb.bind_to_image(1, read=False, write=True)
        if cur.shader:
            try:
                cur.shader["R"].value      = (float(W), float(H))
                cur.shader["u_time"].value = t_gl
            except: pass
            cur.shader.run(W//16+1, H//16+1)

        ctx.screen.use(); ctx.clear()
        tb.use(0); dp["t"].value = 0
        vao.render(moderngl.TRIANGLE_STRIP)
        pygame.display.flip()
        ta, tb = tb, ta

if __name__ == "__main__":
    main()
