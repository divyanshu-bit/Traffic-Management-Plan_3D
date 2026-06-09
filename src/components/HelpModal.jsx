// src/components/HelpModal.jsx
import React, { useEffect } from 'react';
import { 
  MousePointer2, 
  Keyboard, 
  Scaling, 
  X, 
  Move3d, 
  Undo2, 
  Trash2, 
  CornerUpLeft 
} from 'lucide-react';

const HelpModal = ({ onClose }) => {
  // Close on Escape
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div className="help-modal-card" onClick={e => e.stopPropagation()}>
        <button className="help-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        <header className="help-header">
          <div className="help-header-icon">?</div>
          <div>
            <h2>Shortcut & Feature Guide</h2>
            <p>Master the Marg Rakshak platform</p>
          </div>
        </header>

        <div className="help-content">
          {/* Mouse & Interaction */}
          <section className="help-section">
            <div className="help-section-title">
              <MousePointer2 size={18} />
              <h3>Mouse & Interaction</h3>
            </div>
            <div className="help-grid">
              <div className="help-item">
                <span className="help-key">Left Click</span>
                <span className="help-val">Place Asset (with tool)</span>
              </div>
              <div className="help-item">
                <span className="help-key">Left Click</span>
                <span className="help-val">Remove Asset (on asset)</span>
              </div>
              <div className="help-item">
                <span className="help-key">Right Click + Drag</span>
                <span className="help-val">Tilt / Rotate 3D Map</span>
              </div>
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section className="help-section">
            <div className="help-section-title">
              <Keyboard size={18} />
              <h3>Keyboard Shortcuts</h3>
            </div>
            <div className="help-grid">
              <div className="help-item">
                <span className="help-key">Ctrl + Z</span>
                <span className="help-val">Undo Last Action</span>
              </div>
              <div className="help-item">
                <span className="help-key">Delete / Backspace</span>
                <span className="help-val">Remove Selected Asset</span>
              </div>
              <div className="help-item">
                <span className="help-key">Escape</span>
                <span className="help-val">Cancel Tool / Deselect</span>
              </div>
            </div>
          </section>

          {/* Asset Scaling Legend */}
          <section className="help-section">
            <div className="help-section-title">
              <Scaling size={18} />
              <h3>Industrial Asset Scales</h3>
            </div>
            <div className="help-asset-legend">
              <div className="legend-item">
                <div className="legend-bar" style={{ width: '100%', background: '#3b82f6' }}>Truck: 15.0m</div>
              </div>
              <div className="legend-item">
                <div className="legend-bar" style={{ width: '60%', background: '#eab308' }}>Boom Gate: 9.0m</div>
              </div>
              <div className="legend-item">
                <div className="legend-bar" style={{ width: '56%', background: '#ffffff', color: '#000' }}>Road Sign: 8.5m</div>
              </div>
              <div className="legend-item">
                <div className="legend-bar" style={{ width: '20%', background: '#f97316' }}>Barrier: 3.0m</div>
              </div>
            </div>
            <p className="help-note">* All assets use realistic visibility scaling for accurate site planning.</p>
          </section>
        </div>

        <div className="help-footer">
          <button className="onboarding-btn-primary" onClick={onClose} style={{ background: '#334155' }}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
