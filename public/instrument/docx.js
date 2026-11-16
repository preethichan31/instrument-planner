/*
 * Instrumentation Planner: Word export.
 *
 * Turns the data from OLPlanner.questionnaire() into a .docx file, in the browser, with no library and no network
 * call (clients on locked-down networks can still export). A .docx is a ZIP of XML parts; this file writes the four
 * parts Word needs and a store-only ZIP around them.
 *
 * OWNER:  FDE team (Preethi).
 * TESTS:  tests/instrument/docx.test.mjs (zip integrity, well-formed XML, escaping, content). Runs offline.
 *         After changing the XML below, also open one export in Word: element ORDER inside w:pPr, w:rPr, w:tblPr and
 *         w:tcPr is fixed by the Word schema, and Word refuses files that get it wrong.
 *
 * No DOM access. Loaded as a plain <script> (window.OLDocx) and require()d by the Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OLDocx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PAGE_W = 12240, PAGE_H = 15840, MARGIN = 1080; // US Letter, 0.75" margins, in twentieths of a point
  const BODY_W = PAGE_W - 2 * MARGIN;
  const MONO = 'Courier New';
  const C = { text: '0A0A0A', muted: '6B7280', border: 'D4D4D4', head: 'F5F5F5', link: '1D4ED8',
    confirm: 'FFF4D6', partial: 'FFFBEB', add: 'E9F9EE', addText: '14532D', del: 'FDECEC', delText: '7F1D1D' };

  // XML 1.0 forbids most control characters even when escaped, so they are dropped (a pasted name can contain them).
  // Surrogates are kept so emoji survive; TextEncoder turns a stray half into U+FFFD, which is valid.
  const esc = (v) => String(v == null ? '' : v)
    .replace(/[^\x09\x0A\x0D\x20-\uFFFD]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Runs and paragraphs ──
  // Order inside w:rPr follows Word's own: rFonts, b, i, color, sz, szCs, u.
  function run(text, f) {
    f = f || {};
    const pr = (f.mono ? `<w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/>` : '')
      + (f.bold ? '<w:b/>' : '') + (f.italic ? '<w:i/>' : '')
      + (f.color ? `<w:color w:val="${f.color}"/>` : '')
      + (f.size ? `<w:sz w:val="${f.size}"/><w:szCs w:val="${f.size}"/>` : '')
      + (f.underline ? '<w:u w:val="single"/>' : '');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }
  // The planner's text uses **bold** and `code` only. Anything else is literal.
  function mdRuns(text, f) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    const s = String(text == null ? '' : text);
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(run(s.slice(last, m.index), f));
      out.push(m[1] !== undefined ? run(m[1], Object.assign({}, f, { bold: true })) : run(m[2], Object.assign({}, f, { mono: true, size: (f && f.size ? f.size : 20) - 2 })));
      last = m.index + m[0].length;
    }
    if (last < s.length || !out.length) out.push(run(s.slice(last), f));
    return out.join('');
  }
  // Order inside w:pPr: pStyle, keepNext, shd, spacing, ind.
  function para(runs, p) {
    p = p || {};
    const pr = (p.style ? `<w:pStyle w:val="${p.style}"/>` : '') + (p.keepNext ? '<w:keepNext/>' : '')
      + (p.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${p.fill}"/>` : '')
      + (p.before !== undefined || p.after !== undefined || p.line ? `<w:spacing${p.before !== undefined ? ` w:before="${p.before}"` : ''}${p.after !== undefined ? ` w:after="${p.after}"` : ''}${p.line ? ` w:line="${p.line}" w:lineRule="auto"` : ''}/>` : '')
      + (p.indent ? `<w:ind w:left="${p.indent}" w:right="${p.indent}"/>` : '');
    return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs}</w:p>`;
  }
  const text = (t, f, p) => para(mdRuns(t, f), p);

  // ── Tables ──
  // rows: arrays of cells; a cell is a string (markdown) or { t, f (run format), fill, sub (small second line) }.
  // widths must add up to BODY_W.
  function table(widths, rows, opts) {
    opts = opts || {};
    const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${C.border}"/>`;
    const tblPr = `<w:tblPr><w:tblW w:w="${BODY_W}" w:type="dxa"/>`
      + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
      + '<w:tblLayout w:type="fixed"/>'
      + '<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>';
    const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    const tr = (cells, header, rowFill) => {
      const tcs = cells.map((cell, i) => {
        const c = typeof cell === 'string' ? { t: cell } : cell;
        const fill = header ? C.head : c.fill || rowFill || '';
        const f = Object.assign({ size: 18 }, header ? { bold: true } : {}, c.f || {});
        const lines = c.lines && c.lines.length
          ? c.lines.map((ln, n) => text(ln.t, Object.assign({}, f, ln.bold ? { bold: true } : {}), { before: n ? 40 : 0, after: 0 })).join('')
          : text(c.t == null ? '' : c.t, f, { after: 0 });
        const sub = c.sub ? text(c.sub, { size: 16, italic: true, color: C.muted }, { before: 40, after: 0 }) : '';
        return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${lines}${sub}</w:tc>`;
      }).join('');
      return `<w:tr><w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>${tcs}</w:tr>`;
    };
    const body = (opts.head ? tr(opts.head, true) : '') + rows.map((r) => (Array.isArray(r) ? tr(r, false, '') : tr(r.cells, false, r.fill))).join(''); // arrays have a .fill method
    // Word needs a paragraph between two tables and after the last one; this also gives the gap below.
    return `<w:tbl>${tblPr}${grid}${body}</w:tbl>${para('', { after: 60 })}`;
  }

  // ── Code and diffs: one shaded paragraph per line, monospace ──
  function codeBlock(lines) {
    return lines.map((l, i) => {
      const line = typeof l === 'string' ? { t: ' ', s: l } : l;
      const add = line.t === '+', del = line.t === '-';
      const mark = typeof l === 'string' ? '' : (add ? '+ ' : del ? '- ' : '  ');
      return para(run(mark + line.s, { mono: true, size: 16, color: add ? C.addText : del ? C.delText : C.text }),
        { fill: add ? C.add : del ? C.del : C.head, before: 0, after: i === lines.length - 1 ? 160 : 0, line: 240, indent: 80 });
    }).join('');
  }

  // ── The document ──
  // One answer cell: ticked boxes where the question has them, otherwise the written answer.
  function answerCell(r) {
    const na = r.status === 'na';
    const f = na ? { color: C.muted, italic: true } : {};
    const extra = [];
    if (r.note) extra.push(r.note);
    if (r.status === 'partial' && r.todo) extra.push('Still open: ' + r.todo);
    else if (r.status === 'confirm' && r.choices) extra.push('Not asked in the planner');
    if (r.choices) {
      const tickedLabels = r.choices.filter((c) => c.on).map((c) => c.label).join(', ');
      // A written note that is not itself one of the ticked boxes (the planner route, for example).
      if (r.a && r.a !== tickedLabels) extra.unshift(r.a);
      return { lines: r.choices.map((c) => ({ t: (c.on ? '☑ ' : '☐ ') + c.label, bold: c.on })), sub: extra.join(' — '), f };
    }
    if (r.status === 'confirm') return { t: 'Not asked in the planner', f: { color: C.muted, italic: true } };
    return { t: r.a, f, sub: extra.join(' — ') };
  }
  function documentXml(q) {
    const b = [];
    const h1 = (t) => b.push(text(t, null, { style: 'Heading1' }));
    const h2 = (t) => b.push(text(t, null, { style: 'Heading2' }));
    const label = (t) => b.push(text(t, { bold: true, size: 17, color: C.muted }, { before: 120, after: 60, keepNext: true }));

    b.push(text(q.title, null, { style: 'Title' }));
    for (const line of q.intro || []) b.push(text(line, { color: C.muted }));
    h1('The use case and its Openlayer integration');
    b.push(text('Monitoring mode only: live traces from this use case. This is the integration the session sets up.', { color: C.muted }));
    b.push(table([2800, BODY_W - 2800], q.summary.map(([key, v]) => [{ t: key, f: { bold: true }, fill: C.head }, v])));
    if (q.link) {
      b.push(para(`<w:hyperlink r:id="rIdPlan" w:history="1">${run('Open this plan in the Instrumentation Planner', { color: C.link, underline: true })}</w:hyperlink>`
        + run('  (every choice is in the link, and it holds no keys or secrets)', { color: C.muted, size: 18 })));
    }

    for (const sec of q.sections) {
      h1(sec.title);
      if (sec.note) b.push(text(sec.note, { color: C.muted }));
      const widths = sec.fallback ? [700, 3200, 3800, BODY_W - 7700] : [700, 3800, BODY_W - 4500];
      const head = sec.fallback ? ['#', 'Question', 'Your answer', 'If No or Not sure'] : ['#', 'Question', 'Your answer'];
      for (const block of sec.blocks) {
        if (block.title) h2(block.title);
        if (block.note) b.push(text(block.note, { color: C.muted }));
        if (!block.rows.length) continue;
        b.push(table(widths, block.rows.map((r) => {
          const na = r.status === 'na';
          const f = na ? { color: C.muted } : {};
          const fill = r.status === 'confirm' || r.status === 'partial' ? C.confirm : '';
          const cells = [{ t: r.ref, f }, { t: r.q, f }, answerCell(r)];
          if (sec.fallback) cells.push({ t: r.fallback || '', f: { color: C.muted } });
          return { fill, cells };
        }), { head }));
      }
    }

    if (q.confirm.length) {
      h1('Still to confirm before the session');
      b.push(text('Left blank above. Each one is a question the planner does not ask, or only answers in part.', { color: C.muted }));
      b.push(table([700, 3400, BODY_W - 4100], q.confirm.map((r) => [r.ref, r.q, r.todo]), { head: ['#', 'Question', 'What to confirm'] }));
    }

    h1('Ready before the session');
    b.push(text('Tick these the day before. None of them can be confirmed from the planner.', { color: C.muted }));
    b.push(table([6400, BODY_W - 7400, 1000], q.ready.map((r) => [r.t, r.applies, '☐']), { head: ['Check', 'Applies to', 'Done'] }));

    // Same order as the planner page (change, example trace, verify, checks), so "above" and "below" in the text hold.
    const c = q.change;
    const steps = (list) => table([500, 2900, BODY_W - 3400], list.map((it, i) => [String(i + 1), { t: it.t, f: { bold: true } }, it.d]), { head: ['#', 'Step', 'Detail'] });
    h1('Your change');
    if (c.heading && c.heading !== 'Your change') b.push(text(c.heading, { bold: true }));
    if (c.intro) b.push(text(c.intro));
    if (c.wizard) {
      label(`Run in the app's repository (Openlayer CLI ${c.wizard.minVersion} or later)`);
      b.push(codeBlock(c.wizard.run.split('\n')));
      b.push(table([2900, BODY_W - 2900], c.wizard.picks.map((p) => [{ t: p.t, f: { bold: true } }, p.d]), { head: ['When the wizard asks', 'Pick'] }));
    }
    if (c.install) { label('Packages'); b.push(codeBlock([c.install])); }
    if (c.lines.length) { label((c.wizard ? 'Tested reference: ' : '') + (c.file || 'Change')); b.push(codeBlock(c.lines)); }
    if (c.envText) { label(c.envFile || 'Environment variables'); b.push(codeBlock(c.envText.split('\n'))); }
    if (c.items.length) b.push(steps(c.items));
    if (c.after) b.push(text(c.after));
    for (const n of c.notes) b.push(text('Note: ' + n, { size: 18, color: C.muted }));

    if (q.trace.length) {
      h1('Example trace');
      b.push(text('What one request should look like in Openlayer once the change is in. Names and numbers are examples.', { color: C.muted }));
      b.push(table([4200, BODY_W - 5400, 1200], q.trace.map((t) => [{ t: '\u00A0\u00A0\u00A0'.repeat(t.d) + (t.d ? '\u2514 ' : '') + t.n, f: { bold: !t.d } }, t.m || '', t.s || '']), { head: ['Step', 'What it records', 'Time'] }));
    }

    h1(q.verifyTitle);
    b.push(steps(q.verify));

    if (q.checks.length) {
      h1('Starter checks');
      b.push(table([2600, 2300, BODY_W - 4900], q.checks.map((ch) => [{ t: ch.name, f: { bold: true } }, ch.worry, ch.why + (ch.needs ? ' ' + ch.needs : '')]), { head: ['Check', 'From the worry', 'What it does'] }));
    }

    b.push(text('Generated by the Openlayer Instrumentation Planner. This document contains no keys or secrets.', { size: 16, color: C.muted }, { before: 240 }));

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${b.join('')}`
      + `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
      + '</w:body></w:document>';
  }

  function stylesXml() {
    const heading = (id, name, level, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
      + `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<w:styles xmlns:w="${W_NS}"><w:docDefaults>`
      + `<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="${C.text}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>`
      + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>'
      + heading('Heading1', 'heading 1', 0, 28, 360) + heading('Heading2', 'heading 2', 1, 22, 200)
      + '</w:styles>';
  }

  function parts(q) {
    const rel = (id, type, target, external) => `<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`;
    const rels = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
    return [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + `<Override PartName="/word/document.xml" ContentType="${MIME}.main+xml"/>`
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: rels(rel('rId1', R_NS + '/officeDocument', 'word/document.xml')) },
      { name: 'word/document.xml', text: documentXml(q) },
      { name: 'word/styles.xml', text: stylesXml() },
      { name: 'word/_rels/document.xml.rels', text: rels(rel('rIdStyles', R_NS + '/styles', 'styles.xml') + (q.link ? rel('rIdPlan', R_NS + '/hyperlink', q.link, true) : '')) },
    ];
  }

  // ── ZIP (store only: the file is small, and it keeps this dependency-free) ──
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed timestamp, so the same answers give the same file
    const entries = files.map((f) => { const data = enc.encode(f.text); return { name: enc.encode(f.name), data, crc: crc32(data) }; });
    const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    let p = 0;
    const header = (e, central, offset) => {
      v.setUint32(p, central ? 0x02014b50 : 0x04034b50, true); p += 4;
      if (central) { v.setUint16(p, 20, true); p += 2; }
      v.setUint16(p, 20, true); v.setUint16(p + 2, 0x0800, true); v.setUint16(p + 4, 0, true); // version, UTF-8 names, stored
      v.setUint16(p + 6, 0, true); v.setUint16(p + 8, DATE, true);
      v.setUint32(p + 10, e.crc, true); v.setUint32(p + 14, e.data.length, true); v.setUint32(p + 18, e.data.length, true);
      v.setUint16(p + 22, e.name.length, true); v.setUint16(p + 24, 0, true); p += 26;
      if (central) { p += 10; v.setUint32(p, offset, true); p += 4; } // comment len, disk, attributes stay 0
      out.set(e.name, p); p += e.name.length;
    };
    const offsets = entries.map((e) => { const at = p; header(e, false); out.set(e.data, p); p += e.data.length; return at; });
    const dirStart = p;
    entries.forEach((e, i) => header(e, true, offsets[i]));
    const dirSize = p - dirStart;
    v.setUint32(p, 0x06054b50, true); v.setUint16(p + 8, entries.length, true); v.setUint16(p + 10, entries.length, true);
    v.setUint32(p + 12, dirSize, true); v.setUint32(p + 16, dirStart, true);
    return out;
  }

  /** Returns the .docx file as a Uint8Array. `q` is the object from OLPlanner.questionnaire(). */
  const build = (q) => zip(parts(q));

  return { build, parts, MIME, crc32 };
});
