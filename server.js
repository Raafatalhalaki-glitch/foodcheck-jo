const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '50mb' }));

// ── تحميل البيانات في الذاكرة ──
let CODEX = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'codex_data.json'), 'utf8');
  CODEX = JSON.parse(raw);
  console.log('✅ Codex loaded');
} catch(e) {
  console.error('❌ Failed to load codex:', e.message);
}

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── حماية codex_data.json ──
app.get('/codex_data.json', (req, res) => res.status(403).json({ error: 'Forbidden' }));

// ── API: إحصاءات ──
app.get('/api/stats', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  res.json({
    table1: Object.keys(CODEX.table1).filter(k => k !== 'nan').length,
    table2: Object.keys(CODEX.table2).length,
    table3: Object.keys(CODEX.table3).filter(k => k !== 'nan').length,
    annex: CODEX.annex?.length || 0
  });
});

// ── normalize INS ──
function normalizeINS(code) {
  if (!code) return null;
  let c = String(code).trim().toUpperCase();
  c = c.replace(/^E[-\s]?/, '');
  c = c.replace(/\([ivxIVX]+\)/g, '');
  c = c.replace(/[a-zA-Z]+$/, '');
  return c.trim() || null;
}

function resolveINS(raw) {
  if (!raw || !CODEX) return null;
  const num = normalizeINS(raw);
  if (!num) return null;
  const eToIns = CODEX.e_to_ins || {};
  if (eToIns[num]) {
    const mapped = eToIns[num];
    const mn = normalizeINS(mapped);
    if (CODEX.table1[mn] || CODEX.table3[mn]) return mn;
    if (CODEX.table1[mapped] || CODEX.table3[mapped]) return mapped;
  }
  if (CODEX.table1[num] || CODEX.table3[num]) return num;
  for (const k of Object.keys(CODEX.table1)) {
    if (k !== 'nan' && normalizeINS(k) === num) return k;
  }
  for (const k of Object.keys(CODEX.table3)) {
    if (k !== 'nan' && normalizeINS(k) === num) return k;
  }
  return null;
}

// ── API: فحص مضاف في فئة ──
app.get('/api/check', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const { ins, cat } = req.query;
  if (!ins) return res.status(400).json({ error: 'ins required' });

  const resolvedIns = resolveINS(ins);
  if (!resolvedIns) return res.json({ found: false, ins });

  const t1 = CODEX.table1, t2 = CODEX.table2, t3 = CODEX.table3;
  const annex = CODEX.annex || [];
  const additiveName = t1[resolvedIns]?.name || t3[resolvedIns]?.name || 'INS ' + resolvedIns;

  // حالة أردنية
  const arData = CODEX.arabic_names?.[resolvedIns] || CODEX.additives_db?.[resolvedIns];
  const jordanStatus = arData?.jordan || null;

  const steps = [];
  let verdict = 'forbidden', matchData = null;

  // Table 1
  let t1Match = null;
  if (cat && t1[resolvedIns]) {
    const parts = cat.split('.');
    const variants = [cat, parts.slice(0,2).join('.'), parts[0]].filter(Boolean);
    for (const v of variants) {
      t1Match = t1[resolvedIns].categories.find(c => c.cat_no === v);
      if (t1Match) break;
    }
  }

  if (t1Match) {
    steps.push({ n:1, s:'pass', t:'الجدول 1 — مسموح ✓', d:`${t1Match.cat_no} · ${t1Match.max_level}` });
    steps.push({ n:2, s:'skip', t:'الجدول 2', d:'' });
    steps.push({ n:3, s:'skip', t:'الجدول 3', d:'' });
    verdict = 'permitted'; matchData = { source:'T1', match:t1Match };
  } else {
    steps.push({ n:1, s:'fail', t:'الجدول 1 — غير موجود في هذه الفئة', d:'' });
    let t2Match = null;
    if (cat && t2[cat]) {
      t2Match = t2[cat].find(a => {
        const parts = a.ins.replace(/\s/g,'').split(/[;,]+/);
        return parts.some(p => normalizeINS(p) === resolvedIns || p === resolvedIns);
      });
    }
    if (t2Match) {
      steps.push({ n:2, s:'pass', t:'الجدول 2 — مسموح ✓', d:`${t2Match.max_level}` });
      steps.push({ n:3, s:'skip', t:'الجدول 3', d:'' });
      verdict = 'permitted'; matchData = { source:'T2', match:t2Match };
    } else {
      steps.push({ n:2, s:'fail', t:'الجدول 2 — غير موجود', d:'' });
      const inAnnex = cat ? annex.includes(cat) : false;
      if (inAnnex) {
        steps.push({ n:3, s:'fail', t:'الجدول 3 — مستثنى (Annex)', d:'' });
      } else if (t3[resolvedIns]) {
        steps.push({ n:3, s:'pass', t:'الجدول 3 — مسموح ✓', d:'مضاف عام' });
        verdict = 'permitted'; matchData = { source:'T3', match:t3[resolvedIns] };
      } else {
        steps.push({ n:3, s:'fail', t:'الجدول 3 — غير مدرج', d:'' });
      }
    }
  }

  res.json({ found:true, ins:resolvedIns, additiveName, cat, steps, verdict, matchData, jordanStatus });
});

// ── API: تفاصيل مضاف ──
app.get('/api/additive/:ins', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const ins = req.params.ins.trim();
  const resolved = resolveINS(ins);
  if (!resolved) return res.json({ found: false });
  const t1 = CODEX.table1[resolved] || null;
  const t3 = CODEX.table3[resolved] || null;
  res.json({ found: true, ins: resolved, t1, t3 });
});

// ── API: اسم عربي ──
app.get('/api/arabic-name/:ins', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const ins = req.params.ins.trim();
  const resolved = resolveINS(ins) || normalizeINS(ins);
  const ar = CODEX.arabic_names?.[resolved] || CODEX.additives_db?.[resolved] || null;

  // حالة أردنية
  let jordanMsg = null;
  if (ar?.jordan === 'banned_jordan') jordanMsg = 'ممنوع في الأردن';
  else if (ar?.jordan === 'restricted_jordan') jordanMsg = 'مسموح في العلكة فقط في الأردن';

  res.json({ ar: ar?.ar || null, en: ar?.en || null, eu: ar?.eu || null, jordan: jordanMsg });
});

// ── API: بحث ──
app.get('/api/search', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const q = (req.query.q || '').toUpperCase().trim();
  if (q.length < 2) return res.json([]);
  const results = [];
  const seen = new Set();
  for (const [ins, d] of Object.entries(CODEX.table1)) {
    if (ins === 'nan') continue;
    if (ins.includes(q) || d.name.toUpperCase().includes(q)) {
      if (!seen.has(ins)) { seen.add(ins); results.push({ ins, name: d.name, func: d.functional_class }); }
      if (results.length >= 12) break;
    }
  }
  for (const [ins, d] of Object.entries(CODEX.table3)) {
    if (ins === 'nan' || seen.has(ins)) continue;
    if (ins.includes(q) || d.name.toUpperCase().includes(q)) {
      results.push({ ins, name: d.name, func: d.functional_class });
      if (results.length >= 12) break;
    }
  }
  res.json(results);
});

// ── API: فئة غذائية ──
app.get('/api/food-category', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const catNo = req.query.cat;
  if (!catNo) return res.status(400).json({ error: 'cat required' });
  const t2 = CODEX.table2, t3 = CODEX.table3, t1 = CODEX.table1, annex = CODEX.annex || [];
  function getParents(c) { const p=c.split('.'); return p.slice(0,-1).map((_,i)=>p.slice(0,i+1).join('.')); }
  const cats = [catNo, ...getParents(catNo)];
  const seen = new Set(), permitted = [];
  for (const cat of cats) {
    if (t2[cat]) for (const add of t2[cat]) {
      if (!seen.has(add.ins)) {
        seen.add(add.ins);
        const name = t1[add.ins]?.name || t3[add.ins]?.name || '';
        permitted.push({...add, name, source_cat:cat, inherited:cat!==catNo});
      }
    }
  }
  let inAnnex=false, annexMatch=null;
  for (const c of cats) { if (annex.includes(c)) { inAnnex=true; annexMatch=c; break; } }
  const t3Additives = inAnnex ? [] : Object.entries(t3).filter(([k])=>k!=='nan').map(([ins,d])=>({ins,...d}));
  res.json({ catNo, permitted, inAnnex, annexMatch, t3Additives });
});

// ── API: إحصاءات ──
app.get('/api/categories', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  res.json(CODEX.cat_names || {});
});

// ── Route لـ additives.html ──
app.get('/additives.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'additives.html'));
});

// ── Rate limiting ──
const requests = {};
app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) return res.status(429).json({ error: 'تجاوزت الحد المسموح — حاول بعد ساعة' });
  requests[ip].push(now);
  next();
});

// ── API: تحليل الصورة ──
app.post('/api/analyze', async (req, res) => {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'مفتاح API غير مضبوط' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر: ' + err.message });
  }
});

// ── Catch-all ──
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
