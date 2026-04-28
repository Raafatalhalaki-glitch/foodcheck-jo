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

// Rule Engine — 4-step decision
function checkAdditive(ins, catNo) {
  const result = {
    ins, cat_no: catNo,
    verdict: null, max_level: null,
    additive_name: null, functional_class: null,
    message_ar: null, notes: null, notes_text: [],
    steps: { table1: null, table2: null, table3: null, annex3: false }
  };
  const ai = additivesDB.prepare('SELECT name, functional_class FROM additive_info WHERE ins=?').get(ins);
  const t3info = additivesDB.prepare('SELECT name, functional_class, max_level, specific_allowance FROM table3 WHERE ins=?').get(ins);
  if (!ai && !t3info) {
    result.verdict = 'NOT_FOUND';
    result.message_ar = `INS ${ins} غير موجود في قاعدة البيانات`;
    return result;
  }
  result.additive_name = ai ? ai.name : t3info.name;
  result.functional_class = ai ? ai.functional_class : (t3info ? t3info.functional_class : '');
  const annex = additivesDB.prepare('SELECT cat_no FROM annex3 WHERE cat_no=?').get(catNo);
  result.steps.annex3 = !!annex;
  result.steps.table3 = t3info || null;
  const t1 = additivesDB.prepare('SELECT * FROM table1 WHERE ins=? AND cat_no=?').get(ins, catNo);
  result.steps.table1 = t1 || null;
  const t2 = additivesDB.prepare('SELECT * FROM table2 WHERE cat_no=? AND (ins=? OR ins LIKE ?)').get(catNo, ins, `%${ins}%`);
  result.steps.table2 = t2 || null;
  function resolveNotes(str) {
    if (!str) return [];
    return str.split(/[,&\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(id => {
      const n = additivesDB.prepare('SELECT text FROM notes WHERE note_id=?').get(id);
      return n ? { id, text: n.text } : null;
    }).filter(Boolean);
  }
  if (t1) {
    result.max_level = t1.max_level; result.notes = t1.notes;
    result.notes_text = resolveNotes(t1.notes);
    result.verdict = t3info ? 'CONDITIONAL' : 'PASS';
    result.message_ar = `مسموح — Table 1 — الحد: ${t1.max_level}` + (t3info ? ' — توجد قيود إضافية في Table 3' : '');
  } else if (t2) {
    result.max_level = t2.max_level; result.notes = t2.notes;
    result.notes_text = resolveNotes(t2.notes);
    result.verdict = t3info ? 'CONDITIONAL' : 'PASS';
    result.message_ar = `مسموح — Table 2 — الحد: ${t2.max_level}`;
  } else if (t3info) {
    if (annex) {
      result.verdict = 'FAIL';
      result.message_ar = 'غير مسموح — الفئة مستثناة في Annex 3 من شروط Table 3';
    } else {
      result.verdict = 'PASS'; result.max_level = t3info.max_level || 'GMP';
      result.message_ar = 'مسموح — Table 3 GMP';
    }
  } else {
    result.verdict = 'FAIL';
    result.message_ar = 'غير مسموح — غير مدرج في أي جدول لهذه الفئة الغذائية';
  }
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
