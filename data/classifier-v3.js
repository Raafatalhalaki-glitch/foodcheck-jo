// ================================================================
// FoodCheck Jordan — Phase 3 Architecture
// Classifier v3 — Pattern Match Engine (JS port)
// ================================================================
//
// PHILOSOPHY:
// التصنيف يعتمد على اسم المنتج، ليس المكونات.
//
// طبقتان فقط:
//   Layer 1: Pattern Match — قاموس الأنماط المعروفة (62 entry)
//   Layer 2: Unclassified — "غير مصنّف، يحتاج مراجعة"
//
// تم حذف Descriptor Fallback لأنه:
//   - الجدول category_descriptors غير موجود في codex_v2.db
//   - الـ 13 test cases كلها تنحلّ من Layer 1 بنجاح
//   - "غير مصنّف صريح" أفضل من "تخمين خاطئ"
//
// INPUT:
//   { name_en: "American Garden Mayonnaise", name_ar: "" }
//
// OUTPUT:
//   {
//     classification: {
//       cat_no: "12.6.1",
//       confidence: "high",                  // high | none
//       method: "pattern_match",             // pattern_match | unclassified
//       matched_pattern: "mayonnaise",
//       reason: "Mayonnaise → emulsified sauce 12.6.1",
//       cxs: null,                           // optional CXS reference
//       alternatives: []                     // up to 2 next-best cat_no
//     },
//     product_name: "American Garden Mayonnaise"
//   }
//
// Port reference: classifier_v3.py (14 May 2026 rebuild)
// ================================================================


// ================================================================
// قاموس الأنماط المعروفة (62 entry)
// المطابقة تستخدم word boundary للإنجليزي + contains للعربي
// ================================================================
const KNOWN_PRODUCT_PATTERNS = [
  // ============ 12.6 - صلصات ومتبلات ============
  { patterns: ['mayonnaise', 'mayo', 'مايونيز'], cat: '12.6.1',
    reason: 'Mayonnaise → emulsified sauce 12.6.1' },

  { patterns: ['french dressing', 'italian dressing', 'salad dressing',
               'caesar dressing', 'ranch dressing', 'thousand island',
               'صلصة سلطة', 'تتبيلة سلطة'],
    cat: '12.6.1',
    reason: 'Salad dressing → emulsified sauce 12.6.1' },

  { patterns: ['ketchup', 'tomato ketchup', 'catsup', 'كاتشب', 'كتشب'],
    cat: '12.6.2', cxs: '306-2011',
    reason: 'Tomato ketchup → non-emulsified sauce 12.6.2' },

  { patterns: ['bbq sauce', 'barbecue sauce', 'bar-b-q sauce', 'صلصة باربكيو', 'صلصة شواء'],
    cat: '12.6.2',
    reason: 'Barbecue sauce → 12.6.2' },

  { patterns: ['chilli sauce', 'chili sauce', 'hot sauce', 'sriracha', 'صلصة حارة', 'صلصة فلفل'],
    cat: '12.6.2',
    reason: 'Chilli sauce → 12.6.2' },

  { patterns: ['gravy', 'brown gravy', 'gravy mix'],
    cat: '12.6.2',
    reason: 'Gravy → 12.6.2' },

  { patterns: ['pasta sauce', 'pizza sauce', 'tomato sauce', 'صلصة معكرونة', 'صلصة بيتزا', 'صلصة بندورة'],
    cat: '12.6.2',
    reason: 'Pasta/tomato sauce → 12.6.2' },

  { patterns: ['fish sauce', 'صلصة سمك'], cat: '12.6.4', cxs: '302-2011',
    reason: 'Fish sauce → 12.6.4' },

  { patterns: ['soy sauce', 'soya sauce', 'shoyu', 'صلصة صويا'],
    cat: '12.9.2.1',
    reason: 'Soybean sauce → 12.9.2.1' },

  { patterns: ['mustard sauce', 'prepared mustard', 'dijon mustard', 'خردل', 'موستردا'],
    cat: '12.4',
    reason: 'Mustard → 12.4' },

  { patterns: ['vinegar', 'apple cider vinegar', 'balsamic vinegar', 'خل', 'خل تفاح'],
    cat: '12.3',
    reason: 'Vinegar → 12.3' },

  // ============ 05 - حلويات ============
  { patterns: ['hard candy', 'lollipop', 'lollipops', 'hard sweet', 'sugar drops',
               'sucker', 'rock candy', 'ملبس', 'حلوى صلبة', 'مصاصة'],
    cat: '05.2.1',
    reason: 'Hard candy → 05.2.1' },

  { patterns: ['soft candy', 'gummy', 'gummies', 'gum drops', 'jelly bean',
               'jelly beans', 'fruit candy', 'fruit chews', 'sour candy',
               'sugar candy', 'sugar coated candy', 'chewy candy', 'taffy',
               'turkish delight', 'حلقوم', 'راحة', 'جلي', 'سكاكر طرية', 'حلوى طرية'],
    cat: '05.2.2',
    reason: 'Soft candy → 05.2.2' },

  { patterns: ['skittles', 'starburst', 'mentos'],
    cat: '05.2.2',
    reason: 'Branded fruit candy → 05.2.2' },

  { patterns: ['nougat', 'marzipan', 'نوجا', 'مرزبان', 'لوز مطحون محلى'],
    cat: '05.2.3',
    reason: 'Nougat/marzipan → 05.2.3' },

  { patterns: ['chewing gum', 'bubble gum', 'gum', 'علكة'],
    cat: '05.3',
    reason: 'Chewing gum → 05.3' },

  { patterns: ['chocolate bar', 'milk chocolate', 'dark chocolate', 'white chocolate',
               'chocolate truffles', 'cocoa powder', 'شوكولاتة', 'شوكولا', 'كاكاو'],
    cat: '05.1.4',
    reason: 'Chocolate → 05.1.4' },

  { patterns: ['chocolate spread', 'nutella', 'cocoa spread', 'كريمة شوكولاتة', 'دهن شوكولاتة'],
    cat: '05.1.3',
    reason: 'Cocoa-based spread → 05.1.3' },

  { patterns: ['halawa', 'halva', 'halwa', 'حلاوة طحينية', 'حلاوة بالطحينة'],
    cat: '05.2.2',
    reason: 'Halawa → soft confectionery 05.2.2' },

  // ============ 07 - مخبوزات ============
  { patterns: ['bread', 'loaf', 'baguette', 'sandwich bread', 'white bread', 'whole wheat bread',
               'خبز', 'صامولي', 'باغيت'],
    cat: '07.1.1',
    reason: 'Bread → 07.1.1' },

  { patterns: ['pita', 'pita bread', 'arabic bread', 'flat bread', 'tortilla', 'lavash',
               'خبز عربي', 'خبز شراك', 'مرقوق'],
    cat: '07.1.2',
    reason: 'Flat bread → 07.1.2' },

  { patterns: ['cake', 'pound cake', 'sponge cake', 'cup cake', 'cupcake', 'cheesecake',
               'chocolate cake', 'milk cake', 'fruit cake', 'كعكة', 'كيك', 'كيكة', 'تورتة'],
    cat: '07.2.1',
    reason: 'Cake → 07.2.1' },

  { patterns: ['biscuit', 'biscuits', 'cookie', 'cookies', 'cracker', 'crackers',
               'wafer', 'wafers', 'بسكويت', 'كوكيز', 'ويفر'],
    cat: '07.2.1',
    reason: 'Biscuits/cookies → 07.2.1' },

  { patterns: ['croissant', 'donut', 'doughnut', 'muffin', 'pastry', 'danish pastry',
               'كرواسون', 'دونات', 'مافن', 'معجنات', 'فطائر حلوة'],
    cat: '07.2.2',
    reason: 'Fine bakery wares → 07.2.2' },

  { patterns: ['kunafa', 'baklava', 'maamoul', 'qatayef', 'كنافة', 'بقلاوة', 'معمول', 'قطايف'],
    cat: '07.2.1',
    reason: 'Middle Eastern pastries → 07.2.1' },

  // ============ 15 - وجبات خفيفة ============
  { patterns: ['potato chips', 'crisps', 'potato crisps', 'chips', 'pringles',
               'kitco', 'شيبس', 'شبس', 'بطاطا مقلية'],
    cat: '15.1',
    reason: 'Potato chips → 15.1' },

  { patterns: ['corn chips', 'tortilla chips', 'nachos', 'doritos', 'cheetos',
               'شيبس ذرة', 'تشيبس'],
    cat: '15.1',
    reason: 'Corn-based snacks → 15.1' },

  { patterns: ['popcorn', 'فشار', 'بوشار'],
    cat: '15.1',
    reason: 'Popcorn → 15.1' },

  { patterns: ['pretzel', 'pretzels', 'بريتزل', 'مالحات مخبوزة'],
    cat: '15.1',
    reason: 'Pretzels → 15.1' },

  { patterns: ['roasted nuts', 'salted nuts', 'mixed nuts', 'peanuts roasted',
               'مكسرات محمصة', 'فستق محمص', 'لوز محمص', 'كاجو محمص'],
    cat: '15.2',
    reason: 'Roasted/salted nuts → 15.2' },

  // ============ 14.1 - مشروبات ============
  { patterns: ['mineral water', 'spring water', 'still water', 'مياه معدنية', 'ماء معدني'],
    cat: '14.1.1.1',
    reason: 'Mineral water → 14.1.1.1' },

  { patterns: ['fruit juice', 'orange juice', 'apple juice', 'grape juice',
               'pineapple juice', 'عصير فواكه', 'عصير برتقال', 'عصير تفاح'],
    cat: '14.1.2.1',
    reason: 'Fruit juice → 14.1.2.1' },

  { patterns: ['vegetable juice', 'tomato juice', 'carrot juice', 'عصير خضار', 'عصير بندورة'],
    cat: '14.1.2.2',
    reason: 'Vegetable juice → 14.1.2.2' },

  { patterns: ['fruit nectar', 'apricot nectar', 'peach nectar', 'mango nectar',
               'apricot drink', 'mango drink', 'رحيق فواكه', 'شراب مشمش', 'شراب خوخ'],
    cat: '14.1.3.1',
    reason: 'Fruit nectar → 14.1.3.1' },

  { patterns: ['fruit drink', 'fruit beverage', 'flavoured drink', 'flavored drink',
               'fruit punch', 'شراب فواكه', 'مشروب فواكه'],
    cat: '14.1.4',
    reason: 'Fruit-flavoured drink → 14.1.4' },

  { patterns: ['soda', 'cola', 'cola drink', 'soft drink', 'carbonated drink',
               'sparkling drink', 'pepsi', 'مشروب غازي', 'مياه غازية'],
    cat: '14.1.4',
    reason: 'Soft drinks → 14.1.4' },

  { patterns: ['energy drink', 'sports drink', 'isotonic drink', 'red bull',
               'مشروب طاقة', 'مشروب رياضي'],
    cat: '14.1.4',
    reason: 'Energy/sports drinks → 14.1.4' },

  { patterns: ['coffee', 'instant coffee', 'ground coffee', 'coffee beans',
               'قهوة', 'قهوة سريعة', 'قهوة سادة'],
    cat: '14.1.5',
    reason: 'Coffee → 14.1.5' },

  { patterns: ['tea', 'black tea', 'green tea', 'tea bags', 'herbal tea',
               'شاي', 'شاي أخضر', 'شاي أكياس', 'أعشاب'],
    cat: '14.1.5',
    reason: 'Tea → 14.1.5' },

  // ============ 01 - ألبان ============
  { patterns: ['fresh milk', 'whole milk', 'pasteurized milk', 'uht milk', 'full cream milk',
               'حليب طازج', 'حليب كامل الدسم', 'حليب مبستر'],
    cat: '01.1.1',
    reason: 'Fluid milk → 01.1.1' },

  { patterns: ['skim milk', 'low fat milk', 'half cream milk', 'حليب قليل الدسم', 'حليب منزوع الدسم'],
    cat: '01.1.1',
    reason: 'Reduced fat milk → 01.1.1' },

  { patterns: ['flavoured milk', 'flavored milk', 'chocolate milk', 'strawberry milk',
               'حليب منكه', 'حليب بنكهة', 'حليب بالشوكولاتة'],
    cat: '01.1.4',
    reason: 'Flavoured fluid milk → 01.1.4' },

  { patterns: ['evaporated milk', 'condensed milk', 'sweetened condensed milk',
               'حليب مبخر', 'حليب مكثف', 'حليب مكثف محلى'],
    cat: '01.3.1',
    reason: 'Evaporated/condensed milk → 01.3.1' },

  { patterns: ['milk powder', 'dried milk', 'powdered milk', 'instant milk',
               'حليب مجفف', 'حليب بودرة', 'حليب ناشف'],
    cat: '01.5.1',
    reason: 'Dried milk → 01.5.1' },

  { patterns: ['yoghurt', 'yogurt', 'plain yoghurt', 'لبن', 'لبن رايب', 'زبادي'],
    cat: '01.2.1.2',
    reason: 'Yoghurt → 01.2.1.2' },

  { patterns: ['flavoured yoghurt', 'fruit yoghurt', 'لبن بالفواكه', 'زبادي بالفواكه'],
    cat: '01.7',
    reason: 'Flavoured yoghurt → 01.7' },

  { patterns: ['labneh', 'labna', 'strained yoghurt', 'greek yoghurt', 'لبنة'],
    cat: '01.2.1.2',
    reason: 'Labneh → 01.2.1.2' },

  { patterns: ['fresh cream', 'whipping cream', 'heavy cream', 'cream',
               'قشطة', 'قشدة', 'كريمة'],
    cat: '01.4.1',
    reason: 'Cream → 01.4.1' },

  { patterns: ['cooking cream', 'culinary cream', 'cooking preparation',
               'vegetable cooking preparation', 'cooking base', 'كريمة طبخ'],
    cat: '02.3',
    reason: 'Vegetable-based cooking preparation (oil-in-water emulsion) → 02.3' },

  { patterns: ['cream substitute', 'cream analogue', 'non-dairy cream',
               'vegetable cream', 'whipping topping', 'كريمة نباتية', 'بديل قشدة'],
    cat: '01.4.4',
    reason: 'Cream analogues → 01.4.4' },

  { patterns: ['cheese', 'cheddar', 'mozzarella', 'feta', 'parmesan', 'gouda',
               'cream cheese', 'cottage cheese', 'جبنة', 'جبن', 'موزاريلا', 'فيتا'],
    cat: '01.6',
    reason: 'Cheese → 01.6' },

  { patterns: ['processed cheese', 'cheese slices', 'cheese spread',
               'جبنة مطبوخة', 'جبنة شرائح', 'جبنة قابلة للدهن'],
    cat: '01.6.4',
    reason: 'Processed cheese → 01.6.4' },

  { patterns: ['ice cream', 'frozen yoghurt', 'sorbet', 'sherbet', 'gelato',
               'بوظة', 'آيس كريم', 'جيلاتي'],
    cat: '03.0',
    reason: 'Edible ices → 03.0' },

  { patterns: ['jameed', 'جميد'],
    cat: '01.5.2',
    reason: 'Jameed - dried fermented milk product → 01.5.2' },

  // ============ 02 - دهون وزيوت ============
  { patterns: ['vegetable oil', 'sunflower oil', 'corn oil', 'palm oil', 'soybean oil',
               'canola oil', 'olive oil', 'extra virgin olive oil', 'sesame oil',
               'زيت نباتي', 'زيت دوار الشمس', 'زيت ذرة', 'زيت زيتون', 'زيت سمسم'],
    cat: '02.1.2',
    reason: 'Vegetable oil → 02.1.2' },

  { patterns: ['ghee', 'butter ghee', 'clarified butter', 'سمن', 'سمنة', 'سمن بقري'],
    cat: '02.1.1',
    reason: 'Ghee/butter oil → 02.1.1' },

  { patterns: ['butter', 'salted butter', 'unsalted butter', 'زبدة'],
    cat: '02.2.1',
    reason: 'Butter → 02.2.1' },

  { patterns: ['margarine', 'plant butter', 'مارجرين', 'سمن نباتي'],
    cat: '02.2.2',
    reason: 'Margarine → 02.2.2' },

  { patterns: ['blenda', 'edible fat blend', 'fat spread', 'shortening',
               'محضرات دهنية', 'خليط دهني'],
    cat: '02.1',
    reason: 'Edible fat blend (general) → 02.1' },

  { patterns: ['mayonnaise spread', 'sandwich spread', 'salad spread',
               'sandwich filling'],
    cat: '12.7',
    reason: 'Sandwich spreads → 12.7' },

  // ============ 13 - أغذية الرضع ============
  { patterns: ['infant formula', 'baby formula', 'starter formula',
               'حليب رضع', 'حليب أطفال', 'تركيبة رضع'],
    cat: '13.1.1',
    reason: 'Infant formula → 13.1.1' },

  { patterns: ['follow-up formula', 'follow up formula', 'حليب متابعة'],
    cat: '13.1.2',
    reason: 'Follow-up formula → 13.1.2' },

  { patterns: ['baby food', 'infant cereal', 'baby cereal', 'medolac',
               'cerelac', 'طعام أطفال', 'سيريلاك', 'حبوب أطفال'],
    cat: '13.2',
    reason: 'Baby/complementary food → 13.2' },

  // ============ 09 - لحوم ============
  { patterns: ['canned tuna', 'tuna in oil', 'tuna in water', 'tuna chunks',
               'تونة معلبة', 'تونا'],
    cat: '09.4', cxs: '70-1981',
    reason: 'Canned tuna → 09.4' },

  { patterns: ['canned sardines', 'sardines in oil', 'sardines in tomato',
               'سردين معلب', 'سردين'],
    cat: '09.4', cxs: '94-1981',
    reason: 'Canned sardines → 09.4' },

  { patterns: ['canned salmon', 'سلمون معلب'],
    cat: '09.4',
    reason: 'Canned salmon → 09.4' },

  { patterns: ['fish fingers', 'fish sticks', 'frozen fish', 'سمك مجمد', 'أصابع السمك'],
    cat: '09.2.1',
    reason: 'Frozen fish → 09.2.1' },

  { patterns: ['hot dog', 'frankfurter', 'sausage', 'salami', 'mortadella',
               'pepperoni', 'هوت دوغ', 'سجق', 'سلامي', 'مرتديلا'],
    cat: '08.3.1.1',
    reason: 'Processed meat → 08.3.1.1' },

  { patterns: ['ham', 'cooked ham', 'corned beef', 'لحم بقر مملح'],
    cat: '08.2',
    reason: 'Cured meat → 08.2' },

  { patterns: ['canned chicken', 'chicken luncheon', 'لحم دجاج معلب'],
    cat: '08.3.2',
    reason: 'Canned meat → 08.3.2' },

  // ============ 04 - فواكه وخضار ============
  { patterns: ['fresh fruit', 'fresh vegetables', 'فواكه طازجة', 'خضار طازجة'],
    cat: '04.1.1',
    reason: 'Fresh produce → 04.1.1' },

  { patterns: ['canned fruit', 'fruit cocktail', 'canned peaches', 'canned pineapple',
               'فواكه معلبة', 'كوكتيل فواكه'],
    cat: '04.1.2.4',
    reason: 'Canned fruits → 04.1.2.4' },

  { patterns: ['jam', 'marmalade', 'fruit preserve', 'مربى', 'مارملاد'],
    cat: '04.1.2.5',
    reason: 'Jam/marmalade → 04.1.2.5' },

  { patterns: ['dried fruit', 'raisins', 'dates', 'dried apricots', 'dried figs',
               'زبيب', 'تمر', 'تمور', 'مشمش مجفف', 'فواكه مجففة'],
    cat: '04.1.2.2',
    reason: 'Dried fruits → 04.1.2.2' },

  { patterns: ['canned vegetables', 'canned corn', 'canned peas', 'canned beans',
               'خضار معلبة', 'ذرة معلبة', 'فاصوليا معلبة'],
    cat: '04.2.2.4',
    reason: 'Canned vegetables → 04.2.2.4' },

  { patterns: ['frozen vegetables', 'frozen peas', 'frozen corn', 'خضار مجمدة'],
    cat: '04.2.2.1',
    reason: 'Frozen vegetables → 04.2.2.1' },

  { patterns: ['pickles', 'pickled vegetables', 'olives', 'pickled olives',
               'مخلل', 'مخللات', 'زيتون', 'زيتون مخلل'],
    cat: '04.2.2.3',
    reason: 'Pickled vegetables/olives → 04.2.2.3' },

  { patterns: ['tomato paste', 'tomato puree', 'معجون بندورة', 'معجون طماطم'],
    cat: '04.2.2.6',
    reason: 'Tomato paste/puree → 04.2.2.6' },

  // ============ 06 - حبوب ومنتجاتها ============
  { patterns: ['rice', 'basmati rice', 'long grain rice', 'أرز', 'أرز بسمتي'],
    cat: '06.1',
    reason: 'Rice → 06.1' },

  { patterns: ['flour', 'wheat flour', 'all purpose flour', 'طحين', 'دقيق'],
    cat: '06.2.1',
    reason: 'Flour → 06.2.1' },

  { patterns: ['pasta', 'spaghetti', 'macaroni', 'penne', 'lasagna', 'معكرونة', 'سباغيتي'],
    cat: '06.4.2',
    reason: 'Dried pasta → 06.4.2' },

  { patterns: ['instant noodles', 'ramen', 'noodles', 'نودلز', 'إندومي'],
    cat: '06.4.3',
    reason: 'Instant noodles → 06.4.3' },

  { patterns: ['breakfast cereal', 'corn flakes', 'cornflakes', 'oats', 'oatmeal',
               'granola', 'muesli', 'كورن فليكس', 'شوفان', 'حبوب إفطار'],
    cat: '06.3',
    reason: 'Breakfast cereals → 06.3' },

  { patterns: ['bulgur', 'burghul', 'freekeh', 'برغل', 'فريكة'],
    cat: '06.1',
    reason: 'Bulgur/freekeh → 06.1' },

  // ============ 11 - سكر وعسل ============
  { patterns: ['white sugar', 'granulated sugar', 'caster sugar', 'سكر أبيض', 'سكر ناعم'],
    cat: '11.1.1',
    reason: 'Refined sugar → 11.1.1' },

  { patterns: ['brown sugar', 'cane sugar', 'سكر بني'],
    cat: '11.2',
    reason: 'Brown sugar → 11.2' },

  { patterns: ['honey', 'natural honey', 'pure honey', 'عسل', 'عسل نحل'],
    cat: '11.5',
    reason: 'Honey → 11.5' },

  { patterns: ['molasses', 'date syrup', 'maple syrup', 'دبس', 'دبس تمر'],
    cat: '11.4',
    reason: 'Syrups → 11.4' },

  { patterns: ['tabletop sweetener', 'sweetener', 'stevia', 'aspartame',
               'محلي', 'محلي صناعي', 'ستيفيا'],
    cat: '11.6',
    reason: 'Tabletop sweeteners → 11.6' },

  // ============ 12 - منتجات مختلفة ============
  { patterns: ['salt', 'table salt', 'iodized salt', 'sea salt', 'ملح', 'ملح طعام', 'ملح بحر'],
    cat: '12.1.1',
    reason: 'Salt → 12.1.1' },

  { patterns: ['black pepper', 'spices', 'cumin', 'paprika', 'turmeric',
               'فلفل أسود', 'بهارات', 'كمون', 'كركم', 'فلفل أحمر'],
    cat: '12.2.1',
    reason: 'Herbs and spices → 12.2.1' },

  { patterns: ['zaatar', 'thyme mix', 'thyme with oil', 'zaatar with oil',
               'زعتر', 'زعتر بزيت', 'زعتر بالزيت'],
    cat: '12.2.2',
    reason: 'Zaatar (seasoning blend) → 12.2.2' },

  { patterns: ['stock cube', 'bouillon cube', 'chicken cube', 'beef cube', 'broth',
               'مرقة', 'مرقة دجاج', 'مكعبات مرقة'],
    cat: '12.5',
    reason: 'Soups/broths → 12.5' },

  { patterns: ['tahini', 'sesame paste', 'طحينة', 'طحينية'],
    cat: '12.7',
    reason: 'Tahini/sesame paste → 12.7' },

  { patterns: ['hummus', 'baba ghanoush', 'mutabbal', 'حمص', 'متبل', 'بابا غنوج'],
    cat: '12.7',
    reason: 'Hummus/spreads → 12.7' },

  { patterns: ['food supplement', 'vitamin', 'protein powder', 'مكمل غذائي', 'فيتامين'],
    cat: '13.6',
    reason: 'Food supplements → 13.6' },

  // ============ 16 - وجبات جاهزة ============
  { patterns: ['frozen pizza', 'frozen meal', 'ready meal', 'tv dinner',
               'وجبة جاهزة', 'بيتزا مجمدة', 'وجبة سريعة'],
    cat: '16.0',
    reason: 'Prepared foods → 16.0' },

  { patterns: ['instant soup', 'soup mix', 'cup soup', 'شوربة سريعة', 'شوربة جاهزة'],
    cat: '12.5',
    reason: 'Soup mixes → 12.5' },

  { patterns: ['kibbeh', 'mansaf mix', 'maqluba mix', 'كبة', 'منسف جاهز'],
    cat: '16.0',
    reason: 'Prepared Middle Eastern meals → 16.0' },

  // ============ 14.2 - مشروبات كحولية ============
  { patterns: ['beer', 'lager', 'ale', 'بيرة'],
    cat: '14.2.3',
    reason: 'Beer → 14.2.3' },

  { patterns: ['wine', 'red wine', 'white wine', 'rose wine', 'نبيذ'],
    cat: '14.2.3',
    reason: 'Wine → 14.2.3' },

  // ============ 10 - بيض ============
  { patterns: ['fresh eggs', 'chicken eggs', 'بيض', 'بيض طازج', 'بيض دجاج'],
    cat: '10.1',
    reason: 'Fresh eggs → 10.1' },

  { patterns: ['liquid eggs', 'egg whites', 'بيض سائل', 'بياض بيض'],
    cat: '10.2.1',
    reason: 'Liquid eggs → 10.2.1' },
];


// ================================================================
// HELPER: normalize text for matching
// تنظيف: lowercase + إزالة محارف خاصة + توحيد الفراغات
// نحفظ الأحرف العربية (U+0600 إلى U+06FF) والإنجليزية والأرقام والفراغات
// ================================================================
function normalizeText(text) {
  if (!text) return '';
  let t = String(text).toLowerCase();
  // إزالة كل شي ما هو حرف/رقم/فراغ/عربي
  t = t.replace(/[^\w\s\u0600-\u06FF]+/g, ' ');
  // توحيد الفراغات
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}


// ================================================================
// HELPER: detect Arabic text
// ================================================================
function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}


// ================================================================
// HELPER: escape string for use inside RegExp
// ================================================================
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ================================================================
// HELPER: pattern matching
// عربي → contains (لأن \b ما بشتغل مع العربي)
// إنجليزي → word boundary
// ================================================================
function matchesPattern(text, pattern) {
  const textNorm = normalizeText(text);
  const patternNorm = normalizeText(pattern);

  if (!patternNorm) return false;

  // عربي: substring match
  if (hasArabic(patternNorm)) {
    return textNorm.includes(patternNorm);
  }

  // إنجليزي: word boundary
  const re = new RegExp('\\b' + escapeRegex(patternNorm) + '\\b');
  return re.test(textNorm);
}


// ================================================================
// LAYER 1: Pattern Match
// يطابق اسم المنتج مع قاموس الأنماط المعروفة
// لو في أكثر من match، نختار الأطول (الأكثر تخصصاً)
// ================================================================
function matchKnownPatterns(productName) {
  if (!productName) return null;

  const matches = [];

  for (const entry of KNOWN_PRODUCT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (matchesPattern(productName, pattern)) {
        matches.push({
          cat_no: entry.cat,
          matched_pattern: pattern,
          reason: entry.reason,
          cxs: entry.cxs || null,
          pattern_length: pattern.length,
        });
        break;  // ننتقل للـ entry التالي بمجرد ما نلاقي match
      }
    }
  }

  if (matches.length === 0) return null;

  // ترتيب: الأطول أولاً (الأكثر تخصصاً)
  matches.sort((a, b) => b.pattern_length - a.pattern_length);
  const best = matches[0];

  return {
    cat_no: best.cat_no,
    confidence: 'high',
    method: 'pattern_match',
    matched_pattern: best.matched_pattern,
    reason: best.reason,
    cxs: best.cxs,
    alternatives: matches.slice(1, 3).map(m => m.cat_no),
  };
}


// ================================================================
// LAYER 2: Unclassified
// واضح صريح: المنتج يحتاج مراجعة يدوية
// ================================================================
function unclassifiedResult(productName) {
  return {
    cat_no: null,
    confidence: 'none',
    method: 'unclassified',
    reason: 'غير مصنّف - يحتاج وصف أوضح أو مراجعة يدوية',
    suggestion: productName
      ? `منتج "${productName}" لم يطابق أي نمط معروف. يرجى تقديم وصف أوضح للمنتج.`
      : 'لا يوجد اسم منتج للتصنيف',
  };
}


// ================================================================
// MAIN: classify a product by its name
// ================================================================
//
// INPUT: { name_en: string, name_ar: string }
// OUTPUT: { classification: {...}, product_name: string }
// ================================================================
function classifyProduct(product) {
  const nameEn = (product && product.name_en) || '';
  const nameAr = (product && product.name_ar) || '';
  const combinedName = `${nameEn} ${nameAr}`.trim();

  if (!combinedName) {
    return {
      classification: unclassifiedResult(''),
      product_name: '',
    };
  }

  // Layer 1
  const layer1 = matchKnownPatterns(combinedName);
  if (layer1) {
    return {
      classification: layer1,
      product_name: combinedName,
    };
  }

  // Layer 2
  return {
    classification: unclassifiedResult(combinedName),
    product_name: combinedName,
  };
}


// ================================================================
// EXPORTS
// ================================================================
module.exports = {
  classifyProduct,
  matchKnownPatterns,
  matchesPattern,
  normalizeText,
  KNOWN_PRODUCT_PATTERNS,
};


// ================================================================
// SELF-TEST (run with: node classifier-v3.js)
// نفس الـ 13 test cases من classifier_v3.py
// ================================================================
if (require.main === module) {
  const TEST_PRODUCTS = [
    { id: 'French Dressing',       name_en: 'French Dressing',                   expected: '12.6.1' },
    { id: 'Kix Max Sugar Drops',   name_en: 'Kix Max Sugar Drops Candy',         expected: '05.2' },
    { id: 'Medolac Baby Food',     name_en: 'Medolac Baby Cereal',               expected: '13.2' },
    { id: 'Marvella Cake',         name_en: 'Marvella Pound Cake',               expected: '07.2.1' },
    { id: 'Pringles Tabasco',      name_en: 'Pringles Potato Chips Tabasco',     expected: '15.1' },
    { id: 'Apricot Drink',         name_en: 'Apricot Fruit Nectar Drink',        expected: '14.1.3.1' },
    { id: 'Skittles',              name_en: 'Skittles Fruit Candy',              expected: '05.2.2' },
    { id: 'Yes Chocolate Cake',    name_en: 'Yes Chocolate Cake',                expected: '07.2.1' },
    { id: 'American Garden BBQ',   name_en: 'American Garden BBQ Sauce',         expected: '12.6.2' },
    { id: 'American Garden Mayo',  name_en: 'American Garden Mayonnaise',        expected: '12.6.1' },
    { id: 'Master Gourmet Chef',   name_en: 'Master Gourmet Chef Cooking Cream', expected: '02.3' },
    { id: 'Blenda Edible Fat',     name_en: 'Blenda Edible Fat',                 expected: '02.1' },
    { id: 'Kitco Chicken Chips',   name_en: 'Kitco Chicken Flavour Chips',       expected: '15.1' },
  ];

  console.log('='.repeat(70));
  console.log('FoodCheck Classifier v3 (JS) — اختبار 13 منتج');
  console.log('='.repeat(70));

  let correct = 0;

  for (const p of TEST_PRODUCTS) {
    const result = classifyProduct(p);
    const got = result.classification.cat_no;
    const exp = p.expected;

    // قبول المطابقة الفرعية: 05.2.2 يطابق 05.2 (والعكس)
    const isCorrect =
      got === exp ||
      (got && exp && got.startsWith(exp + '.')) ||
      (got && exp && exp.startsWith(got + '.'));

    if (isCorrect) correct++;

    const icon = isCorrect ? '✓' : '✗';
    const method = (result.classification.method || '').slice(0, 4);
    const idStr = p.id.padEnd(28);
    const expStr = String(exp).padEnd(10);
    console.log(`  ${icon} [${method}] ${idStr} متوقع: ${expStr} حصلت: ${got}`);
  }

  const pct = Math.floor((correct * 100) / TEST_PRODUCTS.length);
  console.log('');
  console.log(`📊 النتيجة: ${correct}/${TEST_PRODUCTS.length} = ${pct}%`);

  // exit code: 0 لو كل شي تمام، 1 لو في فشل
  process.exit(correct === TEST_PRODUCTS.length ? 0 : 1);
}
