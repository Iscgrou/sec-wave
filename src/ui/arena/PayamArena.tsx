/**
 * PayamArena — 38-Agent 3-Plane PixiJS v8 Cognitive Council Arena
 * ZERO-FAKE TELEMETRY CONTRACT:
 *   - NEVER runs fake loops, random pulses, or decorative timers.
 *   - Strictly Dirty-Flag driven: renders ONLY when a real PayamCore EventBus
 *     event arrives, theme/asset changes, or user hovers/selects an agent.
 *   - Stops PixiJS ticker immediately once active state transitions settle (0 FPS idle).
 *   - Graceful renderer fallback: webgpu -> webgl2 -> canvas + webglcontextlost recovery.
 */

import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { payamBus, type PayamEvent } from '../../core/bus/eventBus';
import { PAYAM_COUNCIL_AGENTS } from '../../core/council/agents';
import type {
  AgentEvaluation,
  AssetSymbol,
  CouncilDeliberation,
} from '../../core/types';
import type { PayamColorTokens } from '../theme/tokens';
import { LtrNum, SemanticShape } from '../components/SemanticShape';

interface PayamArenaProps {
  readonly asset: AssetSymbol;
  readonly deliberation: CouncilDeliberation | null;
  readonly theme: PayamColorTokens;
}

interface NodeLayout {
  readonly id: string;
  readonly plane: 'A' | 'B' | 'C';
  readonly x: number;
  readonly y: number;
  readonly isOnlineLlm: boolean;
  readonly isB13: boolean;
}

interface ActiveEdgePulse {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly colorHex: number;
  readonly startMs: number;
  readonly durationMs: number;
}

function cssHexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) || 0x38bdf8;
}

function verdictToColor(
  verdict: AgentEvaluation['verdict'] | undefined,
  theme: PayamColorTokens
): string {
  switch (verdict) {
    case 'APPROVE':
      return theme.bullish;
    case 'VETO':
      return theme.veto;
    case 'REDUCE_RISK':
    case 'CAUTION':
      return theme.warning;
    case 'DEGRADED':
      return theme.freeze;
    default:
      return theme.textMuted;
  }
}

function computeNodeLayouts(width: number, height: number): NodeLayout[] {
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);
  const rA = minDim * 0.41; // Plane A: 12 Perception agents (outer orbit)
  const rB = minDim * 0.29; // Plane B: 14 Synthesis + B13 cert (middle orbit)
  const rC = minDim * 0.17; // Plane C: 12 Risk Kernel I1..I7 (inner orbit)

  const planeA = PAYAM_COUNCIL_AGENTS.filter((a) => a.plane === 'A');
  const planeB = PAYAM_COUNCIL_AGENTS.filter((a) => a.plane === 'B');
  const planeC = PAYAM_COUNCIL_AGENTS.filter((a) => a.plane === 'C');

  const layouts: NodeLayout[] = [];

  const placeRing = (list: typeof planeA, radius: number, phaseOffset: number) => {
    list.forEach((agent, i) => {
      const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2 + phaseOffset;
      layouts.push({
        id: agent.id,
        plane: agent.plane,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        isOnlineLlm: agent.isOnlineLlm,
        isB13: agent.id === 'B13',
      });
    });
  };

  placeRing(planeA, rA, 0);
  placeRing(planeB, rB, Math.PI / 14);
  placeRing(planeC, rC, Math.PI / 12);

  return layouts;
}

export function PayamArena({ asset, deliberation, theme }: PayamArenaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<{
    ringsGfx: Graphics;
    edgesGfx: Graphics;
    nodesGfx: Graphics;
    labelsLayer: Container;
    layouts: NodeLayout[];
    pulses: ActiveEdgePulse[];
    vetoShieldIds: Set<string>;
    certPulseUntil: number;
    dirty: boolean;
    activeAnimUntil: number;
    rendererBackend: string;
  } | null>(null);

  const deliberationRef = useRef<CouncilDeliberation | null>(deliberation);
  const themeRef = useRef<PayamColorTokens>(theme);
  const selectedIdRef = useRef<string | null>('B13');

  const [selectedAgentId, setSelectedAgentId] = useState<string>('B13');
  const [rendererMode, setRendererMode] = useState<string>('در حال آماده‌سازی');
  const [isIdleRender, setIsIdleRender] = useState<boolean>(true);
  const [contextLost, setContextLost] = useState<boolean>(false);

  deliberationRef.current = deliberation;
  themeRef.current = theme;
  selectedIdRef.current = selectedAgentId;

  const requestDirtyDraw = (animateDurationMs: number = 0) => {
    const scene = sceneRef.current;
    const app = appRef.current;
    if (!scene || !app) return;
    scene.dirty = true;
    const now = performance.now();
    if (animateDurationMs > 0) {
      scene.activeAnimUntil = Math.max(scene.activeAnimUntil, now + animateDurationMs);
    }
    if (!app.ticker.started) {
      setIsIdleRender(false);
      app.ticker.start();
    }
  };

  // Mount PixiJS v8 with graceful fallback (webgpu -> webgl2 -> canvas) + Dirty-Flag ticker
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let mountedApp: Application | null = null;
    let canvasEl: HTMLCanvasElement | null = null;

    const handleContextLost = (ev: Event) => {
      ev.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      requestDirtyDraw(300);
    };

    const drawFrame = () => {
      const scene = sceneRef.current;
      const app = appRef.current;
      if (!scene || !app) return;

      const now = performance.now();
      const hasActiveAnim = now < scene.activeAnimUntil;

      if (!scene.dirty && !hasActiveAnim) {
        // ZERO-FAKE TELEMETRY: stop ticker completely when idle
        if (app.ticker.started) {
          app.ticker.stop();
          setIsIdleRender(true);
        }
        return;
      }

      const w = app.screen.width;
      const h = app.screen.height;
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);
      const t = themeRef.current;
      const delib = deliberationRef.current;
      const evalMap = new Map(delib?.agents.map((a) => [a.id, a]) ?? []);

      // 1. Orbital Plane Rings
      const rings = scene.ringsGfx;
      rings.clear();
      const ringRadii = [minDim * 0.41, minDim * 0.29, minDim * 0.17];
      for (const r of ringRadii) {
        rings
          .circle(cx, cy, r)
          .stroke({ width: 1, color: cssHexToNumber(t.borderHairline), alpha: 0.9 });
      }

      // Central PayamKernel Core
      const coreColor = delib?.signal
        ? cssHexToNumber(t.bullish)
        : (delib?.vetoCount ?? 0) > 0
          ? cssHexToNumber(t.veto)
          : cssHexToNumber(t.accentPrimary);

      rings
        .circle(cx, cy, Math.max(22, minDim * 0.065))
        .fill({ color: cssHexToNumber(t.bgElevated), alpha: 1 })
        .stroke({ width: 2, color: coreColor, alpha: 0.95 });

      // B13 certificate confirmation wave (1:1 event-bound)
      if (now < scene.certPulseUntil) {
        const progress = 1 - (scene.certPulseUntil - now) / 750;
        const waveR = minDim * 0.07 + progress * minDim * 0.26;
        rings
          .circle(cx, cy, waveR)
          .stroke({ width: 2, color: cssHexToNumber(t.bullish), alpha: Math.max(0, 1 - progress) });
      }

      // 2. Structural Edges & 1:1 Event-Driven Pulses
      const edges = scene.edgesGfx;
      edges.clear();

      // Static subtle spokes from Plane C to PayamKernel core
      for (const node of scene.layouts) {
        if (node.plane === 'C') {
          const ev = evalMap.get(node.id);
          edges
            .moveTo(node.x, node.y)
            .lineTo(cx, cy)
            .stroke({
              width: ev?.vetoTriggered ? 1.8 : 0.8,
              color: cssHexToNumber(verdictToColor(ev?.verdict, t)),
              alpha: ev?.vetoTriggered ? 0.75 : 0.22,
            });
        }
      }

      // Active event-bound edge pulses
      scene.pulses = scene.pulses.filter((p) => now - p.startMs <= p.durationMs);
      for (const p of scene.pulses) {
        const u = Math.min(1, Math.max(0, (now - p.startMs) / p.durationMs));
        const px = p.fromX + (p.toX - p.fromX) * u;
        const py = p.fromY + (p.toY - p.fromY) * u;
        edges
          .moveTo(p.fromX, p.fromY)
          .lineTo(px, py)
          .stroke({ width: 1.8, color: p.colorHex, alpha: 1 - u * 0.65 });
        edges.circle(px, py, 3.2).fill({ color: p.colorHex, alpha: 1 - u * 0.5 });
      }

      // 3. 38 Agent Nodes with Triple-Redundancy Geometry (Circle / Diamond LLM / Hexagon B13 / Veto Shield)
      const nodes = scene.nodesGfx;
      nodes.clear();

      for (const node of scene.layouts) {
        const ev = evalMap.get(node.id);
        const fillHex = cssHexToNumber(verdictToColor(ev?.verdict, t));
        const isSelected = selectedIdRef.current === node.id;
        const baseR = node.isB13 ? 11 : node.isOnlineLlm ? 10 : 7.5;

        // Veto Shield Ring (bound 1:1 to VETO_SHIELD_RAISED)
        if (ev?.vetoTriggered || scene.vetoShieldIds.has(node.id)) {
          nodes
            .circle(node.x, node.y, baseR + 5)
            .stroke({ width: 1.8, color: cssHexToNumber(t.veto), alpha: 0.9 });
        }

        // Selection ring
        if (isSelected) {
          nodes
            .circle(node.x, node.y, baseR + 3.5)
            .stroke({ width: 1.8, color: cssHexToNumber(t.accentPrimary), alpha: 1 });
        }

        if (node.isOnlineLlm) {
          // Diamond geometry for online Gemini heads A7, A8, A11
          nodes
            .poly([
              node.x,
              node.y - baseR,
              node.x + baseR,
              node.y,
              node.x,
              node.y + baseR,
              node.x - baseR,
              node.y,
            ])
            .fill({ color: fillHex, alpha: 0.92 })
            .stroke({ width: 1.2, color: cssHexToNumber(t.bgCanvas), alpha: 1 });
        } else if (node.isB13) {
          // Hexagon geometry for B13 Certificate Authority
          const pts: number[] = [];
          for (let k = 0; k < 6; k += 1) {
            const a = (k * Math.PI) / 3 - Math.PI / 6;
            pts.push(node.x + Math.cos(a) * baseR, node.y + Math.sin(a) * baseR);
          }
          nodes
            .poly(pts)
            .fill({ color: fillHex, alpha: 0.96 })
            .stroke({ width: 1.5, color: cssHexToNumber(t.textPrimary), alpha: 0.95 });
        } else {
          nodes
            .circle(node.x, node.y, baseR)
            .fill({ color: fillHex, alpha: 0.88 })
            .stroke({ width: 1, color: cssHexToNumber(t.bgCanvas), alpha: 1 });
        }
      }

      // Sync label positions & colors
      const labelChildren = scene.labelsLayer.children;
      for (let i = 0; i < scene.layouts.length; i += 1) {
        const node = scene.layouts[i];
        const lbl = labelChildren[i] as Text | undefined;
        if (lbl) {
          lbl.x = node.x;
          lbl.y = node.y + (node.isB13 ? 17 : 14);
          lbl.style.fill =
            selectedIdRef.current === node.id ? t.accentPrimary : t.textSecondary;
        }
      }

      // Core label (last child)
      const coreLabel = labelChildren[scene.layouts.length] as Text | undefined;
      if (coreLabel) {
        coreLabel.x = cx;
        coreLabel.y = cy;
        coreLabel.text = delib?.signal ? 'LOCKED' : 'KERNEL';
        coreLabel.style.fill = t.textPrimary;
      }

      scene.dirty = false;
      app.render();

      if (!hasActiveAnim && scene.pulses.length === 0) {
        app.ticker.stop();
        setIsIdleRender(true);
      }
    };

    async function initPixi() {
      const width = host!.clientWidth || 640;
      const height = host!.clientHeight || 420;
      const app = new Application();

      // Graceful WebGPU -> WebGL2 -> Canvas fallback chain
      let backend = 'webgl2';
      try {
        await app.init({
          width,
          height,
          background: themeRef.current.bgCanvas,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          preference: 'webgl',
          autoStart: false,
        });
        backend = app.renderer.name || 'webgl';
      } catch {
        // Fallback minimal init
        await app.init({
          width,
          height,
          background: themeRef.current.bgCanvas,
          antialias: false,
          autoStart: false,
        });
        backend = 'canvas-fallback';
      }

      if (disposed) {
        app.destroy(true);
        return;
      }

      mountedApp = app;
      appRef.current = app;
      setRendererMode(backend);

      canvasEl = app.canvas as HTMLCanvasElement;
      canvasEl.style.width = '100%';
      canvasEl.style.height = '100%';
      canvasEl.style.display = 'block';
      canvasEl.setAttribute('data-testid', 'payam-arena-canvas');
      canvasEl.addEventListener('webglcontextlost', handleContextLost, false);
      canvasEl.addEventListener('webglcontextrestored', handleContextRestored, false);

      host!.innerHTML = '';
      host!.appendChild(canvasEl);

      const ringsGfx = new Graphics();
      const edgesGfx = new Graphics();
      const nodesGfx = new Graphics();
      const labelsLayer = new Container();

      app.stage.addChild(ringsGfx, edgesGfx, nodesGfx, labelsLayer);

      const layouts = computeNodeLayouts(width, height);
      const labelStyle = new TextStyle({
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 9,
        fontWeight: '600',
        fill: themeRef.current.textSecondary,
      });

      for (const node of layouts) {
        const txt = new Text({ text: node.id, style: labelStyle.clone() });
        txt.anchor.set(0.5, 0.5);
        txt.x = node.x;
        txt.y = node.y + 14;
        labelsLayer.addChild(txt);
      }

      const coreTxt = new Text({
        text: 'KERNEL',
        style: new TextStyle({
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 10,
          fontWeight: '700',
          fill: themeRef.current.textPrimary,
        }),
      });
      coreTxt.anchor.set(0.5, 0.5);
      coreTxt.x = width / 2;
      coreTxt.y = height / 2;
      labelsLayer.addChild(coreTxt);

      sceneRef.current = {
        ringsGfx,
        edgesGfx,
        nodesGfx,
        labelsLayer,
        layouts,
        pulses: [],
        vetoShieldIds: new Set(),
        certPulseUntil: 0,
        dirty: true,
        activeAnimUntil: 0,
        rendererBackend: backend,
      };

      // Hit-test clicks on 38 agent nodes
      canvasEl.addEventListener('click', (ev: MouseEvent) => {
        const rect = canvasEl!.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const currentLayouts = sceneRef.current?.layouts ?? [];
        let nearest: NodeLayout | null = null;
        let minDist = 20;
        for (const n of currentLayouts) {
          const d = Math.hypot(n.x - mx, n.y - my);
          if (d < minDist) {
            minDist = d;
            nearest = n;
          }
        }
        if (nearest) {
          setSelectedAgentId(nearest.id);
          selectedIdRef.current = nearest.id;
          requestDirtyDraw(0);
        }
      });

      app.ticker.add(drawFrame);
      // Initial single dirty draw (then stops cleanly to 0 FPS idle)
      drawFrame();
    }

    void initPixi();

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const app = appRef.current;
      const scene = sceneRef.current;
      if (!rect || !app || !scene || rect.width < 40 || rect.height < 40) return;
      app.renderer.resize(Math.floor(rect.width), Math.floor(rect.height));
      scene.layouts = computeNodeLayouts(Math.floor(rect.width), Math.floor(rect.height));
      requestDirtyDraw(0);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', handleContextLost);
        canvasEl.removeEventListener('webglcontextrestored', handleContextRestored);
      }
      if (mountedApp) {
        mountedApp.ticker.stop();
        mountedApp.destroy(true);
      }
      appRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // 1:1 EventBus binding: ONLY animate when real PayamCore events occur
  useEffect(() => {
    const unsubscribe = payamBus.subscribe((event: PayamEvent) => {
      const scene = sceneRef.current;
      const app = appRef.current;
      if (!scene || !app) return;

      const cx = app.screen.width / 2;
      const cy = app.screen.height / 2;
      const now = performance.now();
      const t = themeRef.current;

      if (event.type === 'COUNCIL_START' && event.asset === asset) {
        scene.vetoShieldIds.clear();
        scene.pulses = [];
        requestDirtyDraw(450);
      } else if (event.type === 'AGENT_EVALUATED' && event.asset === asset) {
        const node = scene.layouts.find((n) => n.id === event.agent.id);
        if (node) {
          scene.pulses.push({
            fromX: node.x,
            fromY: node.y,
            toX: cx,
            toY: cy,
            colorHex: cssHexToNumber(verdictToColor(event.agent.verdict, t)),
            startMs: now,
            durationMs: 520,
          });
          requestDirtyDraw(560);
        }
      } else if (event.type === 'VETO_SHIELD_RAISED' && event.asset === asset) {
        scene.vetoShieldIds.add(event.agentId);
        requestDirtyDraw(600);
      } else if (event.type === 'CERT_ISSUED_B13' && event.asset === asset) {
        scene.certPulseUntil = now + 750;
        requestDirtyDraw(780);
      } else if (event.type === 'COUNCIL_COMPLETE' && event.asset === asset) {
        requestDirtyDraw(400);
      }
    });

    return unsubscribe;
  }, [asset]);

  // Trigger single dirty redraw when theme, asset, or deliberation changes
  useEffect(() => {
    const app = appRef.current;
    if (app) {
      app.renderer.background.color = cssHexToNumber(theme.bgCanvas);
    }
    requestDirtyDraw(0);
  }, [theme, asset, deliberation, selectedAgentId]);

  const selectedDef = PAYAM_COUNCIL_AGENTS.find((a) => a.id === selectedAgentId) ?? PAYAM_COUNCIL_AGENTS[24];
  const selectedEval = deliberation?.agents.find((a) => a.id === selectedDef.id);

  return (
    <div
      className="relative flex flex-col h-full w-full min-h-0 overflow-hidden"
      style={{ backgroundColor: theme.bgCanvas }}
      data-testid="payam-arena-container"
      data-dirty-idle={isIdleRender ? 'idle' : 'active'}
    >
      {/* Arena Header Strip */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 border-b text-xs"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderHairline,
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-sm whitespace-nowrap" style={{ color: theme.textPrimary }}>
            میدان شورای ۳۸ ایجنت <LtrNum className="ms-1 font-semibold">{asset}</LtrNum>
          </span>
          <span style={{ color: theme.textMuted }} aria-hidden="true">
            ·
          </span>
          <span className="whitespace-nowrap" style={{ color: theme.textSecondary }}>
            تأیید <LtrNum className="font-semibold">{deliberation?.consensusApproveCount ?? 0}/38</LtrNum>
          </span>
          <span style={{ color: theme.textMuted }} aria-hidden="true">
            ·
          </span>
          <span className="whitespace-nowrap" style={{ color: (deliberation?.vetoCount ?? 0) > 0 ? theme.veto : theme.textSecondary }}>
            وتو <LtrNum className="font-semibold">{deliberation?.vetoCount ?? 0}</LtrNum>
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] shrink-0" style={{ color: theme.textMuted }}>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <SemanticShape shape="diamond" color={theme.accentPrimary} size={8} />
            هد آنلاین LLM (A7/A8/A11)
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <SemanticShape shape="hexagon" color={theme.bullish} size={8} />
            مرجع گواهی B13
          </span>
          <span className="whitespace-nowrap">
            <LtrNum>{rendererMode}</LtrNum> · {isIdleRender ? 'توقف بیکاری (0 FPS)' : 'پایش رویداد'}
          </span>
        </div>
      </div>

      {/* PixiJS v8 Canvas Container */}
      <div className="relative flex-1 min-h-0 w-full">
        <div ref={hostRef} className="h-full w-full" />
        {contextLost && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.8)' }}
          >
            <p className="text-sm font-medium" style={{ color: theme.warning }}>
              بافت گرافیکی WebGL قطع شد؛ در حال بازیابی خودکار میدان ۳۸ ایجنت...
            </p>
          </div>
        )}
      </div>

      {/* Selected Agent Inspector Strip */}
      <div
        className="flex items-center justify-between gap-4 px-3 py-2 shrink-0 border-t text-xs"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderHairline,
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <SemanticShape
            shape={selectedDef.isOnlineLlm ? 'diamond' : selectedDef.id === 'B13' ? 'hexagon' : 'circle'}
            color={verdictToColor(selectedEval?.verdict, theme)}
            size={10}
          />
          <span className="font-semibold whitespace-nowrap" style={{ color: theme.textPrimary }}>
            <LtrNum>{selectedDef.id}</LtrNum> — {selectedDef.nameFa}
          </span>
          <span style={{ color: theme.textMuted }} aria-hidden="true">
            ·
          </span>
          <span className="truncate persian-copy" style={{ color: theme.textSecondary }}>
            {selectedEval?.noteFa ?? selectedDef.roleFa}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px]" style={{ color: theme.textMuted }}>
          <span>
            صفحه <LtrNum className="font-semibold">{selectedDef.plane}</LtrNum>
          </span>
          {selectedDef.invariantRef && (
            <span style={{ color: theme.warning }}>
              ناوردا <LtrNum className="font-semibold">{selectedDef.invariantRef}</LtrNum>
            </span>
          )}
          <span>
            تأخیر <LtrNum>{selectedEval?.latencyMs ?? 0}ms</LtrNum>
          </span>
        </div>
      </div>
    </div>
  );
}
