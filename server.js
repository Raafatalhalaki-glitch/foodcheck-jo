const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50mb' }));

// ================================================================
// ===== قاعدة بيانات المضافات — Codex CXS 192 =====
// ================================================================
let additivesDB;
try {
  const Database = require('better-sqlite3');
  additivesDB = new Database(path.join(__dirname, 'codex.db'), { readonly: true });
  console.log('✅ codex.db loaded');
} catch (e) {
  console.warn('⚠️ codex.db not loaded:', e.message);
}

// ================================================================
// ===== نظام GMP/HACCP =====
// ================================================================
let gmpDB;
try {
  const Database = require('better-sqlite3');
  gmpDB = new Database(path.join(__dirname, 'gmp_assessments.db'));
  gmpDB.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      org_name TEXT,
      facility_type TEXT,
      sectors TEXT,
      inputs TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'in_progress'
    );
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id TEXT,
      module_id TEXT,
      rule_id TEXT,
      answer TEXT,
      evidence_status TEXT DEFAULT 'not_provided',
      notes TEXT,
      answered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id TEXT,
      module_id TEXT,
      score REAL,
      critical_count INTEGER,
      major_count INTEGER,
      minor_count INTEGER,
      risk_level TEXT,
      decision TEXT,
      calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_unique ON answers(assessment_id, rule_id);
  `);
  console.log('✅ gmp_assessments.db loaded');
} catch(e) {
  console.warn('⚠️ gmp_assessments.db not loaded:', e.message);
}

// تحميل محرك GMP
let gmpEngine = null;
try {
  const fs = require('fs');
  gmpEngine = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gmp_engine.json'), 'utf8'));
  console.log(`✅ GMP Engine loaded: ${gmpEngine.rules.length} rules`);
} catch(e) {
  console.warn('⚠️ gmp_engine.json not loaded:', e.message);
}

// دوال محرك GMP
function getActiveGMPRules(inputs) {
  if (!gmpEngine) return [];
  return gmpEngine.rules.filter(rule => {
    const applicability = rule['Applicability Rule'] || 'All';
    const sector = rule['Sector'] || 'All';
    if (applicability === 'All') return true;
    if (sector !== 'All' && inputs.sectors) {
      const ruleSectors = sector.split(/[,;/]/).map(s => s.trim().toLowerCase());
      const userSectors = (inputs.sectors || []).map(s => s.toLowerCase());
      const match = ruleSectors.some(rs => userSectors.some(us => us.includes(rs) || rs.includes(us)));
      if (!match && sector !== 'All') return false;
    }
    const trigger = rule['Product / Process Trigger'] || '';
    if (trigger.includes('RTE') && !inputs.rte) return false;
    if (trigger.includes('CIP') && !inputs.cip) return false;
    if (trigger.includes('Animal-derived') && !inputs.animal_origin) return false;
    return true;
  });
}

function calcModuleScore(moduleId, answerMap, activeRules) {
  const moduleRules = activeRules.filter(r => r['Module ID'] === moduleId);
  if (!moduleRules.length) return null;
  let totalWeight = 0, earnedWeight = 0, criticalCount = 0, majorCount = 0, minorCount = 0, criticalFail = false;
  moduleRules.forEach(rule => {
    const answer = answerMap[rule['Rule ID']];
    const severity = rule['Severity'];
    const weight = parseFloat(rule['Weight']) || 0;
    totalWeight += weight;
    if (!answer || answer === 'Not Assessed') return;
    if (answer === 'Yes') { earnedWeight += weight; }
    else if (answer === 'N/A') { totalWeight -= weight; }
    else if (answer === 'No' || answer === 'Partial') {
      if (severity === 'Critical') { criticalCount++; criticalFail = true; }
      else if (severity === 'Major') { majorCount++; }
      else { minorCount++; }
      if (answer === 'Partial') earnedWeight += weight * 0.5;
    }
  });
  const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
  let riskLevel, decision;
  if (criticalFail || score < 60) { riskLevel = 'Critical'; decision = 'FAIL'; }
  else if (score >= 90) { riskLevel = 'Low'; decision = 'PASS'; }
  else if (score >= 75) { riskLevel = 'Medium'; decision = 'CONDITIONAL PASS'; }
  else { riskLevel = 'High'; decision = 'FAIL'; }
  return { moduleId, score: Math.round(score * 10) / 10, totalRules: moduleRules.length, criticalCount, majorCount, minorCount, criticalFail, riskLevel, decision };
}

// ── GMP API Routes ──

app.get('/api/gmp/engine', (req, res) => {
  if (!gmpEngine) return res.status(503).json({ error: 'GMP Engine غير متاح' });
  res.json({
    totalRules: gmpEngine.rules.length,
    modules: ['M01','M02','M03','M04','M05','M06','M07','M08'],
    moduleNames: { M01:'Supplier & Primary Production', M02:'Facility & Infrastructure', M03:'Cleaning & Sanitation', M04:'Pest Control', M05:'Personnel Hygiene', M06:'Operational Control', M07:'Documentation & Evidence', M08:'Traceability & Recall' }
  });
});

app.post('/api/gmp/assessment', (req, res) => {
  if (!gmpDB) return res.status(503).json({ error: 'GMP DB غير متاح' });
  const { org_name, facility_type, sectors, inputs } = req.body;
  if (!org_name || !facility_type || !sectors) return res.status(400).json({ error: 'بيانات ناقصة' });
  const id = 'GMP-' + Date.now() + '-' + Math.random().toString(36).substr(2,6).toUpperCase();
  gmpDB.prepare('INSERT INTO assessments (id,org_name,facility_type,sectors,inputs) VALUES (?,?,?,?,?)')
    .run(id, org_name, facility_type, JSON.stringify(sectors), JSON.stringify(inputs || {}));
  res.json({ assessment_id: id });
});

app.get('/api/gmp/assessment/:id', (req, res) => {
  if (!gmpDB) return res.status(503).json({ error: 'GMP DB غير متاح' });
  const assessment = gmpDB.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'غير موجود' });
  const answers = gmpDB.prepare('SELECT rule_id, answer FROM answers WHERE assessment_id=?').all(req.params.id);
  const answerMap = {};
  answers.forEach(a => { answerMap[a.rule_id] = a.answer; });
  res.json({ ...assessment, answers: answerMap });
});

app.get('/api/gmp/assessment/:id/module/:moduleId', (req, res) => {
  if (!gmpDB || !gmpEngine) return res.status(503).json({ error: 'GMP غير متاح' });
  const assessment = gmpDB.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'غير موجود' });
  const inputs = JSON.parse(assessment.inputs || '{}');
  inputs.sectors = JSON.parse(assessment.sectors || '[]');
  const activeRules = getActiveGMPRules(inputs)
    .filter(r => r['Module ID'] === req.params.moduleId)
    .map(r => ({
      id: r['Rule ID'], category: r['Category'], question: r['Question'],
      hazard: r['Hazard / Risk'], severity: r['Severity'], weight: r['Weight'],
      requiredEvidence: r['Required Evidence'], correctiveAction: r['Corrective Action'],
      haccpTrigger: r['HACCP Trigger'], sopId: r['SOP ID'], reference: r['Codex / EU Reference']
    }));
  const answers = gmpDB.prepare('SELECT rule_id, answer, evidence_status FROM answers WHERE assessment_id=? AND module_id=?').all(req.params.id, req.params.moduleId);
  const answerMap = {};
  answers.forEach(a => { answerMap[a.rule_id] = { answer: a.answer, evidence_status: a.evidence_status }; });
  res.json({ moduleId: req.params.moduleId, totalRules: activeRules.length, rules: activeRules, answers: answerMap });
});

app.post('/api/gmp/assessment/:id/module/:moduleId/answers', (req, res) => {
  if (!gmpDB) return res.status(503).json({ error: 'GMP DB غير متاح' });
  const { answers } = req.body;
  if (!answers) return res.status(400).json({ error: 'لا توجد إجابات' });
  const insertOrReplace = gmpDB.prepare(`
    INSERT INTO answers (assessment_id, module_id, rule_id, answer, evidence_status, notes)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(assessment_id, rule_id) DO UPDATE SET
      answer=excluded.answer, evidence_status=excluded.evidence_status, notes=excluded.notes, answered_at=CURRENT_TIMESTAMP
  `);
  const insertMany = gmpDB.transaction((answers) => {
    for (const [ruleId, data] of Object.entries(answers)) {
      insertOrReplace.run(req.params.id, req.params.moduleId, ruleId, data.answer || data, data.evidence_status || 'not_provided', data.notes || null);
    }
  });
  insertMany(answers);
  const assessment = gmpDB.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id);
  const inputs = JSON.parse(assessment.inputs || '{}');
  inputs.sectors = JSON.parse(assessment.sectors || '[]');
  const activeRules = getActiveGMPRules(inputs);
  const allAnswers = gmpDB.prepare('SELECT rule_id, answer FROM answers WHERE assessment_id=?').all(req.params.id);
  const answerMap = {};
  allAnswers.forEach(a => { answerMap[a.rule_id] = a.answer; });
  const score = calcModuleScore(req.params.moduleId, answerMap, activeRules);
  if (score) {
    gmpDB.prepare('INSERT OR REPLACE INTO results (assessment_id,module_id,score,critical_count,major_count,minor_count,risk_level,decision) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.params.id, req.params.moduleId, score.score, score.criticalCount, score.majorCount, score.minorCount, score.riskLevel, score.decision);
  }
  res.json({ success: true, score });
});

app.get('/api/gmp/assessment/:id/results', (req, res) => {
  if (!gmpDB || !gmpEngine) return res.status(503).json({ error: 'GMP غير متاح' });
  const assessment = gmpDB.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'غير موجود' });
  const inputs = JSON.parse(assessment.inputs || '{}');
  inputs.sectors = JSON.parse(assessment.sectors || '[]');
  const activeRules = getActiveGMPRules(inputs);
  const allAnswers = gmpDB.prepare('SELECT rule_id, answer FROM answers WHERE assessment_id=?').all(req.params.id);
  const answerMap = {};
  allAnswers.forEach(a => { answerMap[a.rule_id] = a.answer; });
  const modules = ['M01','M02','M03','M04','M05','M06','M07','M08'];
  const moduleResults = modules.map(m => calcModuleScore(m, answerMap, activeRules)).filter(Boolean);
  const weights = { M01:15, M02:10, M03:15, M04:10, M05:10, M06:20, M07:10, M08:10 };
  let weightedScore = 0, totalW = 0;
  moduleResults.forEach(r => { const w = weights[r.moduleId]||10; weightedScore += r.score*w; totalW += w; });
  weightedScore = totalW > 0 ? weightedScore/totalW : 0;
  const hasAnyCritical = moduleResults.some(r => r.criticalFail);
  let finalDecision, systemStatus;
  if (hasAnyCritical) { finalDecision='FAIL'; systemStatus='تم تحديد إشكالية حرجة. يلزم إجراء تصحيحي فوري.'; }
  else if (weightedScore>=90) { finalDecision='PASS'; systemStatus='النظام يبدو مضبوطاً بشكل كافٍ بناءً على الإجابات المقدمة.'; }
  else if (weightedScore>=75) { finalDecision='CONDITIONAL PASS'; systemStatus='النظام يحتوي على نقاط ضعف تستوجب خطة CAPA.'; }
  else { finalDecision='FAIL'; systemStatus='ضبط النظام ضعيف. مطلوب خطة تصحيحية شاملة.'; }
  const findings = [];
  activeRules.forEach(rule => {
    const answer = answerMap[rule['Rule ID']];
    if (answer === 'No' || answer === 'Partial') {
      findings.push({ moduleId:rule['Module ID'], ruleId:rule['Rule ID'], question:rule['Question'], severity:rule['Severity'], correctiveAction:rule['Corrective Action'], sopId:rule['SOP ID'] });
    }
  });
  res.json({ assessment:{ id:assessment.id, org_name:assessment.org_name, facility_type:assessment.facility_type, sectors:inputs.sectors }, moduleResults, finalDecision:{ finalDecision, systemStatus, weightedScore:Math.round(weightedScore*10)/10, hasAnyCritical }, findings, totalAnswered:allAnswers.length, totalActive:activeRules.length });
});

// ── GMP Page Routes ──
app.get('/gmp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gmp', 'index.html'));
});

// ================================================================
// ===== Rule Engine — 4-step decision (FIXED) =====
// ================================================================
// Rule Engine — 4-step decision (FIXED)
function checkAdditive(ins, catNo) {
  const result = {
    ins, cat_no: catNo,
    verdict: null, max_level: null,
    additive_name: null, functional_class: null,
    message_ar: null, notes: null, notes_text: [],
    steps: { table1: null, table2: null, table3: null, annex3: false }
  };

  // ── تطبيع رقم INS — يحل مشكلة 170 vs 170(i) ──
  // البحث أولاً بتطابق تام، ثم بـ LIKE للمضافات ذات النسخ (i)(ii)(a)(b)...
  function resolveINS(insInput) {
    // تطابق تام أولاً
    const exact = additivesDB.prepare(
      'SELECT ins FROM additive_info WHERE ins=?'
    ).get(insInput);
    if (exact) return [insInput];

    // بحث LIKE — يلاقي 170(i), 170(ii), 472(a)...
    const variants = additivesDB.prepare(
      "SELECT ins FROM additive_info WHERE ins LIKE ? ORDER BY ins"
    ).all(insInput + '%');
    if (variants.length) return variants.map(v => v.ins);

    // بحث في table1 و table3 مباشرة
    const t1variants = additivesDB.prepare(
      "SELECT DISTINCT ins FROM table1 WHERE ins LIKE ? ORDER BY ins"
    ).all(insInput + '%');
    if (t1variants.length) return t1variants.map(v => v.ins);

    return [insInput]; // إرجاع الأصل إذا ما لقى شي
  }

  const insVariants = resolveINS(ins);
  // نستخدم أول نسخة للبحث الرئيسي، ونحتفظ بالكل للـ fallback
  const primaryINS = insVariants[0];
  result.ins_resolved = insVariants.length > 1 ? insVariants : undefined;

  // ── معلومات المضاف الأساسية ──
  const ai = additivesDB.prepare(
    'SELECT name, functional_class FROM additive_info WHERE ins=?'
  ).get(primaryINS);

  const t3info = additivesDB.prepare(
    'SELECT name, functional_class, max_level, specific_allowance FROM table3 WHERE ins=?'
  ).get(primaryINS);

  if (!ai && !t3info) {
    result.verdict = 'NOT_FOUND';
    result.message_ar = `INS ${ins} غير موجود في قاعدة البيانات`;
    return result;
  }

  result.additive_name  = ai ? ai.name           : t3info.name;
  result.functional_class = ai ? ai.functional_class : (t3info ? t3info.functional_class : '');
  // تحديث الـ ins في النتيجة ليعكس النسخة الفعلية
  if (primaryINS !== ins) {
    result.ins_original = ins;
    result.ins = primaryINS;
  }

  // ── دالة استخراج ملاحظات ──
  function resolveNotes(str) {
    if (!str) return [];
    return str.split(/[,&\s]+/)
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
      .map(id => {
        const n = additivesDB.prepare('SELECT text FROM notes WHERE note_id=?').get(id);
        return n ? { id, text: n.text } : null;
      }).filter(Boolean);
  }

  // ── بناء قائمة الفئات الأعلى (hierarchy) ──
  // مثال: 14.1.4.1 → ['14.1.4.1', '14.1.4', '14.1', '14']
  function getParentCats(cat) {
    const parts = cat.split('.');
    const cats = [];
    for (let i = parts.length; i >= 1; i--) {
      cats.push(parts.slice(0, i).join('.'));
    }
    return cats;
  }

  const catHierarchy = getParentCats(catNo);

  // ════════════════════════════════
  // STEP 1: Table 1 — المضاف مسموح صراحةً في هذه الفئة أو أي فئة أعلى؟
  // ════════════════════════════════
  let t1 = null;
  for (const cat of catHierarchy) {
    t1 = additivesDB.prepare(
      'SELECT * FROM table1 WHERE ins=? AND cat_no=?'
    ).get(primaryINS, cat);
    if (t1) break;
  }
  result.steps.table1 = t1 || null;

  if (t1) {
    result.max_level  = t1.max_level;
    result.notes      = t1.notes;
    result.notes_text = resolveNotes(t1.notes);
    result.verdict    = 'PASS';
    result.message_ar = `مسموح — Table 1 — الفئة: ${t1.cat_no} — الحد: ${t1.max_level}`;
    result.steps.table3 = t3info || null;
    result.steps.annex3 = false; // لا يهم — Table 1 يتغلب
    return result;
  }

  // ════════════════════════════════
  // STEP 2: Table 2 — carry-over أو إذن بالنقل؟
  // ════════════════════════════════
  let t2 = null;
  for (const cat of catHierarchy) {
    t2 = additivesDB.prepare(
      'SELECT * FROM table2 WHERE cat_no=? AND (ins=? OR ins LIKE ?)'
    ).get(cat, primaryINS, `%${primaryINS}%`);
    if (t2) break;
  }
  result.steps.table2 = t2 || null;

  if (t2) {
    result.max_level  = t2.max_level;
    result.notes      = t2.notes;
    result.notes_text = resolveNotes(t2.notes);
    result.verdict    = 'PASS';
    result.message_ar = `مسموح — Table 2 — الحد: ${t2.max_level}`;
    result.steps.table3 = t3info || null;
    result.steps.annex3 = false;
    return result;
  }

  // ════════════════════════════════
  // STEP 3: Table 3 (GMP) — لكن هل الفئة مستثناة في Annex 3؟
  // ════════════════════════════════
  result.steps.table3 = t3info || null;

  // فحص Annex 3 على الفئة الحالية والفئات الأعلى
  let annex = null;
  for (const cat of catHierarchy) {
    annex = additivesDB.prepare(
      'SELECT cat_no FROM annex3 WHERE cat_no=?'
    ).get(cat);
    if (annex) break;
  }
  result.steps.annex3 = !!annex;

  if (t3info) {
    if (annex) {
      // الفئة مستثناة من GMP → المضاف غير مسموح
      result.verdict    = 'FAIL';
      result.message_ar = `غير مسموح — الفئة ${annex.cat_no} مستثناة في Annex 3 من شروط Table 3 (GMP)`;
    } else {
      // GMP — مسموح بكميات تقنية ضرورية
      result.verdict    = 'PASS';
      result.max_level  = t3info.max_level || 'GMP';
      result.message_ar = `مسموح — Table 3 GMP — الفئة غير مستثناة`;
    }
    return result;
  }

  // ════════════════════════════════
  // STEP 4: البحث في الفئات الفرعية (للأسفل)
  // مثال: المستخدم حط 08.2 لكن الإذن موجود في 08.2.2
  // ════════════════════════════════
  const subT1 = additivesDB.prepare(
    "SELECT * FROM table1 WHERE ins=? AND cat_no LIKE ? ORDER BY cat_no LIMIT 1"
  ).get(primaryINS, catNo + '.%');

  if (subT1) {
    result.max_level  = subT1.max_level;
    result.notes      = subT1.notes;
    result.notes_text = resolveNotes(subT1.notes);
    result.verdict    = 'PASS';
    result.message_ar = `مسموح — Table 1 — الفئة الفرعية: ${subT1.cat_no} — الحد: ${subT1.max_level} (تم البحث تلقائياً في الفئات الفرعية لـ ${catNo})`;
    result.steps.table1 = subT1;
    return result;
  }

  // ════════════════════════════════
  // STEP 5: غير موجود في أي جدول أو فئة فرعية
  // ════════════════════════════════
  result.verdict    = 'FAIL';
  result.message_ar = `غير مسموح — INS ${ins} غير مدرج في أي جدول لهذه الفئة الغذائية`;
  return result;
}


// API Routes — المضافات
app.get('/api/additives/check', (req, res) => {
  if (!additivesDB) return res.status(503).json({ error: 'قاعدة البيانات غير متاحة' });
  const { ins, cat } = req.query;
  if (!ins || !cat) return res.status(400).json({ error: 'ins و cat مطلوبان' });
  try { res.json(checkAdditive(ins.trim(), cat.trim())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/additives/search', (req, res) => {
  if (!additivesDB) return res.status(503).json({ error: 'قاعدة البيانات غير متاحة' });
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q مطلوب' });
  try {
    const results = /^\d+$/.test(q)
      ? additivesDB.prepare('SELECT ins, name, functional_class FROM additive_info WHERE ins LIKE ?').all(`${q}%`).slice(0, 15)
      : additivesDB.prepare('SELECT ins, name, functional_class FROM additive_info WHERE name LIKE ? COLLATE NOCASE').all(`%${q}%`).slice(0, 15);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/additives/categories', (req, res) => {
  if (!additivesDB) return res.status(503).json({ error: 'قاعدة البيانات غير متاحة' });
  try { res.json(additivesDB.prepare('SELECT cat_no, cat_name, parent FROM food_categories ORDER BY cat_no').all()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/additives/category-additives', (req, res) => {
  if (!additivesDB) return res.status(503).json({ error: 'قاعدة البيانات غير متاحة' });
  const cat = (req.query.cat || '').trim();
  if (!cat) return res.status(400).json({ error: 'cat مطلوب' });
  try {
    res.json({
      cat_no: cat,
      table1: additivesDB.prepare('SELECT ins, cat_name, max_level, notes FROM table1 WHERE cat_no=? ORDER BY ins').all(cat),
      table2: additivesDB.prepare('SELECT ins, name, max_level, notes FROM table2 WHERE cat_no=? ORDER BY ins').all(cat)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ملفات ثابتة من public
app.use(express.static(path.join(__dirname, 'public')));

// Routes صريحة للصفحات
app.get('/additives.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'additives.html'));
});
app.get('/shelf-life.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shelf-life.html'));
});
app.get('/restaurant-shelf-life.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'restaurant-shelf-life.html'));
});
app.get('/report.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});
app.get('/codex_data.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'codex_data.json'));
});

// ================================================================
// ===== نظام عداد الفحوصات =====
// ================================================================

// قاعدة بيانات بسيطة في الذاكرة
// (تُعاد عند إعادة تشغيل السيرفر — كافية للمرحلة الحالية)
const usageDB = {
  // بالـ IP: { daily: [{timestamp}], total: number }
  byIP: {},
  // إجماليات
  stats: {
    total_checks: 0,
    today_checks: 0,
    last_reset: new Date().toDateString()
  }
};

// الحد اليومي للزوار غير المسجلين
const FREE_DAILY_LIMIT = 5;

// دالة تنظيف الإحصائيات اليومية
function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (usageDB.stats.last_reset !== today) {
    usageDB.stats.today_checks = 0;
    usageDB.stats.last_reset = today;
    // تنظيف السجلات القديمة لكل IP
    for (const ip in usageDB.byIP) {
      const now = Date.now();
      usageDB.byIP[ip].daily = usageDB.byIP[ip].daily.filter(
        t => now - t < 24 * 60 * 60 * 1000
      );
    }
  }
}

// ================================================================
// ===== تسجيل المستخدمين =====
// ================================================================

const registeredUsers = []; // في الذاكرة — سنحوّله لـ DB لاحقاً

app.post('/api/register', (req, res) => {
  const { name, email, company } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'الاسم والبريد مطلوبان' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;

  // تحقق إذا مسجل مسبقاً
  const existing = registeredUsers.find(u => u.email === email);
  if (existing) {
    // منح فحوصات إضافية
    if (usageDB.byIP[ip]) {
      usageDB.byIP[ip].registered = true;
      usageDB.byIP[ip].limit = 30; // 30 فحص/شهر للمسجلين
    }
    return res.json({
      success: true,
      message: 'مرحباً بعودتك!',
      limit: 30
    });
  }

  // تسجيل جديد
  registeredUsers.push({
    name, email,
    company: company || '',
    ip,
    registered_at: new Date().toISOString()
  });

  // منح فحوصات إضافية
  if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };
  usageDB.byIP[ip].registered = true;
  usageDB.byIP[ip].limit = 30;

  console.log(`✅ مستخدم جديد: ${name} | ${email} | ${company || 'غير محدد'}`);

  res.json({
    success: true,
    message: 'تم التسجيل! حصلت على 30 فحص/شهر مجاناً',
    limit: 30,
    total_users: registeredUsers.length
  });
});

// عرض المسجلين (للمطور فقط)
app.get('/api/admin/users', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  res.json({
    total: registeredUsers.length,
    users: registeredUsers
  });
});

// API للحصول على معلومات الاستخدام
app.get('/api/usage', (req, res) => {
  resetDailyIfNeeded();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;
  const userUsage = usageDB.byIP[ip] || { daily: [], total: 0 };
  const now = Date.now();
  const todayCount = userUsage.daily.filter(
    t => now - t < 24 * 60 * 60 * 1000
  ).length;

  res.json({
    today: todayCount,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - todayCount),
    total: userUsage.total || 0,
    canCheck: todayCount < FREE_DAILY_LIMIT
  });
});

// API إحصائيات عامة (للـ dashboard لاحقاً)
app.get('/api/stats', (req, res) => {
  resetDailyIfNeeded();
  res.json({
    total_checks: usageDB.stats.total_checks,
    today_checks: usageDB.stats.today_checks,
    active_ips: Object.keys(usageDB.byIP).length
  });
});

// ================================================================
// ===== Rate Limiting + Usage Counter =====
// ================================================================

const requests = {};

app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;
  const now = Date.now();

  // Rate limiting (10 طلبات/ساعة — للحماية من الاستخدام المفرط)
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) {
    return res.status(429).json({
      error: 'تجاوزت الحد المسموح — حاول بعد ساعة',
      type: 'rate_limit'
    });
  }

  // عداد الفحوصات اليومية
  resetDailyIfNeeded();
  if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };

  const userLimit = usageDB.byIP[ip].registered ? 30 : FREE_DAILY_LIMIT;
  const todayChecks = usageDB.byIP[ip].daily.filter(
    t => now - t < 24 * 60 * 60 * 1000
  ).length;

  if (todayChecks >= userLimit) {
    return res.status(429).json({
      error: usageDB.byIP[ip].registered
        ? `وصلت للحد الشهري (${userLimit} فحص) — تواصل معنا للترقية`
        : `وصلت للحد اليومي المجاني (${FREE_DAILY_LIMIT} فحوصات)`,
      type: 'daily_limit',
      today: todayChecks,
      limit: userLimit,
      registered: usageDB.byIP[ip].registered || false
    });
  }

  // تسجيل الطلب
  requests[ip].push(now);
  req._ip = ip;
  next();
});

// ================================================================
// ===== API التحليل الرئيسي =====
// ================================================================

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

    // تسجيل الاستخدام بعد نجاح التحليل
    if (response.ok && req._ip) {
      const ip = req._ip;
      const now = Date.now();
      usageDB.byIP[ip].daily.push(now);
      usageDB.byIP[ip].total = (usageDB.byIP[ip].total || 0) + 1;
      usageDB.stats.total_checks++;
      usageDB.stats.today_checks++;

      // إضافة معلومات الاستخدام للرد
      const todayCount = usageDB.byIP[ip].daily.filter(
        t => now - t < 24 * 60 * 60 * 1000
      ).length;
      data._usage = {
        today: todayCount,
        limit: FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - todayCount)
      };
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر: ' + err.message });
  }
});

// الصفحة الرئيسية
app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
