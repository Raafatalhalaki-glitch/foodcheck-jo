const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '50mb' }));

// ── تحميل البيانات في الذاكرة عند بدء السيرفر ──
let CODEX = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'codex_data.json'), 'utf8');
  CODEX = JSON.parse(raw);
  console.log('✅ Codex data loaded in memory');
} catch(e) {
  console.error('❌ Failed to load codex_data.json:', e.message);
}

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── حماية codex_data.json تماماً ──
app.get('/codex_data.json', (req, res) => res.status(403).json({ error: 'Forbidden' }));

// ── API: بحث عن مضاف ──
app.get('/api/additive/:ins', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const ins = req.params.ins.trim();
  const t1 = CODEX.table1[ins] || null;
  const t3 = CODEX.table3[ins] || null;
  if (!t1 && !t3) return res.json({ found: false });
  res.json({ found: true, ins, t1, t3 });
});

// ── API: فحص مضاف في فئة ──
app.get('/api/check', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const { ins, cat } = req.query;
  if (!ins) return res.status(400).json({ error: 'ins required' });

  const t1 = CODEX.table1, t2 = CODEX.table2, t3 = CODEX.table3;
  const annex = CODEX.annex || [];
  const eToIns = CODEX.e_to_ins || {};

  // normalize INS
  function normalizeINS(code) {
    if (!code) return null;
    let c = String(code).trim().toUpperCase();
    c = c.replace(/^E[-\s]?/, '');
    c = c.replace(/\([ivxIVX]+\)/g, '');
    c = c.replace(/[a-zA-Z]+$/, '');
    return c.trim() || null;
  }

  // resolve INS
  function resolveINS(raw) {
    const num = normalizeINS(raw);
    if (!num) return null;
    if (eToIns[num]) {
      const mapped = eToIns[num];
      const mn = normalizeINS(mapped);
      if (t1[mn] || t3[mn]) return mn;
      if (t1[mapped] || t3[mapped]) return mapped;
    }
    if (t1[num] || t3[num]) return num;
    for (const k of Object.keys(t1)) {
      if (k !== 'nan' && normalizeINS(k) === num) return k;
    }
    return null;
  }

  const resolvedIns = resolveINS(ins);
  if (!resolvedIns) return res.json({ found: false, ins });

  const additiveName = t1[resolvedIns]?.name || t3[resolvedIns]?.name || 'INS ' + resolvedIns;
  const steps = [];
  let verdict = 'forbidden';
  let matchData = null;

  // خطوة 1: Table 1
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
    steps.push({ n:1, s:'pass', t:'الجدول 1 — مسموح ✓', d:`الفئة ${t1Match.cat_no} · ${t1Match.max_level}` });
    steps.push({ n:2, s:'skip', t:'الجدول 2', d:'القرار حُسم' });
    steps.push({ n:3, s:'skip', t:'الجدول 3', d:'' });
    verdict = 'permitted'; matchData = { source:'T1', match:t1Match };
  } else {
    steps.push({ n:1, s:'fail', t:'الجدول 1 — غير موجود في هذه الفئة', d:'' });

    // خطوة 2: Table 2
    let t2Match = null;
    if (cat && t2[cat]) {
      t2Match = t2[cat].find(a => {
        const parts = a.ins.replace(/\s/g,'').split(/[;,]+/);
        return parts.some(p => normalizeINS(p) === resolvedIns || p === resolvedIns);
      });
    }

    if (t2Match) {
      steps.push({ n:2, s:'pass', t:'الجدول 2 — مسموح ✓', d:`${t2Match.max_level}` });
      steps.push({ n:3, s:'skip', t:'الجدول 3', d:'القرار حُسم' });
      verdict = 'permitted'; matchData = { source:'T2', match:t2Match };
    } else {
      steps.push({ n:2, s:'fail', t:'الجدول 2 — غير موجود', d:'' });
      const inAnnex = cat ? annex.includes(cat) : false;
      if (inAnnex) {
        steps.push({ n:3, s:'fail', t:'الجدول 3 — مستثنى (Annex)', d:`الفئة ${cat} مستثناة` });
      } else if (t3[resolvedIns]) {
        steps.push({ n:3, s:'pass', t:'الجدول 3 — مسموح ✓', d:'مضاف عام مسموح' });
        verdict = 'permitted'; matchData = { source:'T3', match:t3[resolvedIns] };
      } else {
        steps.push({ n:3, s:'fail', t:'الجدول 3 — غير مدرج', d:'غير مسموح في CXS 192' });
      }
    }
  }

  res.json({ found:true, ins:resolvedIns, additiveName, cat, steps, verdict, matchData });
});

// ── API: بحث batch (فحص قائمة مضافات) ──
app.post('/api/batch-check', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const { additives, cat } = req.body;
  if (!additives || !Array.isArray(additives)) return res.status(400).json({ error: 'additives array required' });

  // نفس منطق الـ check لكل مضاف
  const results = additives.map(add => {
    const checkRes = require('http').get; // placeholder
    return { add, status: 'pending' };
  });

  res.json({ results: additives.map(a => ({ name: a.name, ins: a.ins })) });
});

// ── API: بيانات الإحصاء فقط (بدون البيانات الكاملة) ──
app.get('/api/stats', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  res.json({
    table1: Object.keys(CODEX.table1).filter(k => k !== 'nan').length,
    table2: Object.keys(CODEX.table2).length,
    table3: Object.keys(CODEX.table3).filter(k => k !== 'nan').length,
    annex: CODEX.annex?.length || 0
  });
});

// ── API: autocomplete للمضافات ──
app.get('/api/search', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const q = (req.query.q || '').toUpperCase().trim();
  if (q.length < 2) return res.json([]);

  const results = [];
  for (const [ins, d] of Object.entries(CODEX.table1)) {
    if (ins === 'nan') continue;
    if (ins.includes(q) || d.name.toUpperCase().includes(q)) {
      results.push({ ins, name: d.name, func: d.functional_class });
      if (results.length >= 12) break;
    }
  }
  for (const [ins, d] of Object.entries(CODEX.table3)) {
    if (ins === 'nan' || CODEX.table1[ins]) continue;
    if (ins.includes(q) || d.name.toUpperCase().includes(q)) {
      results.push({ ins, name: d.name, func: d.functional_class });
      if (results.length >= 12) break;
    }
  }
  res.json(results);
});

// ── API: فئات الغذاء ──
app.get('/api/categories', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  res.json(CODEX.cat_names || {});
});


// ── API: فئة غذائية كاملة ──
app.get('/api/food-category', (req, res) => {
  if (!CODEX) return res.status(500).json({ error: 'Data not loaded' });
  const catNo = req.query.cat;
  if (!catNo) return res.status(400).json({ error: 'cat required' });
  const t2=CODEX.table2, t3=CODEX.table3, t1=CODEX.table1, annex=CODEX.annex||[];
  function getParents(c) {
    const p=c.split('.');
    return p.slice(0,-1).map((_,i)=>p.slice(0,i+1).join('.'));
  }
  const cats=[catNo,...getParents(catNo)];
  const seen=new Set(), permitted=[];
  for (const cat of cats) {
    if (t2[cat]) for (const add of t2[cat]) {
      if (!seen.has(add.ins)) {
        seen.add(add.ins);
        const name=t1[add.ins]?.name||t3[add.ins]?.name||'';
        permitted.push({...add,name,source_cat:cat,inherited:cat!==catNo});
      }
    }
  }
  let inAnnex=false, annexMatch=null;
  for (const c of cats) { if (annex.includes(c)){inAnnex=true;annexMatch=c;break;} }
  const t3Additives=inAnnex?[]:Object.entries(t3).filter(([k])=>k!=='nan').map(([ins,d])=>({ins,...d}));
  res.json({catNo,permitted,inAnnex,annexMatch,t3Additives});
});

// ── Route لـ additives.html ──
app.get('/additives.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'additives.html'));
});

// ── Rate limiting للتحليل ──
const requests = {};
app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) {
    return res.status(429).json({ error: 'تجاوزت الحد المسموح — حاول بعد ساعة' });
  }
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
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
