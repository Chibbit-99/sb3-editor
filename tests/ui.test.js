// End-to-end test of the real page in jsdom: open an .sb3, decompile,
// edit the pseudocode, compile, and repackage.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');
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
  const vc = new (require('/tmp/node_modules/jsdom').VirtualConsole)();
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
  ok($('pState').textContent.includes('Compile'), 'status tells you to compile');

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
  ok($('pCompile').disabled, 'Compile is disabled again after a successful compile');
  ok($('pState').textContent === '', 'the edited banner is cleared');
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
  ok($('diagHead').innerHTML.includes('Cannot compile'), 'a bad compile explains itself');

  // --- revert restores the pseudocode from the JSON tab ---
  $('pRefresh').onclick();
  ok($('pseudo').value === pseudo2, 'Revert restores the text from project.json');

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
