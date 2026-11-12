import { forwardRef } from 'react';

interface Props {
  text: string;
  visible: boolean;
  onClose: () => void;
  onOpen: () => void;
}

const Bubble = forwardRef<HTMLDivElement, Props>(function Bubble(
  { text, visible, onClose, onOpen },
  ref,
) {
  if (!visible) return null;

  return (
    <div
      ref={ref}
      className="bubble"
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="bubble-text">{text}</div>
      <button
        className="bubble-close"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
});

export default Bubble;
