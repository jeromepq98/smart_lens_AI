import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/settingsService.js', () => ({
  getAiKey: vi.fn(async () => 'test-gemini-key'),
  getEffectiveSettings: vi.fn(async () => ({ cost: {} })),
}));

const {
  generateGeminiContent,
  mapGeminiError,
  normalizeGeminiModel,
  thinkingConfigFor,
  toGeminiSchema,
  readCandidate,
  usageFrom,
} = await import('../../services/geminiClient.js');
const { analyzeImage } = await import('../../services/geminiVision.js');
const { answerFollowUp } = await import('../../services/geminiChat.js');
const { generateLearningContent } = await import('../../services/geminiLearning.js');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validScanJson() {
  return {
    main_identification: 'Snake plant',
    category: 'plant',
    scientific_name: 'Dracaena trifasciata',
    confidence: 'high',
    description: 'A hardy indoor plant with tall, sword-like variegated leaves.',
    characteristics: ['Tall upright leaves', 'Yellow leaf margins'],
    common_uses: ['Indoor decoration'],
    interesting_facts: ['Releases oxygen at night'],
    safety: ['Mildly toxic if ingested by pets'],
    alternatives: [{ name: 'Aloe vera', likelihood: 'low', note: 'Leaves are thicker and fleshy.' }],
    recommendations: [
      { kind: 'care', title: 'Water sparingly', body: 'Let the soil dry out between waterings.' },
    ],
    observations: ['Rigid leaves with yellow edges'],
    assumptions: ['Indoor potted plant'],
    follow_up_questions: ['How often should I water it?', 'Is it safe for cats?', 'Does it need direct sun?'],
    uncertainty_notes: '',
  };
}

describe('Gemini error mapping', () => {
  it('maps quota exhaustion, rejected keys, missing models and outages', () => {
    const quota = mapGeminiError({
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details.',
    });
    expect(quota).toMatchObject({ statusCode: 503, code: 'AI_QUOTA_EXHAUSTED' });
    expect(quota.message).toContain('quota');

    const billing = mapGeminiError({
      status: 403,
      message: 'Billing is disabled for this project; credits are required.',
    });
    expect(billing).toMatchObject({ code: 'AI_AUTH_ERROR' });

    const invalidKey = mapGeminiError({ status: 400, message: 'API key not valid. Please pass a valid API key.' });
    expect(invalidKey).toMatchObject({ code: 'AI_AUTH_ERROR' });

    const missingModel = mapGeminiError({ status: 404, message: 'models/gemini-x is not found' });
    expect(missingModel).toMatchObject({ statusCode: 503, code: 'AI_UNAVAILABLE' });
    expect(missingModel.message).toContain('model');

    expect(mapGeminiError({ status: 503 })).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(mapGeminiError({ name: 'TimeoutError' })).toMatchObject({
      statusCode: 504,
      code: 'AI_TIMEOUT',
    });
    expect(mapGeminiError(new TypeError('fetch failed'))).toMatchObject({ code: 'AI_ERROR' });
  });
});

describe('Gemini request helpers', () => {
  it('drops schema keywords Gemini rejects and keeps the supported subset', () => {
    const cleaned = toGeminiSchema({
      type: 'array',
      additionalProperties: false,
      minLength: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 80 },
          kind: { type: 'string', enum: ['a', 'b'] },
        },
      },
    });

    expect(cleaned).toEqual({
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['a', 'b'] },
        },
      },
    });
    expect(JSON.stringify(cleaned)).not.toContain('additionalProperties');
  });

  it('normalizes model IDs and only disables thinking for 2.5 Flash', () => {
    expect(normalizeGeminiModel('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingConfigFor('models/gemini-2.5-flash-lite')).toEqual({
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(thinkingConfigFor('gemini-2.5-pro')).toEqual({});
  });

  it('reads candidate text, usage and safety blocks', () => {
    const payload = {
      candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    };
    expect(readCandidate(payload).text).toBe('hello world');
    expect(usageFrom(payload)).toEqual({ tokensIn: 12, tokensOut: 3 });
    try {
      readCandidate({ promptFeedback: { blockReason: 'SAFETY' } });
      expect.unreachable('a blocked prompt must throw');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, code: 'AI_REFUSED' });
    }
  });
});

describe('Gemini transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to generateContent with the API key header and returns the payload', async () => {
    fetch.mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));

    const payload = await generateGeminiContent({
      model: 'models/gemini-2.5-flash',
      timeoutMs: 5000,
      payload: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    });

    expect(payload.candidates).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');
    expect(JSON.parse(init.body).contents[0].parts[0].text).toBe('hi');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces API errors with mapped codes instead of raw responses', async () => {
    fetch.mockResolvedValue(
      jsonResponse({ error: { code: 429, message: 'Quota exceeded for quota metric', status: 'RESOURCE_EXHAUSTED' } }, 429),
    );

    await expect(
      generateGeminiContent({ model: 'gemini-2.5-flash', timeoutMs: 5000, payload: {} }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'AI_QUOTA_EXHAUSTED' });
  });

  it('analyzes an image with inline data and a Gemini-compatible response schema', async () => {
    fetch.mockResolvedValue(
      jsonResponse({
        candidates: [
          { content: { role: 'model', parts: [{ text: JSON.stringify(validScanJson()) }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 1100, candidatesTokenCount: 320 },
      }),
    );

    const result = await analyzeImage({
      buffer: Buffer.from('fake-image-bytes'),
      mimeType: 'image/jpeg',
      language: 'en',
      settings: {
        ai: {
          visionModel: 'gemini-2.5-flash',
          maxOutputTokens: 1400,
          visionTimeoutMs: 60000,
        },
      },
    });

    expect(result.data.mainIdentification).toBe('Snake plant');
    expect(result.data.followUpQuestions).toHaveLength(3);
    expect(result.usage).toEqual({ tokensIn: 1100, tokensOut: 320 });
    expect(result.model).toBe('gemini-2.5-flash');

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    const parts = body.contents[0].parts;
    expect(parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from('fake-image-bytes').toString('base64'),
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain('additionalProperties');
    expect(body.systemInstruction.parts[0].text).toContain('untrusted content');
  });

  it('reports an AI refusal without retrying', async () => {
    fetch.mockResolvedValue(jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));

    await expect(
      analyzeImage({
        buffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
        language: 'en',
        settings: { ai: { visionModel: 'gemini-2.5-flash', maxOutputTokens: 1000, visionTimeoutMs: 5000 } },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'AI_REFUSED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends follow-up chat as user/model turns with a system instruction', async () => {
    fetch.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Keep it away from cats.' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 },
      }),
    );

    const answer = await answerFollowUp({
      aiResult: {
        mainIdentification: 'Snake plant',
        categorySlug: 'plant',
        scientificName: 'Dracaena trifasciata',
        confidence: 'high',
        description: 'A hardy indoor plant.',
        characteristics: ['Tall leaves'],
        commonUses: [],
        safety: ['Toxic to pets'],
        uncertaintyNotes: '',
      },
      recommendations: [{ title: 'Water sparingly', body: 'Let soil dry.' }],
      history: [
        { role: 'user', content: 'Is it safe for cats?' },
        { role: 'assistant', content: 'It is mildly toxic.' },
        { role: 'user', content: 'What should I do?' },
      ],
      language: 'en',
      settings: { ai: { textModel: 'gemini-2.5-flash', maxOutputTokens: 800, chatTimeoutMs: 30000 } },
    });

    expect(answer.content).toBe('Keep it away from cats.');
    expect(answer.usage).toEqual({ tokensIn: 300, tokensOut: 20 });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toContain('follow-up assistant');
    expect(body.contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[1].parts[0].text).toBe('It is mildly toxic.');
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it('generates learning material from the sanitized JSON schema', async () => {
    const learning = {
      explanation: 'Photosynthesis converts light energy into chemical energy inside chloroplasts.',
      facts: ['Chlorophyll absorbs red and blue light.'],
      activity: 'Place one plant in a dark cupboard for a week and compare its leaves.',
      glossary: [{ term: 'Chlorophyll', definition: 'The green pigment that captures light.' }],
      quiz: [
        {
          question: 'What gas is released during photosynthesis?',
          options: ['Oxygen', 'Nitrogen', 'Methane', 'Helium'],
          answer_index: 0,
          explanation: 'Oxygen is a by-product of splitting water.',
        },
        {
          question: 'Where does photosynthesis happen?',
          options: ['Chloroplasts', 'Mitochondria', 'Nucleus', 'Vacuole'],
          answer_index: 0,
          explanation: 'Chloroplasts contain chlorophyll.',
        },
      ],
    };
    fetch.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(learning) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 400 },
      }),
    );

    const result = await generateLearningContent({
      aiResult: {
        mainIdentification: 'Snake plant',
        categorySlug: 'plant',
        scientificName: 'Dracaena trifasciata',
        confidence: 'high',
        description: 'A hardy indoor plant.',
        characteristics: ['Tall leaves'],
        safety: ['Toxic to pets'],
        uncertaintyNotes: '',
      },
      level: 'beginner',
      language: 'en',
      settings: { ai: { textModel: 'gemini-2.5-flash', maxOutputTokens: 1400, learningTimeoutMs: 30000 } },
    });

    expect(result.content.quiz).toHaveLength(2);
    expect(result.content.quiz[0].answerIndex).toBe(0);
    expect(result.content.glossary[0].term).toBe('Chlorophyll');
    expect(result.usage).toEqual({ tokensIn: 500, tokensOut: 400 });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain('additionalProperties');
  });
});
