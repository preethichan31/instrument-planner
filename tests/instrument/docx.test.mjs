// Tests for the Word export: the questionnaire data (snippets.js) and the .docx writer (docx.js).
// Fast, offline. Run: npm run test:instrument:fast   (or: node --test tests/instrument/docx.test.mjs)
//
// These prove the file is a sound ZIP of well-formed XML with the right content. They do not prove Word opens it:
// after changing the XML in docx.js, open one export in Word too (see the README).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { allStates } from './combos.mjs';

const require = createRequire(import.meta.url);
const P = require('../../public/instrument/snippets.js');
const D = require('../../public/instrument/docx.js');

const states = allStates(P);
const LINK = 'https://tools.openlayer.com/instrument?name=A&how=own';
const build = (s, opts) => P.questionnaire(s, { date: '16 Nov 2026', link: LINK, ...opts });

// ── Helpers: a minimal ZIP reader and an XML well-formedness check (Node has no XML parser built in) ──
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50, 'end-of-central-directory record');
  const count = v.getUint16(end + 10, true);
  const dirSize = v.getUint32(end + 12, true);
  let p = v.getUint32(end + 16, true);
  assert.equal(p + dirSize, end, 'central directory ends where the end record starts');
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, 'central header signature');
    assert.equal(v.getUint16(p + 10, true), 0, 'stored, not compressed');
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nameLen = v.getUint16(p + 28, true), at = v.getUint32(p + 42, true);
    assert.equal(v.getUint32(p + 20, true), size, 'compressed size equals size');
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(v.getUint32(at, true), 0x04034b50, 'local header signature for ' + name);
    assert.equal(v.getUint32(at + 14, true), crc, 'local CRC matches central CRC for ' + name);
    assert.equal(v.getUint32(at + 18, true), size, 'local size for ' + name);
    assert.equal(dec.decode(bytes.subarray(at + 30, at + 30 + v.getUint16(at + 26, true))), name, 'local name');
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    assert.equal(zlib.crc32(data), crc, 'CRC of ' + name);
    files.push({ name, text: dec.decode(data) });
    p += 46 + nameLen;
  }
  assert.equal(p, end, 'central directory size');
  return files;
}

function assertWellFormed(xml, where) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), 'XML declaration in ' + where);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/.test(xml), 'control character in ' + where);
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|>/g;
  let last = xml.indexOf('?>') + 2, m;
  re.lastIndex = last;
  const checkText = (t) => assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(t), `bare & in ${where}: ${t.slice(0, 60)}`);
  while ((m = re.exec(xml))) {
    assert.ok(m[2], `stray ${m[0]} in ${where} near: ${xml.slice(Math.max(0, m.index - 40), m.index + 40)}`);
    checkText(xml.slice(last, m.index));
    checkText(m[3]);
    last = re.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing tag order in ${where}`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(stack.length, 0, 'unclosed tags in ' + where);
  assert.equal(xml.slice(last).trim(), '', 'text after the root element in ' + where);
}

const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const part = (files, name) => files.find((f) => f.name === name).text;
const docText = (xml) => unescape(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
const rowsOf = (q) => q.sections.flatMap((sec) => sec.blocks.flatMap((b) => b.rows));

// ── The questionnaire data ──
test('questionnaire: every combination gives a complete, consistent questionnaire', () => {
  for (const s of states) {
    const q = build(s);
    const id = JSON.stringify(s);
    assert.match(q.filename, /^openlayer-questionnaire-[a-z0-9-]+\.docx$/, id);
    assert.deepEqual(q.sections.map((sec) => sec.title), [
      '1. The new AI use case', "2. How it's built", '3. Your work machine', '4. Running the use case', '5. What you want to check',
    ], id);
    const rows = rowsOf(q);
    const refs = rows.map((r) => r.ref);
    assert.equal(new Set(refs).size, refs.length, 'duplicate question number for ' + id);
    for (const r of rows) {
      assert.ok(['answered', 'partial', 'confirm', 'na'].includes(r.status), `status of ${r.ref} for ${id}`);
      assert.ok(r.q, `question text of ${r.ref}`);
      // Open rows say what to confirm; settled rows carry an answer and nothing to chase.
      if (r.status === 'confirm') assert.ok(r.todo && !r.a, `${r.ref} should only have a to-do for ${id}`);
      else if (r.status === 'partial') assert.ok(r.todo && r.a, `${r.ref} needs an answer and a to-do for ${id}`);
      else assert.ok(r.a && !r.todo, `${r.ref} should be settled for ${id}`);
    }
    assert.deepEqual(q.confirm.map((r) => r.ref), rows.filter((r) => r.status === 'confirm' || r.status === 'partial').map((r) => r.ref), 'to-confirm list for ' + id);
    assert.equal(q.counts.answered + q.counts.partial + q.counts.confirm + q.counts.na, rows.length, 'counts for ' + id);
    assert.equal(q.verify.length, P.buildPlan(s).verify.length);
    assert.ok(q.summary.every(([k, v]) => k && v), 'summary for ' + id);
  }
});

test('questionnaire: no CI/CD or development-mode questions', () => {
  for (const s of states) {
    const q = build(s);
    const asked = rowsOf(q).map((r) => r.q.toLowerCase()).join('\n');
    assert.ok(!/where is the code stored|ci\/cd|pull request|pipeline|jenkins|development mode|test dataset|judge/.test(asked), 'out-of-scope question for ' + JSON.stringify(s));
    assert.ok(!/ci gate|ci\/cd|step 4|block(s)? the merge|pull request check|development mode/.test(JSON.stringify(q).toLowerCase()), 'CI or development-mode text for ' + JSON.stringify(s));
    assert.equal(q.summary.find(([k]) => k === 'Openlayer mode')[1], 'Monitoring mode');
  }
});

test('questionnaire: answers follow what was clicked', () => {
  const row = (q, ref) => rowsOf(q).find((r) => r.ref === ref);
  const sum = (q, key) => q.summary.find(([k]) => k === key)[1];
  const on = (r) => r.choices.filter((c) => c.on).map((c) => c.label);

  const rag = build({ name: 'Support assistant', where: 'onprem', host: 'ol.acme.com', worries: ['hallucination', 'cost'], pii: true, alert: 'slack' });
  assert.equal(rag.title, 'Before your next integration session: Support assistant');
  assert.equal(rag.filename, 'openlayer-questionnaire-support-assistant.docx');
  assert.equal(row(rag, '1.1').a, 'Support assistant');
  assert.deepEqual(on(row(rag, '1.6')), ['Chatbot or Q&A over documents (RAG)']);
  assert.deepEqual(on(row(rag, '2.1')), ['Our own code']);
  assert.equal(row(rag, '2.3'), undefined, 'vendor questions only appear for a vendor product');
  assert.equal(sum(rag, 'Where Openlayer runs'), 'On-prem · https://ol.acme.com/v1');
  assert.equal(sum(rag, 'Openlayer mode'), 'Monitoring mode');
  assert.match(sum(rag, 'How the change is made'), /openlayer init/);
  assert.match(row(rag, '3.6').a, /openlayer init/);
  assert.equal(row(rag, '5.1').note, 'PII redaction: wanted');
  assert.ok(on(row(rag, '5.1')).includes('Wrong or made-up answers') && on(row(rag, '5.1')).includes('Cost'));
  assert.match(row(rag, '5.3').todo, /Slack channel/);
  assert.equal(row(rag, '4.1').a, 'Yes');
  assert.equal(sum(rag, 'Session'), 'Can be run in the session');
  assert.ok(rag.change.wizard && rag.change.wizard.picks.length >= 4, 'wizard picks on the default route');
  assert.ok(rag.trace.length >= 2 && rag.checks.length >= 2);

  const hand = build({ route: 'hand', run: 'no' });
  assert.equal(row(hand, '1.1').status, 'confirm', 'no name typed means it is still to confirm');
  assert.match(row(hand, '3.6').a, /by hand/);
  assert.equal(hand.change.wizard, null);
  assert.equal(row(hand, '4.1').a, 'No');
  assert.match(sum(hand, 'Session'), /next dev deploy/);
  assert.equal(hand.verifyTitle, 'Hand-off checklist');
  assert.equal(row(build({ worries: [] }), '5.1').status, 'confirm');

  const vendor = build({ how: 'vendor', vendor: 'copilot-studio' });
  assert.equal(row(vendor, '2.3').status, 'partial');
  assert.deepEqual(on(row(vendor, '2.3')), ['Copilot Studio']);
  assert.equal(row(vendor, '2.5').status, 'confirm');
  assert.equal(row(vendor, '3.1'), undefined, 'the work-machine section is skipped for a vendor product');
  assert.equal(row(vendor, '4.1'), undefined);
  assert.equal(vendor.sections[2].blocks.length, 0);
  assert.match(sum(vendor, 'Session'), /session/);

  const ml = build({ pattern: 'ml' });
  assert.equal(row(ml, '4.2').status, 'na', 'no LLM credentials to check for a tabular model');
  assert.deepEqual(on(row(ml, '1.6')), ['Classic ML (tabular model, no LLM)']);
});

test('questionnaire: holds no keys, only placeholders', () => {
  for (const s of states) {
    const text = JSON.stringify(build(s));
    assert.ok(!/sk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9_-]{20,}|xox[bp]-/.test(text), 'something key-shaped for ' + JSON.stringify(s));
    for (const m of text.matchAll(/OPENLAYER_API_KEY=([^\\"\s]*)/g)) assert.ok(m[1].startsWith('<'), 'API key value must be a placeholder, got ' + m[1]);
  }
});

// ── The .docx file ──
test('docx: every combination gives a sound ZIP of well-formed XML', () => {
  for (const s of states) {
    const files = unzip(D.build(build(s)));
    assert.deepEqual(files.map((f) => f.name), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels'], 'parts, content types first');
    for (const f of files) assertWellFormed(f.text, f.name + ' for ' + JSON.stringify(s));
    const doc = part(files, 'word/document.xml');
    assert.ok(!/undefined|\[object Object\]|NaN|\[native code\]/.test(doc), 'a value leaked into the document for ' + JSON.stringify(s));
    assert.ok(!/w:(fill|color|val|w)=""/.test(doc), 'empty attribute for ' + JSON.stringify(s));
  }
});

test('docx: tables follow the rules Word enforces', () => {
  for (const s of [{}, { how: 'vendor', vendor: 'copilot-studio' }, { pattern: 'ml' }, { how: 'otel', otelVia: 'collector' }, { how: 'gateway' }, { how: 'table' }]) {
    const doc = part(unzip(D.build(build(s))), 'word/document.xml');
    const tables = doc.match(/<w:tbl>.*?<\/w:tbl>/gs);
    assert.ok(tables.length >= 6, 'tables for ' + JSON.stringify(s));
    for (const t of tables) {
      const width = Number(t.match(/<w:tblW w:w="(\d+)"/)[1]);
      const grid = [...t.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
      assert.equal(grid.reduce((a, b) => a + b, 0), width, 'grid columns add up to the table width');
      assert.ok(grid.every((w) => w > 0), 'no zero or negative column');
      for (const row of t.match(/<w:tr>.*?<\/w:tr>/gs)) {
        const cells = row.match(/<w:tc>.*?<\/w:tc>/gs);
        assert.equal(cells.length, grid.length, 'cells per row');
        cells.forEach((c, i) => {
          assert.equal(Number(c.match(/<w:tcW w:w="(\d+)"/)[1]), grid[i], 'cell width matches its column');
          assert.match(c, /<\/w:p><\/w:tc>$/, 'a cell must end with a paragraph');
        });
      }
    }
    assert.match(doc, /<\/w:tbl><w:p>/, 'a paragraph follows every table');
    assert.ok(!doc.includes('</w:tbl><w:tbl>'), 'two tables may not touch');
    assert.match(doc, /<w:sectPr>.*<\/w:sectPr><\/w:body><\/w:document>$/, 'section properties come last');
    for (const t of doc.matchAll(/<w:t[ >][^<]*/g)) assert.ok(t[0].startsWith('<w:t xml:space="preserve">'), 'spaces are preserved in every run');
  }
});

test('docx: the content is the questionnaire', () => {
  const s = { name: 'Support assistant', where: 'onprem', host: 'ol.acme.com', worries: ['hallucination'] };
  const q = build(s);
  const files = unzip(D.build(q));
  const text = docText(part(files, 'word/document.xml'));
  assert.ok(text.includes('Before your next integration session: Support assistant'));
  assert.ok(text.includes('on 16 Nov 2026'));
  assert.ok(text.includes('☑ Our own code') && text.includes('☐ OpenTelemetry'), 'the chosen option is ticked and the others are not');
  for (const sec of q.sections) {
    assert.ok(text.includes(sec.title), sec.title);
    for (const r of sec.blocks.flatMap((b) => b.rows)) assert.ok(text.includes(r.q), r.q);
  }
  for (const h of ['The use case and its Openlayer integration', 'Still to confirm before the session', 'Ready before the session', 'Your change', 'Example trace', 'Check it works', 'Starter checks']) assert.ok(text.includes(h), h);
  assert.ok(text.includes('openlayer init'), 'the wizard command');
  assert.ok(text.includes('+ from openlayer.lib import init, trace'), 'added lines keep their + marker');
  assert.ok(text.includes('OPENLAYER_BASE_URL=https://ol.acme.com/v1'), 'env block');
  // Prose only: code blocks are printed as they are, and the .env comment legitimately contains backticks.
  const prose = docText(part(files, 'word/document.xml').replace(/<w:r><w:rPr><w:rFonts [^>]*Courier New[^>]*\/>.*?<\/w:r>/g, ''));
  assert.ok(!/\*\*|`/.test(prose), 'markdown markers are turned into formatting, not printed');
  assert.match(part(files, 'word/document.xml'), /<w:b\/>/, 'bold runs exist');
  assert.ok(text.includes('contains no keys or secrets'));
  // The planner link is a real hyperlink, and its & is escaped in the relationships part.
  const rels = part(files, 'word/_rels/document.xml.rels');
  assert.ok(rels.includes('Target="https://tools.openlayer.com/instrument?name=A&amp;how=own" TargetMode="External"'));
  assert.match(part(files, 'word/document.xml'), /<w:hyperlink r:id="rIdPlan"/);
  // Without a link there is no hyperlink and no dangling relationship.
  const bare = unzip(D.build(build(s, { link: '' })));
  assert.ok(!part(bare, 'word/document.xml').includes('w:hyperlink') && !part(bare, 'word/_rels/document.xml.rels').includes('rIdPlan'));
});

test('docx: awkward text in the use case name cannot break the file', () => {
  const name = 'R&D <bot> "v2" \'x\' \u0001\u000b]]> 🤖 \ud83d café';
  const q = build({ name });
  assert.match(q.filename, /^openlayer-questionnaire-r-d-bot-v2-x-caf\.docx$/);
  const files = unzip(D.build(q));
  for (const f of files) assertWellFormed(f.text, f.name);
  const text = docText(part(files, 'word/document.xml'));
  assert.ok(text.includes('R&D <bot> "v2" \'x\' ]]> 🤖'), 'name survives, minus the control characters');
  assert.ok(text.includes('café'));
});

test('docx: the same answers give the same bytes', () => {
  const a = D.build(build({ name: 'Same' })), b = D.build(build({ name: 'Same' }));
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  assert.equal(D.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'CRC-32 check value');
});
