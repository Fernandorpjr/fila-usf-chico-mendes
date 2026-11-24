// Motor centralizado e resiliente de OCR via Gemini Vision + failover Groq Vision (circuit breaker, backoff e cache)
const crypto = require('crypto');

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite'
];

const DEFAULT_GROQ_VISION_MODELS = [
  'qwen/qwen3.8-27b'
];

const MODEL_COOLDOWN_MS = 90 * 1000; // 90s em caso de 503/429/timeout
const MODEL_NOT_FOUND_COOLDOWN_MS = 10 * 60 * 1000; // 10 min para 404
const OCR_CACHE_TTL_MS = 5 * 60 * 1000;
const OCR_CACHE_MAX_ITEMS = 30;
const OCR_TOTAL_BUDGET_MS = 38000;
const OCR_ATTEMPT_TIMEOUT_MS = 10000;
const OCR_GEMINI_FAST_TIMEOUT_MS = 7500;
const OCR_GROQ_ATTEMPT_TIMEOUT_MS = 15000;
const GROQ_RESERVE_BUDGET_MS = 16000;
const GEMINI_MAX_PHASE_WITH_GROQ_MS = 16000;

const _modelCooldownUntil = new Map();
const _ocrCache = new Map();

function buildGeminiModelList(envModel = process.env.GEMINI_MODEL) {
  return [...new Set([
    envModel ? String(envModel).trim() : '',
    ...DEFAULT_GEMINI_MODELS
  ].filter(Boolean))];
}

function buildGroqModelList(envModel = process.env.GROQ_VISION_MODEL) {
  return [...new Set([
    envModel ? String(envModel).trim() : '',
    ...DEFAULT_GROQ_VISION_MODELS
  ].filter(Boolean))];
}

function buildGenerationConfig(model, maxOutputTokens = 1800, includeThinking = true) {
  const cfg = {
    temperature: 0.1,
    maxOutputTokens,
    responseMimeType: 'application/json'
  };
  if (includeThinking) {
    if (/gemini-2\.5/i.test(model)) {
      cfg.thinkingConfig = { thinkingBudget: 0 };
    } else if (/gemini-(3|flash-lite-latest|flash-latest)/i.test(model)) {
      cfg.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    }
  }
  return cfg;
}

function ordenarModelosPorSaude(models, nowMs = Date.now(), keyPrefix = '') {
  const saudaveis = [];
  const emCooldown = [];
  for (const m of models || []) {
    const key = keyPrefix ? `${keyPrefix}${m}` : m;
    const until = _modelCooldownUntil.get(key) || 0;
    if (until > nowMs) {
      emCooldown.push({ model: m, until });
    } else {
      if (until) _modelCooldownUntil.delete(key);
      saudaveis.push(m);
    }
  }
  emCooldown.sort((a, b) => a.until - b.until);
  return [...saudaveis, ...emCooldown.map(x => x.model)];
}

function marcarModeloEmCooldown(model, status, nowMs = Date.now()) {
  if (!model) return;
  const duracao = status === 404 ? MODEL_NOT_FOUND_COOLDOWN_MS : MODEL_COOLDOWN_MS;
  _modelCooldownUntil.set(model, nowMs + duracao);
}

function limparCooldownModelo(model) {
  if (model) _modelCooldownUntil.delete(model);
}

function resetarEstadoOcrTeste() {
  _modelCooldownUntil.clear();
  _ocrCache.clear();
}

function formatarErroOcrAmigavel(rawMsg, status = 0) {
  const s = String(rawMsg || '').toLowerCase();
  if (status === 401 || status === 403 || s.includes('api key') || s.includes('permission')) {
    return 'Chave de IA inválida ou sem permissão no servidor.';
  }
  if (
    status === 503 ||
    s.includes('high demand') ||
    s.includes('overloaded') ||
    s.includes('unavailable')
  ) {
    return 'Servidor de IA temporariamente congestionado (alta demanda no Google). A foto foi mantida — clique em "Tentar ler novamente" em alguns segundos.';
  }
  if (status === 429 || s.includes('quota') || s.includes('rate limit') || s.includes('resource exhausted')) {
    return 'Limite momentâneo da chave gratuita de IA atingido. Aguarde alguns segundos e clique em "Tentar ler novamente".';
  }
  if (s.includes('timeout') || s.includes('aborted') || s.includes('abort')) {
    return 'A leitura demorou mais que o esperado. A foto foi mantida — clique em "Tentar ler novamente".';
  }
  return 'Não foi possível concluir a leitura automática agora. A foto foi mantida — você pode tentar novamente ou preencher manualmente.';
}

function gerarChaveCacheOcr(cacheNamespace, mimeType, base64Data) {
  const digest = crypto
    .createHash('sha256')
    .update(`${cacheNamespace || 'default'}|${mimeType || ''}|${base64Data || ''}`)
    .digest('hex');
  return digest;
}

function lerCacheOcr(key, nowMs = Date.now()) {
  const entry = _ocrCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    _ocrCache.delete(key);
    return null;
  }
  return entry;
}

function gravarCacheOcr(key, value, nowMs = Date.now()) {
  if (_ocrCache.size >= OCR_CACHE_MAX_ITEMS) {
    const oldestKey = _ocrCache.keys().next().value;
    if (oldestKey) _ocrCache.delete(oldestKey);
  }
  _ocrCache.set(key, {
    ...value,
    expiresAt: nowMs + OCR_CACHE_TTL_MS
  });
}

function extrairJsonDeTexto(rawText) {
  const cleaned = String(rawText || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
}

function extrairJsonDeRespostaGemini(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const rawText = parts
    .filter(p => p && !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim() || parts[0]?.text || '';
  return extrairJsonDeTexto(rawText);
}

function extrairJsonDeRespostaGroq(payload) {
  const rawText = payload?.choices?.[0]?.message?.content || '';
  return extrairJsonDeTexto(rawText);
}

function esperarMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function chamarGeminiUnicaTentativa({
  apiKey,
  model,
  prompt,
  mimeType,
  base64Data,
  maxOutputTokens,
  includeThinking,
  timeoutMs,
  fetchImpl
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = buildGenerationConfig(model, maxOutputTokens, includeThinking);
  const apiRes = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }],
      generationConfig
    })
  });

  if (!apiRes.ok) {
    const errJson = await apiRes.json().catch(() => ({}));
    const msg = errJson?.error?.message || `Erro Gemini HTTP ${apiRes.status}`;
    return { ok: false, status: apiRes.status, rawError: msg };
  }

  const payload = await apiRes.json();
  const parsed = extrairJsonDeRespostaGemini(payload);
  return { ok: true, status: 200, parsed };
}

async function chamarGroqUnicaTentativa({
  apiKey,
  model,
  prompt,
  mimeType,
  base64Data,
  maxOutputTokens,
  includeJsonMode = true,
  timeoutMs,
  fetchImpl
}) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const apiRes = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: maxOutputTokens,
      ...(includeJsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        {
          role: 'system',
          content: 'Você é um revisor clínico rigoroso do SUS (Recife/PE). Responda exclusivamente com JSON válido. Sempre que o esquema pedir observacoes_revisada, corrija ortografia, acentuação, pontuação e erros óbvios de digitação (ex.: SUBMISO -> SUBMUCOSO) sem inventar dados clínicos, registre cada correção ou dúvida em alertas_digitacao e marque trechos ilegíveis com [CONFERIR: ...].'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `${prompt}\n\nResponda exclusivamente com um objeto JSON válido.` },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
          ]
        }
      ]
    })
  });

  if (!apiRes.ok) {
    const errJson = await apiRes.json().catch(() => ({}));
    const msg = errJson?.error?.message || `Erro Groq HTTP ${apiRes.status}`;
    return { ok: false, status: apiRes.status, rawError: msg };
  }

  const payload = await apiRes.json();
  const parsed = extrairJsonDeRespostaGroq(payload);
  return { ok: true, status: 200, parsed };
}

async function executarOcrGeminiJson({
  apiKey,
  groqApiKey = (process.env.GROQ_API_KEY || '').trim(),
  prompt,
  mimeType,
  base64Data,
  maxOutputTokens = 1800,
  cacheNamespace = 'ocr',
  fetchImpl = globalThis.fetch,
  budgetMs = OCR_TOTAL_BUDGET_MS,
  backoffBaseMs = 1200,
  jitterMaxMs = 500
}) {
  const cacheKey = gerarChaveCacheOcr(cacheNamespace, mimeType, base64Data);
  const cached = lerCacheOcr(cacheKey);
  if (cached) {
    return {
      ok: true,
      model: cached.model,
      provider: cached.provider || 'gemini',
      parsed: cached.parsed,
      fromCache: true
    };
  }

  const isImage = String(mimeType || '').toLowerCase().startsWith('image/');
  const groqKeyTrimmed = groqApiKey ? String(groqApiKey).trim() : '';
  const geminiKeyTrimmed = apiKey ? String(apiKey).trim() : '';
  const podeUsarGroq = Boolean(groqKeyTrimmed && isImage);

  const startedAt = Date.now();
  const models = ordenarModelosPorSaude(buildGeminiModelList());
  const deadline = startedAt + budgetMs;
  const geminiPhaseDeadline = podeUsarGroq
    ? Math.min(Math.max(startedAt + 2500, deadline - GROQ_RESERVE_BUDGET_MS), startedAt + GEMINI_MAX_PHASE_WITH_GROQ_MS)
    : deadline;
  const transitorios = [];
  let lastStatus = 0;
  let lastRawError = 'Não foi possível ler o documento automaticamente.';
  let geminiFatalAuth = false;

  const tentarModelo = async (model, reservarGroq = false) => {
    const restanteMs = reservarGroq ? (geminiPhaseDeadline - Date.now()) : (deadline - Date.now());
    const minNecessario = reservarGroq ? 2000 : 1500;
    if (restanteMs < minNecessario) {
      return { abortBudget: true };
    }
    const maxTentativa = reservarGroq ? OCR_GEMINI_FAST_TIMEOUT_MS : OCR_ATTEMPT_TIMEOUT_MS;
    const timeoutMs = Math.min(maxTentativa, restanteMs);
    try {
      let resp = await chamarGeminiUnicaTentativa({
        apiKey: geminiKeyTrimmed,
        model,
        prompt,
        mimeType,
        base64Data,
        maxOutputTokens,
        includeThinking: true,
        timeoutMs,
        fetchImpl
      });

      if (!resp.ok && resp.status === 400 && /thinking/i.test(resp.rawError || '')) {
        const restAfter400 = (reservarGroq ? geminiPhaseDeadline : deadline) - Date.now();
        if (restAfter400 >= 1500) {
          resp = await chamarGeminiUnicaTentativa({
            apiKey: geminiKeyTrimmed,
            model,
            prompt,
            mimeType,
            base64Data,
            maxOutputTokens,
            includeThinking: false,
            timeoutMs: Math.min(maxTentativa, restAfter400),
            fetchImpl
          });
        }
      }

      if (resp.ok) {
        limparCooldownModelo(model);
        gravarCacheOcr(cacheKey, { model, provider: 'gemini', parsed: resp.parsed });
        console.info(`[ocr-ai] [${cacheNamespace}] OK provider=gemini model=${model} (${Date.now() - startedAt}ms)`);
        return { success: true, model, provider: 'gemini', parsed: resp.parsed };
      }

      lastStatus = resp.status || 0;
      lastRawError = resp.rawError || lastRawError;
      console.warn(`[ocr-ai] [${cacheNamespace}] ${model} HTTP ${lastStatus}: ${lastRawError}`);

      if (lastStatus === 401 || lastStatus === 403) {
        return { fatalAuth: true };
      }
      if (lastStatus === 503 || lastStatus === 429 || lastStatus === 404 || lastStatus >= 500) {
        marcarModeloEmCooldown(model, lastStatus);
      }
      if (lastStatus === 503 || lastStatus === 429 || lastStatus >= 500) {
        transitorios.push(model);
      }
      return { retryNext: true };
    } catch (err) {
      lastStatus = 0;
      lastRawError = err?.message || lastRawError;
      console.warn(`[ocr-ai] [${cacheNamespace}] ${model} erro: ${lastRawError}`);
      marcarModeloEmCooldown(model, 503);
      transitorios.push(model);
      return { retryNext: true };
    }
  };

  if (geminiKeyTrimmed) {
    for (const model of models) {
      const r = await tentarModelo(model, podeUsarGroq);
      if (r.success) {
        return { ok: true, model: r.model, provider: 'gemini', parsed: r.parsed, fromCache: false };
      }
      if (r.fatalAuth) {
        geminiFatalAuth = true;
        break;
      }
      if (r.abortBudget) break;
    }
  }

  // Fase 2: Failover automatico para Groq Vision (somente imagens)
  if (podeUsarGroq) {
    const groqModels = ordenarModelosPorSaude(buildGroqModelList(), Date.now(), 'groq:');
    for (const model of groqModels) {
      const restanteMs = deadline - Date.now();
      if (restanteMs < 1500) break;
      const timeoutMs = Math.min(OCR_GROQ_ATTEMPT_TIMEOUT_MS, restanteMs);
      const cooldownKey = `groq:${model}`;
      try {
        let resp = await chamarGroqUnicaTentativa({
          apiKey: groqKeyTrimmed,
          model,
          prompt,
          mimeType,
          base64Data,
          maxOutputTokens,
          includeJsonMode: true,
          timeoutMs,
          fetchImpl
        });

        if (!resp.ok && resp.status === 400 && /response_format|json/i.test(resp.rawError || '')) {
          const restAfter400 = deadline - Date.now();
          if (restAfter400 >= 1500) {
            resp = await chamarGroqUnicaTentativa({
              apiKey: groqKeyTrimmed,
              model,
              prompt,
              mimeType,
              base64Data,
              maxOutputTokens,
              includeJsonMode: false,
              timeoutMs: Math.min(OCR_GROQ_ATTEMPT_TIMEOUT_MS, restAfter400),
              fetchImpl
            });
          }
        }

        if (resp.ok) {
          limparCooldownModelo(cooldownKey);
          const groqModelId = `groq/${model}`;
          gravarCacheOcr(cacheKey, { model: groqModelId, provider: 'groq', parsed: resp.parsed });
          console.info(`[ocr-ai] [${cacheNamespace}] OK provider=groq model=${groqModelId} (${Date.now() - startedAt}ms)`);
          return { ok: true, model: groqModelId, provider: 'groq', parsed: resp.parsed, fromCache: false };
        }

        lastStatus = resp.status || 0;
        lastRawError = resp.rawError || lastRawError;
        console.warn(`[ocr-ai] [${cacheNamespace}] groq/${model} HTTP ${lastStatus}: ${lastRawError}`);

        if (lastStatus === 401 || lastStatus === 403) {
          break;
        }
        if (lastStatus === 503 || lastStatus === 429 || lastStatus === 404 || lastStatus >= 500) {
          marcarModeloEmCooldown(cooldownKey, lastStatus);
        }
      } catch (err) {
        lastStatus = 0;
        lastRawError = err?.message || lastRawError;
        console.warn(`[ocr-ai] [${cacheNamespace}] groq/${model} erro: ${lastRawError}`);
        marcarModeloEmCooldown(cooldownKey, 503);
      }
    }
  }

  // Fase 3: Segunda rodada curta do Gemini com backoff + jitter se houve apenas congestionamento transitorio
  if (geminiKeyTrimmed && !geminiFatalAuth && transitorios.length > 0 && lastStatus !== 401 && lastStatus !== 403) {
    const restanteParaRetry = deadline - Date.now();
    if (restanteParaRetry >= 6000) {
      const espera = backoffBaseMs + (jitterMaxMs > 0 ? Math.floor(Math.random() * jitterMaxMs) : 0);
      if (espera > 0) await esperarMs(espera);
      const candidatosRetry = [...new Set(transitorios)].slice(0, 2);
      for (const model of candidatosRetry) {
        const r = await tentarModelo(model, false);
        if (r.success) {
          return { ok: true, model: r.model, provider: 'gemini', parsed: r.parsed, fromCache: false };
        }
        if (r.fatalAuth || r.abortBudget) break;
      }
    }
  }

  return {
    ok: false,
    error: formatarErroOcrAmigavel(lastRawError, lastStatus),
    rawError: lastRawError,
    lastStatus
  };
}

module.exports = {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GROQ_VISION_MODELS,
  MODEL_COOLDOWN_MS,
  OCR_CACHE_TTL_MS,
  OCR_TOTAL_BUDGET_MS,
  buildGeminiModelList,
  buildGroqModelList,
  buildGenerationConfig,
  ordenarModelosPorSaude,
  marcarModeloEmCooldown,
  limparCooldownModelo,
  resetarEstadoOcrTeste,
  formatarErroOcrAmigavel,
  executarOcrGeminiJson
};
