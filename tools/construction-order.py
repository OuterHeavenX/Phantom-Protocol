"""Construction-order sweep.

Walks each class constructor statement by statement. A field is "defined" once
the constructor has assigned it, or once the constructor has called something
that assigns it. Reading a field that is not defined yet, but IS assigned later
in the same constructor, is a construction-order bug: the read sees undefined
and the value it should have had arrives too late.

The reads that matter are not all in the same class. A constructor that hands
`this` to `new Mission(this)` runs Mission's constructor immediately, and
anything Mission calls back on the engine runs before the engine has finished
building itself. So the walk follows `this` across object boundaries: into the
constructors it is passed to, through the alias those stash it under
(`this.engine=engine`), and back out through every method they call on it.

Not reported, deliberately:
  * reads the author already guarded with `||`, `??` or `?.`
  * calls written inside a callback, which do not run during construction
  * fields the constructor initialises to a placeholder up front and fills in
    later. Those read as null rather than undefined, which is a different bug
    and a much noisier signal — most placeholders are legitimate.

Validated against the real thing: run it on 859b8ad^ and it reproduces the op6
PROVING GROUND crash, naming Engine.spawnBoss reading .codec with the whole
chain from Engine.constructor through new Mission(this) to setupDuel.

    python3 tools/construction-order.py src data
"""
import re,os,sys

ROOT=sys.argv[1] if len(sys.argv)>1 else 'src'
ROOTS=sys.argv[1:] or ['src']

def strip_noncode(src):
    out=list(src); i=0; n=len(src)
    while i<n:
        c=src[i]
        if c=='/' and i+1<n and src[i+1]=='/':
            while i<n and src[i]!='\n': out[i]=' '; i+=1
        elif c=='/' and i+1<n and src[i+1]=='*':
            while i<n and not (src[i]=='*' and i+1<n and src[i+1]=='/'):
                if src[i]!='\n': out[i]=' '
                i+=1
            if i<n-1: out[i]=' '; out[i+1]=' '; i+=2
        elif c in '"\'':
            q=c; out[i]=' '; i+=1
            while i<n and src[i]!=q:
                if src[i]=='\\':
                    if src[i]!='\n': out[i]=' '
                    i+=1
                if i<n and src[i]!='\n': out[i]=' '
                i+=1
            if i<n: out[i]=' '; i+=1
        elif c=='`':
            out[i]=' '; i+=1
            while i<n:
                if src[i]=='\\':
                    if src[i]!='\n': out[i]=' '
                    i+=1
                    if i<n and src[i]!='\n': out[i]=' '
                    i+=1; continue
                if src[i]=='$' and i+1<n and src[i+1]=='{':
                    out[i]=' '; i+=2; d=1
                    while i<n and d>0:
                        if src[i]=='{': d+=1
                        elif src[i]=='}': d-=1
                        i+=1
                    continue
                if src[i]=='`': out[i]=' '; i+=1; break
                if src[i]!='\n': out[i]=' '
                i+=1
        else: i+=1
    return ''.join(out)

def match_brace(s,i):
    d=0
    while i<len(s):
        if s[i]=='{': d+=1
        elif s[i]=='}':
            d-=1
            if d==0: return i
        i+=1
    return -1

def match_paren(s,i):
    d=0
    while i<len(s):
        if s[i]=='(': d+=1
        elif s[i]==')':
            d-=1
            if d==0: return i
        i+=1
    return -1

CLASS_RE=re.compile(r'\bclass\s+(\w+)[^{]*\{')
METH_RE=re.compile(r'(?:^|\n)\s*(?:static\s+)?(get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{')
KEYWORDS={'if','for','while','switch','catch','return','function','do','else','typeof','new'}

CLASSES={}   # name -> dict(file, methods{name:(offset,src,params)}, lines)
for root in ROOTS:
    for base,_,names in os.walk(root):
        if 'node_modules' in base or '/.git' in base: continue
        for n in sorted(names):
            if not n.endswith('.js'): continue
            path=os.path.join(base,n)
            raw=open(path).read()
            code=strip_noncode(raw)
            for cm in CLASS_RE.finditer(code):
                cname=cm.group(1)
                cstart=code.index('{',cm.start()); cend=match_brace(code,cstart)
                if cend<0: continue
                body=code[cstart+1:cend]; base_off=cstart+1
                methods={}
                for mm in METH_RE.finditer(body):
                    name=mm.group(2)
                    if name in KEYWORDS: continue
                    mstart=body.index('{',mm.end()-1) if body[mm.end()-1]!='{' else mm.end()-1
                    mend=match_brace(body,mstart)
                    if mend<0: continue
                    params=[p.strip().split('=')[0].strip() for p in mm.group(3).split(',') if p.strip()]
                    methods[name]=(base_off+mstart+1,body[mstart+1:mend],params)
                CLASSES[cname]=dict(file=path,raw=raw,methods=methods)

def line_of(raw,off): return raw.count('\n',0,off)+1

def guarded(src,end):
    """An early read the author already handled: `this.x||fallback`,
    `this.x??fallback`, `this.x?.y`. Reading a field before it exists is only a
    bug when nothing is standing by to catch it."""
    return bool(re.match(r'\s*(?:\|\||\?\?|\?\.)',src[end:end+3]))

_deferred_cache={}

def deferred(src,pos):
    """True when this position sits inside a nested function body, and so does
    not run during construction.

    The first version of this looked back only as far as the nearest statement
    separator, which meant a call inside a block inside an arrow — the shape of
    every `addEventListener('x',e=>{ ... })` in the project — read as running
    immediately and produced a run of false positives."""
    spans=_deferred_cache.get(id(src))
    if spans is None:
        spans=[]
        depth=0
        pending=[]        # depths at which a nested function body is expected
        open_bodies=[]    # (depth, start) for bodies currently open
        i=0
        n=len(src)
        while i<n:
            c=src[i]
            if c=='=' and i+1<n and src[i+1]=='>':
                pending.append(depth); i+=2; continue
            if src.startswith('function',i) and (i==0 or not (src[i-1].isalnum() or src[i-1] in '_$')):
                pending.append(depth); i+=8; continue
            if c=='{':
                if pending and pending[-1]==depth:
                    pending.pop()
                    open_bodies.append((depth,i))
                depth+=1
            elif c=='}':
                depth-=1
                if open_bodies and open_bodies[-1][0]==depth:
                    _,start=open_bodies.pop()
                    spans.append((start,i))
            elif c==';' or c==',':
                # A concise arrow body ends at the next separator at its depth.
                if pending and pending[-1]==depth:
                    pending.pop()
            i+=1
        _deferred_cache[id(src)]=spans
    for a,b in spans:
        if a<pos<b:return True
    # A concise arrow body: `x=>this.foo()` with no braces at all.
    cut=max(src.rfind(';',0,pos),src.rfind('{',0,pos),src.rfind('}',0,pos),src.rfind(',',0,pos))
    span=src[cut:pos]
    return '=>' in span or re.search(r'\bfunction\b',span)

findings=[]

def assigns_of(cls,name,seen=None):
    seen=seen or set()
    key=(cls,name)
    if key in seen: return set()
    seen.add(key)
    info=CLASSES.get(cls)
    if not info or name not in info['methods']: return set()
    off,src,_=info['methods'][name]
    got={m.group(1) for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|/=|\|\|=|\?\?=)',src)}
    for c in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*\(',src):
        got|=assigns_of(cls,c.group(1),seen)
    return got

def alias_set(src,seed):
    """Every expression in `src` that ends up pointing at the object under
    construction. A class handed the engine almost always stashes it as
    `this.engine`, and the interesting calls go through that, not the
    parameter."""
    aliases=set(seed)
    for _ in range(4):
        grew=False
        for a in list(aliases):
            for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*=\s*'+re.escape(a)+r'\s*[;,)\n]',src):
                nxt='this.'+m.group(1)
                if nxt not in aliases: aliases.add(nxt); grew=True
        if not grew: break
    return aliases

def walk(cls,method,aliases,defined,later,chain,seen,owner_cls):
    """Walk `cls.method`, where `aliases` are the expressions inside it that
    denote the object still under construction. Reports every read of a field
    that object has not assigned yet but will."""
    key=(cls,method,frozenset(aliases))
    if key in seen or len(chain)>8: return
    seen=seen|{key}
    info=CLASSES.get(cls)
    if not info or method not in info['methods']: return
    off,src,params=info['methods'][method]
    aliases=alias_set(src,aliases)
    local=set()
    alt='|'.join(sorted((re.escape(a) for a in aliases),key=len,reverse=True))
    for m in re.finditer(r'(?<![\w$.])(?:'+alt+r')\.([A-Za-z_$][\w$]*)',src):
        fld=m.group(1); pos=m.end()
        tail=src[pos:pos+3]
        if re.match(r'\s*(?:=(?!=)|\+=|-=|\*=|/=|\|\|=|\?\?=)',tail):
            local.add(fld); continue
        is_call=bool(re.match(r'\s*\(',tail))
        if is_call and deferred(src,m.start()): continue
        if fld in defined or fld in local: continue
        if fld in later:
            if guarded(src,pos): continue
            findings.append(dict(file=info['file'],line=line_of(info['raw'],off+m.start()),
                cls=cls,method=method,field=fld,chain=' -> '.join(chain)))
            continue
        if is_call:
            # `defined|local`, not `defined`: a field this method assigned a few
            # lines up is available to whatever it calls next, and passing only
            # the constructor's set made every such call look like a bug.
            walk(owner_cls,fld,{'this'},defined|local,later,
                 chain+[f'{cls}.{method} -> .{fld}()'],seen,owner_cls)
    # Calls to this class's own methods carry the alias along.
    if 'this' not in aliases:
        for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*\(',src):
            if deferred(src,m.start()): continue
            if m.group(1) in info['methods']:
                walk(cls,m.group(1),aliases,defined|local,later,
                     chain+[f'{cls}.{method} -> this.{m.group(1)}()'],seen,owner_cls)
    # Objects handed the alias build immediately and can call straight back.
    for nm in re.finditer(r'\bnew\s+([A-Z]\w*)\s*\(',src):
        if deferred(src,nm.start()): continue
        popen=src.index('(',nm.end()-1); pclose=match_paren(src,popen)
        if pclose<0: continue
        args=[a.strip() for a in re.split(r',(?![^(\[{]*[)\]}])',src[popen+1:pclose])]
        target=CLASSES.get(nm.group(1))
        if not target or 'constructor' not in target['methods']: continue
        tparams=target['methods']['constructor'][2]
        for i,a in enumerate(args):
            if a not in aliases or i>=len(tparams): continue
            walk(nm.group(1),'constructor',{tparams[i]},defined,later,
                 chain+[f'{cls}.{method} -> new {nm.group(1)}({a})'],seen,owner_cls)

for cname,info in sorted(CLASSES.items()):
    if 'constructor' not in info['methods']: continue
    coff,csrc,_=info['methods']['constructor']
    all_assigned={m.group(1) for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|/=|\|\|=|\?\?=)',csrc)}
    # Setup methods the constructor calls assign plenty of fields too, and a
    # read that lands before one of those calls is exactly the same bug.
    for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*\(',csrc):
        if deferred(csrc,m.start()): continue
        if m.group(1) in info['methods']: all_assigned|=assigns_of(cname,m.group(1))
    defined=set()
    for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)',csrc):
        fld=m.group(1); start=m.start(); end=m.end()
        tail=csrc[end:end+3]
        if re.match(r'\s*(?:=(?!=)|\+=|-=|\*=|/=|\|\|=|\?\?=)',tail):
            defined.add(fld); continue
        is_call=bool(re.match(r'\s*\(',tail))
        if is_call and deferred(csrc,start): continue
        later=all_assigned-defined
        if is_call and fld in info['methods']:
            walk(cname,fld,{'this'},set(defined),later,[f'{cname}.constructor -> this.{fld}()'],set(),cname)
            defined|=assigns_of(cname,fld)
            continue
        if fld not in defined and fld in all_assigned and not guarded(csrc,end):
            findings.append(dict(file=info['file'],line=line_of(info['raw'],coff+start),
                cls=cname,method='constructor',field=fld,chain='direct read'))
    # Sub-objects constructed with `this`.
    for nm in re.finditer(r'\bnew\s+([A-Z]\w*)\s*\(',csrc):
        if deferred(csrc,nm.start()): continue
        popen=csrc.index('(',nm.end()-1); pclose=match_paren(csrc,popen)
        if pclose<0: continue
        args=[a.strip() for a in re.split(r',(?![^(\[{]*[)\]}])',csrc[popen+1:pclose])]
        target=CLASSES.get(nm.group(1))
        if not target or 'constructor' not in target['methods']: continue
        tparams=target['methods']['constructor'][2]
        # Everything the constructor has assigned above this point.
        head=csrc[:nm.start()]
        upto={m2.group(1) for m2 in re.finditer(
            r'this\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|/=|\|\|=|\?\?=)',head)}
        for m2 in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*\(',head):
            if deferred(head,m2.start()): continue
            if m2.group(1) in info['methods']: upto|=assigns_of(cname,m2.group(1))
        for i,a in enumerate(args):
            if a!='this' or i>=len(tparams): continue
            walk(nm.group(1),'constructor',{tparams[i]},upto,all_assigned-upto,
                 [f'{cname}.constructor -> new {nm.group(1)}(this)'],set(),cname)

seen=set(); uniq=[]
for f in findings:
    k=(f['file'],f['cls'],f['method'],f['field'])
    if k in seen: continue
    seen.add(k); uniq.append(f)
uniq.sort(key=lambda f:(f['file'],f['line']))
for f in uniq:
    print(f"{f['file']}:{f['line']}  {f['cls']}.{f['method']} reads .{f['field']} before it is set")
    print(f"    via {f['chain']}")
print(f"\n{len(uniq)} finding(s), {len(CLASSES)} classes scanned")
