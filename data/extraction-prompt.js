// ================================================================
// FoodCheck Jordan — Phase 3 Architecture
// Extraction Prompt (Data Extraction Only — No Judgment)
// ================================================================
// 
// PHILOSOPHY:
// This module's ONLY job is to ask Claude to read a food label image
// and return raw extracted data as structured JSON. 
// 
// NO judgment, NO rules, NO compliance decisions happen here.
// All compliance logic lives in rule-engine.js (deterministic code).
//
// This separation gives us:
//   1. Consistent results (same label → same JSON every time)
//   2. Lower API cost (smaller prompt)
//   3. Faster responses
//   4. Easier debugging (data extraction issues vs rule issues)
// ================================================================

/**
 * Builds the extraction prompt for Claude API.
 * @param {string} productType - The product category (e.g. 'candy', 'dairy', 'auto')
 * @returns {string} The complete prompt text
 */
function buildExtractionPrompt(productType = 'auto') {
  return `أنت خبير في قراءة بطاقات البيان الغذائية. مهمتك هي **استخراج البيانات الخام فقط** من الصور المرفقة.

**مهم جداً:**
- لا تحكم على أي شيء (مطابق/غير مطابق)
- لا تطبق أي قواعد أو معايير
- لا تترجم بنفسك إلا حيث مطلوب صراحة
- فقط استخرج ما تراه على البطاقة بدقة

**اللغات المتوقعة على البطاقة:**
العربية، الإنجليزية، الفرنسية، التركية، الروسية. اقرأ كل اللغات الموجودة بدقة.

**نوع المنتج المُعلَن من المستخدم:** ${productType}

**ما يجب استخراجه:**

1. **اسم المنتج** - كما هو مكتوب باللغات المتاحة
2. **قائمة المكونات** - النص الكامل كما هو مكتوب
3. **المضافات الغذائية** - استخرج كل مضاف بشكل منفصل مع:
   - الاسم كما هو مكتوب
   - رقم E إذا ذُكر (مثل E104, E122)
   - رقم INS إذا ذُكر (مثل INS 950, INS 951)
4. **مواد الحساسية** - كل ما تجده مذكوراً على البطاقة
5. **الجدول التغذوي** - القيم كما هي مكتوبة
6. **بيانات الصلاحية** - تاريخ الإنتاج وتاريخ الانتهاء
7. **بيانات المُصنّع** - الاسم والعنوان وبلد المنشأ
8. **الوزن/الحجم الصافي** - كما هو مكتوب
9. **رقم الدفعة** - إذا كان واضحاً
10. **اللغات الموجودة على البطاقة** - أي لغات تستطيع قراءتها
11. **الباركود** - إذا كان واضحاً
12. **ادعاءات/تحذيرات** - أي نص تحذيري أو ادعاء صحي

**قواعد الاستخراج المهمة:**

أ. **المضافات:** ابحث عن:
   - أرقام E (E100 إلى E999)
   - أرقام INS (1 إلى 1525)
   - أسماء ملوّنات معروفة: Quinoline Yellow, Carmoisine, Brilliant Blue, Tartrazine, Sunset Yellow, Allura Red, Erythrosine, Ponceau, Indigo Carmine, Azorubine
   - أسماء محليات: Aspartame, Acesulfame, Sucralose, Saccharin, Stevia, Sorbitol, Xylitol
   - أسماء مواد حافظة: Sodium Benzoate, Potassium Sorbate, Sulphites
   - أسماء أحماض: Citric Acid, Malic Acid, Tartaric Acid, Lactic Acid
   - أي مادة في قائمة المكونات لها رقم تعريفي
   استخرج كل مضاف حتى لو كان مذكوراً 20 مرة بأشكال مختلفة.

ب. **الجدول التغذوي:** استخرج كل قيمة موجودة حتى لو كان الجدول ناقصاً.

ج. **اللغات:** إذا البطاقة باللغة الإنجليزية فقط، اكتب "arabic_text_present": false. لا تترجم أنت.

د. **الصور المتعددة:** إذا أُعطيت أكثر من صورة، اعتبرها وجوهاً مختلفة لنفس المنتج واجمع البيانات منها كلها.

هـ. **عدم الوضوح:** إذا لم تستطع قراءة شيء، اكتب null. لا تخمن.

**أعطِ الجواب بصيغة JSON فقط بدون أي نص خارجي:**

\`\`\`json
{
  "product_name": {
    "ar": "الاسم بالعربية إن وجد، أو null",
    "en": "الاسم بالإنجليزية إن وجد، أو null",
    "fr": null,
    "tr": null,
    "ru": null
  },
  "product_type_declared": "${productType}",
  "ingredients_text": {
    "ar": "النص الكامل لقائمة المكونات بالعربية، أو null",
    "en": "النص الكامل لقائمة المكونات بالإنجليزية، أو null",
    "fr": null,
    "tr": null,
    "ru": null
  },
  "additives": [
    {
      "name_as_written": "Quinoline Yellow",
      "name_ar": null,
      "name_en": "Quinoline Yellow",
      "e_number": "E104",
      "ins_number": "104",
      "found_in_image": "main_label"
    }
  ],
  "allergens_mentioned": [
    {
      "name_as_written": "Milk",
      "category": "milk"
    }
  ],
  "nutrition_table": {
    "present": true,
    "per_basis": "100g or per serving",
    "serving_size": "80g",
    "servings_per_package": null,
    "values": {
      "calories_kcal": "264",
      "calories_kj": null,
      "protein_g": "0.08",
      "total_fat_g": "0.24",
      "saturated_fat_g": null,
      "trans_fat_g": null,
      "cholesterol_mg": null,
      "carbohydrate_g": "65.28",
      "total_sugars_g": "64.88",
      "added_sugars_g": null,
      "fiber_g": null,
      "sodium_mg": null,
      "salt_g": "0.16"
    },
    "raw_text": "النص الكامل للجدول كما هو مكتوب"
  },
  "manufacturer": {
    "name": "Aftab Talayee Persian Co.",
    "address": "العنوان الكامل إن وجد",
    "country_of_origin": "Iran",
    "phone": "+98-21-88500844",
    "responsible_party_in_jordan": null
  },
  "dates": {
    "production_date": "2025-05-28",
    "expiry_date": "2028-05-28",
    "best_before_date": null,
    "shelf_life_after_opening": null
  },
  "net_content": {
    "value": "80",
    "unit": "g",
    "drained_weight": null
  },
  "batch_number": null,
  "barcode": "6262227003521",
  "languages_on_label": ["en", "ru", "ar"],
  "arabic_text_present": true,
  "claims_on_label": ["Sugar dragee with sour flavor"],
  "warnings_on_label": ["Keep away from moisture and light"],
  "storage_instructions": "Keep away from moisture and light",
  "preparation_instructions": null,
  "halal_indicator_present": false,
  "image_quality_notes": "ملاحظات على جودة الصورة إن كانت مهمة، مثل: الصورة مقلوبة، النص الصغير غير واضح"
}
\`\`\`

**تذكير أخير:** لا تكتب أي شيء قبل أو بعد الـ JSON. الجواب يبدأ بـ { وينتهي بـ }.`;
}

// تصدير الدالة للاستخدام في server.js
module.exports = { buildExtractionPrompt };
