import React, { useRef, useEffect } from 'react';
import gsap from 'gsap';

const MagneticButton = ({ children, className, onClick, strength = 40, textStrength = 20 }) => {
  const buttonRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    const button = buttonRef.current;
    const text = textRef.current;

    const xTo = gsap.quickTo(button, "x", { duration: 0.6, ease: "power3" });
    const yTo = gsap.quickTo(button, "y", { duration: 0.6, ease: "power3" });
    const textXTo = gsap.quickTo(text, "x", { duration: 0.6, ease: "power3" });
    const textYTo = gsap.quickTo(text, "y", { duration: 0.6, ease: "power3" });

    const handleMouseMove = (e) => {
      const { clientX, clientY } = e;
      const { left, top, width, height } = button.getBoundingClientRect();
      const x = clientX - (left + width / 2);
      const y = clientY - (top + height / 2);

      xTo(x * (strength / 100));
      yTo(y * (strength / 100));
      textXTo(x * (textStrength / 100));
      textYTo(y * (textStrength / 100));
    };

    const handleMouseLeave = () => {
      xTo(0);
      yTo(0);
      textXTo(0);
      textYTo(0);
    };

    button.addEventListener("mousemove", handleMouseMove);
    button.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      button.removeEventListener("mousemove", handleMouseMove);
      button.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [strength, textStrength]);

  return (
    <button
      ref={buttonRef}
      className={`magnetic-button ${className}`}
      onClick={onClick}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <span ref={textRef} style={{ display: 'inline-block', pointerEvents: 'none' }}>
        {children}
      </span>
    </button>
  );
};

export default MagneticButton;
