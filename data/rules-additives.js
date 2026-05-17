// ================================================================
// FoodCheck Jordan — Phase 3 Architecture
// Rules Engine: Additives Verification
// ================================================================
//
// PHILOSOPHY:
// This module takes RAW extracted additive data (from Claude) and
// applies Codex CXS 192:2025 rules to produce DETERMINISTIC verdicts.
//
// NO AI is involved in compliance decisions here.
// Same input → same output, every single time.
//
// INPUT (from extraction-prompt.js):
//   additives: [
//     {
//       name_as_written: "Quinoline Yellow",
//       name_en: "Quinoline Yellow",
//       e_number: "E104",
//       ins_number: "104"
//     }
//   ]
//   productType: "candy"
//
// OUTPUT:
//   {
//     verified_additives: [...],   // Per-additive verdicts
//     summary: {                    // Aggregate stats
//       total_found: 5,
//       allowed_count: 3,
//       forbidden_count: 1,
//       unknown_count: 1,
//       has_artificial_colors: true,
//       has_artificial_sweeteners: false,
//       has_preservatives: true,
//       overall_status: "FAIL" | "PASS" | "WARNING"
//     },
//     violations: [...]             // Issues to add to compliance report
//   }
// ================================================================


// ================================================================
// PRODUCT TYPE → CODEX CATEGORY MAP
// ================================================================
const PRODUCT_CAT_MAP = {
  dairy: '01.0', processed_cheese: '01.6.4', soft_cheese: '01.6.1',
  flavored_milk: '01.1.4', dried_milk: '01.5.1',
  evaporated_milk: '01.3.1', filled_evaporated_milk: '01.3.2',
  filled_condensed_milk: '01.4.2', filled_dried_milk: '01.5.1',
  yoghurt: '01.2.1.2', uht_milk: '01.1.1',
  cream: '01.4.1', cream_analogue: '01.4.4',
  labneh: '01.2.1.2', condensed_milk: '01.3.1', butter: '02.2.1',
  ghee: '02.2.2', vegetable_oil: '02.1',
  ice_cream: '03.0',
  tomato_concentrate: '04.2.2.6', tomato_paste: '04.2.2.6',
  unshelled_pistachio: '04.2.3', peanuts: '04.2.3',
  decorticated_pine_nuts: '04.2.3', quick_frozen_fries: '04.2.2.4',
  dates: '04.1.1.2', table_olives: '04.2.2.3',
  jam: '04.1.2.5', canned_vegetables: '04.2.2.4', pickles: '04.2.2.3',
  chocolate: '05.1.4', candy: '05.2.2', jelly_mix: '05.2.2',
  cocoa_powder: '05.1.1',
  foul_medames: '04.2.2.4', pasta: '06.4.2', noodles: '06.4.3',
  semolina: '06.2.1', flour: '06.2.1',
  bakery: '07.2.2', biscuit: '07.2.1', bread: '07.1.1',
  flat_bread: '07.1.2', pancake_mix: '07.2.2',
  meat: '08.3.1.1', processed_meat: '08.3.1.1',
  fish: '09.2.1', sardines: '09.4', tuna_bonito: '09.4',
  frozen_fish: '09.2.1',
  sugar: '11.1.1', date_syrup: '11.4', molasses: '11.4', honey: '11.5',
  mayonnaise: '12.6.1', ketchup: '12.6.2', hot_sauce: '12.6.2',
  chilli_sauce: '12.6.2', bbq_sauce: '12.6.2', tomato_sauce: '12.6.2',
  mustard: '12.4', vinegar: '12.3', spices: '12.2.1',
  seasoning_mix: '12.2.2', flower_water: '12.9',
  salt: '12.1.1', tahini: '12.7', hummus: '12.7',
  infant_formula: '13.1.1', fsmp_infant_formula: '13.1.1',
  cereal_infant: '13.1.3', supplements: '13.6',
  beverages: '14.1.4', energy_drink: '14.1.4', juice: '14.1.2.1',
  fruit_syrup: '14.1.4', flavored_drink: '14.1.4',
  malt_beverage: '14.2.1', coffee: '14.1.5', tea: '14.1.5',
  water: '14.1.1.1', coffee_milk: '01.1.4',
  corn_chips: '15.1', potato_chips: '15.1',
  snacks: '15.1', roasted_nuts: '15.2',
  cinnamon: '12.2.1', black_pepper: '12.2.1', paprika: '12.2.1',
  cumin: '12.2.1', turmeric: '12.2.1',
  claims_product: null, general: null, auto: null,
};


// ================================================================
// KNOWN ADDITIVE NAMES → INS NUMBERS
// Used as fallback when Claude returns name but no number
// ================================================================
const NAME_TO_INS = {
  // Artificial Colors (Critical for JS regulations)
  'quinoline yellow': '104',
  'tartrazine': '102',
  'sunset yellow': '110',
  'sunset yellow fcf': '110',
  'carmoisine': '122',
  'azorubine': '122',
  'amaranth': '123',
  'ponceau': '124',
  'ponceau 4r': '124',
  'cochineal red': '124',
  'erythrosine': '127',
  'allura red': '129',
  'allura red ac': '129',
  'patent blue': '131',
  'indigo carmine': '132',
  'indigotine': '132',
  'brilliant blue': '133',
  'brilliant blue fcf': '133',
  'fast green': '143',
  'fast green fcf': '143',
  'green s': '142',
  'brilliant black': '151',
  'brown ht': '155',
  
  // US Color names → INS
  'red 40': '129',           // Allura Red
  'red 3': '127',            // Erythrosine
  'yellow 5': '102',         // Tartrazine
  'yellow 6': '110',         // Sunset Yellow
  'blue 1': '133',           // Brilliant Blue
  'blue 2': '132',           // Indigo Carmine
  'green 3': '143',          // Fast Green
  
  // Natural Colors
  'curcumin': '100',
  'riboflavin': '101',
  'chlorophyll': '140',
  'caramel': '150a',
  'beta-carotene': '160a',
  'paprika extract': '160c',
  'lycopene': '160d',
  'anthocyanins': '163',
  
  // Artificial Sweeteners (Critical!)
  'acesulfame': '950',
  'acesulfame-k': '950',
  'acesulfame potassium': '950',
  'aspartame': '951',
  'cyclamate': '952',
  'saccharin': '954',
  'sucralose': '955',
  'thaumatin': '957',
  'neotame': '961',
  'aspartame-acesulfame salt': '962',
  'steviol glycosides': '960',
  'stevia': '960',
  'advantame': '969',
  
  // Sugar alcohols
  'sorbitol': '420',
  'mannitol': '421',
  'isomalt': '953',
  'maltitol': '965',
  'lactitol': '966',
  'xylitol': '967',
  'erythritol': '968',
  
  // Preservatives
  'sorbic acid': '200',
  'potassium sorbate': '202',
  'calcium sorbate': '203',
  'benzoic acid': '210',
  'sodium benzoate': '211',
  'potassium benzoate': '212',
  'calcium benzoate': '213',
  'sulphur dioxide': '220',
  'sulfur dioxide': '220',
  'sodium sulphite': '221',
  'sodium bisulfite': '222',
  'sodium metabisulphite': '223',
  'potassium metabisulphite': '224',
  'nisin': '234',
  'natamycin': '235',
  'sodium nitrite': '250',
  'potassium nitrite': '249',
  'sodium nitrate': '251',
  'potassium nitrate': '252',
  
  // Acids
  'acetic acid': '260',
  'lactic acid': '270',
  'citric acid': '330',
  'tartaric acid': '334',
  'malic acid': '296',
  'fumaric acid': '297',
  'phosphoric acid': '338',
  'ascorbic acid': '300',
  
  // Antioxidants
  'sodium ascorbate': '301',
  'calcium ascorbate': '302',
  'tocopherols': '307',
  'bha': '320',
  'butylated hydroxyanisole': '320',
  'bht': '321',
  'butylated hydroxytoluene': '321',
  'lecithin': '322',
  
  // Emulsifiers/Stabilizers
  'mono- and diglycerides': '471',
  'monoglycerides': '471',
  'diglycerides': '471',
  'pectin': '440',
  'gum arabic': '414',
  'gum acacia': '414',
  'guar gum': '412',
  'xanthan gum': '415',
  'carrageenan': '407',
  'agar': '406',
  'gelatin': '428',
  
  // Anti-caking agents
  'silicon dioxide': '551',
  'silica': '551',
  'calcium silicate': '552',
  'magnesium silicate': '553',
  
  // Flavor enhancers
  'monosodium glutamate': '621',
  'msg': '621',
  'disodium guanylate': '627',
  'disodium inosinate': '631',
  
  // Carriers/Glazing
  'carnauba wax': '903',
  'beeswax': '901',
  'shellac': '904',
};


// ================================================================
// ADDITIVE CATEGORY CLASSIFIERS
// Helps generate higher-quality warnings
// ================================================================
const ADDITIVE_CATEGORIES = {
  artificial_colors: [
    '102', '104', '110', '122', '123', '124', '127', '129', 
    '131', '132', '133', '142', '143', '151', '155'
  ],
  artificial_sweeteners: [
    '950', '951', '952', '954', '955', '957', '960', '961', '962', '969'
  ],
  sugar_alcohols: [
    '420', '421', '953', '965', '966', '967', '968'
  ],
  preservatives: [
    '200', '202', '203', '210', '211', '212', '213',
    '220', '221', '222', '223', '224', '234', '235',
    '249', '250', '251', '252'
  ],
  flavor_enhancers: [
    '621', '622', '623', '624', '625', '626', '627',
    '628', '629', '630', '631', '632', '633', '634', '635'
  ]
};


// ================================================================
// HELPER: Get category hierarchy (e.g. '01.1.4' → ['01.1.4', '01.1', '01'])
// ================================================================
function getParentCats(cat) {
  if (!cat) return [];
  const parts = cat.split('.');
  const cats = [];
  for (let i = parts.length; i >= 1; i--) {
    cats.push(parts.slice(0, i).join('.'));
  }
  return cats;
}


// ================================================================
// HELPER: Resolve INS number from raw additive data
// Handles: INS number, E number, name (English/Arabic)
// ================================================================
function resolveINS(additive) {
  // Priority 1: Direct INS number
  if (additive.ins_number) {
    const cleaned = String(additive.ins_number).replace(/^E/i, '').trim();
    if (/^\d+[a-z]?$/i.test(cleaned)) return cleaned;
  }
  
  // Priority 2: E number (strip "E" prefix)
  if (additive.e_number) {
    const cleaned = String(additive.e_number).replace(/^E/i, '').trim();
    if (/^\d+[a-z]?$/i.test(cleaned)) return cleaned;
  }
  
  // Priority 3: Legacy "ins" field (for backwards compatibility)
  if (additive.ins) {
    const cleaned = String(additive.ins).replace(/^E/i, '').trim();
    if (/^\d+[a-z]?$/i.test(cleaned)) return cleaned;
  }
  
  // Priority 4: Match English name
  const nameToCheck = (additive.name_en || additive.name_as_written || additive.name || '')
    .toLowerCase().trim();
  if (nameToCheck && NAME_TO_INS[nameToCheck]) {
    return NAME_TO_INS[nameToCheck];
  }
  
  // Priority 5: Fuzzy match (substring)
  for (const [key, ins] of Object.entries(NAME_TO_INS)) {
    if (nameToCheck.includes(key) || key.includes(nameToCheck)) {
      if (nameToCheck.length >= 4) return ins;  // Avoid false matches on short names
    }
  }
  
  return null;
}


// ================================================================
// HELPER: Classify additive into category (color, sweetener, etc.)
// ================================================================
function classifyAdditive(ins) {
  if (!ins) return null;
  const cleanIns = ins.replace(/[a-z]$/i, '');  // "150a" → "150"
  for (const [category, list] of Object.entries(ADDITIVE_CATEGORIES)) {
    if (list.includes(ins) || list.includes(cleanIns)) {
      return category;
    }
  }
  return null;
}


// ================================================================
// CORE: Check single additive against Codex CXS 192 tables
// Uses 4-step decision: Table1 → Table2 → Table3 → Annex3
// ================================================================
function checkAdditive(db, ins, catNo) {
  const result = {
    ins,
    cat_no: catNo,
    verdict: null,
    max_level: null,
    additive_name: null,
    functional_class: null,
    message_ar: null,
    notes_text: [],
    category: classifyAdditive(ins),
    steps: { table1: null, table2: null, table3: null, annex3: false }
  };
  
  // Get basic additive info
  const ai = db.prepare(
    'SELECT name, functional_class FROM additive_info WHERE ins=?'
  ).get(ins);
  
  const t3info = db.prepare(
    'SELECT name, functional_class, max_level, specific_allowance FROM table3 WHERE ins=?'
  ).get(ins);
  
  // Not found anywhere
  if (!ai && !t3info) {
    result.verdict = 'NOT_FOUND';
    result.message_ar = `INS ${ins} غير موجود في قاعدة بيانات Codex CXS 192. يحتاج تحقق يدوي.`;
    return result;
  }
  
  result.additive_name = ai ? ai.name : t3info.name;
  result.functional_class = ai ? ai.functional_class : (t3info ? t3info.functional_class : '');
  
  // Helper to resolve note IDs to text
  function resolveNotes(str) {
    if (!str) return [];
    return str.split(/[,&\s]+/)
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
      .map(id => {
        const n = db.prepare('SELECT text FROM notes WHERE note_id=?').get(id);
        return n ? { id, text: n.text } : null;
      }).filter(Boolean);
  }
  
  // If no category provided, just confirm existence
  if (!catNo) {
    result.verdict = 'NEEDS_CATEGORY';
    result.message_ar = `${result.additive_name} موجود في قاعدة البيانات لكن الفئة الغذائية غير محددة — حدد فئة المنتج للتحقق من السماح.`;
    return result;
  }
  
  const catHierarchy = getParentCats(catNo);
  
  // STEP 1: Check Table 1 (specific permissions)
  let t1 = null;
  for (const cat of catHierarchy) {
    t1 = db.prepare(
      'SELECT * FROM table1 WHERE ins=? AND cat_no=?'
    ).get(ins, cat);
    if (t1) break;
  }
  result.steps.table1 = t1 || null;
  
  if (t1) {
    result.max_level = t1.max_level;
    result.notes_text = resolveNotes(t1.notes);
    result.verdict = 'PASS';
    result.message_ar = `مسموح حسب الجدول 1 — الفئة: ${t1.cat_no} — الحد الأقصى: ${t1.max_level}`;
    result.steps.table3 = t3info || null;
    return result;
  }
  
  // STEP 2: Check Table 2 (group permissions)
  let t2 = null;
  for (const cat of catHierarchy) {
    t2 = db.prepare(
      'SELECT * FROM table2 WHERE cat_no=? AND (ins=? OR ins LIKE ?)'
    ).get(cat, ins, `%${ins}%`);
    if (t2) break;
  }
  result.steps.table2 = t2 || null;
  
  if (t2) {
    result.max_level = t2.max_level;
    result.notes_text = resolveNotes(t2.notes);
    result.verdict = 'PASS';
    result.message_ar = `مسموح حسب الجدول 2 — الحد الأقصى: ${t2.max_level}`;
    result.steps.table3 = t3info || null;
    return result;
  }
  
  // STEP 3: Check Table 3 (GMP additives with Annex 3 exclusions)
  result.steps.table3 = t3info || null;
  
  let annex = null;
  for (const cat of catHierarchy) {
    annex = db.prepare(
      'SELECT cat_no FROM annex3 WHERE cat_no=?'
    ).get(cat);
    if (annex) break;
  }
  result.steps.annex3 = !!annex;
  
  if (t3info) {
    if (annex) {
      result.verdict = 'FAIL';
      result.message_ar = `غير مسموح — الفئة ${annex.cat_no} مستثناة في Annex 3 من شروط الجدول 3 (GMP)`;
    } else {
      result.verdict = 'PASS';
      result.max_level = t3info.max_level || 'GMP';
      result.message_ar = `مسموح حسب الجدول 3 (GMP) — الفئة غير مستثناة في Annex 3`;
    }
    return result;
  }
  
  // STEP 4: Not allowed in this food category
  result.verdict = 'FAIL';
  result.message_ar = `غير مسموح — INS ${ins} (${result.additive_name}) غير مدرج في أي جدول من جداول CXS 192 لهذه الفئة الغذائية`;
  return result;
}


// ================================================================
// MAIN: Verify all additives extracted from a label
// ================================================================
function verifyExtractedAdditives(db, extractedAdditives, productType) {
  // Defensive checks
  if (!db) {
    return {
      verified_additives: [],
      summary: { total_found: 0, error: 'Database not available' },
      violations: []
    };
  }
  
  if (!extractedAdditives || !Array.isArray(extractedAdditives) || extractedAdditives.length === 0) {
    return {
      verified_additives: [],
      summary: {
        total_found: 0,
        allowed_count: 0,
        forbidden_count: 0,
        unknown_count: 0,
        no_ins_count: 0,
        has_artificial_colors: false,
        has_artificial_sweeteners: false,
        has_preservatives: false,
        overall_status: 'NO_ADDITIVES'
      },
      violations: []
    };
  }
  
  const catNo = PRODUCT_CAT_MAP[productType] || null;
  const verified = [];
  
  // Process each extracted additive
  for (const additive of extractedAdditives) {
    try {
      const resolvedIns = resolveINS(additive);
      
      if (!resolvedIns) {
        // Could not determine INS at all
        verified.push({
          name_as_written: additive.name_as_written || additive.name || 'غير معروف',
          name_en: additive.name_en || '',
          name_ar: additive.name_ar || '',
          ins: null,
          e_number: additive.e_number || null,
          catNo,
          verdict: 'NO_INS',
          message_ar: `لم يتم التعرف على رقم INS لهذا المضاف. تحقق يدوياً.`,
          category: null,
          additive_name: null,
          max_level: null,
          notes_text: []
        });
        continue;
      }
      
      // Verify against Codex tables
      const checkResult = checkAdditive(db, resolvedIns, catNo || '');
      
      verified.push({
        name_as_written: additive.name_as_written || additive.name || '',
        name_en: additive.name_en || checkResult.additive_name || '',
        name_ar: additive.name_ar || '',
        ins: resolvedIns,
        e_number: additive.e_number || `E${resolvedIns}`,
        catNo,
        verdict: checkResult.verdict,
        message_ar: checkResult.message_ar,
        category: checkResult.category,
        additive_name: checkResult.additive_name,
        functional_class: checkResult.functional_class,
        max_level: checkResult.max_level,
        notes_text: checkResult.notes_text || []
      });
      
    } catch (err) {
      verified.push({
        name_as_written: additive.name_as_written || additive.name || 'خطأ',
        ins: null,
        catNo,
        verdict: 'ERROR',
        message_ar: `خطأ في فحص المضاف: ${err.message}`,
        category: null
      });
    }
  }
  
  // Build summary statistics
  const summary = {
    total_found: verified.length,
    allowed_count: verified.filter(v => v.verdict === 'PASS').length,
    forbidden_count: verified.filter(v => v.verdict === 'FAIL').length,
    unknown_count: verified.filter(v => v.verdict === 'NOT_FOUND').length,
    no_ins_count: verified.filter(v => v.verdict === 'NO_INS').length,
    needs_category_count: verified.filter(v => v.verdict === 'NEEDS_CATEGORY').length,
    has_artificial_colors: verified.some(v => v.category === 'artificial_colors'),
    has_artificial_sweeteners: verified.some(v => v.category === 'artificial_sweeteners'),
    has_preservatives: verified.some(v => v.category === 'preservatives'),
    has_flavor_enhancers: verified.some(v => v.category === 'flavor_enhancers'),
    artificial_colors_list: verified.filter(v => v.category === 'artificial_colors')
                                    .map(v => `${v.additive_name || v.name_en} (INS ${v.ins})`),
    artificial_sweeteners_list: verified.filter(v => v.category === 'artificial_sweeteners')
                                        .map(v => `${v.additive_name || v.name_en} (INS ${v.ins})`)
  };
  
  // Determine overall status
  if (summary.forbidden_count > 0) {
    summary.overall_status = 'FAIL';
  } else if (summary.no_ins_count > 0 || summary.unknown_count > 0 || summary.needs_category_count > 0) {
    summary.overall_status = 'WARNING';
  } else if (summary.allowed_count > 0) {
    summary.overall_status = 'PASS';
  } else {
    summary.overall_status = 'NO_ADDITIVES';
  }
  
  // Build violations list (for compliance report)
  const violations = [];
  
  // Add violations for forbidden additives
  verified.filter(v => v.verdict === 'FAIL').forEach(v => {
    violations.push({
      code: `CXS192-${v.ins}`,
      rule: `مضاف غير مسموح: ${v.additive_name || v.name_en} (INS ${v.ins})`,
      category: 'مضافات',
      requirement: `INS ${v.ins} غير مسموح في الفئة ${v.catNo || 'غير محددة'} حسب Codex CXS 192`,
      status: 'critical',
      note: v.message_ar,
      solution: `احذف المضاف INS ${v.ins} (${v.additive_name || v.name_en}) أو استبدله بمضاف مسموح في هذه الفئة الغذائية`
    });
  });
  
  // Add warning for additives without INS
  verified.filter(v => v.verdict === 'NO_INS').forEach(v => {
    violations.push({
      code: `CXS192-NO-INS`,
      rule: `مضاف بدون رقم INS: ${v.name_as_written}`,
      category: 'مضافات',
      requirement: `يجب التحقق من رقم INS للمضاف "${v.name_as_written}" يدوياً`,
      status: 'warning',
      note: v.message_ar,
      solution: `راجع البطاقة وحدد رقم INS الصحيح، ثم تحقق من السماح في الفئة الغذائية`
    });
  });
  
  // Warning if artificial sweeteners present (JS-SWEET-01)
  if (summary.has_artificial_sweeteners) {
    violations.push({
      code: `JS9-SWEET-01`,
      rule: `يحتوي على محليات صناعية`,
      category: 'مضافات',
      requirement: `وفقاً لـ JS 9:2025، يجب ذكر نسبة المحلي الصناعي على البطاقة + تحذير "يحتوي على فينيل ألانين" إذا كان أسبارتام`,
      status: 'warning',
      note: `المحليات المكتشفة: ${summary.artificial_sweeteners_list.join('، ')}`,
      solution: `تأكد من ذكر نسبة كل محلي صناعي على البطاقة، وأضف تحذير الفينيل ألانين إذا كان المنتج يحتوي على أسبارتام (INS 951)`
    });
  }
  
  return {
    verified_additives: verified,
    summary,
    violations
  };
}


// ================================================================
// EXPORTS
// ================================================================
module.exports = {
  verifyExtractedAdditives,
  checkAdditive,
  resolveINS,
  classifyAdditive,
  PRODUCT_CAT_MAP,
  NAME_TO_INS,
  ADDITIVE_CATEGORIES
};
