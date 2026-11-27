// Fast drop-in for makefun-diff 1.0.0.
//
// Same answer as makefun-diff's diffPatch on every input, computed faster.
// The rule (from the house baseline's header, restated here in my own words):
//  - Lines: a text is cut after every "\n" (the only separator; "\r" is part of
//    its line); a last line with no "\n" is a line too. Two lines are equal only
//    when they are the same code units, newline or its absence included.
//  - The edit script: the common prefix of lines is kept, then the common
//    suffix of the lines left; between them, Myers's greedy search from the
//    first lines, which keeps on each diagonal the path reaching furthest into
//    the old text and, when a deletion and an insertion reach the same point,
//    the deletion's, never moves past either text's end, prunes no edge
//    diagonal, and follows every run of lines equal in both as far as it goes;
//    the first path to reach both ends is the script.
//  - The patch: a line "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I",
//    then each hunk's line "@ os ol ns nl" and one line per line it covers,
//    "=" and the line if kept, "-" if deleted, "+" if inserted; each run of
//    changes lists its deletions before its insertions and shows up to 3 kept
//    lines before and after it, and two runs at most 6 kept lines apart share a
//    hunk. A line that ends its text with no newline is written with one and
//    followed by a line "%". Identical texts are the first line alone.
//
// How this is faster than the reference: the reference allocates one path
// object (with a linked list of components) per (d, k) cell of the search, so
// it pays millions of allocations. This version interns every distinct line to
// a small integer once, then runs the search over typed arrays with no
// allocation in the hot loop, storing one integer per cell (the furthest old
// position reached on that diagonal) and rebuilding the script afterwards by
// walking those rows backwards with the same tie-break rule.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';
const DEAD = -1;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = new Array(parts.length);
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/**
 * The runs of the edit script of the middle slices a[0..n) into b[0..m):
 * [{ kind, count }], in order, kinds alternating. The search below mirrors
 * the reference exactly: positions are counts of lines consumed (x old, y new),
 * a diagonal is k = x - y, and the value stored per (d, k) is the furthest x
 * reached with d edits after following the run of equal lines as far as it goes.
 *
 * Candidate validity (never past either text's end): a deletion from the
 * (d-1, k-1) path is possible only when that path consumed fewer than n old
 * lines; an insertion from the (d-1, k+1) path only when that path consumed
 * fewer than m new lines. The deletion is taken when its resulting x is at
 * least the insertion's (the tie goes to the deletion); an edge diagonal has
 * only its one candidate, exactly as the reference's undefined path does.
 */
function editRuns(a, b, n, m) {
  // The initial snake, depth 0, diagonal 0.
  let x0 = 0;
  let y0 = 0;
  while (x0 < n && y0 < m && a[x0] === b[y0]) { x0++; y0++; }
  if (x0 === n && y0 === m) return [];

  const maxD = n + m;
  // rows[d] is an Int32Array of length 2d+1, index k+d, holding the furthest x
  // reached on diagonal k with d edits, or DEAD when no path reached it.
  const rows = new Array(maxD + 1);
  const row0 = new Int32Array(1);
  row0[0] = x0;
  rows[0] = row0;

  let D = -1;
  let K = 0;
  for (let d = 1; d <= maxD; d++) {
    const prev = rows[d - 1];
    const row = new Int32Array(2 * d + 1);
    // Edge k = -d: only the insertion candidate exists (from prev[0]).
    let xa = prev[0];
    if (xa !== DEAD && (xa - (-d + 1)) < m) {
      let x = xa;
      let y = x + d;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      row[0] = x;
      if (x === n && y === m) { D = d; K = -d; break; }
    } else row[0] = DEAD;
    // Interior diagonals, j = k + d running 2, 4, ..., 2d - 2: the deletion
    // candidate reads prev[j - 2], the insertion candidate prev[j].
    for (let j = 2; j <= 2 * d - 2; j += 2) {
      const k = j - d;
      const xr = prev[j - 2];
      xa = prev[j];
      const canR = xr !== DEAD && xr < n;
      const canA = xa !== DEAD && (xa - (k + 1)) < m;
      if (!canR && !canA) { row[j] = DEAD; continue; }
      const xd = canR ? xr + 1 : -1;
      const xi = canA ? xa : -1;
      let x = canR && (!canA || xd >= xi) ? xd : xi;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      row[j] = x;
      if (x === n && y === m) { D = d; K = k; break; }
    }
    if (D >= 0) break;
    // Edge k = d: only the deletion candidate exists (from prev[2d - 2]).
    const xr = prev[2 * d - 2];
    if (xr !== DEAD && xr < n) {
      let x = xr + 1;
      let y = x - d;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      row[2 * d] = x;
      if (x === n && y === m) { D = d; K = d; break; }
    } else row[2 * d] = DEAD;
    rows[d] = row;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk the rows backwards from (n, m) at depth D, rebuilding the script.
  // Each step re-derives the move the forward search took with the same rule,
  // then the run of kept lines the search followed from that move.
  const rev = [];
  const push = (kind, count) => {
    if (count <= 0) return;
    const last = rev[rev.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else rev.push({ kind, count });
  };
  let x = n;
  let y = m;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const prev = rows[d - 1];
    const xr = k - 1 >= -(d - 1) && k - 1 <= d - 1 ? prev[k - 1 + (d - 1)] : DEAD;
    const xa = k + 1 >= -(d - 1) && k + 1 <= d - 1 ? prev[k + 1 + (d - 1)] : DEAD;
    const canR = xr !== DEAD && xr < n;
    const canA = xa !== DEAD && (xa - (k + 1)) < m;
    const xd = canR ? xr + 1 : -1;
    const xi = canA ? xa : -1;
    const del = canR && (!canA || xd >= xi);
    const xPre = del ? xd : xi;
    // The kept run the search followed from this move to (x, y).
    push(KEEP, x - xPre);
    push(del ? DELETE : INSERT, 1);
    if (del) { x = xr; y = xr - (k - 1); }
    else { x = xa; y = xa - (k + 1); }
  }
  push(KEEP, x); // the initial snake, from (0, 0) to the depth-0 point
  rev.reverse();
  return rev;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aLines = tokenize(input.old);
  const bLines = tokenize(input.new);
  const n = aLines.length;
  const m = bLines.length;

  // Intern every distinct line to a small integer, once, so the search
  // compares integers instead of strings.
  const ids = new Map();
  const a = new Int32Array(n);
  const b = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    let id = ids.get(aLines[i]);
    if (id === undefined) { id = ids.size; ids.set(aLines[i], id); }
    a[i] = id;
  }
  for (let i = 0; i < m; i++) {
    let id = ids.get(bLines[i]);
    if (id === undefined) { id = ids.size; ids.set(bLines[i], id); }
    b[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix), n - prefix - suffix, m - prefix - suffix));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [FORMAT + ' old=' + n + ' new=' + m + ' hunks=' + hunks.length + ' deleted=' + deleted + ' inserted=' + inserted + '\n'];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push('@ ' + (oldStart + 1) + ' ' + (oldEnd - oldStart) + ' ' + (newStart + 1) + ' ' + (newEnd - newStart) + '\n');
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, aLines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, aLines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, bLines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, aLines[at]));
  }
  return out.join('');
}
