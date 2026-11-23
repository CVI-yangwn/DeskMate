import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';
import type { AvatarConfig, HitRect, UtterancePlan } from '../shared/types';

interface Props {
  config: AvatarConfig | null;
  plan: UtterancePlan | null;
  speakingUntil: number;
  onHitRect: (rect: HitRect) => void;
  onOpenPanel: () => void;
}

const EMOTION_TO_EXPRESSION: Record<string, string> = {
  celebrate: 'happy',
  tease: 'smile',
  comfort: 'sad',
  think: 'neutral',
};

export default function Live2DStage({
  config,
  plan,
  speakingUntil,
  onHitRect,
  onOpenPanel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const configRef = useRef<AvatarConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');

  useEffect(() => {
    if (!config || !canvasRef.current) return;

    let cancelled = false;
    configRef.current = config;

    const canvas = canvasRef.current;
    const cfg = config;
    const app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: canvas.clientWidth || 240,
      height: canvas.clientHeight || 360,
    });
    appRef.current = app;

    // pixi-live2d-display 需要从 window.PIXI 取 Ticker
    (window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

    void (async () => {
      try {
        const model = await Live2DModel.from(config.model, {
          autoInteract: false,
        });
        if (cancelled) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        model.anchor.set(cfg.anchor[0], cfg.anchor[1]);
        app.stage.addChild(model);

        layout();
        const idle = cfg.motions.idle?.[0] ?? 'idle';
        model.motion(idle).catch(() => undefined);
      } catch (error) {
        console.error('Live2D 加载失败', error);
        setLoadError(String(error));
      }
    })();

    type DragState = {
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
    };
    let dragState: DragState | null = null;

    function finishDrag(openPanel: boolean) {
      if (!dragState) return;
      const pointerId = dragState.pointerId;
      const moved = dragState.moved;
      dragState = null;
      window.deskmate.endAvatarDrag();
      try {
        if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      } catch {
        // pointer capture may already be released by the browser
      }
      if (openPanel && !moved) onOpenPanel();
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      dragState = {
        pointerId: event.pointerId,
        startX: event.screenX,
        startY: event.screenY,
        lastX: event.screenX,
        lastY: event.screenY,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      window.deskmate.beginAvatarDrag();
      event.preventDefault();
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.screenX - dragState.lastX;
      const dy = event.screenY - dragState.lastY;
      if (
        Math.abs(event.screenX - dragState.startX) + Math.abs(event.screenY - dragState.startY) > 4
      ) {
        dragState.moved = true;
      }
      if (dx !== 0 || dy !== 0) {
        dragState.lastX = event.screenX;
        dragState.lastY = event.screenY;
        window.deskmate.moveAvatar(dx, dy);
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      finishDrag(true);
    }

    function onPointerCancel(event: PointerEvent) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      finishDrag(false);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);

    let maskTimer: number | null = null;

    function scheduleHitMask() {
      if (maskTimer) window.clearTimeout(maskTimer);
      maskTimer = window.setTimeout(() => {
        maskTimer = null;
        publishHitMask();
      }, 160);
    }

    // 用渲染结果生成低分辨率 alpha 掩码，主进程按猫的轮廓做点击穿透，
    // 不再用整个窗口/模型矩形。
    function publishHitMask() {
      try {
        const width = canvas.clientWidth || 240;
        const height = canvas.clientHeight || 360;
        if (!width || !height) return;

        const extract = app.renderer.plugins.extract as {
          pixels?: (target?: unknown) => Uint8Array;
        };
        if (typeof extract.pixels !== 'function') return;

        // 不能直接读主画布（preserveDrawingBuffer=false 会读到空帧），
        // 先渲染到一张同尺寸 RenderTexture，再取像素。
        const target = PIXI.RenderTexture.create({ width, height, resolution: 1 });
        app.renderer.render(app.stage, { renderTexture: target });
        const pixels = extract.pixels(target);
        target.destroy(true);

        const rw = width;
        const rh = height;
        const cell = 4;
        const cols = Math.ceil(width / cell);
        const rows = Math.ceil(height / cell);
        const mask = new Array<number>(cols * rows).fill(0);

        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const px = Math.floor((col + 0.5) * cell);
            const py = Math.floor((row + 0.5) * cell);
            if (px < 0 || py < 0 || px >= rw || py >= rh) continue;
            const alpha = pixels[(py * rw + px) * 4 + 3];
            if (alpha > 8) mask[row * cols + col] = 1;
          }
        }

        window.deskmate.setAvatarHitMask({ width, height, cell, cols, rows, mask });
      } catch (error) {
        console.warn('生成 Live2D 命中掩码失败', error);
      }
    }

    function layout() {
      const model = modelRef.current;
      if (!model) return;

      const width = canvas.clientWidth || 240;
      const height = canvas.clientHeight || 360;
      app.renderer.resize(width, height);

      // model.width/height 依赖首帧 bounds，初次加载时可能为 0；internalModel
      // 的尺寸是模型自身画布尺寸，不受当前 scale 影响。
      const modelWidth = Math.max(model.internalModel.width || model.width, 1);
      const modelHeight = Math.max(model.internalModel.height || model.height, 1);
      const fit = Math.min(width / modelWidth, height / modelHeight);
      model.scale.set(fit * cfg.scale);
      model.x = width / 2;
      model.y = height - 8;

      requestAnimationFrame(() => {
        const bounds = model.getBounds();
        const padding = 10;
        const rect: HitRect = {
          x: Math.max(0, bounds.x - padding),
          y: Math.max(0, bounds.y - padding),
          w: Math.min(width, bounds.width + padding * 2),
          h: Math.min(height, bounds.height + padding * 2),
        };
        onHitRect(rect);
        if (window.location.search.includes('debug=1')) {
          setDebugInfo(
            `canvas ${width}x${height} | model ${Math.round(model.width)}x${Math.round(
              model.height,
            )} | scale ${model.scale.x.toFixed(3)} | bounds ${Math.round(bounds.x)},${Math.round(
              bounds.y,
            )},${Math.round(bounds.width)},${Math.round(bounds.height)}`,
          );
        }
      });
      scheduleHitMask();
    }

    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(() => layout());
    resizeObserver.observe(canvas);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      if (dragState) {
        dragState = null;
        window.deskmate.endAvatarDrag();
      }
      if (maskTimer) window.clearTimeout(maskTimer);
      modelRef.current = null;
      app.destroy(true);
      appRef.current = null;
    };
  }, [config, onHitRect, onOpenPanel]);

  useEffect(() => {
    const model = modelRef.current;
    const cfg = configRef.current;
    if (!model || !cfg || !plan?.say) return;

    const expressionKey = EMOTION_TO_EXPRESSION[plan.emotion] ?? plan.emotion;
    const expressionName = cfg.expressions[expressionKey];
    if (expressionName) {
      model.expression(expressionName).catch(() => undefined);
    }

    const motion = cfg.motions[plan.motion] ?? cfg.motions.idle;
    if (motion) {
      if (motion.length > 1) {
        model.motion(motion[0], Number(motion[1])).catch(() => undefined);
      } else {
        model.motion(motion[0]).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    const core = model.internalModel.coreModel as unknown as {
      setParameterValueById?: (id: string, value: number) => void;
      setParamFloat?: (id: string, value: number, weight?: number) => void;
    };
    const param = configRef.current?.lipSync.param ?? 'PARAM_MOUTH_OPEN_Y';
    const setMouth = (value: number) => {
      if (typeof core.setParameterValueById === 'function') {
        core.setParameterValueById(param, value);
      } else if (typeof core.setParamFloat === 'function') {
        core.setParamFloat(param, value, 1);
      }
    };
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      if (now >= speakingUntil) {
        setMouth(0);
        return;
      }

      const t = (now - start) / 1000;
      const envelope = Math.min(1, (now - start) / 300);
      const mouth = (0.12 + 0.34 * Math.abs(Math.sin(t * 9)) + 0.08 * Math.sin(t * 23)) * envelope;
      setMouth(Math.min(1, Math.max(0, mouth)));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setMouth(0);
    };
  }, [speakingUntil]);

  return (
    <>
      {debugInfo && (
        <div className="live2d-debug">{debugInfo}</div>
      )}
      {loadError && (
        <div className="live2d-error">
          <strong>Live2D 加载失败</strong>
          <span>{loadError}</span>
          <span>检查 live2d.min.js 和 config/avatar.json 里的模型路径。</span>
        </div>
      )}
      <canvas ref={canvasRef} className="live2d-canvas" />
    </>
  );
}
