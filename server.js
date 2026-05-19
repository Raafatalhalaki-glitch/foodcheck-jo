const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();
app.use(express.json({ limit: '50mb' }));

// ================================================================
// ===== حماية مجلد data/ من الوصول المباشر =====
// ================================================================
app.get('/data/*', (req, res) => {
  res.status(403).json({ error: 'Access denied' });
});



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
      id: r['Rule ID'],
      category: r['Category'],
      categoryAr: r['Category_AR'] || r['Category'],
      question: r['Question'],
      questionAr: r['Question_AR'] || null,
      hazard: r['Hazard / Risk'],
      hazardAr: r['HazardRisk_AR'] || null,
      severity: r['Severity'],
      severityAr: r['Severity_AR'] || r['Severity'],
      weight: r['Weight'],
      requiredEvidence: r['Required Evidence'],
      requiredEvidenceAr: r['RequiredEvidence_AR'] || null,
      correctiveAction: r['Corrective Action'],
      correctiveActionAr: r['CorrectiveAction_AR'] || null,
      haccpTrigger: r['HACCP Trigger'],
      sopId: r['SOP ID'],
      reference: r['Codex / EU Reference']
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
function checkAdditive(ins, catNo) {
  const result = {
    ins, cat_no: catNo,
    verdict: null, max_level: null,
    additive_name: null, functional_class: null,
    message_ar: null, notes: null, notes_text: [],
    steps: { table1: null, table2: null, table3: null, annex3: false }
  };

  const ai = additivesDB.prepare(
    'SELECT name, functional_class FROM additive_info WHERE ins=?'
  ).get(ins);

  const t3info = additivesDB.prepare(
    'SELECT name, functional_class, max_level, specific_allowance FROM table3 WHERE ins=?'
  ).get(ins);

  if (!ai && !t3info) {
    result.verdict = 'NOT_FOUND';
    result.message_ar = `INS ${ins} غير موجود في قاعدة البيانات`;
    return result;
  }

  result.additive_name  = ai ? ai.name           : t3info.name;
  result.functional_class = ai ? ai.functional_class : (t3info ? t3info.functional_class : '');

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

  function getParentCats(cat) {
    const parts = cat.split('.');
    const cats = [];
    for (let i = parts.length; i >= 1; i--) {
      cats.push(parts.slice(0, i).join('.'));
    }
    return cats;
  }

  const catHierarchy = getParentCats(catNo);

  // STEP 1: Table 1
  let t1 = null;
  for (const cat of catHierarchy) {
    t1 = additivesDB.prepare(
      'SELECT * FROM table1 WHERE ins=? AND cat_no=?'
    ).get(ins, cat);
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
    result.steps.annex3 = false;
    return result;
  }

  // STEP 2: Table 2
  let t2 = null;
  for (const cat of catHierarchy) {
    t2 = additivesDB.prepare(
      'SELECT * FROM table2 WHERE cat_no=? AND (ins=? OR ins LIKE ?)'
    ).get(cat, ins, `%${ins}%`);
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

  // STEP 3: Table 3 (GMP)
  result.steps.table3 = t3info || null;

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
      result.verdict    = 'FAIL';
      result.message_ar = `غير مسموح — الفئة ${annex.cat_no} مستثناة في Annex 3 من شروط Table 3 (GMP)`;
    } else {
      result.verdict    = 'PASS';
      result.max_level  = t3info.max_level || 'GMP';
      result.message_ar = `مسموح — Table 3 GMP — الفئة غير مستثناة`;
    }
    return result;
  }

  // STEP 4: غير موجود
  result.verdict    = 'FAIL';
  result.message_ar = `غير مسموح — INS ${ins} غير مدرج في أي جدول لهذه الفئة الغذائية`;
  return result;
}

// ================================================================
// PRODUCT_CAT_MAP — النسخة المصححة والمكتملة
// مراجعة: 18 مايو 2026
// المصدر: CXS 192:2025 — Annex B + Annex C
// ================================================================
// هذا الـ map يُستخدم في:
//   1. server.js (داخل verifyAdditives)
//   2. data/rules-additives.js (داخل verifyExtractedAdditives)
// كلا الملفين يحتاج نفس التعديلات بالضبط.
// ================================================================

const PRODUCT_CAT_MAP = {

  // ── 01: منتجات الألبان ──────────────────────────────────────
  dairy:                  '01.0',   // عام لكل منتجات الألبان

  // حليب سائل
  uht_milk:               '01.1.1', // حليب UHT / مبستر / معقم — CXS 281
  flavored_milk:          '01.1.4', // حليب منكّه (شوكولاتة، فراولة...)

  // حليب مخمر
  yoghurt:                '01.2.1.2', // لبن / زبادي — plain, heat-treated after fermentation
  labneh:                 '01.2.1.2',   // لبنة = unripened cheese

  // حليب مركّز (01.3)
  evaporated_milk:        '01.3.1', // حليب مبخر (plain) — CXS 281-1971
  condensed_milk:         '01.3.1', // حليب مكثف محلى (plain) — CXS 282-1971
  filled_evaporated_milk: '01.3.2', // حليب مبخر + دهون نباتية — CXS 250-2006
  filled_condensed_milk:  '01.3.2', // حليب مكثف + دهون نباتية — CXS 252-2006
  beverage_whitener:      '01.3.2', // مبيّض مشروبات

  // حليب مجفف (01.5)
  dried_milk:             '01.5.1', // حليب بودرة / كريمة بودرة — CXS 207-1999
  filled_dried_milk:      '01.5.2', // حليب بودرة + دهون نباتية — CXS 251-2006

  // كريمة (01.4) — CXS 288-1976
  cream:                  '01.4.2', // كريمة UHT / sterilized / whipping (الأكثر شيوعاً في السوق)
  cream_pasteurized:      '01.4.1', // كريمة مبسترة طازجة
  cream_fermented:        '01.4.3', // كريمة مخمرة / حامضية / sour cream
  cream_analogue:         '01.4.4', // كريمة نباتية للتقديم (non-dairy topping/whipping)

  // أجبان (01.6)
  soft_cheese:            '01.6.1', // أجبان طرية / نيئة: نابلسية، عكاوي، فيتا، موزاريلا طرية — CXS 221-2001
  ripened_cheese:         '01.6.2.1', // أجبان معتقة: Edam، Gouda، Brie، Cheddar — Annex B
  processed_cheese:       '01.6.4', // أجبان مطبوخة / مجهزة — Annex B

  // حلويات ألبان وآيس كريم
  ice_cream:              '01.7',   // آيس كريم بمنتجات حليب — CXS 192 Descriptor 01.7
  sorbet:                 '03.0',   // سوربيه / شربات / مثلجات مائية بدون حليب — 03.0

  // ── 02: دهون وزيوت ──────────────────────────────────────────
  ghee:                   '02.1.1', // سمن حيواني / butter oil — Annex B
  vegetable_oil:          '02.1.2', // زيوت نباتية (زيتون، عباد، ذرة...) — CXS 33-1981
  animal_fat:             '02.1.3', // دهون حيوانية (شحم، تالو، زيت سمك) — Annex B
  butter:                 '02.2.1', // زبدة — Annex B
  margarine:              '02.2.2', // مارجرين / سمن نباتي — Annex B
  cooking_cream:          '02.3',   // كريمة طبخ نباتية (oil-in-water emulsion) — CXS 192 Descriptor 02.3

  // ── 04: فواكه وخضار ─────────────────────────────────────────
  // فواكه مجففة
  dates:                  '04.1.2.2', // تمر مجفف — CXS 360-2020
  dried_fruit:            '04.1.2.2', // فواكه مجففة عامة — CXS 360-2020
  jam:                    '04.1.2.5', // مربيات / جيلي / مارملاد — Annex B

  // خضار مجمدة
  quick_frozen_fries:     '04.2.2.1', // بطاطا مجمدة — CXS 192 Descriptor 04.2.2.1
  frozen_vegetables:      '04.2.2.1', // خضار مجمدة عامة

  // خضار مجففة (شاملة المكسرات النيئة)
  raw_nuts:               '04.2.2.2', // مكسرات نيئة/مجففة (فستق، لوز، كاجو نيء) — Annex B
  unshelled_pistachio:    '04.2.2.2', // فستق غير محمص — Annex B
  peanuts:                '04.2.2.2', // فول سوداني نيء — Annex B
  decorticated_pine_nuts: '04.2.2.2', // صنوبر نيء — Annex B

  // خضار مخللة وزيتون
  table_olives:           '04.2.2.3', // زيتون مائدة — CXS 66-1981
  pickled_vegetables:     '04.2.2.3', // مخللات خضار عامة — Annex B

  // خضار معلبة (04.2.2.4)
  tomato_concentrate:     '04.2.2.4', // رب بندورة معلب (canned tomato paste) — CXS 57-1981
  preserved_tomatoes:     '04.2.2.4', // بندورة محفوظة معلبة — CXS 13-1981
  canned_vegetables:      '04.2.2.4', // خضار معلبة عامة — CXS 297-2009
  foul_medames:           '04.2.2.4', // فول مدمس معلب — CXS 258R-2007
  hummus:                 '04.2.2.4', // حمص بالطحينية معلب — CXS 257R-2007

  // هريس خضار (04.2.2.5)
  tomato_puree:           '04.2.2.5', // هريس بندورة / لب بندورة (<24% مواد صلبة) — CXS 57-1981

  // معجون/مستخلص خضار (04.2.2.6)
  tahini:                 '04.2.2.6', // طحينية — CXS 259R-2007
  tomato_paste:           '04.2.2.6', // معجون بندورة (paste غير معلب) — CXS 57-1981

  // ── 05: حلويات ──────────────────────────────────────────────
  chocolate:              '05.1.4', // شوكولاتة ومنتجاتها — Annex B
  cocoa_powder:           '05.1.1', // مسحوق كاكاو وخلطاته — Annex B
  cocoa_spread:           '05.1.3', // دهن كاكاو (نوتيلا وما شابه) — Annex B
  hard_candy:             '05.2.1', // حلوى صلبة — Annex B
  candy:                  '05.2.2', // حلوى طرية (default) — Annex B
  soft_candy:             '05.2.2', // حلوى طرية — Annex B
  nougat:                 '05.2.3', // نوجا ومرزبان — Annex B
  chewing_gum:            '05.3',   // علكة — Annex B

  // ── 06: حبوب ومنتجاتها ──────────────────────────────────────
  rice:                   '06.1',   // أرز — Annex B
  flour:                  '06.2.1', // طحين قمح — Annex B
  breakfast_cereal:       '06.3',   // حبوب إفطار (كورن فليكس، شوفان) — Annex B
  pasta:                  '06.4.2', // معكرونة/شعيرية جافة — Annex B
  noodles:                '06.4.3', // نودلز سريعة التحضير — Annex B

  // ── 07: مخبوزات ──────────────────────────────────────────────
  bakery:                 '07.1',   // خبز عادي (default) — Annex B
  bread:                  '07.1.1', // خبز وأرغفة — Annex B
  biscuit:                '07.2.1', // بسكويت، كوكيز، كراكر — Annex B (تصحيح من 07.1.2)
  fine_bakery:            '07.2.2', // كيك، مافن، دونات — Annex B

  // ── 08: لحوم ─────────────────────────────────────────────────
  meat:                   '08.0',   // لحوم عامة
  processed_meat:         '08.3.2', // لانشون / سوسج / كورند بيف (heat-treated comminuted)
  salami:                 '08.3.1.2', // سلامي (fermented + dried, non-heat treated)
  salami_cooked:          '08.3.2',   // سلامي مطبوخ
  cured_meat:             '08.2',     // لحم مملح/معالج

  // ── 09: أسماك ────────────────────────────────────────────────
  fish:                   '09.0',   // أسماك عامة
  frozen_fish:            '09.2.1', // أسماك مجمدة — Annex B (CXS 36-1981)
  sardines:               '09.4',   // سردين معلب — CXS 94-1981
  tuna_bonito:            '09.4',   // تونة/بونيتو معلب — CXS 70-1981
  canned_fish:            '09.4',   // أسماك معلبة عامة

  // ── 10: بيض ──────────────────────────────────────────────────
  eggs:                   '10.1',   // بيض طازج — Annex B
  liquid_eggs:            '10.2.1', // بيض سائل — Annex B

  // ── 11: سكر وعسل ─────────────────────────────────────────────
  sugar:                  '11.1.1', // سكر أبيض مكرر — Annex B
  honey:                  '11.5',   // عسل — CXS 12-1981

  // ── 12: توابل وصلصات ─────────────────────────────────────────
  salt:                   '12.1.1', // ملح طعام — Annex B
  spices:                 '12.2.1', // بهارات وأعشاب (كمون، كركم، فلفل...) — Annex B
  cinnamon:               '12.2.1',
  black_pepper:           '12.2.1',
  paprika:                '12.2.1',
  cumin:                  '12.2.1',
  turmeric:               '12.2.1',
  flower_water:           '12.2.1',
  seasoning_blend:        '12.2.2', // خلطات تتبيل (زعتر بزيت...) — Annex B
  vinegar:                '12.3',   // خل — Annex B
  mustard:                '12.4',   // خردل — Annex B
  mayonnaise:             '12.6.1', // مايونيز / صلصات مستحلبة — Annex B
  ketchup:                '12.6.2', // كاتشب / صلصات غير مستحلبة — CXS 306-2011
  fish_sauce:             '12.6.4', // صلصة سمك — CXS 302-2011
  soy_sauce:              '12.9.2.1', // صلصة صويا مخمرة — Annex B

  // ── 13: أغذية لأغراض خاصة ────────────────────────────────────
  infant_formula:         '13.1.1', // تركيبة رضع — CXS 72-1981
  fsmp_infant_formula:    '13.1.3', // تركيبة لأغراض طبية خاصة للرضع — CXS 72-1981
  follow_up_formula:      '13.1.2', // تركيبة متابعة — Annex B
  cereal_infant:          '13.2',   // غذاء تكميلي للرضع — Annex B
  supplements:            '13.6',   // مكملات غذائية — Annex B

  // ── 14: مشروبات ──────────────────────────────────────────────
  beverages:              '14.1',   // مشروبات عامة
  mineral_water:          '14.1.1.1', // مياه معدنية — Annex B
  fruit_juice:            '14.1.2.1', // عصير فواكه — Annex B
  juice:                  '14.1.2.1',
  vegetable_juice:        '14.1.2.2', // عصير خضار — Annex B
  fruit_nectar:           '14.1.3.1', // رحيق فواكه — Annex B
  flavored_drink:         '14.1.4',   // مشروبات نكهات / غازية — Annex B
  energy_drink:           '14.1.4',   // مشروبات طاقة — Annex B
  fruit_syrup:            '14.1.4',   // شراب فواكه — Annex B
  beer:                   '14.2.1', // بيرة وشراب شعير — Annex B
  wine:                   '14.2.3', // نبيذ عنب — Annex B

  // ── 15: وجبات خفيفة ──────────────────────────────────────────
  corn_chips:             '15.1',   // شيبس، بوبكورن، بريتزل — Annex B
  potato_chips:           '15.1',   // شيبس بطاطا — Annex B
  roasted_nuts:           '15.2',   // مكسرات محمصة/مبهرة/مملحة — Annex B

  // ── 16: أطعمة مركبة جاهزة ────────────────────────────────────
  ready_meal:             '16.0',   // وجبات جاهزة مركبة — Annex B

  // ── بدون تصنيف (يحتاج مراجعة يدوية) ─────────────────────────
  claims_product:         null,
  general:                null,
  auto:                   null,
};

// ================================================================
// ===== Verify Additives via checkAdditive() =====
// ================================================================
function verifyAdditives(additives, productType) {
  if (!additivesDB || !additives || !additives.length) return [];
  const catNo = PRODUCT_CAT_MAP[productType] || null;
  const results = [];
  for (const add of additives) {
    try {
      const insRaw = (add.ins || '').toString().replace(/^E/i, '').trim();
      if (!insRaw || !/^\d+$/.test(insRaw)) {
        results.push({ ...add, verdict: 'NO_INS', catNo, message: 'رقم INS غير متاح — تحقق يدوياً' });
        continue;
      }
      const result = checkAdditive(insRaw, catNo || '');
      results.push({
        name: add.name,
        name_en: add.name_en || '',
        ins: insRaw,
        catNo,
        verdict: result.verdict,
        max_level: result.max_level,
        additive_name: result.additive_name,
        functional_class: result.functional_class,
        message: result.message_ar,
        notes_text: result.notes_text || [],
      });
    } catch (e) {
      results.push({ ...add, verdict: 'ERROR', message: e.message });
    }
  }
  return results;
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
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ================================================================
// ===== قاعدة بيانات المستخدمين — SQLite (دائمة) =====
// ================================================================
let usersDB;
try {
  const Database = require('better-sqlite3');
  usersDB = new Database(path.join(__dirname, 'users.db'));
  usersDB.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      company TEXT,
      ip TEXT,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  console.log('✅ users.db loaded');
} catch(e) {
  console.warn('⚠️ users.db not loaded:', e.message);
}

const SESSION_COOKIE = 'foodcheck_session';
const SESSION_DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_REMEMBER_MS = 30 * SESSION_DAY_MS;

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cookieValue(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

function sessionCookieOptions(req, maxAge) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(req, res, userId, remember) {
  const maxAge = remember ? SESSION_REMEMBER_MS : SESSION_DAY_MS;
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + maxAge).toISOString();

  usersDB.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  usersDB.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?,?,?)')
    .run(userId, tokenHash(token), expiresAt);

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req, maxAge));
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req, 0));
}

function getSessionUser(req) {
  if (!usersDB) return null;
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;

  const session = usersDB.prepare(`
    SELECT sessions.id as session_id, users.id, users.email, users.name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), new Date().toISOString());

  return session || null;
}

// ================================================================
// ===== نظام عداد الفحوصات =====
// ================================================================
const usageDB = {
  byIP: {},
  stats: {
    total_checks: 0,
    today_checks: 0,
    last_reset: new Date().toDateString()
  }
};

const FREE_DAILY_LIMIT = 5;

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (usageDB.stats.last_reset !== today) {
    usageDB.stats.today_checks = 0;
    usageDB.stats.last_reset = today;
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

app.post('/api/register', (req, res) => {
  const { name, email, company } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'الاسم والبريد مطلوبان' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;

  try {
    const existing = usersDB.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (existing) {
      if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };
      usageDB.byIP[ip].registered = true;
      usageDB.byIP[ip].limit = 30;
      return res.json({
        success: true,
        message: 'مرحباً بعودتك!',
        limit: 30
      });
    }

    usersDB.prepare('INSERT INTO users (name, email, company, ip) VALUES (?,?,?,?)')
      .run(name, email, company || '', ip);

    if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };
    usageDB.byIP[ip].registered = true;
    usageDB.byIP[ip].limit = 30;

    const total = usersDB.prepare('SELECT COUNT(*) as count FROM users').get().count;
    console.log(`✅ مستخدم جديد: ${name} | ${email} | ${company || 'غير محدد'}`);

    res.json({
      success: true,
      message: 'تم التسجيل! حصلت على 30 فحص/شهر مجاناً',
      limit: 30,
      total_users: total
    });
  } catch(e) {
    res.status(500).json({ error: 'خطأ في التسجيل: ' + e.message });
  }
});

// Email-only MVP auth: create user if needed, then start a session.
app.post('/api/auth/email', (req, res) => {
  if (!usersDB) return res.status(503).json({ error: 'قاعدة المستخدمين غير متاحة' });

  const email = normalizeEmail(req.body.email);
  const remember = !!req.body.remember;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;

  try {
    let user = usersDB.prepare('SELECT id, name, email FROM users WHERE email=?').get(email);
    let created = false;

    if (!user) {
      const fallbackName = email.split('@')[0] || 'FoodCheck User';
      const result = usersDB.prepare('INSERT INTO users (name, email, company, ip) VALUES (?,?,?,?)')
        .run(fallbackName, email, '', ip);
      user = { id: result.lastInsertRowid, name: fallbackName, email };
      created = true;
    }

    if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };
    usageDB.byIP[ip].registered = true;
    usageDB.byIP[ip].limit = 30;

    createSession(req, res, user.id, remember);
    res.json({ success: true, created, user: { email: user.email } });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في تسجيل الدخول: ' + e.message });
  }
});

app.get('/api/auth/session', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: { email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  if (usersDB) {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) {
      usersDB.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    }
  }
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// عرض المسجلين (للمطور فقط)
app.get('/api/admin/users', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const users = usersDB.prepare('SELECT * FROM users ORDER BY registered_at DESC').all();
  res.json({
    total: users.length,
    users
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

// API إحصائيات عامة
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

  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) {
    return res.status(429).json({
      error: 'تجاوزت الحد المسموح — حاول بعد ساعة',
      type: 'rate_limit'
    });
  }

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

    // استخرج productType واحذفه من body قبل الإرسال لـ Claude
    const { _productType, ...claudeBody } = req.body;
    const productType = _productType || 'general';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudeBody)
    });

    const data = await response.json();

    if (response.ok && req._ip) {
      const ip = req._ip;
      const now = Date.now();
      usageDB.byIP[ip].daily.push(now);
      usageDB.byIP[ip].total = (usageDB.byIP[ip].total || 0) + 1;
      usageDB.stats.total_checks++;
      usageDB.stats.today_checks++;

      const todayCount = usageDB.byIP[ip].daily.filter(
        t => now - t < 24 * 60 * 60 * 1000
      ).length;
      data._usage = {
        today: todayCount,
        limit: FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - todayCount)
      };
    }

    // ── فحص المضافات عبر قاعدة البيانات ──
    if (response.ok && data.content && data.content[0] && data.content[0].text) {
      try {
        const rawText = data.content[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          if (parsed.additives && parsed.additives.length > 0) {
            const verified = verifyAdditives(parsed.additives, productType);
            parsed.additives_verified = verified;

            // أضف مخالفات للمضافات الممنوعة
            const forbidden = verified.filter(v => v.verdict === 'FAIL');
            if (forbidden.length > 0 && parsed.results) {
              forbidden.forEach(f => {
                parsed.results.push({
                  code: `CXS192-${f.ins}`,
                  rule: `مضاف غير مسموح: ${f.additive_name || f.name} (INS ${f.ins})`,
                  category: 'مضافات',
                  requirement: `INS ${f.ins} غير مسموح في الفئة ${f.catNo || 'غير محددة'} حسب Codex CXS 192`,
                  status: 'critical',
                  note: f.message || 'غير مسموح حسب جداول CXS 192',
                  solution: `احذف المضاف INS ${f.ins} أو استبدله بمضاف مسموح في هذه الفئة الغذائية`
                });
              });
            }

            // أعد كتابة الـ JSON في النص
            data.content[0].text = rawText.replace(
              jsonMatch[0],
              JSON.stringify(parsed)
            );
          }
        }
      } catch (parseErr) {
        console.warn('⚠️ additives verify failed:', parseErr.message);
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر: ' + err.message });
  }
});
// ================================================================
// ================================================================
// ============= PHASE 3 ARCHITECTURE — START =====================
// ================================================================
// ================================================================
// This block adds the new /api/analyze-v2 endpoint that uses:
//   - data/extraction-prompt.js (Claude extracts raw data only)
//   - data/rules-additives.js (deterministic additives verification)
//
// The legacy /api/analyze endpoint above is UNTOUCHED.
// Both endpoints run side-by-side for safe comparison.
// ================================================================

// Load Phase 3 modules (with safe fallback if files missing)
let extractionPromptModule = null;
let rulesAdditivesModule = null;
try {
  extractionPromptModule = require('./data/extraction-prompt.js');
  console.log('✅ Phase 3: extraction-prompt.js loaded');
} catch(e) {
  console.warn('⚠️ Phase 3: extraction-prompt.js NOT loaded:', e.message);
}
try {
  rulesAdditivesModule = require('./data/rules-additives.js');
  console.log('✅ Phase 3: rules-additives.js loaded');
} catch(e) {
  console.warn('⚠️ Phase 3: rules-additives.js NOT loaded:', e.message);
}

// ─── Phase 3 Step 2 — Matching Layer (Annex C → Codex Category) ───
let matchingLayerModule = null;
try {
  matchingLayerModule = require('./data/matching-layer.js');
  console.log('✅ Phase 3 Step 2: matching-layer.js loaded');
} catch(e) {
  console.warn('⚠️ Phase 3 Step 2: matching-layer.js NOT loaded:', e.message);
}

// ================================================================
// NEW ENDPOINT: /api/analyze-v2 (Phase 3 Architecture)
// ================================================================
app.post('/api/analyze-v2', async (req, res) => {
  try {
    // === Safety check: ensure Phase 3 modules loaded ===
    if (!extractionPromptModule || !rulesAdditivesModule) {
      return res.status(503).json({
        error: 'Phase 3 modules not available',
        message: 'نظام التحليل الجديد غير متاح حالياً'
      });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'مفتاح API غير مضبوط' });
    }

    // === Extract product type and images from request ===
    const { productType = 'auto', images = [] } = req.body;

    if (!images || !images.length) {
      return res.status(400).json({ error: 'لا توجد صور للتحليل' });
    }

    // === Build the simplified extraction prompt ===
    const extractionPrompt = extractionPromptModule.buildExtractionPrompt(productType);

    // === Call Claude API for data extraction ONLY ===
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            ...images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: img.type, data: img.base64 }
            })),
            { type: 'text', text: extractionPrompt }
          ]
        }]
      })
    });

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      return res.status(claudeResponse.status).json({
        error: 'فشل الاتصال بـ Claude API',
        details: claudeData.error?.message || 'خطأ غير معروف'
      });
    }

    // === Parse Claude's JSON response ===
    let extracted;
    try {
      const rawText = claudeData.content[0].text;
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in Claude response');
      extracted = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({
        error: 'فشل تحليل بيانات Claude',
        details: parseErr.message,
        raw_response: claudeData.content?.[0]?.text?.substring(0, 500)
      });
    }

    // === Run Phase 3 deterministic checks ===

    // 1. Additives verification (the main fix for the original problem)
    const additivesResult = rulesAdditivesModule.verifyExtractedAdditives(
      additivesDB,
      extracted.additives || [],
      productType
    );

    // === Build the v2 response ===
    // For now, we return BOTH the raw extraction AND the additives verification.
    // Future commits will add rules-js9.js and rules-nutrition.js to fill the rest.
    const response = {
      // Meta information
      _meta: {
        version: 'v2-phase3',
        timestamp: new Date().toISOString(),
        productType,
        model_used: 'claude-sonnet-4-5'
      },

      // Raw extracted data (for inspection/debugging)
      extracted_data: extracted,

      // Phase 3 verified additives (the main fix!)
      additives_verification: additivesResult,

      // Backwards-compatible fields (for current frontend)
      product_name: extracted.product_name?.ar || extracted.product_name?.en || '',
      summary: `تم استخراج البيانات وفحص ${additivesResult.summary.total_found} مضاف`,
      additives: extracted.additives || [],
      additives_verified: additivesResult.verified_additives,
      allergens: extracted.allergens_mentioned || [],
      nutrition: extracted.nutrition_table || { hasTable: false },

      // Compliance results (only additives for now — will expand later)
      results: additivesResult.violations,

      // Overall status based on additives only for now
      overallStatus: additivesResult.summary.overall_status === 'FAIL' ? 'fail' :
                     additivesResult.summary.overall_status === 'WARNING' ? 'warning' : 'pass',

      score: additivesResult.summary.forbidden_count === 0 ? 85 : 40,

      // Usage tracking (if applicable)
      _usage: null  // Will be filled by the middleware if needed
    };

    res.json(response);

  } catch (err) {
    console.error('❌ /api/analyze-v2 error:', err);
    res.status(500).json({
      error: 'خطأ في السيرفر',
      details: err.message
    });
  }
});

// ================================================================
// DIAGNOSTIC ENDPOINT: Check if Phase 3 is loaded correctly
// Useful for verifying the deployment before testing
// ================================================================
app.get('/api/analyze-v2/status', (req, res) => {
  res.json({
    phase3_ready: !!(extractionPromptModule && rulesAdditivesModule),
    phase3_step2_ready: !!matchingLayerModule,
    modules: {
      extraction_prompt: !!extractionPromptModule,
      rules_additives: !!rulesAdditivesModule,
      matching_layer: !!matchingLayerModule,
      additives_db: !!additivesDB
    },
    endpoints: [
      'POST /api/analyze-v2 — main extraction + verification endpoint',
      'GET /api/analyze-v2/status — this diagnostic endpoint'
    ]
  });
});

// ================================================================
// ============= PHASE 3 ARCHITECTURE — END =======================
// ================================================================

// ================================================================
// FoodCheck Jordan — Phase 3 Architecture
// Classifier API Endpoint Patch
// ================================================================
//
// PURPOSE:
// إضافة endpoint مستقل لاختبار classifier-v3.js على منتجات حقيقية
// بدون لمس /api/analyze أو /api/analyze-v2
//
// MOUNT INSTRUCTIONS:
// 1. Open server.js
// 2. Find this comment block:
//      // ============= PHASE 3 ARCHITECTURE — END =======================
// 3. Paste this entire file IMMEDIATELY AFTER that comment block
// 4. Save & commit to phase-3-architecture branch
//
// ENDPOINTS ADDED:
//   POST /api/classify           — Classify a product by name
//   GET  /api/classify/status    — Diagnostic check
//   POST /api/classify/batch     — Classify multiple products at once
// ================================================================


// ================================================================
// Load classifier module (safe fallback if file missing)
// ================================================================
let classifierModule = null;
try {
  classifierModule = require('./data/classifier-v3.js');
  console.log('✅ Phase 3: classifier-v3.js loaded');
} catch(e) {
  console.warn('⚠️ Phase 3: classifier-v3.js NOT loaded:', e.message);
}


// ================================================================
// ENDPOINT 1: POST /api/classify
// ================================================================
//
// REQUEST BODY:
//   {
//     "name_en": "American Garden Mayonnaise",  // optional
//     "name_ar": "مايونيز أمريكان جاردن"        // optional
//   }
// (لازم على الأقل واحد من الاثنين)
//
// RESPONSE (success):
//   {
//     "classification": {
//       "cat_no": "12.6.1",
//       "confidence": "high",
//       "method": "pattern_match",
//       "matched_pattern": "mayonnaise",
//       "reason": "Mayonnaise → emulsified sauce 12.6.1",
//       "cxs": null,
//       "alternatives": []
//     },
//     "product_name": "American Garden Mayonnaise",
//     "_meta": {
//       "endpoint": "/api/classify",
//       "version": "v1",
//       "timestamp": "2026-05-15T..."
//     }
//   }
//
// RESPONSE (unclassified):
//   {
//     "classification": {
//       "cat_no": null,
//       "confidence": "none",
//       "method": "unclassified",
//       "reason": "...",
//       "suggestion": "..."
//     },
//     ...
//   }
// ================================================================
app.post('/api/classify', (req, res) => {
  if (!classifierModule) {
    return res.status(503).json({
      error: 'Classifier module not available',
      message: 'محرك التصنيف غير متاح حالياً'
    });
  }

  const { name_en, name_ar } = req.body || {};

  if (!name_en && !name_ar) {
    return res.status(400).json({
      error: 'لازم على الأقل name_en أو name_ar',
      example: { name_en: 'Mayonnaise', name_ar: 'مايونيز' }
    });
  }

  try {
    const result = classifierModule.classifyProduct({
      name_en: name_en || '',
      name_ar: name_ar || ''
    });

    res.json({
      ...result,
      _meta: {
        endpoint: '/api/classify',
        version: 'v1',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('❌ /api/classify error:', err);
    res.status(500).json({
      error: 'خطأ في التصنيف',
      details: err.message
    });
  }
});


// ================================================================
// ENDPOINT 2: GET /api/classify/status
// ================================================================
// تشخيص سريع: هل الـ classifier محمّل؟ كم نمط فيه؟
// ================================================================
app.get('/api/classify/status', (req, res) => {
  res.json({
    classifier_ready: !!classifierModule,
    total_patterns: classifierModule
      ? classifierModule.KNOWN_PRODUCT_PATTERNS.length
      : 0,
    endpoints: [
      'POST /api/classify         — تصنيف منتج واحد',
      'GET  /api/classify/status  — تشخيص',
      'POST /api/classify/batch   — تصنيف عدة منتجات'
    ],
    example_request: {
      method: 'POST',
      url: '/api/classify',
      body: { name_en: 'Mayonnaise', name_ar: 'مايونيز' }
    }
  });
});


// ================================================================
// ENDPOINT 3: POST /api/classify/batch
// ================================================================
//
// REQUEST BODY:
//   {
//     "products": [
//       { "name_en": "Mayonnaise" },
//       { "name_ar": "زعتر بزيت زيتون" },
//       { "name_en": "Tuna in Olive Oil", "name_ar": "تونة بزيت الزيتون" }
//     ]
//   }
//
// RESPONSE:
//   {
//     "total": 3,
//     "classified": 2,
//     "unclassified": 1,
//     "results": [ ... ]
//   }
//
// مفيد لما تختبر 30-50 منتج دفعة واحدة من Postman
// ================================================================
app.post('/api/classify/batch', (req, res) => {
  if (!classifierModule) {
    return res.status(503).json({
      error: 'Classifier module not available'
    });
  }

  const { products } = req.body || {};

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      error: 'لازم products array',
      example: {
        products: [
          { name_en: 'Mayonnaise' },
          { name_ar: 'كاتشب' }
        ]
      }
    });
  }

  if (products.length > 100) {
    return res.status(400).json({
      error: 'الحد الأقصى 100 منتج في الطلب الواحد'
    });
  }

  try {
    const results = products.map((p, idx) => {
      const out = classifierModule.classifyProduct({
        name_en: (p && p.name_en) || '',
        name_ar: (p && p.name_ar) || ''
      });
      return { index: idx, ...out };
    });

    const classified = results.filter(r => r.classification.cat_no !== null).length;
    const unclassified = results.length - classified;

    res.json({
      total: results.length,
      classified,
      unclassified,
      classification_rate: results.length > 0
        ? Math.round((classified / results.length) * 100)
        : 0,
      results,
      _meta: {
        endpoint: '/api/classify/batch',
        version: 'v1',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('❌ /api/classify/batch error:', err);
    res.status(500).json({
      error: 'خطأ في التصنيف الجماعي',
      details: err.message
    });
  }
});


// ================================================================
// ===== نظام HACCP =====
// ================================================================
let haccpEngine, criticalLimits;
try {
  haccpEngine = require('./data/haccp_engine.json');
  console.log('✅ haccp_engine.json loaded');
} catch(e) {
  console.warn('⚠️ haccp_engine.json not loaded:', e.message);
}
try {
  criticalLimits = require('./data/critical_limits.json');
  console.log('✅ critical_limits.json loaded');
} catch(e) {
  console.warn('⚠️ critical_limits.json not loaded:', e.message);
}

app.get('/haccp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'haccp', 'index.html'));
});

app.get('/api/haccp/engine', (req, res) => {
  if (!haccpEngine) return res.status(503).json({ error: 'HACCP engine not loaded' });
  res.json({
    metadata: haccpEngine.metadata,
    sectors: haccpEngine.product_input_schema?.find(f => f.id === 'PIN-003')?.options_en || [],
    sectors_ar: haccpEngine.product_input_schema?.find(f => f.id === 'PIN-003')?.options_ar || [],
    process_steps: haccpEngine.process_steps,
    principles_covered: haccpEngine.metadata.principles_covered
  });
});

app.post('/api/haccp/analyze', (req, res) => {
  if (!haccpEngine) return res.status(503).json({ error: 'HACCP engine not loaded' });

  const { sector, rte, heat_treatment, allergens, raw_material_type, temperature_category } = req.body;

  const sectorHazards = haccpEngine.sector_hazards.filter(h => {
    return h.sector.includes(sector) || h.sector.includes('All');
  });

  const gmpTriggers = haccpEngine.gmp_triggers || [];

  const haccpTemplates = haccpEngine.haccp_plan_templates.filter(t => {
    return t.sector.includes(sector) || t.sector.includes('All');
  });

  const matchedLimits = (criticalLimits?.critical_limits || []).filter(cl => {
    return cl.sector.includes(sector) || cl.sector.includes('All');
  });

  if (rte && !sectorHazards.find(h => h.sector.includes('RTE'))) {
    const rteHazards = haccpEngine.sector_hazards.filter(h => h.sector.includes('RTE'));
    sectorHazards.push(...rteHazards);
  }

  const decisionTree = haccpEngine.decision_tree;

  res.json({
    sector,
    inputs: req.body,
    hazards: sectorHazards,
    haccp_plan_templates: haccpTemplates,
    critical_limits: matchedLimits,
    gmp_triggers: gmpTriggers,
    decision_tree: decisionTree,
    principles: haccpEngine.metadata.principles_covered,
    verification: haccpEngine.verification_programme,
    required_records: haccpEngine.required_records
  });
});

app.get('/api/haccp/critical-limits', (req, res) => {
  if (!criticalLimits) return res.status(503).json({ error: 'Critical limits not loaded' });
  const { sector } = req.query;
  if (sector) {
    const filtered = criticalLimits.critical_limits.filter(cl =>
      cl.sector.includes(sector) || cl.sector.includes('All')
    );
    return res.json({ critical_limits: filtered, metadata: criticalLimits.metadata });
  }
  res.json(criticalLimits);
});

app.get('/api/haccp/decision-tree', (req, res) => {
  if (!haccpEngine) return res.status(503).json({ error: 'HACCP engine not loaded' });
  res.json({ decision_tree: haccpEngine.decision_tree });
});

app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
