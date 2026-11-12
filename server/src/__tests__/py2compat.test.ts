import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PY2_COMPAT } from '../pipeline/py2compat.js'

// Runs Renplay's `python early` block the way the engine does: Ren'Py's py_compile parses the
// code, hands the tree to renpy.python.wrap_node and compiles it, and PyExpr carries the
// Python version the code was written for (2 when it comes from an old game's .rpyc).
function run(program: string): string {
  const block = PY2_COMPAT.split('\n').slice(PY2_COMPAT.split('\n').indexOf('python early:') + 1)
  const body = block.map((line) => line.replace(/^ {4}/, '')).join('\n')
  const script = String.raw`
import ast, sys, types

class PyExpr(str):
    def __new__(cls, s, filename="game/script.rpy", linenumber=1, py=2):
        rv = str.__new__(cls, s)
        rv.filename, rv.linenumber, rv.py = filename, linenumber, py
        return rv

python = types.ModuleType("renpy.python")
python.wrap_node = ast.NodeTransformer()

def py_compile(source, mode, filename="<none>", lineno=1, ast_node=False, cache=True, py=None, hashcode=None, column=0):
    if isinstance(source, PyExpr):
        filename = source.filename
    tree = compile(str(source), filename, "exec" if mode == "hide" else mode, ast.PyCF_ONLY_AST)
    tree = python.wrap_node.visit(tree)
    if ast_node:
        return tree.body
    return compile(tree, filename, "exec" if mode == "hide" else mode)

python.py_compile = py_compile
pyanalysis = types.ModuleType("renpy.pyanalysis")
pyanalysis.py_compile = py_compile
import importlib.abc
class RenpyImporter(importlib.abc.MetaPathFinder, importlib.abc.InspectLoader):
    def get_source(self, fullname):
        return None
importer = types.ModuleType("renpy.importer")
importer.RenpyImporter = RenpyImporter
store = types.ModuleType("store")
sys.modules["store"] = store
# In game code renpy is renpy.exports; the engine's modules are only in sys.modules.
sys.modules.update({"renpy.python": python, "renpy.pyanalysis": pyanalysis, "renpy.importer": importer})
renpy = types.SimpleNamespace(store=store)
`
    + `\nexec(${JSON.stringify(body)}, {"renpy": renpy})\n`
    + String.raw`
def run(code, py=2):
    exec(python.py_compile(PyExpr(code, py=py), "exec"), store.__dict__)
` + program
  return execFileSync('python3', ['-I', '-c', script], { encoding: 'utf8' }).trim()
}

describe('Python 2 compatibility script', () => {
  it('runs Python 2 code from old games the way Python 2 did', () => {
    const out = run(String.raw`
run('''
class Card(object):
    def __init__(self, n):
        self.n = n
    def __cmp__(self, other):
        return cmp(self.n, other.n)
    def __nonzero__(self):
        return self.n != 0
    def __div__(self, k):
        return Card(self.n / k)

class Counter(object):
    def __init__(self):
        self.i = 0
    def __iter__(self):
        return self
    def next(self):
        self.i += 1
        if self.i > 3:
            raise StopIteration
        return self.i

import string, sys, itertools, cPickle
d = {"b": 2, "a": 1}
x = 9
x /= 2
checks = [
    ("long", long(5) == 5),
    ("unichr", unichr(65) == u"A"),
    ("reduce", reduce(lambda a, b: a + b, [1, 2, 3]) == 6),
    ("cmp", cmp(1, 2) == -1),
    ("iteritems", sorted(d.iteritems()) == [("a", 1), ("b", 2)]),
    ("has_key", d.has_key("a")),
    ("keys_index", sorted(d.keys())[0] == "a" and d.keys()[0] in d),
    ("values_index", d.values()[0] in (1, 2)),
    ("items_index", d.items()[0][0] in d),
    ("keys_sort", (lambda k: (k.sort(), k)[1])(d.keys()) == ["a", "b"]),
    ("keys_plus", sorted(d.keys() + ["c"]) == ["a", "b", "c"]),
    ("delete_while_iterating", [d.pop(k) for k in d.keys()] and d == {}),
    ("map_index", map(str, [1, 2])[0] == "1"),
    ("filter_index", filter(None, [0, 5])[0] == 5),
    ("filter_text", filter(lambda c: c != "b", "abc") == "ac"),
    ("zip_index", zip([1], [2])[0] == (1, 2)),
    ("mixed_sorted", sorted([3, "a", 1]) == [1, 3, "a"]),
    ("mixed_sort", (lambda l: (l.sort(), l)[1])([2, "b", 1]) == [1, 2, "b"]),
    ("none_sort", sorted([2, None, 1]) == [None, 1, 2]),
    ("mixed_max", max([1, "a"]) == "a" and min(x for x in [1, "a"]) == 1),
    ("cmp_class_sort", [c.n for c in sorted([Card(3), Card(1)])] == [1, 3]),
    ("cmp_class_lt", Card(1) < Card(2) and Card(2) == Card(2) and len({Card(1)}) == 1),
    ("nonzero", not Card(0) and bool(Card(1))),
    ("div_class", (Card(6) / 2).n == 3),
    ("next_iter", list(Counter()) == [1, 2, 3]),
    ("next_method", iter([7]).next() == 7),
    ("sort_cmp", sorted([3, 1, 2], cmp=lambda a, b: b - a) == [3, 2, 1]),
    ("list_sort_cmp", (lambda l: (l.sort(cmp=lambda a, b: a - b), l)[1])([2, 1]) == [1, 2]),
    ("string", "a" in string.letters and string.join(["a", "b"], "-") == "a-b" and string.upper("a") == "A"),
    ("maxint", sys.maxint > 0),
    ("izip", list(itertools.izip([1], [2])) == [(1, 2)]),
    ("cpickle", cPickle.loads(cPickle.dumps(1)) == 1),
    ("decode", "abc".decode("utf-8") == u"abc"),
    ("int_div", 7 / 2 == 3 and 7.0 / 2 == 3.5 and -7 / 2 == -4 and x == 4),
    ("round", round(2.5) == 3.0 and isinstance(round(2), float)),
]
failed = [name for name, ok in checks if not ok]
print("failed: %s" % failed)
''')
`)
    expect(out).toBe('failed: []')
  })

  it('keeps true division when the code imports it from __future__', () => {
    expect(run(`run("from __future__ import division\\nprint(7 / 2)")`)).toBe('3.5')
  })

  it('leaves Python 3 code alone', () => {
    const out = run(String.raw`
run('''
class Card(object):
    def __cmp__(self, other):
        return 0
try:
    Card() < Card()
    ordered = "ordered"
except TypeError:
    ordered = "unordered"
print(7 / 2, type({}.keys()).__name__, type(map(str, [])).__name__, ordered, "long" in globals())
''', py=3)
`)
    expect(out).toBe('3.5 dict_keys map unordered False')
  })

  it('fixes Python 2 syntax and runs the code as Python 2', () => {
    const out = run(String.raw`
import io, sys
source = (
    "try:\n"
    "    raise ValueError, 'bad'\n"
    # Python 3.14 reads "except A, e" as a tuple again, the engine's 3.12 refuses it.
    + ("except ValueError, e:\n" if sys.version_info < (3, 14) else "except ValueError as e:\n") +
    "    message = str(e)\n"
    "import io\n"
    "buffer = io.StringIO()\n"
    "print >>buffer, 'to a file'\n"
    "print 'statement', 0777, 10L\n"
    "exec 'shown = 1 != 2'\n"
    "different = 1 <> 2\n"
    "if True:\n"
    "\tquoted = ` + "`" + String.raw`7 / 2` + "`" + String.raw`\n"
    "        quoted += ur'!'\n"
    "print message, buffer.getvalue().strip(), shown, different, quoted\n"
)
run(source)
`)
    expect(out).toBe('statement 511 10\nbad to a file True True 3!')
  })

  it('fixes a Python 2 game\'s own .py modules the same way', () => {
    const out = run(String.raw`
run("x = 1")  # Python 2 code from the game's scripts turns the fixes on.
module = types.ModuleType("helpers")
source = b"from __future__ import print_function\nimport string\nhalf = 7 / 2\nbig = long(2) ** 70\nkeys = {'a': 1}.keys()[0]\ndef show():\n    print 'half', half, big > sys.maxint, keys, string.letters[:3]\nimport sys\n"
exec(RenpyImporter().source_to_code(source, "game/helpers.py"), module.__dict__)
module.show()
`)
    expect(out).toBe('half 3 True a abc')
  })
})
