/**
 * Payam Sovereign — Strict Flat Zod Validation Schemas (I5 Firewall)
 * Every external LLM response or reconciliation input must pass Zod validation
 * before touching PayamCore deterministic state.
 */

import { z } from 'zod';

export const LlmHeadIdSchema = z.enum(['A7', 'A8', 'A11']);

export const LlmRiskActionSchema = z.enum([
  'ALLOW',
  'REDUCE_RISK',
  'TIGHTEN_SL',
  'VETO',
]);

/**
 * Flat, shallow schema for each online Gemini head (A7, A8, A11).
 * Raw prose (`summaryFa`) is bounded and isolated for display-only use (I5).
 */
export const LlmHeadOutputSchema = z.object({
  headId: LlmHeadIdSchema,
  riskAction: LlmRiskActionSchema,
  riskMultiplier: z.number().finite().min(0.1).max(2.0), // I1 clamps any value > 1.0 down to 1.0
  slTightenFraction: z.number().finite().min(-0.5).max(0.5), // I1 clamps any negative (widening) to 0
  macroEventHazard: z.boolean(),
  structuralInvalidationFlag: z.boolean(),
  summaryFa: z.string().min(1).max(240),
  latencyMs: z.number().finite().min(0).max(60000).default(0),
});

export const CouncilLlmApiResponseSchema = z.object({
  status: z.enum(['OK', 'DEGRADED']),
  reason: z.string().optional(),
  model: z.string().optional(),
  tokensEstimated: z.number().finite().min(0).default(0),
  heads: z.array(LlmHeadOutputSchema).max(3).default([]),
});

export const ReconcilePositionInputSchema = z.object({
  brokerPrice: z.number().finite().positive(),
  brokerStopLoss: z.number().finite().positive(),
  remainingSizePct: z.number().finite().min(0).max(100),
  isStillOpen: z.boolean(),
});

export type ValidatedLlmHead = z.infer<typeof LlmHeadOutputSchema>;
export type ValidatedCouncilLlmApiResponse = z.infer<typeof CouncilLlmApiResponseSchema>;
export type ValidatedReconcileInput = z.infer<typeof ReconcilePositionInputSchema>;
