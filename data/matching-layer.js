// ================================================================
// FoodCheck Jordan — Phase 3 Step 2
// Matching Layer: Product Name → Codex Category
// ================================================================
//
// FLOW:
//   Input: { name_en, name_ar, productType (optional) }
//      ↓
//   [1] بحث في annex_c.db (عربي + إنجليزي)
//      ↓
//   [2] واحد match  → ✅ verdict + cxs + cat
//       متعدد       → ⚠️ needs_review + candidates
//       صفر         → fall through
//      ↓
//   [3] Fallback: PRODUCT_CAT_MAP (الموجود في rules-additives.js)
//      ↓
//   [4] Last resort: null + needs_review
//
// SOURCES في الـ output:
//   'annex_c_exact'      → match دقيق (single result)
//   'annex_c_priority'   → multi result، اختار preferred_for_market
//   'product_cat_map'    → fallback من الـ map الثابت
//   'unclassified'       → ما لقاه
//
// ================================================================

const path = require('path');

let annexDB = null;
try {
  const Database = require('better-sqlite3');
  annexDB = new Database(path.join(__dirname, 'annex_c.db'), { readonly: true });
  console.log('✅ annex_c.db loaded (matching layer)');
} catch (e) {
  console.warn('⚠️ annex_c.db not loaded:', e.message);
}

// ================================================================
// CONFIG
// ================================================================

// أسماء عربية شائعة جداً نتعامل معها بأولوية خاصة
// عشان نتفادى false positives في الـ substring match
const HIGH_FREQUENCY_TERMS = [
  'حليب', 'لبن', 'جبنة', 'زيت', 'تونة', 'سردين', 'عسل', 'سكر',
  'ملح', 'شوكولاتة', 'شيبس', 'بسكويت', 'كيك', 'أرز', 'طحين',
  'بندورة', 'طماطم', 'بطاطا', 'فول', 'حمص', 'زبدة', 'سمنة',
  'كريمة', 'مياه', 'ماء', 'عصير', 'مربى', 'تمر', 'زيتون',
  'مخلل', 'صلصة', 'كاتشب', 'مايونيز', 'بهار', 'كركم', 'هيل'
];


// ================================================================
// HELPERS
// ================================================================

/**
 * تنظيف النص: lowercase + إزالة محارف غير الأحرف والأرقام
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة الحركات العربية
    .replace(/[إأآا]/g, 'ا')                // توحيد الألف
    .replace(/[ىي]/g, 'ي')                  // توحيد الياء
    .replace(/ة/g, 'ه')                     // توحيد التاء المربوطة (للبحث المرن)
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')   // محارف غير المهمة → فراغ
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * فحص: هل text بحتوي على keyword كـ "word" حقيقي (مش substring في وسط كلمة ثانية)
 */
function containsAsWord(text, keyword) {
  if (!keyword || !text) return false;
  const normText = normalizeText(text);
  const normKw = normalizeText(keyword);
  if (!normKw) return false;
  
  // العربي: ما عنده word boundary حقيقي، فنستخدم whitespace أو حدود السلسلة
  // الإنجليزي: \b يشتغل عادي
  const hasArabic = /[\u0600-\u06FF]/.test(normKw);
  
  if (hasArabic) {
    // (^|\s)keyword(\s|$)
    const pattern = new RegExp(`(^|\\s)${escapeRegex(normKw)}(\\s|$)`);
    return pattern.test(normText);
  } else {
    const pattern = new RegExp(`\\b${escapeRegex(normKw)}\\b`, 'i');
    return pattern.test(normText);
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * استخراج كل aliases من حقل standard_name_ar
 * الـ format: "alias1 | alias2 | alias3"
 */
function parseAliases(field) {
  if (!field) return [];
  return field.split('|').map(s => s.trim()).filter(Boolean);
}


// ================================================================
// CORE: SEARCH ANNEX C
// ================================================================

/**
 * يبحث في annex_c.db عن مطابقات لاسم المنتج
 * @param {string} query - اسم المنتج (عربي أو إنجليزي)
 * @returns {Array} - candidates مرتبة حسب جودة المطابقة
 */
function searchAnnexC(query) {
  if (!annexDB || !query) return [];
  
  const normQuery = normalizeText(query);
  if (!normQuery) return [];
  
  // نجلب كل الـ entries اللي عندها ترجمة عربية أو إنجليزية للبحث
  const rows = annexDB.prepare(`
    SELECT id, cxs_no, food_category_no, standard_name_en, standard_name_ar, market_priority
    FROM annex_c_mappings
    WHERE standard_name_ar IS NOT NULL OR standard_name_en IS NOT NULL
  `).all();
  
  const matches = [];
  
  for (const row of rows) {
    // جمع كل الـ aliases المحتملة (عربي + إنجليزي)
    const arAliases = parseAliases(row.standard_name_ar);
    const enAliases = [row.standard_name_en, ...parseAliases(row.standard_name_en)];
    const allAliases = [...arAliases, ...enAliases].filter(Boolean);
    
    let bestScore = 0;
    let matchedAlias = null;
    
    for (const alias of allAliases) {
      const normAlias = normalizeText(alias);
      if (!normAlias) continue;
      
      // 1. Exact match: السكور 100
      if (normQuery === normAlias) {
        bestScore = Math.max(bestScore, 100);
        matchedAlias = alias;
        continue;
      }
      
      // 2. Whole word match (الـ alias كلمة كاملة في الـ query): السكور 90
      if (containsAsWord(normQuery, normAlias)) {
        if (bestScore < 90) {
          bestScore = 90;
          matchedAlias = alias;
        }
        continue;
      }
      
      // 3. Substring match (مع شرط: طول الـ alias >= 4 لتجنب false positives)
      if (normAlias.length >= 4 && normQuery.includes(normAlias)) {
        if (bestScore < 70) {
          bestScore = 70;
          matchedAlias = alias;
        }
        continue;
      }
      
      // 4. Reverse substring (alias contains query): السكور 50
      if (normQuery.length >= 4 && normAlias.includes(normQuery)) {
        if (bestScore < 50) {
          bestScore = 50;
          matchedAlias = alias;
        }
      }
    }
    
    if (bestScore > 0) {
      matches.push({
        cxs_no: row.cxs_no,
        food_category_no: row.food_category_no,
        standard_name_en: row.standard_name_en,
        standard_name_ar: row.standard_name_ar,
        market_priority: row.market_priority,
        matched_alias: matchedAlias,
        score: bestScore
      });
    }
  }
  
  // ترتيب: السكور الأعلى أولاً، بعدها market_priority preferred
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.market_priority === 'preferred_for_market') return -1;
    if (b.market_priority === 'preferred_for_market') return 1;
    if (a.market_priority === 'fallback_only') return 1;
    if (b.market_priority === 'fallback_only') return -1;
    return 0;
  });
  
  return matches;
}


// ================================================================
// MAIN: classify product
// ================================================================

/**
 * يصنف منتج باستخدام Annex C أولاً، ثم fallback للـ PRODUCT_CAT_MAP
 * @param {object} product - { name_en, name_ar, productType }
 * @param {object} productCatMap - الـ map من rules-additives.js
 * @returns {object} - { cat_no, source, cxs, candidates?, needs_review?, confidence }
 */
function classifyProduct(product, productCatMap = {}) {
  const { name_en = '', name_ar = '', productType = null } = product;
  
  // نجمع كل النصوص اللي عندنا للبحث
  const searchTexts = [name_ar, name_en].filter(Boolean);
  const combinedQuery = searchTexts.join(' ');
  
  // [1] محاولة بحث في Annex C
  if (combinedQuery) {
    const matches = searchAnnexC(combinedQuery);
    
    if (matches.length > 0) {
      const topScore = matches[0].score;
      // نأخذ كل اللي عندهم نفس الـ top score
      const topMatches = matches.filter(m => m.score === topScore);
      
      // حالة 1: مطابقة واحدة فقط في الـ top
      if (topMatches.length === 1) {
        return {
          cat_no: topMatches[0].food_category_no,
          cxs: topMatches[0].cxs_no,
          source: 'annex_c_exact',
          confidence: scoreToConfidence(topScore),
          matched_alias: topMatches[0].matched_alias,
          standard_name: topMatches[0].standard_name_en,
          needs_review: false
        };
      }
      
      // حالة 2: عدة مطابقات بنفس السكور
      //   فحص: هل في واحد عنده preferred_for_market؟
      const preferred = topMatches.find(m => m.market_priority === 'preferred_for_market');
      if (preferred) {
        return {
          cat_no: preferred.food_category_no,
          cxs: preferred.cxs_no,
          source: 'annex_c_priority',
          confidence: scoreToConfidence(topScore) === 'high' ? 'medium' : 'low',
          matched_alias: preferred.matched_alias,
          standard_name: preferred.standard_name_en,
          needs_review: true,
          review_reason: 'تم اختيار الافتراضي للسوق الأردني (نباتي)؛ يُرجى التأكد إذا كان المنتج طبيعياً',
          candidates: topMatches.slice(0, 5).map(m => ({
            cat_no: m.food_category_no,
            cxs: m.cxs_no,
            name: m.standard_name_en
          }))
        };
      }
      
      // حالة 3: عدة مطابقات بدون preferred → needs_review
      return {
        cat_no: topMatches[0].food_category_no, // نأخذ الأول مؤقتاً
        cxs: topMatches[0].cxs_no,
        source: 'annex_c_ambiguous',
        confidence: 'low',
        needs_review: true,
        review_reason: `${topMatches.length} فئات محتملة — يحتاج تأكيد المستخدم`,
        candidates: topMatches.slice(0, 5).map(m => ({
          cat_no: m.food_category_no,
          cxs: m.cxs_no,
          name: m.standard_name_en
        }))
      };
    }
  }
  
  // [2] Fallback: PRODUCT_CAT_MAP بناءً على productType
  if (productType && productCatMap[productType]) {
    return {
      cat_no: productCatMap[productType],
      cxs: null,
      source: 'product_cat_map',
      confidence: 'medium',
      productType: productType,
      needs_review: false
    };
  }
  
  // [3] Last resort: غير مصنف
  return {
    cat_no: null,
    cxs: null,
    source: 'unclassified',
    confidence: 'none',
    needs_review: true,
    review_reason: 'لم يتم العثور على تطابق في Annex C ولا في PRODUCT_CAT_MAP'
  };
}


function scoreToConfidence(score) {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}


// ================================================================
// DIAGNOSTIC: search and return all candidates (for debugging)
// ================================================================

function searchDiagnostic(query, limit = 10) {
  const matches = searchAnnexC(query);
  return matches.slice(0, limit).map(m => ({
    cxs: m.cxs_no,
    cat: m.food_category_no,
    en: m.standard_name_en,
    ar: m.standard_name_ar,
    matched: m.matched_alias,
    score: m.score,
    priority: m.market_priority
  }));
}


// ================================================================
// EXPORTS
// ================================================================

module.exports = {
  classifyProduct,
  searchAnnexC,
  searchDiagnostic,
  normalizeText,
  parseAliases
};
