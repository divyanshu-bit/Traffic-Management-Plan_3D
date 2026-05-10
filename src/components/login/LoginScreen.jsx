import React, { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { splitText } from '../../utils/splitText.jsx';
import RealisticBackground from './RealisticBackground.jsx';
import MagneticButton from './MagneticButton.jsx';
import './LoginScreen.css';

const LoginScreen = ({ onLogin }) => {
  const containerRef = useRef(null);
  const cardRef = useRef(null);
  const titleRef = useRef(null);
  const subtitleRef = useRef(null);
  const cursorRef = useRef(null);
  
  const [isExiting, setIsExiting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Custom Cursor Logic
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    
    // Set initial centering via GSAP to avoid CSS transform conflicts
    gsap.set(cursor, { xPercent: -50, yPercent: -50 });

    const xTo = gsap.quickTo(cursor, "x", { duration: 0.3, ease: "power3" });
    const yTo = gsap.quickTo(cursor, "y", { duration: 0.3, ease: "power3" });

    const handleMouseMove = (e) => {
      xTo(e.clientX);
      yTo(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // MASTER ENTRANCE (Title & Trigger Button)
  useGSAP(() => {
    const tl = gsap.timeline();
    
    // Reset initial states to be sure
    gsap.set(".char", { y: 100, opacity: 0 });
    gsap.set(subtitleRef.current, { opacity: 0, y: 20 });
    gsap.set(".initial-trigger-btn", { opacity: 0, scale: 0.8, y: 50 });

    tl.to(".char", { 
      y: 0, 
      opacity: 1, 
      stagger: 0.05, 
      duration: 1, 
      ease: "power4.out" 
    });

    tl.to(subtitleRef.current, { 
      opacity: 0.8, 
      y: 0, 
      duration: 0.8, 
      ease: "power3.out" 
    }, "-=0.5");

    tl.to(".initial-trigger-btn", { 
      opacity: 1, 
      scale: 1, 
      y: 0, 
      duration: 1, 
      ease: "back.out(1.7)" 
    }, "-=0.3");
  }, { scope: containerRef });

  // MODAL ENTRANCE (When showModal becomes true)
  useGSAP(() => {
    if (showModal && cardRef.current) {
      const tl = gsap.timeline();
      
      tl.fromTo(cardRef.current, 
        { opacity: 0, scale: 0.9, y: 50 },
        { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power4.out" }
      );
      
      tl.fromTo(".login-form-v2 > *", 
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, stagger: 0.1, duration: 0.6, ease: "power3.out" },
        "-=0.4"
      );
    }
  }, [showModal]);

  const handleTriggerClick = () => {
    // Fade out the trigger button first
    gsap.to(".initial-trigger-btn", {
      opacity: 0,
      scale: 0.8,
      y: 20,
      duration: 0.3,
      onComplete: () => setShowModal(true)
    });
  };

  const handleLoginClick = (e) => {
    if (e) e.preventDefault();
    setIsExiting(true);

    const tl = gsap.timeline({ 
      onComplete: () => onLogin() 
    });

    tl.to(cardRef.current, { 
      scale: 0.8, 
      opacity: 0, 
      y: 40,
      duration: 0.5, 
      ease: "power4.in" 
    });

    tl.to(".char", { 
      y: -100, 
      opacity: 0, 
      stagger: 0.02, 
      duration: 0.5, 
      ease: "power4.in" 
    }, "-=0.4");

    tl.to(containerRef.current, { 
      backgroundColor: "#0ea5e9", 
      duration: 0.4 
    }, "-=0.2");
  };

  const handleSignupClick = () => {
    // Force Auth0 to show the Sign Up screen instead of Log In
    onLogin({ authorizationParams: { screen_hint: 'signup' } });
  };

  const handleGoogleLogin = () => {
    onLogin({ connection: 'google-oauth2' });
  };


  return (
    <div ref={containerRef} className="login-screen-v2">
      <div ref={cursorRef} className="custom-cursor" />
      <RealisticBackground isExiting={isExiting} />

      <div className="login-header" style={{ position: 'relative', zIndex: 10, textAlign: 'center' }}>
        <div className="title-wrapper" style={{ overflow: 'hidden', marginBottom: 10 }}>
          <h1 ref={titleRef} className="main-title-v2">{splitText("MARG RAKSHAK")}</h1>
        </div>
        <p ref={subtitleRef} className="subtitle-v2">Precision Traffic Engineering & Disaster Response</p>
      </div>

      <div className="interaction-area" style={{ position: 'relative', zIndex: 50, width: '100%', display: 'flex', justifyContent: 'center', paddingBottom: '10vh' }}>
        {!showModal ? (
          <div className="trigger-container">
            <MagneticButton 
              className="initial-trigger-btn technical-btn-v2" 
              onClick={handleTriggerClick}
              strength={60}
              style={{ width: '280px', opacity: 0 }} /* Start invisible for GSAP */
            >
              INITIALIZE SYSTEM
            </MagneticButton>
          </div>
        ) : (
          <div ref={cardRef} className="login-card-v2" style={{ opacity: 0 }}> {/* Start invisible for GSAP */}
            <div className="card-scanner-v2" />
            <div className="terminal-status">
              <span className="status-dot pulsed" />
              <span className="status-text">SECURE TERMINAL READY</span>
            </div>
            <form className="login-form-v2" onSubmit={handleLoginClick}>
              <div className="input-group-v2">
                <label>OPERATOR IDENTITY</label>
                <input type="text" className="login-input-v2" placeholder="ENTER USER ID" required />
              </div>
              <MagneticButton className="technical-btn-v2" strength={50}>
                CONFIRM IDENTITY
              </MagneticButton>
              <div className="auth-divider-v2">
                <div className="divider-line" />
                <span>OR CONNECT VIA</span>
                <div className="divider-line" />
              </div>
              <button type="button" className="google-btn-v2" onClick={handleGoogleLogin}>
                <svg className="google-icon" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5.04c1.94 0 3.51.68 4.79 1.84l3.52-3.52C18.11 1.5 15.31 0 12 0 7.33 0 3.26 2.69 1.2 6.64l4.1 3.19C6.26 7.15 8.91 5.04 12 5.04z" /><path fill="#4285F4" d="M23.64 12.2c0-.77-.07-1.52-.2-2.24H12v4.25h6.52c-.28 1.51-1.09 2.78-2.35 3.64l3.66 2.85c2.14-1.97 3.81-4.87 3.81-8.5z" /><path fill="#FBBC05" d="M5.3 14.51c-.24-.71-.38-1.47-.38-2.26s.14-1.55.38-2.26L1.2 6.64C.43 8.24 0 10.06 0 12s.43 3.76 1.2 5.36l4.1-3.21z" /><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.66-2.85c-1.1.74-2.5 1.18-4.29 1.18-3.09 0-5.71-2.09-6.65-4.91L1.2 17.64C3.26 21.31 7.33 24 12 24z" /></svg>
                Sign in with Google
              </button>

              <div className="signup-prompt" style={{ marginTop: '15px', fontSize: '0.75rem', color: '#64748b' }}>
                New operator? <span onClick={handleSignupClick} style={{ color: '#0ea5e9', cursor: 'pointer', fontWeight: 'bold' }}>Create Account</span>
              </div>

              <div className="technical-footer-v2">
                <div className="footer-item"><span className="label">ENCRYPTION</span><span className="value">AES-256</span></div>
                <div className="footer-item"><span className="label">GRID</span><span className="value">SAT-NAV-04</span></div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginScreen;
