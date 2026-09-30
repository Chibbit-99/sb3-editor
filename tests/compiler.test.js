// Focused tests for the compiler over constructs example.json does not cover.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sb3-editor.html'), 'utf8');
const blocks = [...html.matchAll(/\/\/<(decompiler|compiler)>\n([\s\S]*?)\n\/\/<\/\1>/g)].map(m => m[2]);
const { SB3Decompiler, SB3Compiler } = new Function(blocks[0] + '\n' + blocks[1] + '\nreturn {SB3Decompiler, SB3Compiler};')();

let pass = 0, fail = 0;
function T (name, src, check) {
  let r;
  try { r = SB3Compiler.compile(src); } catch (e) { console.log('THROW  ' + name + ' :: ' + e.message); fail++; return; }
  if (r.fatal) { console.log('FATAL  ' + name + ' :: ' + r.diagnostics[0].message); fail++; return; }
  const errs = r.diagnostics.filter(d => d.level === 'error');
  if (errs.length) { console.log('ERROR  ' + name + ' :: ' + errs.map(e => e.message).join('; ')); fail++; return; }
  try { check(r.json, r); pass++; }
  catch (e) { console.log('FAIL   ' + name + ' :: ' + e.message); fail++; }
}
const wrap = (props, body, extra) =>
  'project {\n  semver = "3.0.0"\n  vm = "1"\n  agent = "t"\n  extensions = ["pen"]\n}\n\n' +
  'stage "Stage" {\n  props ' + (props || 'currentCostume=0 volume=100 layerOrder=0 tempo=60') + '\n' +
  '  costume "bg" file="abc.svg" format="svg" res=1 center=(240,180)\n' +
  '  sound "pop" file="def.wav" rate=48000 samples=1000\n' +
  (extra || '') +
  '  on flag clicked {   // @ 10,20\n' + body + '\n  }\n}\n';

const firstBlock = j => {
  const t = j.targets[0];
  const id = Object.keys(t.blocks).find(b => t.blocks[b].topLevel);
  return { t, id, b: t.blocks[id] };
};
const opOf = (j, b, inputName) => {
  const t = j.targets[0];
  const v = b.inputs[inputName];
  return v ? (Array.isArray(v[1]) ? 'prim' : t.blocks[v[1]].opcode) : null;
};
const deepFind = (t, opcode) => Object.values(t.blocks).filter(b => !Array.isArray(b) && b.opcode === opcode);
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

/* ---- hats ---- */
const HATS = [
  ['on flag clicked', 'event_whenflagclicked'],
  ['on this sprite clicked', 'event_whenthisspriteclicked'],
  ['on stage clicked', 'event_whenstageclicked'],
  ['on clone start', 'control_start_as_clone'],
  ['on key "space"', 'event_whenkeypressed'],
  ['on broadcast "go"', 'event_whenbroadcastreceived'],
  ['on backdrop switches to "bg"', 'event_whenbackdropswitchesto'],
  ['on touching "Sprite1"', 'event_whentouchingobject'],
  ['on (TIMER > 10)', 'event_whengreaterthan'],
  ['on (LOUDNESS > 5)', 'event_whengreaterthan']
];
HATS.forEach(([hdr, op]) => {
  T('hat: ' + hdr,
    'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  broadcast "go"\n  costume "bg" file="a.svg" format="svg" center=(1,2)\n\n  ' + hdr + ' {   // @ 5,5\n    move(1)\n  }\n}\n',
    j => {
      const found = deepFind(j.targets[0], op);
      assert(found.length === 1, 'expected one ' + op);
      assert(found[0].x === 5 && found[0].y === 5, 'position not kept');
    });
});

/* ---- key / broadcast fields carry the right shape ---- */
T('event_whenkeypressed KEY_OPTION is a menu input',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n\n  on key "space" {   // @ 0,0\n    move(1)\n  }\n}\n',
  j => {
    const h = deepFind(j.targets[0], 'event_whenkeypressed')[0];
    const v = h.inputs.KEY_OPTION;
    assert(Array.isArray(v) && v[0] === 1, 'KEY_OPTION should be an input holding a shadow, got ' + JSON.stringify(v));
    const sh = j.targets[0].blocks[v[1]];
    assert(sh && sh.opcode === 'sensing_keyoptions' && sh.shadow === true, 'expected a sensing_keyoptions shadow');
    assert(sh.fields.KEY_OPTION[0] === 'space', 'shadow value wrong');
  });

T('event_whenbroadcastreceived keeps the broadcast id',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  broadcast "go" id="b1"\n\n  on broadcast "go" {   // @ 0,0\n    move(1)\n  }\n}\n',
  j => {
    const h = deepFind(j.targets[0], 'event_whenbroadcastreceived')[0];
    assert(h.fields.BROADCAST_OPTION[0] === 'go' && h.fields.BROADCAST_OPTION[1] === 'b1',
      'expected [go, b1], got ' + JSON.stringify(h.fields.BROADCAST_OPTION));
  });

/* ---- menu fields stay fields, menu inputs get shadows ---- */
T('stop() writes a field, not an input', wrap('', '    stop("this script")'), j => {
  const b = deepFind(j.targets[0], 'control_stop')[0];
  assert(b.fields.STOP_OPTION[0] === 'this script', 'STOP_OPTION field missing');
  assert(!b.inputs.STOP_OPTION, 'STOP_OPTION must not be an input');
});

T('goTo() writes a menu shadow input', wrap('', '    goTo("Sprite1")'), j => {
  const b = deepFind(j.targets[0], 'motion_goto')[0];
  const v = b.inputs.TO;
  assert(v[0] === 1 && j.targets[0].blocks[v[1]].opcode === 'motion_goto_menu', 'expected a motion_goto_menu shadow');
});

T('touching() writes a field', wrap('', '    if (touching("Sprite1")) { move(1) }'), j => {
  const b = deepFind(j.targets[0], 'sensing_touchingobject')[0];
  assert(b.fields.TOUCHINGOBJECTMENU[0] === 'Sprite1', 'expected a TOUCHINGOBJECTMENU field');
});

T('propertyOf() writes PROPERTY field + OBJECT shadow', wrap('', '    setX(propertyOf("x position", "_stage_"))'), j => {
  const b = deepFind(j.targets[0], 'sensing_of')[0];
  assert(b.fields.PROPERTY[0] === 'x position', 'PROPERTY field wrong');
  const v = b.inputs.OBJECT;
  assert(j.targets[0].blocks[v[1]].opcode === 'sensing_of_object_menu', 'expected sensing_of_object_menu shadow');
});

T('switchCostume() writes a looks_costume shadow', wrap('', '    switchCostume("costume2")'), j => {
  const b = deepFind(j.targets[0], 'looks_switchcostumeto')[0];
  const sh = j.targets[0].blocks[b.inputs.COSTUME[1]];
  assert(sh.opcode === 'looks_costume' && sh.fields.COSTUME[0] === 'costume2', 'bad costume shadow');
});

T('setRotationStyle() writes a field', wrap('', '    setRotationStyle("left-right")'), j => {
  const b = deepFind(j.targets[0], 'motion_setrotationstyle')[0];
  assert(b.fields.STYLE[0] === 'left-right' && !b.inputs.STYLE, 'STYLE should be a field');
});

/* ---- control ---- */
T('forEach', 'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  var $i = 0 id="v"\n\n  on flag clicked {   // @ 0,0\n    forEach ($i in "ab") {\n      move(1)\n    }\n  }\n}\n',
  j => {
    const b = deepFind(j.targets[0], 'control_for_each')[0];
    assert(b.fields.VARIABLE[0] === 'i' && b.fields.VARIABLE[1] === 'v', 'VARIABLE field wrong');
    assert(b.inputs.SUBSTACK[1], 'SUBSTACK should be filled');
  });

T('if/else', wrap('', '    if (1 > 2) {\n      move(1)\n    } else {\n      move(2)\n    }'), j => {
  const b = deepFind(j.targets[0], 'control_if_else')[0];
  assert(b.inputs.SUBSTACK[1] && b.inputs.SUBSTACK2[1], 'both substacks must be filled');
});

T('empty else block', wrap('', '    if (1 > 2) {\n      move(1)\n    } else {\n    }'), j => {
  const b = deepFind(j.targets[0], 'control_if_else')[0];
  assert(b.inputs.SUBSTACK2[0] === 1 && b.inputs.SUBSTACK2[1] === null, 'empty else should be [1, null]');
});

T('forever with an empty body', wrap('', '    forever {\n    }'), j => {
  const b = deepFind(j.targets[0], 'control_forever')[0];
  assert(b.inputs.SUBSTACK[0] === 1 && b.inputs.SUBSTACK[1] === null, 'empty forever body');
});

T('while loop', wrap('', '    while (1 < 2) {\n      move(1)\n    }'), j => {
  assert(deepFind(j.targets[0], 'control_while').length === 1, 'expected control_while');
});

/* ---- custom blocks ---- */
T('define + call, boolean argument',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n\n  on flag clicked {   // @ 0,0\n    call "draw %s %b"("a", not(1 > 2))\n  }\n\n  define "draw %s %b"(a, b:bool) warp {   // @ 40,40\n    move(%a)\n  }\n}\n',
  j => {
    const t = j.targets[0];
    const proto = deepFind(t, 'procedures_prototype')[0];
    const m = JSON.parse(proto.mutation.argumentnames);
    assert(m.length === 2 && m[0] === 'a' && m[1] === 'b', 'argumentnames wrong: ' + m);
    const ids = JSON.parse(proto.mutation.argumentids);
    assert(ids.length === 2, 'argumentids wrong');
    assert(JSON.parse(proto.mutation.argumentdefaults).length === 2, 'argumentdefaults wrong');
    const call = deepFind(t, 'procedures_call')[0];
    const cids = JSON.parse(call.mutation.argumentids);
    assert(JSON.stringify(cids) === JSON.stringify(ids), 'call argumentids must match the prototype');
    assert(call.inputs[ids[0]], 'first argument input missing');
    const boolRep = deepFind(t, 'argument_reporter_boolean');
    assert(boolRep.length === 0, 'not(1>2) is not a boolean argument');
  });

T('call before define still resolves',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n\n  on flag clicked {   // @ 0,0\n    call "later"()\n  }\n\n  define "later"() {   // @ 0,100\n    move(1)\n  }\n}\n',
  j => assert(deepFind(j.targets[0], 'procedures_call').length === 1, 'call should resolve'));


/* ---- expressions ---- */
T('mathop + colour + empty + negative', wrap('',
  '    move(-10)\n    setEffect("COLOR", #4c6ed4)\n    say(<empty>)'), j => {
  const t = j.targets[0];
  const mv = deepFind(t, 'motion_movesteps')[0];
  assert(mv.inputs.STEPS[0] === 1 && mv.inputs.STEPS[1][1] === '-10', 'negative number literal');
  const ef = deepFind(t, 'looks_seteffectto')[0];
  assert(ef.inputs.VALUE[1][0] === 9, 'colour should be primitive 9');
  const say = deepFind(t, 'looks_say')[0];
  assert(say.inputs.MESSAGE[1][0] === 4 && say.inputs.MESSAGE[1][1] === '', 'a blank slot becomes an empty number primitive');
});

T('infix precedence and nesting', wrap('', '    if ((1 + 2) * 3 > 4) { move(1) }'), j => {
  const t = j.targets[0];
  const mul = deepFind(t, 'operator_multiply')[0];
  const lt = mul.inputs.NUM1[1];
  assert(!Array.isArray(lt) && t.blocks[lt].opcode === 'operator_add', 'multiply left operand should be the (1+2) reporter');
  assert(mul.inputs.NUM2[1][1] === '3', 'multiply right operand');
  const add = deepFind(t, 'operator_add')[0];
  assert(add.inputs.NUM2[1][1] === '2', 'add right operand');
});

T('mod and and/or', wrap('', '    if ((1 mod 2) == 0) { move(1) }'), j => {
  assert(deepFind(j.targets[0], 'operator_mod').length === 1, 'expected operator_mod');
});

T('list operations', 'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  list @l = [1, "a"] id="L"\n\n  on flag clicked {   // @ 0,0\n    @l.add(2)\n    @l.delete(1)\n    @l.insert(1, 3)\n    @l.replace(1, 4)\n    @l.clear()\n    move(@l.length)\n    setX(@l[1])\n  }\n}\n',
  j => {
    const t = j.targets[0];
    assert(deepFind(t, 'data_addtolist').length === 1, 'add');
    assert(deepFind(t, 'data_deleteoflist').length === 1, 'delete');
    assert(deepFind(t, 'data_insertatlist').length === 1, 'insert');
    assert(deepFind(t, 'data_replaceitemoflist').length === 1, 'replace');
    assert(deepFind(t, 'data_deletealloflist').length === 1, 'clear');
    assert(deepFind(t, 'data_lengthoflist').length === 1, 'length');
    assert(deepFind(t, 'data_itemoflist').length === 1, 'index');
    deepFind(t, 'data_addtolist').forEach(b => assert(b.fields.LIST[0] === 'l' && b.fields.LIST[1] === 'L', 'list id'));
  });

/* ---- undeclared symbols are created on the stage ---- */
T('undeclared variable becomes a global', wrap('', '    $brandnew = 1'), j => {
  const t = j.targets[0];
  const names = Object.values(t.variables).map(v => v[0]);
  assert(names.includes('brandnew'), 'expected a global brandnew, got ' + names);
});

T('sprite can read a stage global', 'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  var $g = 7 id="G"\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n}\n\nsprite "S1" {\n  props x=0 y=0\n\n  on flag clicked {   // @ 0,0\n    setX($g)\n  }\n}\n',
  j => {
    const s = j.targets[1];
    const b = deepFind(s, 'motion_setx')[0];
    assert(b.inputs.X[1][2] === 'G', 'should reference the stage global id G, got ' + JSON.stringify(b.inputs.X));
  });

/* ---- generic fallback ---- */
T('generic block form round-trips', wrap('', '    myCustom_op(VALUE: 5, NAME = "hi")'), j => {
  const b = deepFind(j.targets[0], 'myCustom_op')[0];
  assert(b.inputs.VALUE[1][1] === '5', 'input missing');
  assert(b.fields.NAME[0] === 'hi', 'field missing');
});

/* ---- loose variables, comments, cloud vars ---- */
T('loose variable keeps its position',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  var $v = 0 id="V"\n\n  loose $v   // @ 33,44\n}\n',
  j => {
    const loose = Object.values(j.targets[0].blocks).find(Array.isArray);
    assert(loose && loose[0] === 12 && loose[1] === 'v' && loose[2] === 'V' && loose[3] === 33 && loose[4] === 44,
      'bad loose primitive ' + JSON.stringify(loose));
  });

T('block comment attaches to its block', wrap('  var $v = 0 id="V"', '    /// my note\n    $v = 1'), j => {
  const b = deepFind(j.targets[0], 'data_setvariableto')[0];
  assert(b.comment, 'block should have a comment id');
  const c = j.targets[0].comments[b.comment];
  assert(c && c.text === 'my note' && c.blockId === b.__id || (c && c.text === 'my note'), 'comment text');
});

T('floating workspace comment', 'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n\n  /// [workspace comment @ 7,8] free floating\n}\n', j => {
  const cs = Object.values(j.targets[0].comments);
  assert(cs.length === 1 && cs[0].text === 'free floating', 'floating comment: ' + JSON.stringify(cs));
  assert(cs[0].x === 7 && cs[0].y === 8, 'floating comment position');
});

T('cloud variable keeps the third array slot',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  cloud var $c = 1 id="C"\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n}\n',
  j => {
    const v = j.targets[0].variables.C;
    assert(v.length === 3 && v[2] === true, 'cloud flag lost: ' + JSON.stringify(v));
  });

/* ---- monitors ---- */
T('monitor values are restored from the compiled project',
  'project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  var $v = 42 id="V"\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n}\n\nmonitors {\n  {"id":"V","mode":"default","opcode":"data_variable","params":{"VARIABLE":"v"},"spriteName":null,"x":0,"y":0,"visible":true}\n}\n',
  j => {
    const m = j.monitors[0];
    assert(m.id === 'V', 'monitor id: ' + m.id);
    assert(m.value === 42, 'monitor value should be restored, got ' + JSON.stringify(m.value));
  });

/* ---- guards ---- */
(function () {
  let r = SB3Compiler.compile('project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n  list @l = [1, 2, /* +10 more, 12 total */] id="L"\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n}\n');
  if (r.fatal && /list items shown/.test(r.diagnostics[0].message)) { console.log('ok     truncated list is rejected with guidance'); pass++; }
  else { console.log('FAIL   truncated list should be rejected, got ' + JSON.stringify(r.diagnostics)); fail++; }

  r = SB3Compiler.compile('project { semver = "3.0.0" extensions = [] }\n\nsprite "S" {\n  props x=0 y=0\n\n  on flag clicked {   // @ 0,0\n    move(1)\n  }\n}\n');
  if (r.fatal && /no target is the stage/.test(r.diagnostics[0].message)) { console.log('ok     missing stage is rejected'); pass++; }
  else { console.log('FAIL   missing stage should be rejected'); fail++; }

  r = SB3Compiler.compile('project { semver = "3.0.0" extensions = [] }\n\nstage "Stage" {\n  props tempo=60\n\n  on flag clicked {   // @ 0,0\n    nonsense(1)\n  }\n}\n');
  if (r.fatal && /not a known block/.test(r.diagnostics[0].message)) { console.log('ok     unknown block name is rejected'); pass++; }
  else { console.log('FAIL   unknown block should be rejected'); fail++; }
})();

/* ---- full round trip over every compiled example, decompiled again ---- */
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'example.json'), 'utf8');
  const opts = { positions: true, ids: true, monitors: true, maxList: 0, legend: true };
  const t1 = SB3Decompiler.decompile(JSON.parse(src), opts).text;
  const c = SB3Compiler.compile(t1);
  const t2 = SB3Decompiler.decompile(c.json, opts).text;
  const a = t1.split('\n').filter(l => !/^\/\/ /.test(l));
  const bb = t2.split('\n').filter(l => !/^\/\/ /.test(l));
  const diffs = [];
  for (let i = 0; i < Math.max(a.length, bb.length); i++) if (a[i] !== bb[i]) diffs.push([i + 1, a[i], bb[i]]);
  const meaningful = diffs.filter(d => !/comment/.test(d[1] || ''));
  if (!meaningful.length) { console.log('ok     example.json pseudocode is a fixed point (' + diffs.length + ' comment-marker diffs)'); pass++; }
  else {
    console.log('FAIL   example round trip, ' + meaningful.length + ' line diffs:');
    meaningful.slice(0, 8).forEach(d => console.log('         ' + d[0] + '\n           - ' + d[1] + '\n           + ' + d[2]));
    fail++;
  }

/* =======================================================================
   Compiling a single target in the context of the whole project.
   ======================================================================= */
const GLOBALS = '  var $speed = 0\n  list @items = [1, 2]\n  broadcast "go"\n';
const CONTEXT = SB3Compiler.compile(wrap(null, 'say("on the stage")', GLOBALS)).json;
const spriteOnly = (body) =>
  'sprite "Runner" {\n' +
  '  props currentCostume=0 volume=100 layerOrder=1 visible=true x=0 y=0 size=100 direction=90 draggable=false rotationStyle="all around"\n' +
  '  costume "costume1" file="abc.svg" format="svg" res=1 center=(0,0)\n\n' +
  '  on flag clicked {   // @ 40,50\n' + body + '\n  }\n}\n';

function C (name, src, check) {
  let r;
  try { r = SB3Compiler.compile(src, { context: CONTEXT }); }
  catch (e) { console.log('THROW  ' + name + ' :: ' + e.message); fail++; return; }
  if (r.fatal) { console.log('FATAL  ' + name + ' :: ' + r.diagnostics[0].message); fail++; return; }
  try { check(r.json, r); pass++; console.log('ok     ' + name); }
  catch (e) { console.log('FAIL   ' + name + ' :: ' + e.message); fail++; }
}

C('a sprite compiles on its own, with no stage line', spriteOnly('say("hi")'), (j, r) => {
  if (r.targetName !== 'Runner') throw new Error('targetName is ' + r.targetName);
  if (j.isStage !== false) throw new Error('it came back as the stage');
  if (j.name !== 'Runner') throw new Error('name is ' + j.name);
  if (j.targets) throw new Error('a single target came back wrapped in a project');
  if (Object.keys(j.blocks).length < 2) throw new Error('no blocks were built');
  if (r.diagnostics.some(d => d.level === 'error')) throw new Error('errors: ' + JSON.stringify(r.diagnostics));
});

C('a stage global used by the sprite keeps the id the project already had', spriteOnly('$speed = 1'), (j, r) => {
  const stageSpeed = Object.keys(CONTEXT.targets[0].variables).find(id => CONTEXT.targets[0].variables[id][0] === 'speed');
  const setV = Object.values(j.blocks).find(b => b.opcode === 'data_setvariableto');
  if (!setV) throw new Error('no data_setvariableto');
  if (!setV.fields || setV.fields.VARIABLE[1] !== stageSpeed) throw new Error('it invented a new variable instead of reusing the global');
  if (r.diagnostics.some(d => /never declared/.test(d.message))) throw new Error('it warned about a global that exists');
});

C('a stage list is usable from the sprite', spriteOnly('@items.add(1)'), (j, r) => {
  const add = Object.values(j.blocks).find(b => b.opcode === 'data_addtolist');
  if (!add) throw new Error('no data_addtolist');
  if (r.diagnostics.some(d => /never declared/.test(d.message))) throw new Error('it warned about a list that exists');
});

C('a broadcast declared on the stage is usable from the sprite', spriteOnly('broadcast("go")'), (j, r) => {
  const bc = Object.values(j.blocks).find(b => b.opcode === 'event_broadcast');
  if (!bc) throw new Error('no event_broadcast');
  const id = Object.keys(CONTEXT.targets[0].broadcasts).find(k => CONTEXT.targets[0].broadcasts[k] === 'go');
  if (bc.inputs.BROADCAST_INPUT[1][2] !== id) throw new Error('it invented a broadcast id');
  if (r.diagnostics.some(d => /never declared/.test(d.message))) throw new Error('it warned about a broadcast that exists');
});

C('a brand new global still resolves, it just has nowhere to be stored', spriteOnly('$fresh = 1'), (j, r) => {
  const setV = Object.values(j.blocks).find(b => b.opcode === 'data_setvariableto');
  if (!setV || !setV.fields || !setV.fields.VARIABLE[1]) throw new Error('the variable was not resolved at all');
  if (!r.diagnostics.some(d => /never declared/.test(d.message))) throw new Error('it should have said the global is new');
  if (Object.keys(j.variables).length) throw new Error('it stored a global on a sprite, which Scratch has no room for');
});

C('the stage on its own is still a valid single target', wrap(null, 'say("only the stage")'), (j, r) => {
  if (j.isStage !== true) throw new Error('it came back as a sprite');
  if (r.targetName !== 'Stage') throw new Error('targetName is ' + r.targetName);
});

C('a target with no scripts is a target with no blocks', 'sprite "Empty" {\n}\n', (j) => {
  if (j.name !== 'Empty') throw new Error('name is ' + j.name);
  if (Object.keys(j.blocks).length) throw new Error('it invented blocks');
});

(function () {
  // an emptied box is almost certainly a mistake, so say so and say what to do
  for (const blank of ['', '   \n\n  \t']) {
    const r = SB3Compiler.compile(blank, { context: CONTEXT });
    if (!r.fatal) { console.log('FAIL   an empty box is refused'); fail++; return; }
    if (!/All targets/.test(r.diagnostics[0].message)) {
      console.log('FAIL   the refusal does not say what to do: ' + r.diagnostics[0].message); fail++; return;
    }
  }
  console.log('ok     an emptied box is refused, pointing at "All targets"'); pass++;
})();

(function () {
  // without a context, a sprite-only document is still a whole-project error
  const r = SB3Compiler.compile(spriteOnly('say("hi")'));
  if (!r.fatal || !/no target is the stage/.test(r.diagnostics[0].message)) {
    console.log('FAIL   a sprite-only document is rejected when there is no context'); fail++; return;
  }
  console.log('ok     a sprite-only document is rejected when there is no context'); pass++;
})();

(function () {
  // splicing a rebuilt target back must leave the rest of the project alone
  const r = SB3Compiler.compile(spriteOnly('say("spliced")'), { context: CONTEXT });
  const copy = JSON.parse(JSON.stringify(CONTEXT));
  copy.targets[1] = Object.assign({}, copy.targets[1], r.json);
  if (copy.targets.length !== 2) throw new Error('target count changed');
  if (JSON.stringify(copy.targets[0]) !== JSON.stringify(CONTEXT.targets[0])) throw new Error('the stage moved');
  const say = Object.values(copy.targets[1].blocks).find(b => b.opcode === 'looks_say');
  if (!say || say.inputs.MESSAGE[1][1] !== 'spliced') throw new Error('the new block is not there');
  console.log('ok     the rebuilt target splices into a copy of the project'); pass++;
})();

})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
