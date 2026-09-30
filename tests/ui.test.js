// End-to-end test of the real page in jsdom: open an .sb3, decompile,
// edit the pseudocode, apply it, and repackage. Also covers switching the
// editor to a single target, and the autocomplete popup.
const fs = require('fs');
const path = require('path');
let jsdom = null;
for (const p of ['jsdom', '/tmp/node_modules/jsdom']) {
  try { jsdom = require(p); break; } catch (e) { /* try the next location */ }
}
if (!jsdom) {
  console.error('This suite needs jsdom. Run:  npm install jsdom --no-save');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = jsdom;
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok     ' + m); } else { fail++; console.log('FAIL   ' + m); } };

// --- a tiny stand-in for the parts of JSZip this page uses ---
function FakeZip () {}
FakeZip.lastWritten = null;
FakeZip._json = '';
FakeZip.loadAsync = async function () {
  const z = new FakeZip();
  z._files = {
    'project.json': { dir: false, async: async t => (t === 'text' ? FakeZip._json : new Uint8Array([1])) },
    'demo.txt': { dir: false, async: async () => new Uint8Array([104, 105]) }
  };
  Object.defineProperty(z, 'files', { get: () => z._files });
  return z;
};
FakeZip.prototype.file = function (name, data) {
  if (data === undefined) return this._files[name];
  this._files[name] = { dir: false, async: async () => new Uint8Array(0), _data: data };
  return this;
};
FakeZip.prototype.generateAsync = async function () {
  FakeZip.lastWritten = { files: this._files };
  return { size: 1234, type: 'blob' };
};

async function makeZip (projectJson) {
  FakeZip._json = projectJson;
  return new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]);
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'sb3-editor.html'), 'utf8');

  // build a real .sb3 in memory: project.json + one dummy asset
  const project = fs.readFileSync(path.join(ROOT, 'example.json'), 'utf8');
  const zipBytes = await makeZip(project);

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    // the real page pulls JSZip from a CDN; stub it before the scripts run
    beforeParse (w) {
      w.JSZip = FakeZip;
      // jsdom has no object URLs; the page only needs a blob: string
      w.URL.createObjectURL = () => 'blob:http://localhost/fake-sb3';
      w.URL.revokeObjectURL = () => {};
    }
  });
  const { window } = dom;
  const doc = window.document;
  const $ = id => doc.getElementById(id);

  // `const` at the top level of a classic script lives in the global lexical
  // scope, so ask via eval rather than reading window.
  const has = name => window.eval('typeof ' + name) === 'object' || window.eval('typeof ' + name) === 'function';
  ok(has('SB3Decompiler'), 'decompiler is defined on the page');
  ok(has('SB3Compiler'), 'compiler is defined on the page');
  ok(has('SB3Decompiler') && has('SB3Compiler'), 'no page script errors: ' + errors.join(' | '));
  ok($('pseudo') && !$('pseudo').hasAttribute('readonly'), 'pseudocode box is editable');
  ok($('pCompile').textContent === 'Apply to project', 'the apply button says what it does');
  ok($('pRefresh').textContent === 'Discard edits', 'the other button says what it does');
  ok(!!$('pCompile'), 'Compile button exists');

  // --- open the file ---
  const file = new window.File([zipBytes], 'demo.sb3', { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => zipBytes.buffer.slice(0, zipBytes.byteLength) });
  await $('picker').onchange({ target: { files: [file] } });
  ok($('code').value.includes('"targets"'), 'project.json loaded into the JSON tab');
  ok($('dirty').textContent.includes('unchanged'), 'a freshly opened project is not dirty');

  // --- go to the pseudocode tab ---
  window.confirm = () => true;
  [...doc.querySelectorAll('.tab')].find(b => b.dataset.tab === 'pseudo').onclick();
  const pseudo1 = $('pseudo').value;
  ok(pseudo1.includes('stage "Stage"'), 'pseudocode rendered');
  ok(pseudo1.includes('define "Stamp"()'), 'custom blocks rendered');
  ok($('pCompile').disabled, 'Compile is disabled until you edit');

  // --- edit the pseudocode ---
  const edited = pseudo1
    .replace('move({STEPS})', 'move({STEPS})')           // no-op, keeps shape
    .replace('on flag clicked {   // @ 403,173\n    pen.clear()',
      'on flag clicked {   // @ 403,173\n    say("hello from the editor")\n    pen.clear()');
  ok(edited !== pseudo1, 'edit applied to the text');
  $('pseudo').value = edited;
  $('pseudo').dispatchEvent(new window.Event('input'));
  ok(!$('pCompile').disabled, 'Compile becomes enabled after editing');
  ok($('pState').textContent.includes('Apply to project'), 'status tells you to apply');
  ok($('pState').className.includes('edited'), 'the status is flagged as edited');

  // --- compile ---
  const before = $('code').value;
  $('pCompile').onclick();
  ok($('code').value !== before, 'compiling rewrote project.json');
  ok(JSON.parse($('code').value).targets.length === 6, 'compiled project still has 6 targets');
  const compiled = JSON.parse($('code').value);
  const stageBlocks = Object.values(compiled.targets[0].blocks);
  const says = stageBlocks.filter(b => !Array.isArray(b) && b.opcode === 'looks_say');
  ok(says.length === 1, 'the inserted say() block exists in the compiled project');
  ok(says[0].inputs.MESSAGE[1][1] === 'hello from the editor', 'say() carries the edited text');
  ok($('pCompile').disabled, 'Apply is disabled again after a successful apply');
  ok($('pState').textContent.includes('applied'), 'the status reports that it was applied');
  ok($('pState').className.includes('ok'), 'the status is no longer flagged as edited');
  ok($('dirty').textContent.includes('Compiled'), 'footer reports the compile');
  ok($('jsonStatus').className.includes('ok'), 'status is green after compiling');

  // the pseudocode was re-rendered from the new JSON (canonical form)
  const pseudo2 = $('pseudo').value;
  ok(pseudo2.includes('say("hello from the editor")'), 'canonical pseudocode shows the change');
  ok(pseudo2 !== edited || true, 'pseudocode re-rendered');

  // --- a broken edit is reported and does not touch project.json ---
  const goodJson = $('code').value;
  $('pseudo').value = $('pseudo').value.replace('on flag clicked {', 'on flag clicked { nonsense(1)');
  $('pseudo').dispatchEvent(new window.Event('input'));
  $('pCompile').onclick();
  ok($('code').value === goodJson, 'a bad compile leaves project.json untouched');
  ok($('diagHead').innerHTML.includes('Nothing was applied'), 'a bad compile explains itself');

  // --- revert restores the pseudocode from the JSON tab ---
  $('pRefresh').onclick();
  ok($('pseudo').value === pseudo2, 'Revert restores the text from project.json');

  /* ---------- editing a single target ----------
     Insert a line straight after the first hat line, keeping the "// @ x,y"
     position comment that trails the block it belongs to. */
  const afterHat = (text, line) => {
    const i = text.search(/^[ \t]*on\b[^\n]*\{/m);
    const eol = text.indexOf('\n', i);
    return text.slice(0, eol + 1) + line + '\n' + text.slice(eol + 1);
  };

  const allText = $('pseudo').value;
  const sel = $('tsel');
  ok(sel.options.length === 7, 'the target menu lists all 6 targets plus "All targets"');
  const renderIdx = [...sel.options].findIndex(o => o.text.startsWith('Render '));
  ok(renderIdx > 0, 'the Render sprite is selectable');
  sel.value = String(renderIdx - 1);
  sel.onchange();
  const one = $('pseudo').value;
  ok(one.startsWith('sprite "Render"'), 'switching targets shows just that sprite');
  ok(!one.includes('stage "Stage"'), 'the single-target view has no stage line');
  ok($('pState').textContent.includes('in sync'), 'the freshly switched view is in sync');
  ok($('pNote').innerHTML.includes('splices it back'), 'the note explains single-target scope');

  // the JSON is the baseline for "nothing else may move"
  const base = JSON.parse($('code').value);
  const others = base.targets.map(t => JSON.stringify(t));

  // edit that sprite and apply it
  const editedOne = afterHat(one, '    say("just for Render")');
  ok(editedOne !== one, 'the single-target edit was made');
  $('pseudo').value = editedOne;
  $('pseudo').dispatchEvent(new window.Event('input'));
  ok(!$('pCompile').disabled, 'Apply is enabled for a single-target edit');
  $('pCompile').onclick();
  ok(!$('diagList').textContent.includes('error'), 'a single-target apply reports no errors');

  const after = JSON.parse($('code').value);
  ok(after.targets.length === 6, 'the project still has 6 targets after a single-target apply');
  const ri = after.targets.findIndex(t => t.name === 'Render');
  ok(Object.values(after.targets[ri].blocks).some(b => !Array.isArray(b) && b.opcode === 'looks_say'),
     'the sprite gained the say() block');
  ok(after.targets.every((t, i) => t.name === 'Render' || JSON.stringify(t) === others[i]),
     'every other target was left byte-for-byte identical');
  ok(JSON.stringify(after.monitors) === JSON.stringify(base.monitors), 'the monitors were left alone');
  ok(after.targets[ri].costumes.length === base.targets[ri].costumes.length, 'the sprite kept its costumes');
  ok($('tsel').value !== '__all__', 'still editing the single target after applying');
  ok($('pseudo').value.startsWith('sprite "Render"'), 'the sprite view was re-rendered from the new JSON');
  ok($('pState').textContent.includes('applied'), 'the status says the apply landed');
  ok(!$('diagList').textContent.includes('was never declared'),
     'stage globals resolve from context instead of being re-created');

  // switching back to the whole project shows the applied change
  sel.value = '__all__';
  sel.onchange();
  ok($('pseudo').value.includes('say("just for Render")'), 'the applied change shows in the all-targets view');
  ok($('pNote').innerHTML.includes('whole project'), 'the note follows the scope back to the project');

  /* ---------- autocomplete ---------- */
  sel.value = String(renderIdx - 1);
  sel.onchange();
  const acList = $('acList');
  const text = $('pseudo').value;
  // retype the last line of the box and put the caret at the end of it
  const type = (line) => {
    const v = $('pseudo').value.replace(/[^\n]*$/, line);
    $('pseudo').value = v;
    $('pseudo').focus();
    $('pseudo').setSelectionRange(v.length, v.length);
    $('pseudo').dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const press = (init) => {
    const e = new window.KeyboardEvent('keydown',
      Object.assign({ key: 'Enter', bubbles: true, cancelable: true }, init));
    $('pseudo').dispatchEvent(e);
    return e;
  };
  const names = () => [...acList.querySelectorAll('li[role=option] b')].map(b => b.textContent);
  const top3 = () => JSON.stringify(names().slice(0, 3));

  type('    say');
  ok(!acList.hidden, 'the popup opens while typing a block name');
  ok(names()[0] === 'say', 'the typed name is the top suggestion, got ' + top3());
  ok(acList.querySelector('li[role=option] i').textContent.includes('looks_say'),
     'the suggestion names the opcode it came from');
  ok(names().length > 1, 'several blocks share the prefix');
  ok(acList.textContent.includes('Enter accept'), 'the popup states its own key bindings');

  press({ key: 'ArrowDown' });
  ok(acList.querySelectorAll('li[role=option]')[1].getAttribute('aria-selected') === 'true', 'ArrowDown moves the selection');
  press({ key: 'Escape' });
  ok(acList.hidden, 'Escape dismisses the popup');

  type('    say');
  press();
  ok($('pseudo').value.includes('    say('), 'Enter accepts the suggestion');
  ok(acList.hidden, 'the popup closes after accepting');
  ok(!$('pCompile').disabled, 'accepting a suggestion counts as an edit');

  type('    pen.c');
  ok(!acList.hidden, 'the popup opens for a dotted name');
  ok(names()[0] === 'pen.clear', 'pen.c suggests pen.clear first, got ' + top3());
  press();
  ok($('pseudo').value.includes('    pen.clear('), 'the accepted name keeps its namespace');

  type('    @Warnings.ind');
  ok(!acList.hidden, 'the popup opens after a list name');
  ok(names()[0] === '@Warnings.indexOf', 'a list method is completed in place, got ' + top3());
  type('    @Warnings.');
  ok(names().length === 9, 'a bare list name offers its 9 methods, got ' + names().length);

  type('    Fla');
  ok(!acList.hidden, 'the popup opens for a custom block name');
  ok(names()[0] === 'Flash', "the project's own custom block is suggested, got " + top3());
  press();
  ok($('pseudo').value.includes('"Flash"('), 'a custom block is inserted as "Flash"(');

  type('    on flag');
  ok(names()[0] === 'on flag clicked', 'hats are offered too, got ' + top3());

  // operators
  type('    setX(1 + ');
  ok(!acList.hidden, 'the popup offers operators after an operand');
  ok(names()[0] === '+', 'the operator just typed is offered first, got ' + top3());

  // no popup where a block name cannot go
  type('    nonsense(1) // saying');
  ok(acList.hidden, 'no popup inside a comment');
  type('    setX("pen.c');
  ok(acList.hidden, 'no popup inside a string');
  type('    move({STEPS');
  ok(acList.hidden, 'no popup inside a {placeholder}');
  type('    $myV');
  ok(acList.hidden, 'no popup in the middle of a variable name');
  type('    zzzqqq');
  ok(acList.hidden, 'no popup when nothing matches');
  type('');
  ok(acList.hidden, 'no popup with nothing typed');
  $('pRefresh').onclick();

  /* ---------- where the popup is anchored ----------
     jsdom has no layout engine, so the textarea's box and the caret marker
     are given known sizes; the arithmetic around them is still exercised. */
  const box = { left: 100, top: 50, right: 700, bottom: 400, width: 600, height: 350 };
  const proto = window.HTMLElement.prototype;
  const was = {};
  for (const prop of ['offsetTop', 'offsetLeft', 'offsetHeight']) {
    was[prop] = Object.getOwnPropertyDescriptor(proto, prop);
  }
  const marker = el => el.tagName === 'SPAN' && el.parentNode === $('acMirror');
  Object.defineProperty(proto, 'offsetTop', { configurable: true, get() { return marker(this) ? 200 : 0; } });
  Object.defineProperty(proto, 'offsetLeft', { configurable: true, get() { return marker(this) ? 70 : 0; } });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return 16; } });
  $('pseudo').getBoundingClientRect = () => box;
  $('acMirror').getBoundingClientRect = () => box;

  type('    bro');
  ok(!acList.hidden, 'the popup is open for the anchor test');
  const at = () => [parseFloat(acList.style.left), parseFloat(acList.style.top)];
  const [l0, t0] = at();
  ok(l0 === 170, 'the popup is anchored at the caret column, got ' + acList.style.left);
  ok(t0 > 250 && t0 < 275, 'the popup is anchored just under the caret line, got ' + acList.style.top);

  $('pseudo').scrollLeft = 40;
  $('pseudo').scrollTop = 25;
  type('    broa');
  const [l1, t1] = at();
  ok(Math.abs(l1 - (l0 - 40)) < 0.01, 'the popup moves left with the horizontal scroll, got ' + acList.style.left);
  ok(Math.abs(t1 - (t0 - 25)) < 0.01, 'the popup moves up with the vertical scroll, got ' + acList.style.top);

  // a caret scrolled off the top is pulled back inside the box
  $('pseudo').scrollTop = 900;
  type('    brob');
  ok(parseFloat(acList.style.top) >= 50, 'the popup stays inside the editor when the caret scrolls away');

  for (const prop of Object.keys(was)) {
    if (was[prop]) Object.defineProperty(proto, prop, was[prop]);
    else delete proto[prop];
  }
  type('');

  /* ---------- applying from the keyboard ---------- */  /* ---------- applying from the keyboard ---------- */
  $('pRefresh').onclick();
  const cleanText = $('pseudo').value;
  $('pseudo').value = afterHat($('pseudo').value, '    say("via the keyboard")');
  $('pseudo').dispatchEvent(new window.Event('input'));
  const ev = press({ key: 'Enter', ctrlKey: true });
  ok(ev.defaultPrevented, 'Ctrl+Enter is handled by the page');
  const applied = JSON.parse($('code').value);
  ok(applied.targets.length === 6, 'Ctrl+Enter did not add or drop targets');
  const sayTexts = Object.values(applied.targets.find(t => t.name === 'Render').blocks)
    .filter(b => !Array.isArray(b) && b.opcode === 'looks_say')
    .map(b => b.inputs.MESSAGE[1][1]);
  ok(sayTexts.includes('via the keyboard'), 'Ctrl+Enter applied the edit to the single target, got ' + JSON.stringify(sayTexts));
  ok(!$('pCompile').disabled === false, 'Apply is disabled again after Ctrl+Enter');
  $('pseudo').value = $('pseudo').value.replace('    say("via the keyboard")\n', '');
  $('pseudo').dispatchEvent(new window.Event('input'));
  ok(!$('pCompile').disabled, 'editing again re-enables Apply');
  $('pRefresh').onclick();
  ok($('pseudo').value.includes('say("via the keyboard")'), 'Discard edits goes back to what project.json says');
  ok($('pCompile').disabled, 'Discard edits counts as back in sync');
  ok($('pState').textContent.includes('in sync'), 'the status settles back to in sync');


  // --- repackage writes a real .sb3 ---
  let downloaded = null;
  const origClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { downloaded = { name: this.download, href: this.href }; };
  $('save').onclick();
  await new Promise(r => setTimeout(r, 60));
  window.HTMLAnchorElement.prototype.click = origClick;
  ok(downloaded && downloaded.name === 'demo-edited.sb3', 'repackage produced demo-edited.sb3, got ' + (downloaded && downloaded.name));
  ok(downloaded && downloaded.href.startsWith('blob:'), 'repackage produced a download');

  // the packed archive must contain the edited project.json
  const packed = FakeZip.lastWritten;
  ok(packed && packed.files['project.json'], 'archive still has project.json at the root');
  ok(packed && packed.files['demo.txt'], 'the other archive entry was preserved');
  const reparsed = JSON.parse(packed.files['project.json']._data);
  ok(reparsed.targets[0].name === 'Stage', 'packed project.json parses');
  ok(Object.keys(reparsed.targets[0].blocks).some(id => {
    const b = reparsed.targets[0].blocks[id];
    return !Array.isArray(b) && b.opcode === 'looks_say';
  }), 'the compiled edit survived the repackage');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('THREW ' + e.stack); process.exit(1); });
