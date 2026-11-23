import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarConfig, HitRect, UtterancePlan } from '../shared/types';
import Bubble from './Bubble';
import Live2DStage from './Live2DStage';

export default function AvatarApp() {
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [plan, setPlan] = useState<UtterancePlan | null>(null);
  const [speakingUntil, setSpeakingUntil] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [modelRect, setModelRect] = useState<HitRect>({ x: 0, y: 0, w: 0, h: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastEventType = useRef('unknown');

  const onHitRect = useCallback((rect: HitRect) => setModelRect(rect), []);
  const onOpenPanel = useCallback(() => {
    void window.deskmate.sendBubbleFeedback(lastEventType.current, 'open');
    void window.deskmate.openPanel();
  }, []);

  useEffect(() => {
    void window.deskmate.getAvatarConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    const off = window.deskmate.onUtterance((payload) => {
      if (!payload.plan.say) return;
      lastEventType.current =
        payload.eventType ?? payload.plan.evidenceIds[0] ?? payload.origin;
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
    void window.deskmate.setHitRect(modelRect);

    const bubble = bubbleRef.current;
    if (bubbleVisible && bubble) {
      const r = bubble.getBoundingClientRect();
      window.deskmate.setAvatarBubbleRect({ x: r.x, y: r.y, w: r.width, h: r.height });
    } else {
      window.deskmate.setAvatarBubbleRect(null);
    }
  }, [modelRect, bubbleVisible, plan]);

  const closeBubble = useCallback(() => {
    setBubbleVisible(false);
    void window.deskmate.sendBubbleFeedback(lastEventType.current, 'dismiss');
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
      <Bubble
        ref={bubbleRef}
        text={plan?.displayText ?? ''}
        visible={bubbleVisible}
        onClose={closeBubble}
        onOpen={onOpenPanel}
      />
    </div>
  );
}
