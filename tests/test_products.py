"""
ملف اختبار v3 - 13 منتج من السوق الأردني الفعلي
"""

TEST_PRODUCTS = [
    {'id': 'French Dressing',          'name_en': 'French Dressing',                'expected': '12.6.1'},
    {'id': 'Kix Max Sugar Drops',      'name_en': 'Kix Max Sugar Drops Candy',      'expected': '05.2'},
    {'id': 'Medolac Baby Food',        'name_en': 'Medolac Baby Cereal',            'expected': '13.2'},
    {'id': 'Marvella Cake',            'name_en': 'Marvella Pound Cake',            'expected': '07.2.1'},
    {'id': 'Pringles Tabasco',         'name_en': 'Pringles Potato Chips Tabasco',  'expected': '15.1'},
    {'id': 'Apricot Drink',            'name_en': 'Apricot Fruit Nectar Drink',     'expected': '14.1.3.1'},
    {'id': 'Skittles',                 'name_en': 'Skittles Fruit Candy',           'expected': '05.2.2'},
    {'id': 'Yes Chocolate Cake',       'name_en': 'Yes Chocolate Cake',             'expected': '07.2.1'},
    {'id': 'American Garden BBQ',      'name_en': 'American Garden BBQ Sauce',      'expected': '12.6.2'},
    {'id': 'American Garden Mayo',     'name_en': 'American Garden Mayonnaise',     'expected': '12.6.1'},
    {'id': 'Master Gourmet Chef',      'name_en': 'Master Gourmet Chef Cooking Cream', 'expected': '02.3'},
    {'id': 'Blenda Edible Fat',        'name_en': 'Blenda Edible Fat',              'expected': '02.1'},
    {'id': 'Kitco Chicken Chips',      'name_en': 'Kitco Chicken Flavour Chips',    'expected': '15.1'},
]


if __name__ == '__main__':
    import sys
    sys.path.insert(0, '..')
    from classifier_v3 import classify_product
    
    print("=" * 70)
    print("اختبار v3 - 13 منتج من السوق الأردني")
    print("=" * 70)
    
    correct = 0
    for p in TEST_PRODUCTS:
        result = classify_product(p, db_path='../codex.db')
        got = result['classification']['cat_no']
        exp = p['expected']
        is_correct = (got == exp) or (got and exp and got.startswith(exp + '.')) or (got and exp and exp.startswith(got + '.'))
        if is_correct:
            correct += 1
        icon = '✓' if is_correct else '✗'
        print(f"  {icon} {p['id']:<28} → {got}")
    
    pct = correct * 100 // len(TEST_PRODUCTS)
    print(f"\nالنتيجة: {correct}/{len(TEST_PRODUCTS)} = {pct}%")
