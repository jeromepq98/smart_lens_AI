-- SmartLens AI now uses the Google Gemini API instead of OpenAI.
-- Rewrite the stored AI settings (which still hold OpenAI model IDs and an
-- encrypted OpenAI key) and refresh the untouched default cost pricing.

UPDATE system_settings
SET setting_value = JSON_REMOVE(
    JSON_SET(
      setting_value,
      '$.visionModel', 'gemini-2.5-flash',
      '$.textModel', 'gemini-2.5-flash'
    ),
    '$.apiKeyEnc'
  )
WHERE setting_key = 'ai';

UPDATE system_settings
SET setting_value = JSON_SET(
    setting_value,
    '$.disclosure',
    'Images you submit are sent to Google Gemini for analysis and are not made public. Scan history is stored privately and can be deleted at any time. AI identifications are probabilistic and must not be treated as professional, medical, or safety advice.'
  )
WHERE setting_key = 'privacy'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.disclosure')) LIKE '%OpenAI%';

UPDATE system_settings
SET setting_value = JSON_SET(
    setting_value,
    '$.visionInputPer1M', 0.3,
    '$.visionOutputPer1M', 2.5,
    '$.textInputPer1M', 0.3,
    '$.textOutputPer1M', 2.5
  )
WHERE setting_key = 'cost'
  AND JSON_EXTRACT(setting_value, '$.visionInputPer1M') = 2.5
  AND JSON_EXTRACT(setting_value, '$.textInputPer1M') = 0.15;
