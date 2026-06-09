import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import RealisticBackground from './RealisticBackground.jsx';
import './LoginScreen.css';

const LoginScreen = ({ onLogin }) => {
  const containerRef = useRef(null);
  const cardRef = useRef(null);
  const [isExiting, setIsExiting] = useState(false);

  useGSAP(() => {
    gsap.fromTo(cardRef.current, 
      { opacity: 0, y: 30, scale: 0.95 },
      { opacity: 1, y: 0, scale: 1, duration: 1, ease: "power3.out", delay: 0.2 }
    );
  }, { scope: containerRef });

  const handleLogin = (e) => {
    if (e) e.preventDefault();
    if (isExiting) return;
    setIsExiting(true);
    gsap.to(cardRef.current, { 
      opacity: 0, y: -20, scale: 0.95, duration: 0.6, ease: "power3.in",
      onComplete: onLogin 
    });
  };

  const handleGoogleLogin = () => {
    if (isExiting) return;
    setIsExiting(true);
    gsap.to(cardRef.current, { 
      opacity: 0, y: -20, scale: 0.95, duration: 0.6, ease: "power3.in",
      onComplete: () => onLogin({ connection: 'google-oauth2' }) 
    });
  };

  return (
    <div ref={containerRef} className="login-screen-v3">
      <RealisticBackground isExiting={isExiting} />
      <div className="ambient-orb" />
      
      <div ref={cardRef} className="neumorphic-card">
        <h1 className="neumorphic-title">Marg Rakshak</h1>
        <p className="neumorphic-subtitle">Sign in to your workspace</p>

        <form style={{ width: '100%' }} onSubmit={handleLogin}>
          <div className="input-group-v3">
            <label>Email Address</label>
            <input type="email" className="login-input-v3" placeholder="name@company.com" required />
          </div>
          <div className="input-group-v3">
            <label>Password</label>
            <input type="password" className="login-input-v3" placeholder="••••••••" required />
          </div>

          <button type="submit" className="btn-primary-v3">
            Sign In
          </button>
          
          <div className="divider-v3">or continue with</div>

          <button type="button" className="btn-secondary-v3" onClick={handleGoogleLogin}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.92 3.32-2.12 4.44-1.2 1.2-3.08 2.48-5.72 2.48-4.52 0-8.12-3.64-8.12-8.12s3.6-8.12 8.12-8.12c2.44 0 4.28.96 5.6 2.24l2.32-2.32C18.44 2.76 15.64 1.2 12 1.2 6.04 1.2 1.2 6.04 1.2 12s4.84 10.8 10.8 10.8c3.24 0 5.68-1.08 7.6-3.08 2-2 2.64-4.8 2.64-7.08 0-.48-.04-1-.12-1.48h-9.64z"/>
            </svg>
            Google
          </button>

          <div className="signup-text" style={{ textAlign: 'center' }}>
            Don't have an account? <span onClick={() => onLogin({ authorizationParams: { screen_hint: 'signup' } })}>Sign up</span>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;