import random, copy
import numpy as np

class P:
    __slots__ = ("d","s","b")
    def __init__(self):
        self.d = random.uniform(0.01, 0.10)  # decay — small, multiplicative
        self.s = random.uniform(0.05, 0.25)  # speed
        self.b = random.uniform(0.00, 0.02)  # small positive bias
    def mutate(self):
        self.d = float(np.clip(self.d + random.uniform(-0.01, 0.01), 0.001, 0.20))
        self.s = float(np.clip(self.s + random.uniform(-0.02, 0.02), 0.01,  0.40))
        self.b = float(np.clip(self.b + random.uniform(-0.005,0.005),0.0,   0.05))

class R:
    __slots__ = ("src","dst","mu","sig","rho","k")
    def __init__(self):
        self.src = random.randint(0,2)
        self.dst = random.randint(0,2)
        self.rho = random.uniform(-1.0, 1.0)
        self.mu  = random.uniform(0.10, 0.45)
        self.sig = random.uniform(0.01, 0.12)
        self.k   = random.randint(0,2)
    def mutate(self):
        r = random.random()
        if   r < .25: self.mu  = float(np.clip(self.mu  + random.uniform(-.05,.05), .01,.60))
        elif r < .50: self.sig = float(np.clip(self.sig + random.uniform(-.01,.01), .005,.15))
        elif r < .75: self.rho = float(np.clip(self.rho + random.uniform(-.2,.2), -1.,1.))
        else:         self.k   = random.randint(0,2)

class Organism:
    N = 8
    def __init__(self, ctx, genes=None, phys=None):
        self.p      = phys  or P()
        self.g      = genes or [R() for _ in range(self.N)]
        self.shader = None
        self.valid  = False
        self.fit    = 0.0
        if ctx: self._compile(ctx)

    def __getstate__(self):
        d=self.__dict__.copy(); d["shader"]=None; return d
    def __setstate__(self,d): self.__dict__.update(d)

    def mutate(self):
        if random.random() < .20: self.p.mutate()
        random.choice(self.g).mutate()
        if random.random() < .15: random.choice(self.g).mutate()

    def crossover(self, o):
        p = copy.deepcopy(self.p if self.fit >= o.fit else o.p)
        g = [copy.deepcopy(random.choice([a,b])) for a,b in zip(self.g, o.g)]
        return Organism(None, g, p)

    def _compile(self, ctx):
        rules = "".join(
            f"    res[{g.dst}]+={g.rho:.5f}*exp(-pow((k{g.k}[{g.src}]-{g.mu:.5f})/{g.sig:.5f},2.0));\n"
            for g in self.g)
        src = f"""
#version 430
layout(local_size_x=16,local_size_y=16) in;
layout(rgba32f,binding=0) readonly  uniform image2D A;
layout(rgba32f,binding=1) writeonly uniform image2D B;
uniform vec2  R;
uniform float u_time;
ivec2 w(ivec2 t,ivec2 s){{return((t%s)+s)%s;}}
void main(){{
    ivec2 t=ivec2(gl_GlobalInvocationID.xy),s=ivec2(R);
    vec3 c=imageLoad(A,t).rgb;

    vec3 k0=vec3(0),k1=vec3(0),k2=vec3(0);
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++) k0+=imageLoad(A,w(t+ivec2(x,y),s)).rgb;
    k0/=9.0;
    for(int x=-3;x<=3;x++)for(int y=-3;y<=3;y++) k1+=imageLoad(A,w(t+ivec2(x,y),s)).rgb;
    k1/=49.0;
    for(int x=-6;x<=6;x+=2)for(int y=-6;y<=6;y+=2) k2+=imageLoad(A,w(t+ivec2(x,y),s)).rgb;
    k2/=49.0;

    vec3 res=vec3({self.p.b:.5f});
{rules}
    // proper RD update: multiplicative decay + additive GRN input
    // field can never drain to zero from decay alone
    vec3 next = c*(1.0-{self.p.d:.5f}) + {self.p.s:.5f}*res;
    imageStore(B,t,vec4(clamp(next,0.0,1.0),1.0));
}}"""
        try:
            self.shader = ctx.compute_shader(src)
            self.valid  = True
        except:
            self.valid  = False
