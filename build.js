#!/usr/bin/env node
// build.js — legge tutti i .tex in excercises/{subject}/{category}/ e genera exercises.js
// Uso: node build.js
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Utilities ──────────────────────────────────────────────────────

function toTopicName(filename) {
  return path.basename(filename, '.tex')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseDifficulty(str) {
  if (!str) return null;
  switch (str.toLowerCase().trim()) {
    case 'facile':    return 1;
    case 'media':     return 2;
    case 'difficile': return 3;
    default:          return null;
  }
}

// Inferisce difficoltà dall'ID: FAC→3; sezioni 1-2→1; 3-4→2; 5+→3
function inferDifficulty(id) {
  if (!id) return 1;
  if (/fac/i.test(id)) return 3;
  const m = id.match(/^(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n <= 2) return 1;
    if (n <= 4) return 2;
    return 3;
  }
  return 1;
}

function stripComments(text) {
  return text.split('\n')
    .map(line => line.replace(/(?<!\\)%.*$/, ''))
    .join('\n');
}

function findMatchingEnd(text, startPos, envName) {
  const beginStr = `\\begin{${envName}}`;
  const endStr   = `\\end{${envName}}`;
  let depth = 1;
  let pos   = startPos;
  while (pos < text.length) {
    const nb = text.indexOf(beginStr, pos);
    const ne = text.indexOf(endStr,   pos);
    if (ne === -1) return -1;
    if (nb !== -1 && nb < ne) { depth++; pos = nb + beginStr.length; }
    else { depth--; if (depth === 0) return ne; pos = ne + endStr.length; }
  }
  return -1;
}

function makeTitleFrom(text, sourceId) {
  const lines = text.split('\n');
  let candidate = '';
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('\\begin') && !t.startsWith('\\end') && !t.startsWith('\\item')) {
      candidate = t; break;
    }
  }
  let title = candidate
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])*\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length > 72) title = title.slice(0, 69) + '…';
  return title || (sourceId ? `Esercizio ${sourceId}` : 'Esercizio');
}

function normalizeSolution(sol) {
  const s = sol.trim();
  if (!s) return s;
  if (s.includes('$') || s.includes('\\[') || s.includes('\\(') || s.includes('\\begin{')) {
    return s;
  }
  // Strip all \commands{arg}{arg} and bare {groups}, then check whether the
  // remaining text contains word-like sequences (≥3 letters) — a reliable
  // signal that the solution is prose rather than a pure math expression.
  // Prose solutions must not be wrapped in \[…\] because latexToHtml converts
  // text commands (e.g. \textbf) to HTML before KaTeX runs, leaving malformed
  // display-math delimiters around HTML content.
  const bare = s
    .replace(/\\[a-zA-Z]+(?:\{[^}]*\})*/g, '')
    .replace(/\{[^}]*\}/g, '');
  if (/[A-Za-zÀ-ÿ]{3,}/.test(bare)) return s;
  if (/\\[a-zA-Z]/.test(s)) return `\\[ ${s} \\]`;
  return s;
}

// ── Parser ─────────────────────────────────────────────────────────

function parseTex(rawContent, topic, subject, category) {
  const content   = stripComments(rawContent);
  const exercises = [];

  const BEGIN_Q   = '\\begin{question}';
  const END_Q     = '\\end{question}';
  const BEGIN_SOL = '\\begin{solution}';
  const END_SOL   = '\\end{solution}';

  let pos = 0;

  while (true) {
    const qStart = content.indexOf(BEGIN_Q, pos);
    if (qStart === -1) break;

    let headerOpts = '';
    let afterHeader = qStart + BEGIN_Q.length;
    while (afterHeader < content.length && content[afterHeader] === ' ') afterHeader++;

    if (content[afterHeader] === '[') {
      let depth = 1, p = afterHeader + 1;
      while (p < content.length && depth > 0) {
        if (content[p] === '[') depth++;
        else if (content[p] === ']') depth--;
        p++;
      }
      headerOpts = content.slice(afterHeader + 1, p - 1);
      afterHeader = p;
    }

    const nlPos    = content.indexOf('\n', afterHeader);
    const bodyStart = nlPos !== -1 ? nlPos + 1 : afterHeader;

    const qEndPos = findMatchingEnd(content, bodyStart, 'question');
    if (qEndPos === -1) { pos = qStart + 1; continue; }

    let body      = content.slice(bodyStart, qEndPos).trim();
    const qEndTagEnd = qEndPos + END_Q.length;

    // ── Metadata ───────────────────────────────────────────────────
    const idMatch    = headerOpts.match(/\bID\s*=\s*([^\s,}\]]+)/i);
    const sourceId   = idMatch ? idMatch[1].trim() : null;

    const diffMatch  = headerOpts.match(/\bdifficulty\s*=\s*([^\s,}\]]+)/i);
    const difficulty = parseDifficulty(diffMatch ? diffMatch[1] : null)
      ?? inferDifficulty(sourceId);

    const tagsMatch  = headerOpts.match(/\btags\s*=\s*\{([^}]*)\}/i);
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const titleMatch  = headerOpts.match(/\bsubtitle\s*=\s*\{([^}]*)\}/i);
    const headerTitle = titleMatch ? titleMatch[1].trim() : null;

    // ── Soluzione ──────────────────────────────────────────────────
    let solutionText = '';

    const solInsideIdx = body.indexOf(BEGIN_SOL);
    if (solInsideIdx !== -1) {
      const solBodyStart = solInsideIdx + BEGIN_SOL.length;
      const solEndPos    = body.indexOf(END_SOL, solBodyStart);
      if (solEndPos !== -1) {
        solutionText = body.slice(solBodyStart, solEndPos).trim();
        body = (body.slice(0, solInsideIdx) + body.slice(solEndPos + END_SOL.length)).trim();
      }
    }

    if (!solutionText) {
      const afterQ  = content.slice(qEndTagEnd);
      const trimmed = afterQ.trimStart();
      if (trimmed.startsWith(BEGIN_SOL)) {
        const wsLen       = afterQ.length - trimmed.length;
        const solAbsStart = qEndTagEnd + wsLen + BEGIN_SOL.length;
        const solEndPos   = content.indexOf(END_SOL, solAbsStart);
        if (solEndPos !== -1) {
          solutionText = content.slice(solAbsStart, solEndPos).trim();
          pos = solEndPos + END_SOL.length;
        } else {
          pos = qEndTagEnd;
        }
      } else {
        pos = qEndTagEnd;
      }
    } else {
      pos = qEndTagEnd;
    }

    if (/\\includegraphics/.test(body) && !tags.includes('con immagine')) {
      tags.push('con immagine');
    }

    exercises.push({
      subject,
      category,
      topic,
      difficulty,
      sourceId,
      tags,
      subtitle: headerTitle ?? makeTitleFrom(body, sourceId),
      text:     body,
      solution: normalizeSolution(solutionText),
    });
  }

  return exercises;
}

// ── Main ───────────────────────────────────────────────────────────

const ROOT = __dirname;
const BASE = path.join(ROOT, 'excercises');

const SUBJECT_FOLDERS = [
  { folder: 'physics', subject: 'fisica'     },
  { folder: 'math',    subject: 'matematica' },
];

const allExercises = [];
const topics       = {};
let   globalId     = 1;

console.log('Galileo Hub — build.js\n');

for (const { folder, subject } of SUBJECT_FOLDERS) {
  const folderPath = path.join(BASE, folder);
  if (!fs.existsSync(folderPath)) continue;

  topics[subject] = {};

  const cats = fs.readdirSync(folderPath)
    .filter(e => fs.statSync(path.join(folderPath, e)).isDirectory())
    .sort();

  if (!cats.length) continue;
  console.log(`[${subject}] ${folder}/`);

  for (const cat of cats) {
    const catPath = path.join(folderPath, cat);
    const files   = fs.readdirSync(catPath)
      .filter(f => f.endsWith('.tex'))
      .sort();

    topics[subject][cat] = [];

    for (const file of files) {
      const raw    = fs.readFileSync(path.join(catPath, file), 'utf-8');
      const topic  = toTopicName(file);
      const parsed = parseTex(raw, topic, subject, cat);

      for (const ex of parsed) ex.id = globalId++;

      if (parsed.length && !topics[subject][cat].includes(topic)) {
        topics[subject][cat].push(topic);
      }
      allExercises.push(...parsed);
      console.log(`  [${cat}] ${file.padEnd(38)} ${parsed.length} esercizi`);
    }

    if (!topics[subject][cat].length) delete topics[subject][cat];
  }
}

const catCount = Object.values(topics)
  .reduce((s, cats) => s + Object.keys(cats).length, 0);
const topicCount = Object.values(topics)
  .reduce((s, cats) => s + Object.values(cats).flat().length, 0);

const output = `// AUTO-GENERATED — non modificare manualmente
// Per rigenerare: node build.js

const EXERCISES = ${JSON.stringify(allExercises, null, 2)};

const TOPICS = ${JSON.stringify(topics, null, 2)};
`;

fs.writeFileSync(path.join(ROOT, 'exercises.js'), output, 'utf-8');
console.log(`\nGenerati ${allExercises.length} esercizi — ${catCount} categorie, ${topicCount} argomenti → exercises.js`);
