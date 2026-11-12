import { forwardRef } from 'react';

interface Props {
  text: string;
  visible: boolean;
  onClose: () => void;
}

const Bubble = forwardRef<HTMLDivElement, Props>(function Bubble(
  { text, visible, onClose },
  ref,
) {
  if (!visible) return null;

  return (
    <div ref={ref} className="bubble" onPointerDown={(event) => event.stopPropagation()}>
      <div className="bubble-text">{text}</div>
      <button className="bubble-close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
});

export default Bubble;
