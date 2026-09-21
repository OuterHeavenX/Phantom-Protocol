#!/usr/bin/env python3
"""Headless `blender` shim over the bpy module.

This environment cannot reach download.blender.org, so Blender is installed as
the `bpy` wheel from PyPI: the full engine (Cycles, EEVEE, the whole Python
API) without the GUI executable. This shim covers the headless CLI surface:

    blender --version
    blender -b -P script.py [-- args...]
    blender -b file.blend -P script.py
    blender -b --python-expr "import bpy; ..."
    blender -b file.blend -o //out -f 1      (render one frame)

Anything needing a window is not available.
"""
import sys, os

def main(argv):
    if not argv or argv[0] in ('--version','-v'):
        import bpy
        print(f'Blender {bpy.app.version_string} (bpy module, headless shim)')
        return 0
    import bpy
    scripts, exprs, blend, out, frame = [], [], None, None, None
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('-b','--background','-noaudio','--factory-startup'):
            pass
        elif a in ('-P','--python'):
            i += 1; scripts.append(argv[i])
        elif a == '--python-expr':
            i += 1; exprs.append(argv[i])
        elif a in ('-o','--render-output'):
            i += 1; out = argv[i]
        elif a in ('-f','--render-frame'):
            i += 1; frame = int(argv[i])
        elif a == '--':
            rest = argv[i+1:]; break
        elif a.endswith('.blend') and blend is None:
            blend = a
        else:
            rest.append(a)
        i += 1
    if blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
    sys.argv = ['blender'] + (['--'] + rest if rest else [])
    for e in exprs:
        exec(e, {'__name__': '__main__', 'bpy': bpy})
    for s in scripts:
        with open(s) as f:
            code = compile(f.read(), s, 'exec')
        exec(code, {'__name__': '__main__', '__file__': os.path.abspath(s)})
    if frame is not None:
        sc = bpy.context.scene
        if out: sc.render.filepath = out
        sc.frame_set(frame)
        bpy.ops.render.render(write_still=True)
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
