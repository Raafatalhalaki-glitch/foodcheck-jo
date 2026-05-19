# مراجعة PRODUCT_CAT_MAP - منهج التعريف الحرفي
**تاريخ المراجعة:** 17 مايو 2026  
**المراجع:** م. رأفت (خبير سلامة غذاء)  
**المرجع:** Codex CXS 192:2025 (GSFA) + Annex C  
**المشروع:** FoodCheck Jordan - Phase 3 Architecture  
**الحالة:** مراجعة جزئية - مكتمل: 01, 04 (جزئي), 07, 12, 13, 14, 15

---

## ⚠️ الدرس الجوهري للمراجعة

**أي منتج له "Regional Standard" أو معيار Codex مخصص موجود بالاسم في Annex C.**

أمثلة موثّقة:
- `Tehena` (طحينة) → CXS 259R-2007 → **04.2.2.6**
- `Halwa Tehenia` (حلاوة طحينية) → CXS 309R-2011 → **05.2.2**
- `Chilli Sauce` → CXS 306-2011 → **12.6.2**
- `Tannia` → **04.2.1.1**

**القاعدة:** قبل الاستنتاج من شكل/مكوّن المنتج، **ابحث في Annex C أولاً** بكلمات مفتاحية (إنجليزية وعربية).

هذا الدرس **يتكرر** - من Coffee Mate قبل أسابيع، إلى Tahini اليوم. الـ Annex C موثوق، الاستنتاج خاطئ.

---

## المنهجية المعتمدة (3 طبقات)

1. **الطبقة الأولى:** البحث في Annex C - إذا وُجد المنتج، استخدم تصنيفه مباشرة
2. **الطبقة الثانية:** قراءة التعريف الحرفي لفئات Codex - لا الاستنتاج من شكل المنتج
3. **الطبقة الثالثة:** الاستثناءات الصريحة في التعريفات (مثل "excluding..." أو "for ... only")

---

## فئة 01 (الألبان) - نهائي

| product_type | الكود | الحالة |
|---|---|---|
| `uht_milk` | `01.1.1` | ✅ |
| `pasteurized_milk` | `01.1.1` | ✅ |
| `flavored_milk` | `01.1.4` | ✅ |
| `coffee_milk` | `01.1.4` | ✅ |
| `yoghurt_fresh` | `01.2.1.1` | 🆕 (بكتيريا حية) |
| `yoghurt_heat_treated` | `01.2.1.2` | 🆕 (UHT) |
| `yoghurt` (default) | `01.2.1.2` | ⚠️ |
| `labneh` | `01.2.1.2` | ✅ |
| `condensed_milk` | `01.3.1` | ✅ |
| `evaporated_milk` | `01.3.1` | ✅ |
| `coffee_creamer` | `01.3.2` | 🆕 (Coffee Mate) |
| `filled_condensed_milk` | `01.3.2` | 🔧 من 01.4.2 |
| `filled_evaporated_milk` | `01.3.2` | 🔧 |
| `cream` (default) | `01.4.2` | 🔧 من 01.4.1 (السوق UHT) |
| `cream_pasteurized` | `01.4.1` | 🆕 استثناء |
| `cream_analogue` | `01.4.4` | ✅ |
| `dried_milk` | `01.5.1` | ✅ |
| `filled_dried_milk` | `01.5.2` | 🔧 من 01.5.1 |
| `jameed` | `01.5.1` | ⚠️ Codex ما عنده فئة دقيقة |
| `soft_cheese` (نابلسية، عكاوي، شلل، فيتا) | `01.6.1` | ✅ |
| `processed_cheese` | `01.6.4` | ✅ |
| `whey_cheese` (ريكوتا، شنكليش) | `01.6.3` | 🆕 |
| `cheese_analogue` | `01.6.5` | 🆕 |
| `dairy_dessert` (مهلبية، كاسترد) | `01.7` | 🆕 |
| `ice_cream` | `03.0` | (فئة 03 منفصلة) |

---

## فئة 04 (فواكه وخضار) - تحديثات

| product_type | الكود | ملاحظة |
|---|---|---|
| `tomato_paste` (معجون/رب) | `04.2.2.6` | ✅ |
| `tomato_puree` (هريس/بييوره) | `04.2.2.5` | 🆕 تفريق عن paste |
| `tahini` (طحينة) | `04.2.2.6` | 🔧 من 12.7 (CXS 259R-2007) |
| `tannia` | `04.2.1.1` | 🆕 من Annex C |
| `vegetable_puree` | `04.2.2.5` | 🆕 |

**ملاحظة:** بقية فئة 04 (jam, dried fruits, canned, etc.) لم تتم مراجعتها بعد.

---

## فئة 07 (المخبوزات) - نهائي

| product_type | الكود | الحالة |
|---|---|---|
| `bread_western` (توست، باغيت) | `07.1.1.1` | 🆕 |
| `arabic_bread` (خبز عربي، شراك) | `07.1.3` | 🆕 |
| `cracker` (مالح) | `07.1.2` | 🆕 |
| `biscuit` (كوكيز، بسكويت محلى) | `07.2.1` | 🔧 من 07.1.2 |
| `cake` | `07.2.1` | ✅ |
| `wafer` | `07.2.2` | 🆕 (التعريف الحرفي) |
| `pastry` (كرواسون، دونات، مافن) | `07.2.2` | 🆕 |
| `baklava` (بقلاوة، معمول، قطايف) | `07.2.2` | 🆕 |
| `knafeh_cheese` (كنافة بالجبنة) | `16.0` | 🆕 (composite) |

---

## فئة 12 (الصلصات والتوابل) - نهائي

| product_type | الكود | ملاحظة |
|---|---|---|
| `salt` | `12.1.1` | ✅ |
| `salt_substitute` | `12.1.2` | 🆕 |
| `spices` (default) | `12.2.1` | ✅ |
| `cinnamon, black_pepper, paprika, cumin, turmeric` | `12.2.1` | ✅ |
| `seasoning_mix` (تتبيلة لحوم) | `12.2.2` | ✅ |
| `flower_water` (ماء ورد/زهر) | `12.2.2` | 🔧 من 12.9 ومن 14.1.4 |
| `zaatar_seasoning` | `12.2.2` | ✅ |
| `vinegar` | `12.3` | ✅ |
| `mustard` | `12.4` | ✅ |
| `bouillon_broth, stock_cube, instant_soup` | `12.5` | ✅ |
| `mayonnaise` | `12.6.1` | ✅ |
| `creamy_dressing` (Ranch, Caesar) | `12.6.1` | 🆕 |
| `aioli` | `12.6.1` | 🆕 |
| `salad_dressing_french` | `12.6.1` | ✅ |
| `ketchup` | `12.6.2` | ✅ |
| `hot_sauce, chili_sauce` | `12.6.2` | ✅ (CXS 306-2011) |
| `bbq_sauce` | `12.6.2` | ✅ |
| `pasta_sauce, pizza_sauce` | `12.6.2` | ✅ |
| `gravy` | `12.6.2` | ✅ |
| `fish_sauce` | `12.6.4` | 🆕 |
| `hummus, baba_ghanoush, mutabbal` | `12.7` | ✅ |
| `soy_sauce` | `12.9.2` | 🔧 (مذكورة بالاسم في Codex) |

**القاعدة الفلسفية:** عندما يكون الدهن مكوّن رئيسي → 12.6.1، وإلا → 12.6.2. هذه القاعدة تحتاج قراءة قائمة المكوّنات لا الصورة.

---

## فئة 13 (أغذية خاصة) - نهائي

| product_type | الكود | الحالة |
|---|---|---|
| `infant_formula` | `13.1.1` | ✅ |
| `fsmp_infant_formula` | `13.1.1` | ✅ |
| `cereal_infant` | `13.1.3` | ✅ |
| `dietetic_food` | `13.5` | 🆕 |
| `cereal_bar_functional` (bar مع claims) | `13.5` | 🆕 |
| `food_supplement_dose` (كبسولات، حبوب، بودرة) | `13.6` | 🔧 |

**التفريق الحرج:** 13.5 = منتج غذائي معدّل لغرض صحي / 13.6 = "dose form" حصرياً.

---

## فئة 14 (المشروبات) - تحديثات

| product_type | الكود | ملاحظة |
|---|---|---|
| `coffee, coffee_3in1, tea` | `14.1.5` | ✅ |

**ملاحظة:** الحدود تُحسب على المشروب الجاهز (as-consumed) بعد التخفيف.

---

## فئة 15 (السناك) - تحديثات

| product_type | الكود | ملاحظة |
|---|---|---|
| `corn_chips, potato_chips, popcorn` | `15.1` | ✅ (savoury only) |
| `cereal_bar` (محلى، بمكسرات) | `15.2` | 🔧 من 15.1 |
| `roasted_nuts` | `15.2` | ✅ |

---

## الأخطاء المنهجية المُكتشفة

| # | الخطأ | السبب الجذري |
|---|---|---|
| 1 | `biscuit → 07.1.2` | استنتاج: "بسكويت = مخبوزات". الصح: 07.1.2 = crackers فقط |
| 2 | `coffee_creamer → 01.5.2` | "بودرة بيضاء = milk powder analogue". 01.3.2 يستثني هذا صراحة |
| 3 | `filled_condensed_milk → 01.4.2` | "filled" = analogue → 01.3.2 |
| 4 | `filled_dried_milk → 01.5.1` | لم نُفرّق milk و milk analogue powder |
| 5 | `yoghurt → 01.2.1.2` فقط | لم نُفرّق fermented heat-treated عن non-treated |
| 6 | `cream → 01.4.1` كـ default | السوق غالبيته UHT (01.4.2) |
| 7 | `flower_water → 12.9` | 12.9 = Protein products (لا علاقة) |
| 8 | `tahini → 12.7` | لم نبحث في Annex C - الصح 04.2.2.6 |
| 9 | `flower_water → 14.1.4` | استنتاج خاطئ - الصح 12.2.2 (تنكيه) |
| 10 | `tomato_paste = tomato_concentrate` | لم نُفرّق paste (06) عن puree (05) |

**النمط الجوهري:** كل الأخطاء = استنتاج من شكل/استعمال المنتج بدلاً من قراءة Codex/Annex C الحرفية.

---

## الفئات المتبقية للمراجعة

- [ ] 02 - دهون وزيوت
- [ ] 03 - بوظة وآيس كريم
- [ ] 04 - استكمال (jam, dried fruits, canned, etc.)
- [ ] 05 - حلويات (chocolate, candy)
- [ ] 06 - حبوب (rice, flour, pasta, cereals)
- [ ] 08 - لحوم
- [ ] 09 - أسماك (بعض التحديثات تمت)
- [ ] 10 - بيض
- [ ] 11 - سكر وعسل
- [ ] 16 - الأطعمة المركبة

---

## الخطوات التالية

1. مكمل المراجعة للفئات المتبقية بنفس المنهجية
2. بناء patch v2 للـ `PRODUCT_CAT_MAP`
3. تحديث `benchmark_images_v2.py` ليشمل الأنواع الجديدة
4. إعادة تشغيل الـ benchmark
5. مقارنة النتائج مع v1 و v2

---

## ملاحظة ختامية

الـ map الحالي مرحلة انتقالية. الحل الجذري = إكمال Phase 3 Step 1 (Annex C lookup أولاً).
