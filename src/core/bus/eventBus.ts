/**
 * PayamCore EventBus — Strongly-Typed 1:1 State-to-Visual Event Fabric
 * Drives PayamArena (PixiJS Dirty-Flag), PayamLens, and PayamLedger.
 * ZERO fake telemetry: every arena glow, edge pulse, or veto shield originates here.
 */

import type {
  AgentEvaluation,
  AssetSymbol,
  CouncilDeliberation,
  FeedHealthState,
  FmaMode,
  InvariantId,
  LedgerEntry,
  OpenPosition,
  PayamSignal,
  PayamStatechartNode,
} from '../types';

export type PayamEvent =
  | {
      readonly type: 'COUNCIL_START';
      readonly asset: AssetSymbol;
      readonly timestamp: number;
    }
  | {
      readonly type: 'AGENT_EVALUATED';
      readonly asset: AssetSymbol;
      readonly agent: AgentEvaluation;
      readonly timestamp: number;
    }
  | {
      readonly type: 'VETO_SHIELD_RAISED';
      readonly asset: AssetSymbol;
      readonly agentId: string;
      readonly invariantRef?: InvariantId;
      readonly reasonFa: string;
      readonly timestamp: number;
    }
  | {
      readonly type: 'CERT_ISSUED_B13';
      readonly asset: AssetSymbol;
      readonly certId: string;
      readonly expiresAt: number;
      readonly timestamp: number;
    }
  | {
      readonly type: 'COUNCIL_COMPLETE';
      readonly asset: AssetSymbol;
      readonly deliberation: CouncilDeliberation;
      readonly timestamp: number;
    }
  | {
      readonly type: 'STATE_TRANSITION';
      readonly asset: AssetSymbol;
      readonly from: PayamStatechartNode;
      readonly to: PayamStatechartNode;
      readonly fmaMode: FmaMode;
      readonly timestamp: number;
    }
  | {
      readonly type: 'SIGNAL_LOCKED';
      readonly asset: AssetSymbol;
      readonly signal: PayamSignal;
      readonly timestamp: number;
    }
  | {
      readonly type: 'POSITION_UPDATED';
      readonly asset: AssetSymbol;
      readonly position: OpenPosition | null;
      readonly timestamp: number;
    }
  | {
      readonly type: 'INVARIANT_TRIGGERED';
      readonly asset: AssetSymbol;
      readonly invariant: InvariantId;
      readonly passed: boolean;
      readonly reasonFa: string;
      readonly timestamp: number;
    }
  | {
      readonly type: 'FEED_HEALTH_CHANGED';
      readonly health: FeedHealthState;
      readonly latencyMs: number;
      readonly timestamp: number;
    }
  | {
      readonly type: 'LEDGER_COMMITTED';
      readonly entry: LedgerEntry;
      readonly timestamp: number;
    };

export type PayamEventListener = (event: PayamEvent) => void;

export class PayamEventBus {
  private readonly listeners = new Set<PayamEventListener>();

  subscribe(listener: PayamEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: PayamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export const payamBus = new PayamEventBus();
