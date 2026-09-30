// Round-trip harness: decompile -> compile -> decompile, and structural diff.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sb3-editor.html'), 'utf8');

function load (extraMarker) {
  const blocks = [...html.matchAll(/\/\/<(decompiler|compiler)>\n([\s\S]*?)\n\/\/<\/\1>/g)]
    .map(m => m[2]);
  if (blocks.length < 2) throw new Error('need both decompiler and compiler blocks in sb3-editor.html, found ' + blocks.length);
  return new Function(blocks[0] + '\n' + blocks[1] + '\nreturn { SB3Decompiler, SB3Compiler };')();
}

const { SB3Decompiler, SB3Compiler } = load();
const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'example.json'), 'utf8'));

// --- structural fingerprint that ignores generated ids and ordering ---
function fingerprint (p) {
  const out = [];
  for (const t of p.targets) {
    const blocks = t.blocks || {};
    const ids = new Map();
    let n = 0;
    const key = id => { if (id === null || id === undefined) return 'null'; if (!ids.has(id)) ids.set(id, 'b' + (n++)); return ids.get(id); };
    const nameById = id => {
      const b = blocks[id];
      if (!b) return '?';
      if (Array.isArray(b)) return b[0] === 12 ? 'var:' + b[1] : b[0] === 13 ? 'list:' + b[1] : 'prim' + b[0];
      return b.opcode;
    };
    for (const id of Object.keys(blocks).sort()) {
      const b = blocks[id];
      if (Array.isArray(b)) { out.push(t.name + ' LOOSE ' + b[0] + ' ' + b[1]); continue; }
      // A value in an input slot may be written either as an inline
      // primitive (tag 1) or as a block that obscures a shadow (tag 3);
      // both mean the same to the VM. Numeric primitives 4..8 are all
      // just numbers to the VM too.
      const prim = i => {
        if (!Array.isArray(i)) return 'blk:' + nameById(i);
        const n = i[0];
        if (n >= 4 && n <= 8) return 'N(' + i[1] + ')';
        return 'P' + JSON.stringify(i.slice(0, 2));
      };
      // procedures_call keys its inputs by generated argument ids, so map
      // them back to positional names before sorting.
      const inNames = {};
      if (b.opcode === 'procedures_call' && b.mutation) {
        JSON.parse(b.mutation.argumentids || '[]').forEach((id, i) => { inNames[id] = 'arg' + i; });
      }
      const ins = Object.keys(b.inputs || {}).sort((a, c) => {
        const ka = inNames[a] || a, kc = inNames[c] || c;
        return ka < kc ? -1 : ka > kc ? 1 : 0;
      }).map(k => (inNames[k] || k) + '=' + prim(b.inputs[k][1])).join(' ');
      const fs2 = Object.keys(b.fields || {}).sort().map(k => {
        const f = b.fields[k];
        return k + '=' + (f[1] === null || f[1] === undefined ? 'null' : nameByVarId(f[1]));
      }).join(' ');
      // control_stop carries a hasnext mutation only for SB2 compatibility
      const mut = b.mutation ? (b.mutation.proccode !== undefined ? 'mut=' + b.mutation.proccode : '') : '';
      out.push([t.name, b.opcode, b.topLevel ? 'TOP' : '   ', ins, fs2, mut].filter(Boolean).join(' | '));
    }
    function nameByVarId (vid) {
      if (t.variables && t.variables[vid]) return 'var:' + t.variables[vid][0];
      if (t.lists && t.lists[vid]) return 'list:' + t.lists[vid][0];
      if (t.broadcasts && t.broadcasts[vid]) return 'bcast:' + t.broadcasts[vid];
      for (const o of p.targets) {
        if (o.variables && o.variables[vid]) return 'var:' + o.variables[vid][0];
        if (o.lists && o.lists[vid]) return 'list:' + o.lists[vid][0];
        if (o.broadcasts && o.broadcasts[vid]) return 'bcast:' + o.broadcasts[vid];
      }
      return 'id:' + vid;
    }
  }
  return out.sort();
}

const opts = { positions: true, ids: true, monitors: true, maxList: 0, legend: true };

const first = SB3Decompiler.decompile(project, opts);
const res = SB3Compiler.compile(first.text);

console.log('=== COMPILE DIAGNOSTICS (' + res.diagnostics.length + ') ===');
res.diagnostics.slice(0, 30).forEach(d => console.log('  ' + d.level + ' | ' + d.target + ' | ' + d.script + ' | ' + d.message));
if (res.fatal) { console.log('FATAL'); process.exit(1); }

const second = SB3Decompiler.decompile(res.json, opts);
fs.writeFileSync('/tmp/rt1.txt', first.text);
fs.writeFileSync('/tmp/rt2.txt', second.text);

const a = fingerprint(project), b = fingerprint(res.json);
const setA = new Set(a), setB = new Set(b);
const onlyA = a.filter(x => !setB.has(x));
const onlyB = b.filter(x => !setA.has(x));
console.log('\n=== BLOCK FINGERPRINT ===');
console.log('original blocks :', a.length);
console.log('recompiled      :', b.length);
console.log('only in original:', onlyA.length);
console.log('only in recompiled:', onlyB.length);
const show = (label, arr) => {
  if (!arr.length) return;
  console.log('\n--- ' + label + ' (' + arr.length + ', first 25) ---');
  arr.slice(0, 25).forEach(x => console.log('   ' + x));
};
show('ONLY IN ORIGINAL', onlyA);
show('ONLY IN RECOMPILED', onlyB);

console.log('\n=== PSEUDOTEXT STABILITY ===');
const t1 = first.text.split('\n'), t2 = second.text.split('\n');
console.log('lines pass1:', t1.length, ' pass2:', t2.length);
let shown = 0;
for (let i = 0; i < Math.max(t1.length, t2.length) && shown < 30; i++) {
  if (t1[i] !== t2[i]) { console.log('  line ' + (i + 1) + '\n    - ' + t1[i] + '\n    + ' + t2[i]); shown++; }
}
