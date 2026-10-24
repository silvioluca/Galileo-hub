// ── State ──────────────────────────────────────────────────────────
const state = {
  subject: 'all',
  category: null,
  topic: null,
  difficulty: 'all',
  search: '',
  // filtri "caratteristiche" a tre stati: 0 = off, 1 = includi, -1 = escludi
  feat: { image: 0, mc: 0, multi: 0 },
  selectMode: false,
  selected: new Set(),
  scores: new Map(), // id esercizio -> punti (override del default)
  greyEx: new Set(),     // id esercizio interamente escluso (PDP/PEI)
  greyItems: new Map(),  // id esercizio -> Set di indici di \item esclusi
  greyBlocks: new Map(), // id esercizio -> Set di indici di blocchi math (\[..\]/align) esclusi
};

// ── Theme ──────────────────────────────────────────────────────────
const savedTheme = localStorage.getItem('gh-theme') || 'dark';
if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');

document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
  localStorage.setItem('gh-theme', isLight ? 'dark' : 'light');
});

// ── Sidebar toggle ─────────────────────────────────────────────────
document.getElementById('hamburger').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-open');
});

// ── pgfplots / tikzpicture → SVG ───────────────────────────────────
const TIKZ_COLORS = {
  red: '#e74c3c', blue: '#3498db', green: '#27ae60', orange: '#e67e22',
  purple: '#9b59b6', black: 'currentColor', cyan: '#16a085', magenta: '#c0392b',
  teal: '#16a085', brown: '#8d6e63', gray: '#95a5a6',
};

// Compila l'espressione di un \addplot in una funzione JS f(x). null se non valida.
function compileTikzExpr(tex) {
  let s = (tex || '').trim();
  if (!s) return null;
  s = s.replace(/\^/g, '**')
       .replace(/\bdeg\s*\(/g, '(')          // pgfplots usa gradi; deg() annulla la conversione → radianti
       .replace(/\bln\s*\(/g, 'Math.log(')
       .replace(/\bexp\s*\(/g, 'Math.exp(')
       .replace(/\bsqrt\s*\(/g, 'Math.sqrt(')
       .replace(/\babs\s*\(/g, 'Math.abs(')
       .replace(/\bsin\s*\(/g, 'Math.sin(')
       .replace(/\bcos\s*\(/g, 'Math.cos(')
       .replace(/\btan\s*\(/g, 'Math.tan(')
       .replace(/\bpi\b/g, 'Math.PI')
       .replace(/\be\b/g, 'Math.E');
  try {
    const f = new Function('x', '"use strict"; return (' + s + ');');
    const t = f(1);
    if (typeof t !== 'number') return null;
    return f;
  } catch (e) { return null; }
}

function cleanTikzLabel(s) {
  return (s || '')
    .replace(/\\text(?:bf|it|rm)?\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/\\[^a-zA-Z]/g, ' ')
    .replace(/[${}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tikzToSvg(inner) {
  const num = re => { const m = inner.match(re); return m ? parseFloat(m[1]) : null; };
  let xmin = num(/xmin\s*=\s*(-?[\d.]+)/);
  let xmax = num(/xmax\s*=\s*(-?[\d.]+)/);
  let ymin = num(/ymin\s*=\s*(-?[\d.]+)/);
  let ymax = num(/ymax\s*=\s*(-?[\d.]+)/);

  // \addplot[opzioni]{espressione}
  const plots = [];
  const reP = /\\addplot\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let m;
  while ((m = reP.exec(inner))) {
    const opts = m[1] || '';
    const fn = compileTikzExpr(m[2]);
    if (!fn) continue;
    const dm = opts.match(/domain\s*=\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)/);
    const cm = opts.match(/\b(red|blue|green|orange|purple|black|cyan|magenta|teal|brown|gray)\b/);
    plots.push({
      fn,
      dlo: dm ? parseFloat(dm[1]) : null,
      dhi: dm ? parseFloat(dm[2]) : null,
      color: cm ? TIKZ_COLORS[cm[1]] : '#e74c3c',
    });
  }
  if (!plots.length) return '';   // niente da disegnare → rimuovi il blocco

  // Range x: dai limiti dell'asse o dai domini
  if (xmin == null || xmax == null) {
    let lo = Infinity, hi = -Infinity;
    plots.forEach(p => { if (p.dlo != null) { lo = Math.min(lo, p.dlo); hi = Math.max(hi, p.dhi); } });
    if (xmin == null) xmin = isFinite(lo) ? lo : -5;
    if (xmax == null) xmax = isFinite(hi) ? hi : 5;
  }
  // Range y: campiona le funzioni se non dato
  if (ymin == null || ymax == null) {
    let lo = Infinity, hi = -Infinity;
    plots.forEach(p => {
      const a = p.dlo != null ? Math.max(p.dlo, xmin) : xmin;
      const b = p.dhi != null ? Math.min(p.dhi, xmax) : xmax;
      for (let i = 0; i <= 80; i++) {
        const x = a + (b - a) * i / 80;
        let y; try { y = p.fn(x); } catch (e) { continue; }
        if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
    });
    if (!isFinite(lo)) { lo = -5; hi = 5; }
    const pad = (hi - lo) * 0.1 || 1;
    if (ymin == null) ymin = lo - pad;
    if (ymax == null) ymax = hi + pad;
  }
  if (xmax <= xmin) xmax = xmin + 1;
  if (ymax <= ymin) ymax = ymin + 1;

  // Dimensioni (aspetto dalla width/height in cm se presenti)
  const wm = inner.match(/width\s*=\s*([\d.]+)cm/);
  const hm = inner.match(/height\s*=\s*([\d.]+)cm/);
  let W = 240, H = 190;
  if (wm && hm) { W = 320; H = Math.round(320 * parseFloat(hm[1]) / parseFloat(wm[1])); }
  const pad = 26;
  const sx = x => pad + (x - xmin) / (xmax - xmin) * (W - 2 * pad);
  const sy = y => H - pad - (y - ymin) / (ymax - ymin) * (H - 2 * pad);

  const x0 = (xmin <= 0 && xmax >= 0) ? sx(0) : sx(xmin);
  const y0 = (ymin <= 0 && ymax >= 0) ? sy(0) : sy(ymin);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="tikz-svg" style="width:${W}px" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;

  // Griglia leggera (~8 divisioni)
  const niceStep = (lo, hi) => {
    const raw = (hi - lo) / 8, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  };
  const stepX = niceStep(xmin, xmax), stepY = niceStep(ymin, ymax);
  for (let x = Math.ceil(xmin / stepX) * stepX; x <= xmax + 1e-9; x += stepX) {
    svg += `<line x1="${sx(x).toFixed(1)}" y1="${pad}" x2="${sx(x).toFixed(1)}" y2="${H - pad}" class="tikz-grid"/>`;
  }
  for (let y = Math.ceil(ymin / stepY) * stepY; y <= ymax + 1e-9; y += stepY) {
    svg += `<line x1="${pad}" y1="${sy(y).toFixed(1)}" x2="${W - pad}" y2="${sy(y).toFixed(1)}" class="tikz-grid"/>`;
  }

  // Assi
  svg += `<line x1="${pad}" y1="${y0.toFixed(1)}" x2="${W - pad}" y2="${y0.toFixed(1)}" class="tikz-axis"/>`;
  svg += `<line x1="${x0.toFixed(1)}" y1="${pad}" x2="${x0.toFixed(1)}" y2="${H - pad}" class="tikz-axis"/>`;

  // Curve
  plots.forEach(p => {
    const a = p.dlo != null ? Math.max(p.dlo, xmin) : xmin;
    const b = p.dhi != null ? Math.min(p.dhi, xmax) : xmax;
    const N = 160;
    let d = '', pen = false;
    for (let i = 0; i <= N; i++) {
      const x = a + (b - a) * i / N;
      let y; try { y = p.fn(x); } catch (e) { y = NaN; }
      if (!Number.isFinite(y) || y < ymin || y > ymax) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1) + ' ';
      pen = true;
    }
    if (d) svg += `<path d="${d}" fill="none" stroke="${p.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });

  // Etichette \node
  const reN = /\\node\s*(\[[^\]]*\])?\s*at\s*\(\s*axis cs:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\{([^}]*)\}/g;
  while ((m = reN.exec(inner))) {
    const cm = (m[1] || '').match(/\b(red|blue|green|orange|purple|black|cyan|magenta|teal|brown|gray)\b/);
    const label = cleanTikzLabel(m[4]);
    if (!label) continue;
    svg += `<text x="${sx(parseFloat(m[2])).toFixed(1)}" y="${sy(parseFloat(m[3])).toFixed(1)}" class="tikz-text" fill="${cm ? TIKZ_COLORS[cm[1]] : 'currentColor'}">${escHtml(label)}</text>`;
  }

  // Etichette degli assi
  const grabLabel = re => { const mm = inner.match(re); return mm ? cleanTikzLabel(mm[1]) : ''; };
  const labelVal = '(\\{(?:[^{}]|\\{[^{}]*\\})*\\}|\\$[^$]*\\$|[^,\\]\\n]*)';
  const xl = grabLabel(new RegExp('xlabel\\s*=\\s*' + labelVal));
  const yl = grabLabel(new RegExp('ylabel\\s*=\\s*' + labelVal));
  if (xl) svg += `<text x="${(W - pad + 2).toFixed(1)}" y="${(y0 + 4).toFixed(1)}" class="tikz-axislabel" text-anchor="end">${escHtml(xl)}</text>`;
  if (yl) svg += `<text x="${(x0 + 5).toFixed(1)}" y="${(pad - 8).toFixed(1)}" class="tikz-axislabel">${escHtml(yl)}</text>`;

  svg += `</svg>`;
  return `<span class="tikz-plot">${svg}</span>`;
}

// ── LaTeX → HTML pre-processor ─────────────────────────────────────
function latexToHtml(tex) {
  if (!tex) return '';
  let s = tex;

  // -2. tikzpicture (pgfplots) → SVG inline
  s = s.replace(/\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g, (_, body) => tikzToSvg(body));

  // -1. Normalise \cdotp → \cdot (same glyph; \cdotp may appear stray outside math)
  s = s.replace(/\\cdotp\b/g, '\\cdot');

  // -0.5. U+00B7 (·) inside \text{} is not in KaTeX text-mode fonts; pull it out
  //        into math mode: \text{kg·m} → \text{kg}\cdot\text{m}
  s = s.replace(/\\text\{([^}]*)\}/g, (_, inner) => {
    if (!inner.includes('·')) return `\\text{${inner}}`;
    return '\\text{' + inner.replace(/·/g, '}\\cdot\\text{') + '}';
  });

  // -0.2. Proteggi le regioni matematiche: le trasformazioni testuali che seguono
  //        (\\ → <br>, \underline → <u>, rimozione di \hspace, …) altrimenti
  //        corromperebbero il contenuto degli ambienti matematici come align*,
  //        impedendo a KaTeX di renderizzarli. Le sostituiamo con segnaposto e le
  //        ripristiniamo intatte alla fine, lasciandole gestire a KaTeX.
  const mathStore = [];
  const protectMath = re => {
    s = s.replace(re, mm => `\x01M${mathStore.push(mm) - 1}\x01`);
  };
  // (a) math già delimitato (cattura anche align*/cases già dentro \[...\] o $...$)
  protectMath(/\$\$[\s\S]*?\$\$/g);
  protectMath(/\\\[[\s\S]*?\\\]/g);
  protectMath(/\\\([\s\S]*?\\\)/g);
  protectMath(/\$[^$\n]*\$/g);
  // (b) ambienti matematici "nudi" (non dentro \[...\]): KaTeX via auto-render passa
  //      solo il contenuto interno, quindi li avvolgiamo in \[...\] con un ambiente
  //      che KaTeX sa renderizzare (aligned / gathered).
  const stashAs = body => `\x01M${mathStore.push(body) - 1}\x01`;
  s = s.replace(/\\begin\{(align\*|align)\}([\s\S]*?)\\end\{\1\}/g,
    (_, e, body) => stashAs(`\\[\\begin{aligned}${body}\\end{aligned}\\]`));
  s = s.replace(/\\begin\{(gather\*|gather)\}([\s\S]*?)\\end\{\1\}/g,
    (_, e, body) => stashAs(`\\[\\begin{gathered}${body}\\end{gathered}\\]`));
  s = s.replace(/\\begin\{(equation\*|equation|multline\*|multline)\}([\s\S]*?)\\end\{\1\}/g,
    (_, e, body) => stashAs(`\\[${body}\\]`));

  // 0. tabular / tabularx → HTML table
  s = s.replace(/\\begin\{tabularx?\*?\}([\s\S]*?)\\end\{tabularx?\*?\}/g, (_, inner) => {
    // Skip up to 2 balanced {arg} groups: {width} then {colspec}.
    // Uses brace-depth counting so nested {} (e.g. @{}) are handled correctly.
    let i = 0;
    for (let arg = 0; arg < 2; arg++) {
      while (i < inner.length && /\s/.test(inner[i])) i++;
      if (inner[i] !== '{') break;
      let depth = 1; i++;
      while (i < inner.length && depth > 0) {
        if (inner[i] === '{') depth++;
        else if (inner[i] === '}') depth--;
        i++;
      }
    }
    let content = inner.slice(i);
    const rows = content
      .replace(/\\hline\b/g, '').replace(/\\cline\{[^}]*\}/g, '')
      .split(/\\\\/)
      .map(r => r.trim()).filter(r => r);
    if (!rows.length) return '';
    const htmlRows = rows.map(row => {
      const cells = row.split('&').map(c => {
        const cell = c
          .replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, '$1')
          .replace(/\\boxed\{([^}]*)\}/g, '[$1]')
          .replace(/\\hspace\{[^}]*\}/g, ' ')
          .trim();
        return `<td>${cell}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<table class="ex-table">${htmlRows.join('')}</table>`;
  });

  // 0.5. center → strip tags (content stays)
  s = s.replace(/\\begin\{center\}/g, '').replace(/\\end\{center\}/g, '');

  // 0.7. minipage → strip tags (content stays)
  s = s.replace(/\\begin\{minipage\}(?:\[[^\]]*\])?\{[^}]*\}/g, '');
  s = s.replace(/\\end\{minipage\}/g, '');

  // 0.8. multicols{N} → contenitore a N colonne CSS (l'enumerate/itemize interno
  //       viene poi convertito normalmente e fluisce nelle colonne)
  s = s.replace(/\\begin\{multicols\*?\}\s*\{(\d+)\}([\s\S]*?)\\end\{multicols\*?\}/g,
    (_, n, body) => `<div class="multicols" style="column-count:${n}">${body}</div>`);
  s = s.replace(/\\columnbreak\b/g, '');

  // 1. \begin{wrapfigure}...\end{wrapfigure} → <figure>
  s = s.replace(/\\begin\{wrapfigure\}[\s\S]*?\\end\{wrapfigure\}/g, match => {
    const m = match.match(/\\includegraphics(?:\[.*?\])?\{([^}]+)\}/);
    return m ? `<figure class="ex-figure"><img src="${m[1]}" alt="figura"/></figure>` : '';
  });

  // 2. \includegraphics[...]{path} standalone
  s = s.replace(/\\includegraphics(?:\[.*?\])?\{([^}]+)\}/g,
    (_, src) => `<figure class="ex-figure"><img src="${src}" alt="figura"/></figure>`);

  // 3. \begin{enumerate}...\end{enumerate} → <ol>
  //    Etichette a), b), c) di default; numeriche 1), 2) solo con label=\arabic*
  s = s.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, inner) => {
    const parts = inner.split(/\\item(?:\s*\[[^\]]*\])?/);
    const cls = /label\s*=\s*\\arabic/.test(parts[0]) ? 'ol-num' : 'ol-alpha';
    return `<ol class="${cls}">${parts.slice(1).map(i => `<li>${i.trim()}</li>`).join('')}</ol>`;
  });

  // 3.5. \begin{parts}...\end{parts} with \part → <ol>
  s = s.replace(/\\begin\{parts\}([\s\S]*?)\\end\{parts\}/g, (_, inner) => {
    const items = inner.split(/\\part\b(?:\s*\[[^\]]*\])?/).slice(1);
    return `<ol class="ol-alpha">${items.map(i => `<li>${i.trim()}</li>`).join('')}</ol>`;
  });

  // 4. \begin{itemize}...\end{itemize} → <ul>
  s = s.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, inner) => {
    const items = inner.split(/\\item(?:\s*\[[^\]]*\])?/).slice(1);
    return `<ul>${items.map(i => `<li>${i.trim()}</li>`).join('')}</ul>`;
  });

  // 5. Formattazione testo
  s = s.replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>');
  s = s.replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>');
  s = s.replace(/\\emph\{([^}]*)\}/g,   '<em>$1</em>');
  s = s.replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');

  // 6. Comandi di layout → rimossi
  s = s.replace(/\\(vspace|hspace|noindent|centering|vfill|hfill|medskip|bigskip|smallskip|linewidth|textwidth|columnwidth)\b(\{[^}]*\})?/g, '');

  // 6.5. Comandi grafici residui → rimossi
  s = s.replace(/\\color\{[^}]*\}/g, '');
  s = s.replace(/\\rule\{[^}]*\}\{[^}]*\}/g, '');
  s = s.replace(/\\framebox\([^)]*\)\{[^}]*\}/g, '');
  s = s.replace(/\\framebox\([^)]*\)/g, '');
  s = s.replace(/\\hline\b/g, '').replace(/\\cline\{[^}]*\}/g, '');

  // 7. \newline / \\ non in math → <br>
  s = s.replace(/\\newline\b/g, '<br>');
  s = s.replace(/\\\\\s*\n/g, '<br>\n');

  // 8. Ripristina le regioni matematiche protette (intatte, per KaTeX)
  s = s.replace(/\x01M(\d+)\x01/g, (_, i) => mathStore[+i]);

  return s;
}

// Testo piano per le card preview (stripa tutto il LaTeX/HTML)
function latexToPreview(tex) {
  if (!tex) return '';
  return tex
    .replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, '') // ambienti
    .replace(/\$\$[\s\S]*?\$\$/g, '')                        // display math
    .replace(/\$[^$\n]*\$/g, '')                             // inline math
    .replace(/\\\[[\s\S]*?\\\]/g, '')                        // \[...\]
    .replace(/\\\([\s\S]*?\\\)/g, '')                        // \(...\)
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])*(?:\{[^}]*\})*/g, '') // comandi
    .replace(/[{}$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Routing ────────────────────────────────────────────────────────
// Schema:  #/                          → tutto
//          #/fisica                    → materia fisica
//          #/fisica/cinematica         → categoria Cinematica
//          #/fisica/cinematica/mru     → argomento MRU

function toSlug(str) {
  return str.toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e')
    .replace(/[ìí]/g, 'i').replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function fromSlug(slug) {
  if (!slug) return { subject: 'all', category: null, topic: null };
  const parts = slug.split('/').filter(Boolean);

  if (parts.length === 1) {
    if (parts[0] === 'fisica' || parts[0] === 'matematica')
      return { subject: parts[0], category: null, topic: null };
    return null;
  }
  if (parts.length >= 2) {
    const subj    = parts[0];
    const catSlug = parts[1];
    if (!TOPICS[subj]) return null;
    for (const cat of Object.keys(TOPICS[subj])) {
      if (toSlug(cat) === catSlug) {
        if (parts.length === 2)
          return { subject: subj, category: cat, topic: null };
        const topicSlug = parts[2];
        for (const t of TOPICS[subj][cat]) {
          if (toSlug(t) === topicSlug)
            return { subject: subj, category: cat, topic: t };
        }
      }
    }
  }
  return null;
}

function currentSlug() {
  return location.hash.replace(/^#\/?/, '');
}

function pushRoute(slug) {
  const newHash = slug ? `#/${slug}` : '#/';
  if (location.hash === newHash) return;
  location.hash = newHash;
}

function applyCurrentRoute() {
  const resolved = fromSlug(currentSlug());
  if (!resolved) return;
  state.subject  = resolved.subject;
  state.category = resolved.category;
  state.topic    = resolved.topic;
  document.querySelectorAll('.subject-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subject === state.subject)
  );
  document.querySelectorAll('#materia-pills [data-subject]').forEach(b =>
    b.classList.toggle('active', b.dataset.subject === state.subject)
  );
  buildTopicList();
  render();
}

window.addEventListener('hashchange', applyCurrentRoute);

// ── Sidebar topic list ─────────────────────────────────────────────
const collapsedCats = new Set();

function buildTopicList() {
  const list     = document.getElementById('topic-list');
  list.innerHTML = '';
  const subjects = state.subject === 'all'
    ? Object.keys(TOPICS)
    : [state.subject];

  subjects.forEach(subj => {
    const cats = TOPICS[subj];
    if (!cats) return;

    if (state.subject === 'all') {
      const label = document.createElement('div');
      label.className = 'topic-group-label';
      label.textContent = subj.charAt(0).toUpperCase() + subj.slice(1);
      list.appendChild(label);
    }

    Object.entries(cats).forEach(([cat, topicList]) => {
      const catKey   = `${subj}/${cat}`;
      const catCount = EXERCISES.filter(e => e.subject === subj && e.category === cat).length;
      const isActiveCat   = state.category === cat;
      const hasActiveTopic = state.topic && topicList.includes(state.topic);
      const collapsed = collapsedCats.has(catKey) && !hasActiveTopic;

      const block = document.createElement('div');
      block.className = 'topic-category' + (collapsed ? ' collapsed' : '');

      const header = document.createElement('div');
      header.className = 'topic-category-header' + (isActiveCat ? ' active-cat' : '');
      header.innerHTML = `
        <span class="cat-label">${cat}</span>
        <div class="cat-meta">
          <span class="topic-count">${catCount}</span>
          <svg class="cat-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>`;

      // Chevron: toggle collapse
      header.querySelector('.cat-chevron').addEventListener('click', e => {
        e.stopPropagation();
        collapsedCats.has(catKey) ? collapsedCats.delete(catKey) : collapsedCats.add(catKey);
        block.classList.toggle('collapsed');
      });

      // Label: navigate to category
      header.addEventListener('click', () => {
        pushRoute(`${subj}/${toSlug(cat)}`);
      });

      const items = document.createElement('div');
      items.className = 'topic-items';

      topicList.forEach(topic => {
        const count = EXERCISES.filter(e => e.subject === subj && e.topic === topic).length;
        const item  = document.createElement('div');
        item.className = 'topic-item' + (state.topic === topic ? ' active' : '');
        item.innerHTML = `<span>${topic}</span><span class="topic-count">${count}</span>`;
        item.addEventListener('click', e => {
          e.stopPropagation();
          if (state.topic === topic) {
            pushRoute(`${subj}/${toSlug(cat)}`);
          } else {
            pushRoute(`${subj}/${toSlug(cat)}/${toSlug(topic)}`);
          }
        });
        items.appendChild(item);
      });

      block.appendChild(header);
      block.appendChild(items);
      list.appendChild(block);
    });
  });
  updateCollapseAllBtn();
}

// ── Comprimi / espandi tutte le categorie ──────────────────────────
function allCatKeys() {
  const subjects = state.subject === 'all' ? Object.keys(TOPICS) : [state.subject];
  const keys = [];
  subjects.forEach(subj => {
    const cats = TOPICS[subj];
    if (cats) Object.keys(cats).forEach(cat => keys.push(`${subj}/${cat}`));
  });
  return keys;
}

const COLLAPSE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 4 12 9 17 4"/><polyline points="7 20 12 15 17 20"/></svg>';
const EXPAND_ICON   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 9 12 4 17 9"/><polyline points="7 15 12 20 17 15"/></svg>';

function updateCollapseAllBtn() {
  const btn = document.getElementById('btn-collapse-all');
  if (!btn) return;
  const keys = allCatKeys();
  const allCollapsed = keys.length > 0 && keys.every(k => collapsedCats.has(k));
  btn.innerHTML = allCollapsed ? EXPAND_ICON : COLLAPSE_ICON;
  btn.title = allCollapsed ? 'Espandi tutte le categorie' : 'Comprimi tutte le categorie';
  btn.setAttribute('aria-label', allCollapsed ? 'Espandi tutto' : 'Comprimi tutto');
}

document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
  const keys = allCatKeys();
  const allCollapsed = keys.length > 0 && keys.every(k => collapsedCats.has(k));
  if (allCollapsed) keys.forEach(k => collapsedCats.delete(k));
  else keys.forEach(k => collapsedCats.add(k));
  buildTopicList();
});

// ── Subject buttons ────────────────────────────────────────────────
document.querySelectorAll('.subject-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.subject;
    pushRoute(s === 'all' ? '' : s);
  });
});

// ── Difficulty pills ───────────────────────────────────────────────
document.querySelectorAll('.diff-pill[data-diff]').forEach(pill => {
  pill.addEventListener('click', () => {
    state.difficulty = pill.dataset.diff;
    document.querySelectorAll('.diff-pill[data-diff]').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    render();
  });
});

// ── Materia (filtro in alto, sincronizzato con la sidebar/route) ────
document.querySelectorAll('#materia-pills [data-subject]').forEach(pill => {
  pill.addEventListener('click', () => {
    const s = pill.dataset.subject;
    pushRoute(s === 'all' ? '' : s);
  });
});

// ── Caratteristiche dell'esercizio ─────────────────────────────────
// Esercizio a risposta multipla: contiene opzioni \boxed{...}
function isMultipleChoice(ex) { return /\\boxed\{/.test(ex.text); }
function hasImageFeat(ex)     { return (ex.tags || []).includes('con immagine'); }
// "Più di una domanda": almeno due \item nel corpo (prima della soluzione)
function hasMultiQuestions(ex) {
  const body = (ex.text || '').split(/\\begin\{solution\}/)[0];
  return (body.match(/\\item\b/g) || []).length >= 2;
}

// pillole a tre stati: off → includi → escludi → off
document.querySelectorAll('.feat-pill[data-feat]').forEach(pill => {
  pill.addEventListener('click', () => {
    const k = pill.dataset.feat;
    state.feat[k] = state.feat[k] === 0 ? 1 : (state.feat[k] === 1 ? -1 : 0);
    syncFeatPills();
    render();
  });
});

function syncFeatPills() {
  document.querySelectorAll('.feat-pill[data-feat]').forEach(pill => {
    const v = state.feat[pill.dataset.feat];
    pill.classList.toggle('incl', v === 1);
    pill.classList.toggle('excl', v === -1);
  });
}

// vero se l'esercizio soddisfa un filtro a tre stati
function matchFeat(val, has) { return val === 0 || (val === 1 ? has : !has); }

// ── Search ─────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  state.search = e.target.value.toLowerCase().trim();
  render();
});

// ── Reset ──────────────────────────────────────────────────────────
document.getElementById('btn-reset-all').addEventListener('click', () => {
  state.difficulty = 'all';
  state.search     = '';
  state.feat       = { image: 0, mc: 0, multi: 0 };
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.diff-pill[data-diff]').forEach(p =>
    p.classList.toggle('active', p.dataset.diff === 'all')
  );
  syncFeatPills();
  pushRoute('');
});

// ── Filter exercises ───────────────────────────────────────────────
function getFiltered() {
  return EXERCISES.filter(ex => {
    if (state.subject !== 'all' && ex.subject !== state.subject) return false;
    if (state.category && ex.category !== state.category) return false;
    if (state.topic && ex.topic !== state.topic) return false;
    if (state.difficulty !== 'all' && ex.difficulty !== +state.difficulty) return false;
    if (!matchFeat(state.feat.image, hasImageFeat(ex))) return false;
    if (!matchFeat(state.feat.mc, isMultipleChoice(ex))) return false;
    if (!matchFeat(state.feat.multi, hasMultiQuestions(ex))) return false;
    if (state.search) {
      const hay = [ex.subtitle, ex.topic, ex.category, ex.subject, latexToPreview(ex.text)]
        .join(' ').toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

// ── Difficulty dots HTML ───────────────────────────────────────────
function dotsHTML(difficulty) {
  return [1, 2, 3].map(i => {
    const cls = i <= difficulty ? `diff-dot on d${difficulty}` : 'diff-dot';
    return `<span class="${cls}"></span>`;
  }).join('');
}

function accentColor(ex) {
  return ex.subject === 'fisica' ? 'var(--accent-green)' : 'var(--accent-blue)';
}

// ── Render cards ───────────────────────────────────────────────────
function render() {
  const filtered  = getFiltered();
  const grid      = document.getElementById('ex-grid');
  const empty     = document.getElementById('empty-state');

  document.getElementById('ex-count').textContent = `${filtered.length} esercizi`;

  // Chips filtri attivi
  const af = document.getElementById('active-filters');
  af.innerHTML = '';
  if (state.subject !== 'all') {
    af.appendChild(makeChip(
      state.subject === 'fisica' ? 'Fisica' : 'Matematica',
      () => pushRoute('')
    ));
  }
  if (state.category) {
    af.appendChild(makeChip(state.category, () => pushRoute(state.subject)));
  }
  if (state.topic) {
    af.appendChild(makeChip(state.topic, () =>
      pushRoute(`${state.subject}/${toSlug(state.category)}`)
    ));
  }
  if (state.difficulty !== 'all') {
    const labels = { '1': 'Facile', '2': 'Media', '3': 'Difficile' };
    af.appendChild(makeChip(labels[state.difficulty], () => {
      state.difficulty = 'all';
      document.querySelectorAll('.diff-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.diff === 'all')
      );
      render();
    }));
  }
  const featLabels = {
    image: { 1: 'Con immagine', '-1': 'Senza immagine' },
    mc:    { 1: 'Risposta multipla', '-1': 'Senza risposta multipla' },
    multi: { 1: 'Più domande', '-1': 'Domanda singola' },
  };
  Object.keys(featLabels).forEach(k => {
    const v = state.feat[k];
    if (v === 0) return;
    af.appendChild(makeChip(featLabels[k][v], () => {
      state.feat[k] = 0;
      syncFeatPills();
      render();
    }));
  });

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = filtered.map(ex => {
    const preview = latexToPreview(ex.text).slice(0, 160);
    const sel = state.selected.has(ex.id) ? ' selected' : '';
    return `
    <div class="ex-card${sel}" data-id="${ex.id}" style="--card-accent:${accentColor(ex)}">
      <div class="ex-card-meta">
        <div class="ex-card-tags">
          <span class="tag tag-${ex.subject}">${ex.subject === 'fisica' ? 'Fisica' : 'Matematica'}</span>
          <span class="tag tag-topic">${ex.topic}</span>
        </div>
        <div class="diff-dots" title="Difficoltà ${ex.difficulty}/3">${dotsHTML(ex.difficulty)}</div>
      </div>
      <div class="ex-card-title">${escHtml(ex.subtitle)}</div>
      <div class="ex-card-preview">${preview}</div>
      <div class="ex-card-footer">
        <button class="btn-open">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          Apri
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.ex-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const id = +card.dataset.id;
      // "Apri" apre sempre l'anteprima, anche in modalità selezione
      if (state.selectMode && !e.target.closest('.btn-open')) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        card.classList.toggle('selected', state.selected.has(id));
        onSelectionChange();
      } else {
        openModal(id);
      }
    });
  });

  // Renderizza l'eventuale matematica ($…$) nei titoli delle card.
  // Se KaTeX non è ancora caricato, ci pensa renderMath() al suo onload.
  grid.querySelectorAll('.ex-card-title').forEach(el => renderMathIn(el));
}

function makeChip(label, onRemove) {
  const chip = document.createElement('button');
  chip.className = 'filter-chip';
  chip.innerHTML = `${label}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  chip.addEventListener('click', onRemove);
  return chip;
}

// ── Modal ──────────────────────────────────────────────────────────
const overlay       = document.getElementById('modal-overlay');
const btnClose      = document.getElementById('modal-close');
const btnSolution   = document.getElementById('btn-show-solution');
const solutionBlock = document.getElementById('solution-block');

// ── Dimensione del font negli esercizi ─────────────────────────────
const FONT_MIN = 12, FONT_MAX = 24, FONT_DEFAULT = 14;
let fontSize = parseInt(localStorage.getItem('gh-font-size'), 10);
if (!Number.isFinite(fontSize)) fontSize = FONT_DEFAULT;
fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize));

function applyFontSize() {
  document.getElementById('modal-box').style.setProperty('--fz', `${fontSize}px`);
  localStorage.setItem('gh-font-size', fontSize);
  document.getElementById('font-dec').disabled = fontSize <= FONT_MIN;
  document.getElementById('font-inc').disabled = fontSize >= FONT_MAX;
}

function changeFontSize(delta) {
  fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + delta));
  applyFontSize();
}

document.getElementById('font-dec').addEventListener('click', () => changeFontSize(-1));
document.getElementById('font-inc').addEventListener('click', () => changeFontSize(1));

function openModal(id) {
  const ex = EXERCISES.find(e => e.id === id);
  if (!ex) return;

  applyFontSize();

  document.getElementById('modal-subject').textContent = ex.subject === 'fisica' ? 'Fisica' : 'Matematica';
  document.getElementById('modal-subject').className   = `modal-subject ${ex.subject}`;
  document.getElementById('modal-topic').textContent   = ex.topic;
  document.getElementById('modal-dots').innerHTML      = dotsHTML(ex.difficulty);
  const titleEl = document.getElementById('modal-title');
  titleEl.textContent = ex.subtitle;
  renderMathIn(titleEl);

  const textEl = document.getElementById('modal-text');
  textEl.innerHTML = latexToHtml(ex.text);
  renderMathIn(textEl);

  // Prepara soluzione (non renderizzata finché non richiesta)
  document.getElementById('solution-text').innerHTML = latexToHtml(ex.solution || '');

  solutionBlock.classList.add('hidden');
  btnSolution.classList.remove('revealed');

  const hasSolution = !!(ex.solution && ex.solution.trim());
  btnSolution.style.display = hasSolution ? '' : 'none';
  if (hasSolution) btnSolution.innerHTML = eyeIcon() + ' Mostra soluzione';

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

btnSolution.addEventListener('click', () => {
  const hidden = solutionBlock.classList.contains('hidden');
  if (hidden) {
    solutionBlock.classList.remove('hidden');
    renderMathIn(document.getElementById('solution-text'));
    btnSolution.classList.add('revealed');
    btnSolution.innerHTML = eyeOffIcon() + ' Nascondi soluzione';
  } else {
    solutionBlock.classList.add('hidden');
    btnSolution.classList.remove('revealed');
    btnSolution.innerHTML = eyeIcon() + ' Mostra soluzione';
  }
});

function eyeIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function eyeOffIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

function closeModal() {
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
  if (modalFs) {
    modalFs = false;
    overlay.classList.remove('modal-overlay-fs');
    document.getElementById('modal-box').classList.remove('modal-fs');
    document.getElementById('modal-fullscreen').innerHTML = expandIcon();
    document.getElementById('modal-fullscreen').title = 'Espandi';
  }
}
btnClose.addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Modal fullscreen ───────────────────────────────────────────────
let modalFs = false;
const btnFullscreen = document.getElementById('modal-fullscreen');

function expandIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
}
function collapseIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`;
}

btnFullscreen.addEventListener('click', () => {
  modalFs = !modalFs;
  overlay.classList.toggle('modal-overlay-fs', modalFs);
  document.getElementById('modal-box').classList.toggle('modal-fs', modalFs);
  btnFullscreen.innerHTML = modalFs ? collapseIcon() : expandIcon();
  btnFullscreen.title = modalFs ? 'Riduci' : 'Espandi';
});

// ── Scroll to top ──────────────────────────────────────────────────
const btnScrollTop = document.getElementById('btn-scroll-top');
window.addEventListener('scroll', () => {
  btnScrollTop.classList.toggle('visible', window.scrollY > 300);
}, { passive: true });
btnScrollTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── KaTeX rendering ────────────────────────────────────────────────
const KATEX_OPTIONS = {
  macros: {
    '\\cdotp': '\\cdot',
  },
  delimiters: [
    { left: '$$',   right: '$$',   display: true  },
    { left: '$',    right: '$',    display: false },
    { left: '\\[',  right: '\\]',  display: true  },
    { left: '\\(',  right: '\\)',  display: false },
    { left: '\\begin{align*}',     right: '\\end{align*}',     display: true },
    { left: '\\begin{align}',      right: '\\end{align}',      display: true },
    { left: '\\begin{equation*}',  right: '\\end{equation*}',  display: true },
    { left: '\\begin{equation}',   right: '\\end{equation}',   display: true },
    { left: '\\begin{gather*}',    right: '\\end{gather*}',    display: true },
  ],
  throwOnError: false,
  strict: false,
};

function renderMathIn(el) {
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(el, KATEX_OPTIONS);
  }
}

window.renderMath = function() {
  window._appReady = true;
  // Ri-renderizza tutto il DOM visibile dopo il caricamento di KaTeX
  document.querySelectorAll('.modal-text, .solution-text, .ex-card-title, .modal-title').forEach(el => {
    renderMathInElement(el, KATEX_OPTIONS);
  });
};

// ── Crea verifica ──────────────────────────────────────────────────
const DICITURA = (tipo) =>
`Prova strutturata secondo le indicazioni presenti nel ${tipo} con applicazione delle misure compensative/dispensative in esso previste.
Previsto un numero ridotto degli esercizi proposti (non svolgere gli esercizi in grigio).
È consentito l'uso di calcolatrice e formulario.`;

// Font disponibili: pacchetto LaTeX + famiglia CSS per l'anteprima
const FONTS = {
  cm:       { label: 'Computer Modern', tex: '', css: "Georgia, 'Times New Roman', serif", sans: false },
  times:    { label: 'Times',           tex: '\\usepackage{mathptmx}\n', css: "'Times New Roman', Times, serif", sans: false },
  palatino: { label: 'Palatino',        tex: '\\usepackage{mathpazo}\n', css: "'Palatino Linotype', Palatino, Georgia, serif", sans: false },
  helvet:   { label: 'Helvetica',       tex: '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}\n', css: "Helvetica, Arial, sans-serif", sans: true },
  lmsans:   { label: 'Sans (Latin Modern)', tex: '\\usepackage{lmodern}\n\\renewcommand{\\familydefault}{\\sfdefault}\n', css: "'DM Sans', Helvetica, sans-serif", sans: true },
};

const verPanel = document.getElementById('verifica-panel');

// Formattazione punti in stile italiano (virgola decimale)
function fmtPts(v) { return String(v).replace('.', ','); }

// ── Pannello ridimensionabile + layout selezionabile ───────────────
const VP_MIN = 320;
const VP_LAYOUTS = ['compact', 'left', 'right', 'full'];
// larghezza memorizzata per "bucket": compatto stretto, gli altri larghi
const VP_WIDTH_KEY = { compact: 'gh-vp-width', wide: 'gh-vp-wide-width' };
const vpWideDefault = () => Math.min(980, Math.round(window.innerWidth * 0.82));
const vpBucket = layout => (layout === 'compact' ? 'compact' : 'wide');

let vpLayout = localStorage.getItem('gh-vp-layout') || 'compact';
if (vpLayout === 'wide') vpLayout = 'left';          // compat. valore precedente
if (!VP_LAYOUTS.includes(vpLayout)) vpLayout = 'compact';

function vpStoredWidth(bucket) {
  const v = parseInt(localStorage.getItem(VP_WIDTH_KEY[bucket]), 10);
  if (Number.isFinite(v)) return v;
  return bucket === 'wide' ? vpWideDefault() : 440;
}

function applyVpLayout(layout) {
  vpLayout = layout;
  localStorage.setItem('gh-vp-layout', layout);
  const panel = document.getElementById('verifica-panel');
  if (panel) {
    VP_LAYOUTS.forEach(l => panel.classList.toggle('vp-layout-' + l, l === layout));
  }
  const btn = document.getElementById('vf-layout-btn');
  if (btn) btn.classList.toggle('active', layout !== 'compact');
  document.querySelectorAll('#vf-layout-pop [data-layout]').forEach(o =>
    o.classList.toggle('active', o.dataset.layout === layout));
  const max = Math.round(window.innerWidth * 0.92);
  document.documentElement.style.setProperty('--vp-width',
    Math.min(max, vpStoredWidth(vpBucket(layout))) + 'px');
}

applyVpLayout(vpLayout);

// Apertura del menu di scelta layout (pulsante accanto allo storico)
const vfLayoutBtn = document.getElementById('vf-layout-btn');
const vfLayoutPop = document.getElementById('vf-layout-pop');
if (vfLayoutBtn && vfLayoutPop) {
  vfLayoutBtn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('vf-history-pop')?.classList.add('hidden');
    vfLayoutPop.classList.toggle('hidden');
  });
  vfLayoutPop.querySelectorAll('[data-layout]').forEach(opt =>
    opt.addEventListener('click', () => {
      applyVpLayout(opt.dataset.layout);
      vfLayoutPop.classList.add('hidden');
    }));
  document.addEventListener('click', e => {
    if (!vfLayoutPop.classList.contains('hidden')
        && !vfLayoutPop.contains(e.target) && !vfLayoutBtn.contains(e.target)) {
      vfLayoutPop.classList.add('hidden');
    }
  });
}

// ── Zoom anteprima ─────────────────────────────────────────────────
const VP_ZOOM_MIN = 0.5, VP_ZOOM_MAX = 2.2;
let vpZoom = parseFloat(localStorage.getItem('gh-vp-zoom'));
if (!Number.isFinite(vpZoom)) vpZoom = 1;

function applyPreviewZoom() {
  vpZoom = Math.min(VP_ZOOM_MAX, Math.max(VP_ZOOM_MIN, Math.round(vpZoom * 100) / 100));
  const box = document.getElementById('vp-preview');
  if (box) box.style.setProperty('--vp-zoom', vpZoom);
  const val = document.getElementById('vf-zoom-reset');
  if (val) val.textContent = Math.round(vpZoom * 100) + '%';
  localStorage.setItem('gh-vp-zoom', vpZoom);
}
document.getElementById('vf-zoom-in')?.addEventListener('click', () => { vpZoom += 0.1; applyPreviewZoom(); });
document.getElementById('vf-zoom-out')?.addEventListener('click', () => { vpZoom -= 0.1; applyPreviewZoom(); });
document.getElementById('vf-zoom-reset')?.addEventListener('click', () => { vpZoom = 1; applyPreviewZoom(); });
applyPreviewZoom();

(function setupResize() {
  const handle = document.getElementById('vp-resize');
  let dragging = false;
  const onMove = e => {
    if (!dragging) return;
    const max = Math.round(window.innerWidth * 0.92);
    const w = Math.min(max, Math.max(VP_MIN, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty('--vp-width', w + 'px');
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('vp-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const w = getComputedStyle(document.documentElement).getPropertyValue('--vp-width').trim();
    if (w) localStorage.setItem(VP_WIDTH_KEY[vpBucket(vpLayout)], parseInt(w, 10));
  };
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    document.body.classList.add('vp-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

function setSelectMode(on) {
  state.selectMode = on;
  document.body.classList.toggle('select-mode', on);
  document.body.classList.toggle('verifica-open', on);
  verPanel.classList.toggle('hidden', !on);
  if (!on) { state.selected.clear(); render(); }
  onSelectionChange();
}

function currentTipo() {
  const r = document.querySelector('input[name="vf-tipo"]:checked');
  return r ? r.value : 'Normodotazione';
}

// Aggiorna conteggio, stato del pulsante e anteprima live
function onSelectionChange() {
  const n = state.selected.size;
  document.getElementById('vf-count').textContent = n;
  document.getElementById('vf-generate').disabled = n === 0;
  document.getElementById('vf-overleaf').disabled = n === 0;
  renderVerificaPreview();
}

// HTML per l'anteprima: come latexToHtml, ma le tabelle di scelta multipla
// (opzioni \boxed{A}…) diventano un elenco inline, per non sproporzionare la card.
function previewHtml(tex) {
  let html = latexToHtml(tex);
  html = html.replace(/<table class="ex-table">([\s\S]*?)<\/table>/g, (full, inner) => {
    const cells = [...inner.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c => c[1].trim()).filter(Boolean);
    const boxed = cells.filter(c => /^\[[A-Za-z0-9]\]/.test(c)).length;
    if (cells.length && boxed >= Math.max(1, Math.ceil(cells.length / 2))) {
      return `<div class="vp-mc">${cells.map(c => `<span class="vp-mc-opt">${c}</span>`).join('')}</div>`;
    }
    return full; // tabella vera: lasciala com'è
  });
  return html;
}

function renderVerificaPreview() {
  const box = document.getElementById('vp-preview');
  if (!box) return;
  if (!state.selected.size) {
    box.innerHTML = '<div class="vp-empty">Clicca sugli esercizi per aggiungerli alla verifica.<br>Compariranno qui in anteprima.</div>';
    renderScoreList([]);
    return;
  }
  const title    = document.getElementById('vf-title').value.trim();
  const subtitle = document.getElementById('vf-subtitle').value.trim();
  const classe   = document.getElementById('vf-classe').value.trim();
  const tipo     = currentTipo();
  const chosen   = [...state.selected].map(id => EXERCISES.find(e => e.id === id)).filter(Boolean);

  const opt = readVerificaOptions();
  let doc = '';
  doc += `<div class="vp-doc-title">${title ? escHtml(title) : 'Verifica'}</div>`;
  if (subtitle) doc += `<div class="vp-doc-subtitle">${escHtml(subtitle)}</div>`;
  if (classe)   doc += `<div class="vp-doc-classe">Classe: ${escHtml(classe)}</div>`;
  if (tipo === 'PDP' || tipo === 'PEI') {
    doc += `<div class="vp-doc-dicitura">${escHtml(DICITURA(tipo))}</div>`;
  }
  doc += `<div class="vp-doc-fields">`
    + `<span>Nome e Cognome:</span><span class="vp-fill"></span>`
    + `<span>Classe:</span><span class="vp-fill vp-fill-sm"></span>`
    + `<span>Data:</span><span class="vp-fill vp-fill-sm"></span>`
    + `</div>`;
  const pdpei = (tipo === 'PDP' || tipo === 'PEI');
  chosen.forEach((ex, i) => {
    let tag = '';
    if (opt.showPoints && state.scores.has(ex.id)) {
      tag = `<span class="vp-ex-pts-tag">(${fmtPts(state.scores.get(ex.id))} punti)</span> `;
    }
    const whole = pdpei && state.greyEx.has(ex.id);
    const showBody = opt.solutions !== 'only';
    let bodyHtml = showBody ? previewHtml(ex.text) : '';
    if (pdpei && showBody) {
      const gset = state.greyItems.get(ex.id);
      let k = 0;
      bodyHtml = bodyHtml.replace(/<li>/g, () => {
        const idx = ++k;
        const g = gset && gset.has(idx);
        return `<li class="vp-li-target${g ? ' vp-line-grey' : ''}" data-ex="${ex.id}" data-idx="${idx}"><span class="vp-excl" title="Escludi questo elemento">✕</span>`;
      });
      const bset = state.greyBlocks.get(ex.id);
      let b = 0;
      bodyHtml = bodyHtml.replace(/(\\\[[\s\S]*?\\\])/g, (mm) => {
        const idx = ++b;
        const g = bset && bset.has(idx);
        return `<span class="vp-blk-target${g ? ' vp-line-grey' : ''}" data-ex="${ex.id}" data-bidx="${idx}"><span class="vp-excl" title="Escludi questo blocco">✕</span>${mm}</span>`;
      });
    }
    const solHtml = (opt.solutions !== 'none' && ex.solution && ex.solution.trim())
      ? `<div class="vp-ex-solution"><span class="vp-sol-label">Soluzione</span>${previewHtml(ex.solution)}</div>`
      : '';
    const exExcl = pdpei
      ? `<span class="vp-excl vp-excl-ex${whole ? ' on' : ''}" data-exclex="${ex.id}" title="Escludi l'intero esercizio">escludi</span> `
      : '';
    doc += `<div class="vp-ex${whole ? ' vp-ex-grey' : ''}${pdpei ? ' vp-ex-grayable' : ''}" data-id="${ex.id}">
      <button class="vp-ex-rm" data-rm="${ex.id}" title="Rimuovi dalla verifica">✕</button>
      <div class="vp-ex-body"><div class="vp-ex-label">${exExcl}<span class="vp-ex-num">Esercizio ${i + 1}.</span> ${tag}</div>${bodyHtml}${solHtml}</div>
    </div>`;
  });
  // Riflette i controlli avanzati nell'anteprima: corpo, spazio, margini, font, distanza item
  const m = opt.margins;
  const style = `font-size:${opt.fontSize}px; font-family:${opt.font.css};`
    + `--vp-gap:${Math.round(opt.spacing * 0.7 + 6)}px; --vp-itemgap:${Math.max(0, Math.round(opt.enumSep * 0.8))}px;`
    + `padding:${Math.round(m.top * 6)}px ${Math.round(m.right * 6)}px ${Math.round(m.bottom * 6)}px ${Math.round(m.left * 6)}px`;
  box.innerHTML = `<div class="vp-doc" style="${style}">${doc}</div>`;

  box.querySelectorAll('.vp-ex-rm').forEach(btn =>
    btn.addEventListener('click', () => {
      const id = +btn.dataset.rm;
      state.selected.delete(id);
      state.scores.delete(id);
      state.greyEx.delete(id);
      state.greyItems.delete(id);
      state.greyBlocks.delete(id);
      const card = document.querySelector(`.ex-card[data-id="${id}"]`);
      if (card) card.classList.remove('selected');
      onSelectionChange();
    }));

  // PDP/PEI: esclusione (intero esercizio, singolo item o blocco). Click sulla ✕/etichetta.
  const toggleInSet = (map, id, idx) => {
    let s = map.get(id);
    if (!s) { s = new Set(); map.set(id, s); }
    if (s.has(idx)) s.delete(idx); else s.add(idx);
  };
  box.querySelectorAll('.vp-excl-ex').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const id = +b.dataset.exclex;
      if (state.greyEx.has(id)) state.greyEx.delete(id); else state.greyEx.add(id);
      renderVerificaPreview();
    }));
  box.querySelectorAll('.vp-li-target > .vp-excl').forEach(x =>
    x.addEventListener('click', e => {
      e.stopPropagation();
      const li = x.parentElement;
      toggleInSet(state.greyItems, +li.dataset.ex, +li.dataset.idx);
      renderVerificaPreview();
    }));
  box.querySelectorAll('.vp-blk-target > .vp-excl').forEach(x =>
    x.addEventListener('click', e => {
      e.stopPropagation();
      const blk = x.parentElement;
      toggleInSet(state.greyBlocks, +blk.dataset.ex, +blk.dataset.bidx);
      renderVerificaPreview();
    }));

  renderMathIn(box);
  renderScoreList(chosen);
}

// Lista "Punti per esercizio" nell'accordion Valutazione
function renderScoreList(chosen) {
  const box = document.getElementById('vf-scores');
  if (!box) return;
  if (!chosen.length) {
    box.innerHTML = '<div class="vf-scores-empty">Nessun esercizio selezionato.</div>';
    return;
  }
  box.innerHTML = chosen.map((ex, i) => {
    const pv = state.scores.has(ex.id) ? state.scores.get(ex.id) : '';
    return `<div class="vf-score-row">
      <span class="vf-score-num">${i + 1}.</span>
      <span class="vf-score-sub" title="${escHtml(ex.subtitle)}">${escHtml(ex.subtitle)}</span>
      <input class="vp-pts" type="number" min="0" step="0.5" data-id="${ex.id}" value="${pv}" placeholder="pt"/>
    </div>`;
  }).join('');
  box.querySelectorAll('.vp-pts').forEach(inp =>
    inp.addEventListener('input', () => {
      const id = +inp.dataset.id;
      const v = parseFloat(inp.value);
      if (Number.isFinite(v)) state.scores.set(id, v); else state.scores.delete(id);
    }));
}

// Applica la marcatura in grigio (solo PDP/PEI): intero esercizio o singoli \item
function greyTex(text, exId, tipo) {
  let body = text;
  if (tipo !== 'PDP' && tipo !== 'PEI') return body;
  if (state.greyEx.has(exId)) return `{\\color{gray}%\n${body}\n}`;
  const items = state.greyItems.get(exId);
  const blocks = state.greyBlocks.get(exId);
  if (items && items.size) {
    let k = 0;
    body = body.replace(/\\item\b(\s*\[[^\]]*\])?([\s\S]*?)(?=\\item\b|\\end\{)/g, (m, opt, content) => {
      k++;
      // avvolge tutto l'\item (anche il numero) nel colore grigio
      return items.has(k) ? `{\\color{gray}${m}}` : m;
    });
  }
  if (blocks && blocks.size) {
    let b = 0;
    body = body.replace(/(\\\[[\s\S]*?\\\]|\\begin\{(align\*?|gather\*?|equation\*?)\}[\s\S]*?\\end\{\2\})/g, (mm) => {
      b++;
      return blocks.has(b) ? `{\\color{gray}${mm}}` : mm;
    });
  }
  return body;
}

// Griglia di valutazione — LaTeX (struttura A/B/C per esercizio, punti da compilare a mano)
function gridTex(chosen) {
  const n = chosen.length;
  const clineEnd = 3 * n + 1;
  const cline = `\\cline{1-${clineEnd}}`;
  const colspec = '|l|' + 'ccc|'.repeat(n) + 'c';
  const rowEs  = '\\textbf{Esercizio} ' + chosen.map((e, i) => `& \\multicolumn{3}{c|}{\\textbf{${i + 1}}} `).join('') + `& \\\\ ${cline}`;
  const rowPt  = '\\textbf{Punti esercizio} ' + chosen.map(e => {
    const p = state.scores.get(e.id);
    return `& \\multicolumn{3}{c|}{${Number.isFinite(p) ? '\\textbf{' + fmtPts(p) + '}' : ''}} `;
  }).join('') + `& \\\\ ${cline}`;
  const rowInd = 'Indicatori griglia ' + chosen.map(() => `& \\multicolumn{1}{c|}{A} & \\multicolumn{1}{c|}{B} & C `).join('') + `& \\\\ \\hline`;
  const rowPar = 'Parziale indicatori ' + chosen.map(() => `& \\multicolumn{1}{c|}{} & \\multicolumn{1}{c|}{} &  `).join('') + `& \\multicolumn{1}{c|}{\\textbf{TOT}} \\\\ \\hline`;
  const rowTot = '\\textbf{Totale esercizio} ' + chosen.map(() => `& \\multicolumn{3}{l|}{} `).join('') + `& \\multicolumn{1}{c|}{} \\\\ \\hline`;
  return `\\vfill
\\begin{center}
\\renewcommand{\\arraystretch}{1.1}
% si adatta alla larghezza del foglio: riduce solo se la tabella è più larga
\\resizebox{\\ifdim\\width>\\linewidth \\linewidth\\else \\width\\fi}{!}{%
\\begin{tabular}{${colspec}}
${cline}
${rowEs}
${rowPt}
${rowInd}
${rowPar}
${rowTot}
\\end{tabular}}
\\end{center}`;
}

document.getElementById('btn-verifica').addEventListener('click', () => {
  setSelectMode(!state.selectMode);
});
document.getElementById('verifica-cancel').addEventListener('click', () => setSelectMode(false));
document.getElementById('verifica-close').addEventListener('click', () => setSelectMode(false));

// Opzioni avanzate. PDP/PEI forza Helvetica 12pt (font sans).
function readVerificaOptions() {
  const tipo = currentTipo();
  const pdpei = (tipo === 'PDP' || tipo === 'PEI');
  const fontSel = parseInt(document.getElementById('vf-fontsize').value, 10) || 11;
  const spacing = parseFloat(document.getElementById('vf-spacing').value);
  const enumSep = parseFloat(document.getElementById('vf-enumsep').value);
  const fontKey = pdpei ? 'helvet' : (document.getElementById('vf-font').value || 'cm');
  const font = FONTS[fontKey] || FONTS.cm;
  const m = id => { const v = parseFloat(document.getElementById(id).value); return Number.isFinite(v) ? v : 2.2; };
  return {
    tipo,
    font,
    sans: font.sans,
    fontSize: pdpei ? 12 : fontSel,
    spacing: Number.isFinite(spacing) ? spacing : 14,
    enumSep: Number.isFinite(enumSep) ? enumSep : 4,
    grid: document.getElementById('vf-grid').checked,
    showPoints: document.getElementById('vf-showpoints').checked,
    // 'none' = solo esercizi · 'both' = esercizi + soluzioni · 'only' = solo soluzioni
    solutions: document.getElementById('vf-solutions').dataset.state || 'none',
    margins: {
      top:    m('vf-margin-top'),
      bottom: m('vf-margin-bottom'),
      left:   m('vf-margin-left'),
      right:  m('vf-margin-right'),
    },
  };
}

// Quando PDP/PEI è attivo, corpo e font sono bloccati su Helvetica 12pt
function syncControls() {
  const pdpei = (currentTipo() !== 'Normodotazione');
  const fs = document.getElementById('vf-fontsize');
  const fn = document.getElementById('vf-font');
  fs.disabled = pdpei;
  fn.disabled = pdpei;
  fs.title = fn.title = pdpei ? 'Per PDP/PEI il testo è fissato a Helvetica 12pt' : '';
}

// aggiornamenti live dell'anteprima
['vf-title', 'vf-subtitle', 'vf-classe', 'vf-spacing',
 'vf-margin-top', 'vf-margin-bottom', 'vf-margin-left', 'vf-margin-right'].forEach(id =>
  document.getElementById(id).addEventListener('input', renderVerificaPreview));
document.getElementById('vf-fontsize').addEventListener('change', renderVerificaPreview);
document.getElementById('vf-enumsep').addEventListener('input', renderVerificaPreview);
document.getElementById('vf-font').addEventListener('change', renderVerificaPreview);
document.getElementById('vf-grid').addEventListener('change', renderVerificaPreview);
document.getElementById('vf-showpoints').addEventListener('change', renderVerificaPreview);

// ── Pulsante soluzioni a tre stati ─────────────────────────────────
const SOL_STATES = ['none', 'both', 'only'];
const SOL_ICONS = {
  none: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  both: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  only: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M14 11l7-7"/><path d="M16 9l3 3 3-3-3-3"/></svg>',
};
const SOL_META = {
  none: { label: 'Non mostrare soluzioni', cls: '' },
  both: { label: 'Esercizi + soluzioni', cls: 'sol-both' },
  only: { label: 'Solo soluzioni', cls: 'sol-only' },
};
function setSolutionsState(s) {
  if (!SOL_STATES.includes(s)) s = 'none';
  const btn = document.getElementById('vf-solutions');
  if (!btn) return;
  btn.dataset.state = s;
  const meta = SOL_META[s];
  btn.className = 'vf-solbtn' + (meta.cls ? ' ' + meta.cls : '');
  btn.innerHTML = `${SOL_ICONS[s]}<span>${meta.label}</span>`;
  btn.title = `Soluzioni: ${meta.label.toLowerCase()} — clic per cambiare`;
}
document.getElementById('vf-solutions').addEventListener('click', () => {
  const cur = document.getElementById('vf-solutions').dataset.state || 'none';
  setSolutionsState(SOL_STATES[(SOL_STATES.indexOf(cur) + 1) % SOL_STATES.length]);
  renderVerificaPreview();
});
setSolutionsState('none');
document.querySelectorAll('input[name="vf-tipo"]').forEach(r =>
  r.addEventListener('change', () => { syncControls(); renderVerificaPreview(); }));
syncControls();

// ── Generazione del .tex ───────────────────────────────────────────
function texEscapeText(s) {
  // Escapa solo i caratteri speciali nel testo libero (titolo/sottotitolo)
  return (s || '').replace(/([&%#_{}$])/g, '\\$1');
}

function buildVerificaTex() {
  const opt      = readVerificaOptions();
  const title    = texEscapeText(document.getElementById('vf-title').value.trim() || 'Verifica');
  const subtitle = texEscapeText(document.getElementById('vf-subtitle').value.trim());
  const classe   = texEscapeText(document.getElementById('vf-classe').value.trim());
  const tipo     = opt.tipo;
  const ids      = [...state.selected];
  const chosen   = ids.map(id => EXERCISES.find(e => e.id === id)).filter(Boolean);

  // Il documentclass accetta solo 10/11/12pt: per corpi maggiori si scala con extsizes
  const baseClass = [10, 11, 12].includes(opt.fontSize)
    ? `\\documentclass[${opt.fontSize}pt]{article}`
    : `\\documentclass[${opt.fontSize}pt]{extarticle}`;

  // Pacchetto del font scelto (PDP/PEI forza Helvetica)
  const helvet = opt.font.tex;

  let dicituraTex = '';
  if (tipo === 'PDP' || tipo === 'PEI') {
    dicituraTex =
`\\begin{center}\\small
Prova strutturata secondo le indicazioni presenti nel ${tipo} con applicazione delle misure compensative/dispensative in esso previste.
\\end{center}\n
\\small Previsto un numero ridotto degli esercizi proposti (non svolgere gli esercizi in grigio).\\\\
\\small È consentito l'uso di calcolatrice e formulario.
\n\n`;
  }

  const pdpei = (tipo === 'PDP' || tipo === 'PEI');
  const body = chosen.map((ex, i) => {
    let tag = '';
    if (opt.showPoints && state.scores.has(ex.id)) {
      tag = `\\hfill{\\small(${fmtPts(state.scores.get(ex.id))} punti)}`;
    }
    // Numero e distanza sono gestiti da \esercizio (definito nel preambolo):
    // riordinando i blocchi nel .tex la numerazione si aggiorna da sola
    const label = `\\esercizio${tag ? `[${tag}]` : ''}`;
    const txt = ex.text.trim();
    const showBody = opt.solutions !== 'only';
    const sol = (opt.solutions !== 'none' && ex.solution && ex.solution.trim())
      ? `${showBody ? `\n\n\\par\\smallskip{\\color{teal}\\textbf{Soluzione.}}\\\\` : ''}\n${ex.solution.trim()}`
      : '';
    // Esercizio interamente escluso: grigio anche l'etichetta "Esercizio N."
    if (pdpei && state.greyEx.has(ex.id)) {
      return `{\\color{gray}%\n${label}\n${showBody ? txt : ''}${sol}\n}`;
    }
    return `${label}\n${showBody ? greyTex(txt, ex.id, tipo) : ''}${sol}`;
  }).join(`\n\n%---------------------------------------------%\n\n`);

  const gridBlock = opt.grid ? '\n\n' + gridTex(chosen) + '\n' : '';

  return `${baseClass}
\\usepackage[utf8]{inputenc}
\\usepackage[italian]{babel}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage[a4paper,top=${opt.margins.top}cm,bottom=${opt.margins.bottom}cm,left=${opt.margins.left}cm,right=${opt.margins.right}cm]{geometry}
${helvet}\\usepackage{wrapfig}
\\usepackage{tabularx}
\\usepackage{multicol}
\\usepackage{xcolor}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
\\usepackage{tikz}
% Le immagini sono cercate nella cartella images/ del progetto
\\graphicspath{{images/}{excercises/}}
\\setlength{\\parindent}{0pt}
\\setlist{itemsep=${opt.enumSep}pt}
\\renewcommand{\\labelenumi}{\\theenumi) \\ }

% Distanza tra un esercizio e il successivo: basta cambiare questo valore
\\newlength{\\distesercizi}
\\setlength{\\distesercizi}{${opt.spacing}pt}

% \\esercizio stampa "Esercizio N." con numerazione automatica;
% l'argomento opzionale va a destra del titolo, es. \\esercizio[\\hfill(2 punti)]
\\newcounter{esercizio}
\\newcommand{\\esercizio}[1][]{%
  \\par\\ifnum\\value{esercizio}>0 \\vspace{\\distesercizi}\\fi
  \\refstepcounter{esercizio}%
  \\noindent\\textbf{Esercizio \\theesercizio.}#1\\par\\nobreak}

\\begin{document}

\\begin{center}
{\\LARGE ${title}}${subtitle ? `\\\\[6pt]\n{\\large ${subtitle}}` : ''}${classe ? `\\\\[4pt]\n{\\normalsize Classe: ${classe}}` : ''}
\\end{center}
\\medskip
${dicituraTex}\\bigskip

\\noindent
Nome e Cognome:~\\hrulefill\\hrulefill\\quad Classe:~\\hrulefill\\quad Data:~\\hrulefill
\\vspace{5mm}

${body}
${gridBlock}
\\end{document}
`;
}

// Compilazione reale online: invia il .tex a Overleaf (pdflatex con tutti i pacchetti)
// ── Storico verifiche (localStorage) ───────────────────────────────
const VF_HISTORY_KEY = 'gh-verifica-history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(VF_HISTORY_KEY)) || []; }
  catch (e) { return []; }
}
function saveHistory(arr) {
  localStorage.setItem(VF_HISTORY_KEY, JSON.stringify(arr.slice(0, 40)));
}

function snapshotVerifica() {
  const val = id => document.getElementById(id).value;
  return {
    ts: Date.now(),
    title:    val('vf-title'),
    subtitle: val('vf-subtitle'),
    classe:   val('vf-classe'),
    tipo:     currentTipo(),
    font:     val('vf-font'),
    fontSize: val('vf-fontsize'),
    spacing:  val('vf-spacing'),
    enumSep:  val('vf-enumsep'),
    margins: {
      top: val('vf-margin-top'), bottom: val('vf-margin-bottom'),
      left: val('vf-margin-left'), right: val('vf-margin-right'),
    },
    grid:       document.getElementById('vf-grid').checked,
    showPoints: document.getElementById('vf-showpoints').checked,
    solutions:  document.getElementById('vf-solutions').dataset.state || 'none',
    selected:   [...state.selected],
    scores:     [...state.scores.entries()],
    greyEx:     [...state.greyEx],
    greyItems:  [...state.greyItems.entries()].map(([k, v]) => [k, [...v]]),
    greyBlocks: [...state.greyBlocks.entries()].map(([k, v]) => [k, [...v]]),
  };
}

function saveCurrentToHistory() {
  if (!state.selected.size) return;
  const arr = loadHistory();
  arr.unshift(snapshotVerifica());
  saveHistory(arr);
  renderHistory();
}

function applySnapshot(s) {
  const set = (id, v) => { document.getElementById(id).value = v; };
  set('vf-title', s.title || '');
  set('vf-subtitle', s.subtitle || '');
  set('vf-classe', s.classe || '');
  document.querySelectorAll('input[name="vf-tipo"]').forEach(r => { r.checked = (r.value === s.tipo); });
  if (s.font) set('vf-font', s.font);
  if (s.fontSize) set('vf-fontsize', s.fontSize);
  if (s.spacing != null) set('vf-spacing', s.spacing);
  if (s.enumSep != null) set('vf-enumsep', s.enumSep);
  if (s.margins) {
    set('vf-margin-top', s.margins.top); set('vf-margin-bottom', s.margins.bottom);
    set('vf-margin-left', s.margins.left); set('vf-margin-right', s.margins.right);
  }
  document.getElementById('vf-grid').checked = !!s.grid;
  document.getElementById('vf-showpoints').checked = !!s.showPoints;
  // compatibilità: vecchi snapshot salvavano un booleano
  setSolutionsState(s.solutions === true ? 'both' : (s.solutions || 'none'));
  state.selected = new Set(s.selected || []);
  state.scores = new Map(s.scores || []);
  state.greyEx = new Set(s.greyEx || []);
  state.greyItems = new Map((s.greyItems || []).map(([k, v]) => [k, new Set(v)]));
  state.greyBlocks = new Map((s.greyBlocks || []).map(([k, v]) => [k, new Set(v)]));
  syncControls();
  render();              // riallinea le card selezionate nella griglia
  onSelectionChange();   // ricostruisce anteprima + lista punti
}

function renderHistory() {
  const box = document.getElementById('vf-history');
  if (!box) return;
  const arr = loadHistory();
  if (!arr.length) { box.innerHTML = '<div class="vf-history-empty">Nessuna verifica salvata.</div>'; return; }
  box.innerHTML = arr.map((s, i) => {
    const d = new Date(s.ts);
    const when = d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const meta = `${(s.selected || []).length} esercizi${s.classe ? ' · ' + escHtml(s.classe) : ''} · ${when}`;
    return `<div class="vf-hist-item" data-i="${i}">
      <div class="vf-hist-main" data-load="${i}">
        <div class="vf-hist-title">${escHtml(s.title || 'Senza titolo')}</div>
        <div class="vf-hist-meta">${meta}</div>
      </div>
      <button class="vf-hist-load" data-load="${i}">Carica</button>
      <button class="vf-hist-del" data-del="${i}" title="Elimina">✕</button>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-load]').forEach(el =>
    el.addEventListener('click', e => {
      e.stopPropagation();
      const s = loadHistory()[+el.dataset.load];
      if (s) { applySnapshot(s); document.getElementById('vf-history-pop').classList.add('hidden'); }
    }));
  box.querySelectorAll('[data-del]').forEach(el =>
    el.addEventListener('click', e => {
      e.stopPropagation();   // non chiudere il popover dopo l'eliminazione
      const arr2 = loadHistory();
      arr2.splice(+el.dataset.del, 1);
      saveHistory(arr2);
      renderHistory();
    }));
}

renderHistory();

// Apertura/chiusura del popover storico (pulsante orologio nell'header)
const vfHistBtn = document.getElementById('vf-history-btn');
const vfHistPop = document.getElementById('vf-history-pop');
vfHistBtn.addEventListener('click', e => {
  e.stopPropagation();
  const opening = vfHistPop.classList.contains('hidden');
  document.getElementById('vf-layout-pop')?.classList.add('hidden');
  vfHistPop.classList.toggle('hidden');
  if (opening) renderHistory();
});
document.addEventListener('click', e => {
  if (!vfHistPop.classList.contains('hidden')
      && !vfHistPop.contains(e.target) && !vfHistBtn.contains(e.target)) {
    vfHistPop.classList.add('hidden');
  }
});

document.getElementById('vf-overleaf').addEventListener('click', () => {
  if (!state.selected.size) return;
  const tex = buildVerificaTex();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://www.overleaf.com/docs';
  form.target = '_blank';
  const add = (name, value) => {
    const t = document.createElement('textarea');
    t.name = name; t.value = value; t.style.display = 'none';
    form.appendChild(t);
  };
  add('snip', tex);
  add('snip_name', (document.getElementById('vf-title').value.trim() || 'Verifica') + '.tex');
  add('engine', 'pdflatex');
  document.body.appendChild(form);
  form.submit();
  form.remove();
  try { saveCurrentToHistory(); } catch (err) { console.error('Storico non salvato:', err); }
});

document.getElementById('vf-generate').addEventListener('click', () => {
  if (!state.selected.size) return;
  const tex = buildVerificaTex();
  const blob = new Blob([tex], { type: 'application/x-tex;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (document.getElementById('vf-title').value.trim() || 'verifica')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'verifica';
  a.href = url;
  a.download = `${safe}.tex`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  try { saveCurrentToHistory(); } catch (err) { console.error('Storico non salvato:', err); }
});

// Esc esce dalla modalità verifica (se aperta e nessuna modale sopra)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.selectMode && overlay.classList.contains('hidden')) {
    setSelectMode(false);
  }
});

// ── Init ───────────────────────────────────────────────────────────
applyCurrentRoute();
window._appReady = true;
if (window._katexReady) renderMath();
