-- Refrigerator Door Shelf Bin (PS11752778)
WITH ins AS (
  INSERT INTO parts (
    part_number, name, description, price, in_stock,
    image_url, rating, review_count, category, appliance_type
  ) VALUES (
    'PS11752778',
    'Refrigerator Door Shelf Bin (WPW10321304)',
    'Replaces Whirlpool OEM W10321304 / WPW10321304. Clear plastic refrigerator door shelf/bin; compatible with many Whirlpool/Kenmore/Maytag refrigerators. See PartSelect page for full compatibility list.',
    24.99,
    TRUE,
    'https://partselectcom-gtcdcddbene3cpes.z01.azurefd.net/11752778-1-M-Whirlpool-WPW10321304-Refrigerator-Door-Shelf-Bin.jpg',
    4.2,
    58,
    'Door Bin',
    'refrigerator'
  )
  RETURNING id
)

INSERT INTO part_compatibility (part_id, model_number)
SELECT id, model_number
FROM ins,
     (VALUES
         ('WRS325SDHZ01'),
        ('WRF535SWHZ00'),
        ('WRS588FIHZ04'),
        ('WRT519SZDM03')
     ) AS m(model_number);


-- Washer Drain Pump (PS11757304)
WITH ins AS (
  INSERT INTO parts (
    part_number, name, description, price, in_stock,
    image_url, rating, review_count, category, appliance_type
  ) VALUES (
    'PS11757304',
    'Washing Machine Drain Pump (WPW10730972)',
    'Replacement drain pump for select Whirlpool / Kenmore washers. OEM WPW10730972 (also listed as W10730972/AP6023956). Check the PartSelect page for the full compatibility listing and diagrams.',
    59.99,
    TRUE,
    'https://partselectcom-gtcdcddbene3cpes.z01.azurefd.net/11757304-1-M-Whirlpool-WPW10730972-Washer-Drain-Pump.jpg',
    4.3,
    120,
    'Pump',
    'washer'
  )
  RETURNING id
)

INSERT INTO part_compatibility (part_id, model_number)
SELECT id, model_number
FROM ins,
     (VALUES
        ('WFW5620HW0'),
        ('WFW75HEFW0'),
        ('WFW9150WW01'),
        ('WFW8300SW02')
     ) AS m(model_number);
