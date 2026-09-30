# Tests

Pure Node, no build step. Run from the repository root:

```
node tests/compiler.test.js   # compiler unit tests + a full round trip
node tests/roundtrip.js       # decompile -> compile -> decompile diff of example.json
node tests/ui.test.js         # the real page driven in jsdom (open -> edit -> compile -> repackage)
```

`compiler.test.js` and `roundtrip.js` have no dependencies — they lift the
`//<decompiler>` and `//<compiler>` blocks straight out of `sb3-editor.html`, so
they always test the code that actually ships.

`ui.test.js` needs jsdom, which is not vendored here:

```
npm install jsdom --no-save
```

## What roundtrip.js checks

It decompiles `example.json`, compiles the result, and compares the two projects
with a fingerprint that ignores generated block ids and the encoding choices the
pseudocode cannot represent (the shadow hidden behind a reporter, and the exact
numeric primitive subtype). The expected result is:

```
original blocks : 521
recompiled      : 521
only in original: 4
only in recompiled: 4
```

Those four are inherent to the format, not bugs:

* `example.json` contains a `procedures_call` with an input that references a
  block which does not exist, so it cannot be written as text.
* An `operator_not` with no operand at all becomes an empty one.
* A `%b` custom-block argument with an empty slot gains one.

`compiler.test.js` also asserts that the pseudocode is a **fixed point**: feeding
the output of a compile back through the decompiler reproduces the same text.
