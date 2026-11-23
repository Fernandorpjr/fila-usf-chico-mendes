// Motor centralizado e resiliente de OCR via Gemini Vision (multi-geracao, circuit breaker, backoff e cache)
const crypto = require('crypto');

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash'
];

const MODEL_COOLDOWN_MS = 90 * 1000; // 90s em caso de 503/429/timeout
const MODEL_NOT_FOUND_COOLDOWN_MS = 10 * 60 * 1000; // 10 min para 404
const OCR_CACHE_TTL_MS = 5 * 60 * 1000;
const OCR_CACHE_MAX_ITEMS = 30;
const OCR_TOTAL_BUDGET_MS = 25000;
const OCR_ATTEMPT_TIMEOUT_MS = 10000;

const _modelCooldownUntil = new Map();
const _ocrCache = new Map();

function buildGeminiModelList(envModel = process.env.GEMINI_MODEL) {
  return [...new Set([
    envModel ? String(envModel).trim() : '',
    ...DEFAULT_GEMINI_MODELS
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

function ordenarModelosPorSaude(models, nowMs = Date.now()) {
  const saudaveis = [];
  const emCooldown = [];
  for (const m of models || []) {
    const until = _modelCooldownUntil.get(m) || 0;
    if (until > nowMs) {
      emCooldown.push({ model: m, until });
    } else {
      if (until) _modelCooldownUntil.delete(m);
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

function extrairJsonDeRespostaGemini(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const rawText = parts
    .filter(p => p && !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
    .trim() || parts[0]?.text || '';
  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
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

async function executarOcrGeminiJson({
  apiKey,
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
      parsed: cached.parsed,
      fromCache: true
    };
  }

  const models = ordenarModelosPorSaude(buildGeminiModelList());
  const deadline = Date.now() + budgetMs;
  const transitorios = [];
  let lastStatus = 0;
  let lastRawError = 'Não foi possível ler o documento automaticamente.';

  const tentarModelo = async (model) => {
    const restanteMs = deadline - Date.now();
    if (restanteMs < 1500) {
      return { abortBudget: true };
    }
    const timeoutMs = Math.min(OCR_ATTEMPT_TIMEOUT_MS, restanteMs);
    try {
      let resp = await chamarGeminiUnicaTentativa({
        apiKey,
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
        const restAfter400 = deadline - Date.now();
        if (restAfter400 >= 1500) {
          resp = await chamarGeminiUnicaTentativa({
            apiKey,
            model,
            prompt,
            mimeType,
            base64Data,
            maxOutputTokens,
            includeThinking: false,
            timeoutMs: Math.min(OCR_ATTEMPT_TIMEOUT_MS, restAfter400),
            fetchImpl
          });
        }
      }

      if (resp.ok) {
        limparCooldownModelo(model);
        gravarCacheOcr(cacheKey, { model, parsed: resp.parsed });
        return { success: true, model, parsed: resp.parsed };
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

  for (const model of models) {
    const r = await tentarModelo(model);
    if (r.success) {
      return { ok: true, model: r.model, parsed: r.parsed, fromCache: false };
    }
    if (r.fatalAuth || r.abortBudget) break;
  }

  // Segunda rodada curta com backoff + jitter se houve apenas congestionamento transitorio
  if (transitorios.length > 0 && lastStatus !== 401 && lastStatus !== 403) {
    const restanteParaRetry = deadline - Date.now();
    if (restanteParaRetry >= 6000) {
      const espera = backoffBaseMs + (jitterMaxMs > 0 ? Math.floor(Math.random() * jitterMaxMs) : 0);
      if (espera > 0) await esperarMs(espera);
      const candidatosRetry = [...new Set(transitorios)].slice(0, 2);
      for (const model of candidatosRetry) {
        const r = await tentarModelo(model);
        if (r.success) {
          return { ok: true, model: r.model, parsed: r.parsed, fromCache: false };
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
  MODEL_COOLDOWN_MS,
  OCR_CACHE_TTL_MS,
  OCR_TOTAL_BUDGET_MS,
  buildGeminiModelList,
  buildGenerationConfig,
  ordenarModelosPorSaude,
  marcarModeloEmCooldown,
  limparCooldownModelo,
  resetarEstadoOcrTeste,
  formatarErroOcrAmigavel,
  executarOcrGeminiJson
};
