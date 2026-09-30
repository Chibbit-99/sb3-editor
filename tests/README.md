# Tests

Pure Node, no build step. Run from the repository root:

```
node tests/compiler.test.js   # 51 compiler unit tests + a full round trip
node tests/roundtrip.js       # decompile -> compile -> decompile diff of example.json
node tests/ui.test.js         # 98 tests driving the real page in jsdom
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

## What ui.test.js checks

It builds a real `.sb3` in memory and drives the shipped page:

* open a file, decompile, edit, apply, repackage, and read the packed
  `project.json` back out of the archive;
* a broken edit leaves `project.json` byte-for-byte untouched;
* **editing a single target** — switch to one sprite, edit it, apply, and check
  that the other five targets, the monitors and the assets are unchanged;
* **the autocomplete popup** — the suggestions it offers, accepting one with the
  keyboard, the cases where it must stay shut (comments, strings, `{placeholder}`
  slots, variable names) and the arithmetic that anchors it to the caret.

jsdom has no layout engine, so the popup's position is checked by giving the
textarea and the caret marker known sizes rather than by looking at pixels.

## Compiling one target on its own

`SB3Compiler.compile(text, { context: projectJson })` rebuilds a single target
and returns `{ json: target, targetName, diagnostics, fatal }` — just the target
object, not a whole project. The rest of the project is read-only context: its
stage globals, lists and broadcasts stay resolvable, so a sprite can use
`$speed` or `@items` without inventing new ids, but nothing outside the target is
rebuilt. The caller splices the result into a copy of `project.json`.

Without `context`, a document with no stage is still an error. With it, the
document is allowed to be a lone sprite — the stage is simply not part of it.
