import test from 'node:test';
import assert from 'node:assert/strict';
import { deliberateCouncil } from './engine';
import { generateHistoricalCandles } from '../feed/syntheticCandles';
import {
  transitionEnterManualPosition,
  transitionRatchetStopLoss,
  transitionReconcilePosition,
  transitionTriggerUnknownFreeze,
} from '../statechart/machine';
import type { BudgetState, KernelRiskConfig } from '../types';

const DEFAULT_CONFIG: KernelRiskConfig = {
  maxRiskPerTradePct: 0.75,
  maxDailyDrawdownR: -3.0,
  minRewardToRisk: 2.0,
  maxConcurrentPositions: 2,
  unknownConfidenceThreshold: 0.72,
  circuitBreakerTripped: false,
  dailyRealizedR: 0,
};

const DEFAULT_BUDGET: BudgetState = {
  tokensUsedSession: 0,
  tokenCapSession: 24000,
  callsThisHour: 0,
  hourlyCallCap: 30,
  exhausted: false,
};

test('PayamCouncil evaluates all 38 agents and issues B13 certificate on valid XAUUSD setup', () => {
  const now = 1_764_000_000_000;
  const bars = generateHistoricalCandles('XAUUSD', 120, Math.floor(now / 1000));
  const result = deliberateCouncil({
    asset: 'XAUUSD',
    bars,
    currentSpread: 0.16,
    kernelConfig: DEFAULT_CONFIG,
    budget: DEFAULT_BUDGET,
    openPositionCount: 0,
    nowMs: now,
    emitEvents: false,
  });

  assert.equal(result.agents.length, 38);
  assert.ok(result.signal !== null, 'Expected valid XAUUSD bullish sweep signal');
  assert.equal(result.signal.side, 'LONG');
  assert.ok(result.signal.certId.startsWith('B13-XAUUSD-'));
  assert.ok(result.signal.poiAnchors.length >= 1 && result.signal.poiAnchors.length <= 2);
  assert.equal(result.signal.rationaleFa.length, 4);
});

test('PayamCouncil enforces default NO_TRADE (I6) on compressed chop regime (NAS100)', () => {
  const now = 1_764_000_000_000;
  const bars = generateHistoricalCandles('NAS100', 120, Math.floor(now / 1000));
  const result = deliberateCouncil({
    asset: 'NAS100',
    bars,
    currentSpread: 0.5,
    kernelConfig: DEFAULT_CONFIG,
    budget: DEFAULT_BUDGET,
    openPositionCount: 0,
    nowMs: now,
    emitEvents: false,
  });

  assert.equal(result.agents.length, 38);
  assert.equal(result.signal, null);
  assert.ok(result.noTradeReasonFa && result.noTradeReasonFa.length > 0);
});

test('Harel Statechart enforces I7 -> I2 -> I4 Freeze -> Reconcile lifecycle end-to-end', () => {
  const now = 1_764_000_000_000;
  const bars = generateHistoricalCandles('XAUUSD', 120, Math.floor(now / 1000));
  const delib = deliberateCouncil({
    asset: 'XAUUSD',
    bars,
    currentSpread: 0.16,
    kernelConfig: DEFAULT_CONFIG,
    budget: DEFAULT_BUDGET,
    openPositionCount: 0,
    nowMs: now,
    emitEvents: false,
  });
  assert.ok(delib.signal);

  // Blocked without I7 broker confirmation
  const blockedEntry = transitionEnterManualPosition({
    feedHealth: 'HEALTHY',
    signal: delib.signal,
    activeRegime: delib.regime,
    confirmation: { brokerSlPlaced: true, brokerTpPlaced: false, confirmedAt: now },
    nowMs: now,
  });
  assert.equal(blockedEntry.ok, false);

  // Allowed with full I7 broker confirmation
  const openRes = transitionEnterManualPosition({
    feedHealth: 'HEALTHY',
    signal: delib.signal,
    activeRegime: delib.regime,
    confirmation: { brokerSlPlaced: true, brokerTpPlaced: true, confirmedAt: now },
    nowMs: now,
  });
  assert.equal(openRes.ok, true);
  if (!openRes.ok) return;

  // I2 forbids widening SL
  const widen = transitionRatchetStopLoss(
    openRes.position,
    openRes.position.currentStopLoss - 5,
    'HEALTHY'
  );
  assert.equal(widen.ok, false);

  // I2 allows tightening SL
  const tighten = transitionRatchetStopLoss(
    openRes.position,
    openRes.position.currentStopLoss + 2,
    'HEALTHY'
  );
  assert.equal(tighten.ok, true);
  if (!tighten.ok) return;

  // I4 freeze blocks SL ratchet until reconciled
  const frozenPos = transitionTriggerUnknownFreeze(tighten.position, 0.35);
  const blockedDuringFreeze = transitionRatchetStopLoss(
    frozenPos,
    frozenPos.currentStopLoss + 1,
    'HEALTHY'
  );
  assert.equal(blockedDuringFreeze.ok, false);

  // Reconcile resolves I4 freeze cleanly
  const reconciled = transitionReconcilePosition(
    frozenPos,
    {
      brokerPrice: frozenPos.entryPrice + 5,
      brokerStopLoss: frozenPos.currentStopLoss + 1,
      remainingSizePct: 50,
      isStillOpen: true,
    },
    now + 5000
  );
  assert.equal(reconciled.ok, true);
  if (reconciled.ok && reconciled.position) {
    assert.equal(reconciled.position.stateConfidence, 1.0);
    assert.equal(reconciled.position.remainingSizePct, 50);
  }
});
