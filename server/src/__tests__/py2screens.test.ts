import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PY2_COMPAT } from '../pipeline/py2compat.js'

// Python 2.7 (Ren'Py 7.8.7's) pickled the syntax tree of this code, as Ren'Py 6 stored the Python
// of old-style screens in .rpyc files:
//
//   items = [1, 2, 3]; first = items[0]; pair = items[0:2]; grid = {}; grid[1, 2] = 5
//   def f(a, b=2): return a + b
//   def g(*args, **kwargs): return len(args) + len(kwargs)
//   try: raise ValueError, "bad"
//   except ValueError, e: message = str(e)
//   try: x = 1
//   finally: done = True
//   exec "y = 2"
//   print >>out, "printed", first,
const OLD_TREE = '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'

// renpy-compat-pickle.py is Ren'Py 8.5.3's renpy/compat/pickle.py, the loader of .rpyc files.
it('loads and runs the Python 2 syntax trees of old-style screens', () => {
  const block = PY2_COMPAT.split('\n').slice(PY2_COMPAT.split('\n').indexOf('python early:') + 1)
  const body = block.map((line) => line.replace(/^ {4}/, '')).join('\n')
  const script = String.raw`
import ast, base64, io, sys, types
sys.modules["renpy"] = types.ModuleType("renpy")
compat_pickle = types.ModuleType("renpy.compat.pickle")
exec(open(sys.argv[1]).read(), compat_pickle.__dict__)
python = types.ModuleType("renpy.python")
python.wrap_node = ast.NodeTransformer()
def py_compile(source, mode, filename="<none>", lineno=1, ast_node=False, cache=True, py=None, hashcode=None, column=0):
    if isinstance(source, ast.Module):
        return compile(source, filename, mode)
    return compile(python.wrap_node.visit(ast.parse(str(source))), filename, mode)
python.py_compile = py_compile
store = types.ModuleType("store")
sys.modules["store"] = store
# In game code renpy is renpy.exports; the engine's modules are only in sys.modules.
sys.modules.update({"renpy.python": python, "renpy.compat.pickle": compat_pickle})
renpy = types.SimpleNamespace(store=store)
` + `\nexec(${JSON.stringify(body)}, {"renpy": renpy})\n` + String.raw`
tree = compat_pickle.loads(base64.b64decode(sys.argv[2]))
out = io.StringIO()
scope = {"out": out}
exec(python.py_compile(tree, "exec", "game/screens.rpy", py=2), scope)
print(scope["first"], scope["pair"], scope["grid"], scope["f"](1), scope["g"](1, k=2), scope["message"], scope["done"], scope["y"], repr(out.getvalue()))
`
  const out = execFileSync('python3', ['-I', '-c', script, join(import.meta.dirname, 'renpy-compat-pickle.py'), OLD_TREE], { encoding: 'utf8' }).trim()
  expect(out).toBe("1 [1, 2] {(1, 2): 5} 3 2 bad True 2 'printed 1 '")
})
