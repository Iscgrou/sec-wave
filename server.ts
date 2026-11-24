/**
 * Payam Sovereign — Full-Stack Server Entry Point (Port 3000)
 * Hosts Vite dev middleware in development, static dist/ in production,
 * and server-side @google/genai endpoints for the 3 online LLM heads (A7, A8, A11).
 * Enforces strict 12-second AbortController timeout and flat responseSchema.
 */

import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { LlmHeadOutputSchema } from './src/core/council/schemas.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const LLM_TIMEOUT_MS = 12_000;
const GEMINI_MODEL = 'gemini-4-hydrogen';

const CouncilRequestSchema = z.object({
  asset: z.enum(['XAUUSD', 'XAGUSD', 'WTI', 'BTCUSD', 'NAS100']),
  regime: z.enum([
    'TRENDING_EXPANSION',
    'LIQUIDITY_REVERSAL',
    'RANGE_COMPRESSION',
    'HIGH_VOL_SHOCK',
  ]),
  side: z.enum(['LONG', 'SHORT']).nullable(),
  entry: z.number().finite(),
  stopLoss: z.number().finite(),
  tp1: z.number().finite(),
  tp2: z.number().finite(),
  rrRatio: z.number().finite(),
  atr: z.number().finite(),
  displacementRatio: z.number().finite(),
});

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({
      ok: true,
      service: 'Payam Sovereign',
      model: GEMINI_MODEL,
      geminiConfigured,
      timeoutMs: LLM_TIMEOUT_MS,
      timestamp: Date.now(),
    });
  });

  app.post('/api/council/llm', async (req, res) => {
    const startedAt = Date.now();
    const parsedReq = CouncilRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      res.status(400).json({
        status: 'DEGRADED',
        reason: 'ورودی درخواست شورای شناختی نامعتبر است.',
        heads: [],
        tokensEstimated: 0,
      });
      return;
    }

    const ai = createGeminiClient();
    if (!ai) {
      res.status(200).json({
        status: 'DEGRADED',
        reason: 'کلید سرور Gemini تنظیم نشده است؛ اجرا با موتور ۱۰۰٪ قطعی (I3 فعال) ادامه یافت.',
        heads: [],
        tokensEstimated: 0,
      });
      return;
    }

    const input = parsedReq.data;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const prompt = [
        `Asset: ${input.asset}`,
        `Regime: ${input.regime}`,
        `Candidate Side: ${input.side ?? 'NONE'}`,
        `Entry: ${input.entry}, SL: ${input.stopLoss}, TP1: ${input.tp1}, TP2: ${input.tp2}`,
        `R:R: ${input.rrRatio}, ATR: ${input.atr}, Displacement: ${input.displacementRatio}x ATR`,
        'Return exactly 3 items for headId A7 (Macro Risk), A8 (Institutional Narrative), and A11 (Devil Advocate Critic).',
        'Invariant I1: You may ONLY allow (1.0), reduce risk (0.25..0.95), tighten SL (0.0..0.30), or VETO. Never increase risk above 1.0.',
        'Write summaryFa in crisp, active-voice Iranian institutional trader Persian (under 110 characters, zero passive verbs).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          abortSignal: controller.signal,
          systemInstruction:
            'You are the 3 online cognitive risk-critique heads (A7, A8, A11) of Payam Sovereign. Output strictly valid JSON matching the flat schema. Never recommend increasing risk.',
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                headId: { type: Type.STRING },
                riskAction: { type: Type.STRING },
                riskMultiplier: { type: Type.NUMBER },
                slTightenFraction: { type: Type.NUMBER },
                macroEventHazard: { type: Type.BOOLEAN },
                structuralInvalidationFlag: { type: Type.BOOLEAN },
                summaryFa: { type: Type.STRING },
              },
              required: [
                'headId',
                'riskAction',
                'riskMultiplier',
                'slTightenFraction',
                'macroEventHazard',
                'structuralInvalidationFlag',
                'summaryFa',
              ],
            },
          },
        },
      });

      const latencyMs = Date.now() - startedAt;
      const rawText = (response.text ?? '[]').trim();
      const rawJson = JSON.parse(rawText) as unknown;

      if (!Array.isArray(rawJson)) {
        res.status(200).json({
          status: 'DEGRADED',
          reason: 'ساختار پاسخ مدل با اسکیمای مسطح منطبق نبود؛ بازگشت ایمن به هسته قطعی.',
          heads: [],
          tokensEstimated: 650,
        });
        return;
      }

      const validHeads = [];
      for (const item of rawJson.slice(0, 3)) {
        const validated = LlmHeadOutputSchema.safeParse({
          ...(typeof item === 'object' && item !== null ? item : {}),
          latencyMs,
        });
        if (validated.success) {
          validHeads.push(validated.data);
        }
      }

      if (validHeads.length === 0) {
        res.status(200).json({
          status: 'DEGRADED',
          reason: 'هیچ خروجی معتبری از دیواره آتش Zod عبور نکرد؛ حالت قطعی فعال شد.',
          heads: [],
          tokensEstimated: 650,
        });
        return;
      }

      res.status(200).json({
        status: 'OK',
        model: GEMINI_MODEL,
        tokensEstimated: response.usageMetadata?.totalTokenCount ?? 820,
        heads: validHeads,
      });
    } catch (err: unknown) {
      const errObj = err as { name?: string; status?: number; message?: string };
      const isAbort = errObj?.name === 'AbortError' || controller.signal.aborted;
      const isRateLimit = errObj?.status === 429 || String(errObj?.message ?? '').includes('429');

      const reason = isAbort
        ? 'مهلت ۱۲ ثانیه‌ای مدل تمام شد (Timeout)؛ کاهش عمق شناختی و اجرای ۱۰۰٪ قطعی (I3 فعال).'
        : isRateLimit
          ? 'محدودیت نرخ API (429)؛ فقط عمق شناختی کاهش یافت و هسته قطعی I3 فعال ماند.'
          : 'خطای ارتباطی با سرویس مدل؛ بازگشت ایمن به اجرای قطعی بدون افت گاردهای I3.';

      res.status(200).json({
        status: 'DEGRADED',
        reason,
        heads: [],
        tokensEstimated: 0,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payam Sovereign server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Payam Sovereign server:', err);
  process.exit(1);
});
