// src/components/OnboardingOverlay.jsx
import React, { useState, useEffect, useRef } from 'react';

const STEPS = [
  {
    icon: '⬠',
    title: 'Draw Your Work Zone',
    desc: 'Use the polygon or rectangle tool in the floating dock to trace the physical boundary of your site.',
    color: '#0ea5e9',
  },
  {
    icon: '⚡',
    title: 'One-Click Management',
    desc: 'Place assets instantly by left-clicking empty space with a tool selected. Remove any asset just as fast by left-clicking it directly.',
    color: '#f59e0b',
  },
  {
    icon: '⌨️',
    title: 'Pro Keyboard Shortcuts',
    desc: 'Speed up your planning with "Ctrl+Z" to undo, "Delete" to remove selected assets, and "Esc" to quickly cancel any active tool.',
    color: '#a78bfa',
  },
  {
    icon: '🏗️',
    title: 'Industrial Asset Scaling',
    desc: 'Plan with high-fidelity assets: 15m Trucks, 9m Heavy-Duty Boom Gates, and 8.5m Towering Signs for realistic visibility.',
    color: '#f43f5e',
  },
  {
    icon: '🚀',
    title: 'Generate & Export',
    desc: 'Watch the AI map calculate your assets in real-time, then download a fully formatted Traffic Management PDF to hand to authorities.',
    color: '#10b981',
  },
];

const OnboardingOverlay = ({ onDismiss }) => {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  // Trap focus inside the modal when it's open
  const cardRef = useRef(null);
  useEffect(() => {
    // Focus the card itself so screen readers announce the dialog
    cardRef.current?.focus();
  }, [step]);

  // Allow Escape to skip
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      <div
        className="onboarding-card"
        ref={cardRef}
        tabIndex={-1} // programmatically focusable
        style={{ outline: 'none' }}
      >
        {/* FIX #9: Progress dots were <div onClick> — not keyboard accessible.
            Now proper <button> elements with role="tab", aria-selected, tabIndex */}
        <div className="onboarding-dots" role="tablist" aria-label="Onboarding steps">
          {STEPS.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}: ${s.title}${i < step ? ' (completed)' : ''}`}
              tabIndex={i === step ? 0 : -1} // roving tabindex pattern
              className={`onboarding-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => setStep(i)}
              onKeyDown={(e) => {
                // Arrow keys navigate between dots
                if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
                if (e.key === 'ArrowLeft')  setStep((s) => Math.max(s - 1, 0));
              }}
            />
          ))}
        </div>

        {/* Icon */}
        <div
          className="onboarding-icon"
          aria-hidden="true"
          style={{ background: `${current.color}18`, border: `1px solid ${current.color}40` }}
        >
          <span style={{ fontSize: '2.4rem' }}>{current.icon}</span>
        </div>

        {/* Content */}
        <h2 className="onboarding-title" id="onboarding-title">{current.title}</h2>
        <p className="onboarding-desc" id="onboarding-desc">{current.desc}</p>

        {/* Step counter for screen readers */}
        <p className="sr-only" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>

        {/* Actions */}
        <div className="onboarding-actions">
          {step > 0 && (
            <button className="onboarding-btn-ghost" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          )}
          {!isLast ? (
            <button
              className="onboarding-btn-primary"
              style={{ background: current.color }}
              onClick={() => setStep((s) => s + 1)}
            >
              Next →
            </button>
          ) : (
            <button
              className="onboarding-btn-primary"
              style={{ background: '#10b981' }}
              onClick={onDismiss}
            >
              Start Drawing ⬠
            </button>
          )}
        </div>

        {/* Skip */}
        <button className="onboarding-skip" onClick={onDismiss}>
          Skip tutorial
        </button>
      </div>
    </div>
  );
};

export default OnboardingOverlay;