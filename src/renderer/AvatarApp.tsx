import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarConfig, HitRect, UtterancePlan } from '../shared/types';
import Bubble from './Bubble';
import Live2DStage from './Live2DStage';

function unionRects(rects: HitRect[]): HitRect {
  const valid = rects.filter((r) => r.w > 0 && r.h > 0);
  if (valid.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  const left = Math.min(...valid.map((r) => r.x));
  const top = Math.min(...valid.map((r) => r.y));
  const right = Math.max(...valid.map((r) => r.x + r.w));
  const bottom = Math.max(...valid.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export default function AvatarApp() {
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [plan, setPlan] = useState<UtterancePlan | null>(null);
  const [speakingUntil, setSpeakingUntil] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [modelRect, setModelRect] = useState<HitRect>({ x: 0, y: 0, w: 0, h: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const onHitRect = useCallback((rect: HitRect) => setModelRect(rect), []);
  const onOpenPanel = useCallback(() => {
    void window.deskmate.openPanel();
  }, []);

  useEffect(() => {
    void window.deskmate.getAvatarConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    const off = window.deskmate.onUtterance((payload) => {
      if (!payload.plan.say) return;
      setPlan(payload.plan);
      setSpeakingUntil(performance.now() + payload.speakingMs);
      setBubbleVisible(true);

      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        setBubbleVisible(false);
      }, Math.max(6000, payload.speakingMs + 2500));
    });

    return () => {
      off();
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const bubble = bubbleRef.current;
    const rects = [modelRect];

    if (bubbleVisible && bubble) {
      const r = bubble.getBoundingClientRect();
      rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }

    const union = unionRects(rects);
    void window.deskmate.setHitRect(union);
  }, [modelRect, bubbleVisible, plan]);

  const closeBubble = useCallback(() => {
    setBubbleVisible(false);
  }, []);

  return (
    <div className="avatar-root">
      <Live2DStage
        config={config}
        plan={plan}
        speakingUntil={speakingUntil}
        onHitRect={onHitRect}
        onOpenPanel={onOpenPanel}
      />
      <Bubble ref={bubbleRef} text={plan?.displayText ?? ''} visible={bubbleVisible} onClose={closeBubble} />
    </div>
  );
}
