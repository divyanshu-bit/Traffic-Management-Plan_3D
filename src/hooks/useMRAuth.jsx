import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children, isAuthEnabled }) => {
  let auth0 = null;
  try {
    auth0 = isAuthEnabled ? useAuth0() : null;
  } catch (e) {
    console.error("Auth0 hook error:", e);
  }

  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Start with true to allow effect to run

  useEffect(() => {
    console.log("[AUTH] AuthProvider Effect: isAuthEnabled =", isAuthEnabled, "auth0.isLoading =", auth0?.isLoading);
    
    if (!isAuthEnabled) {
      console.log("[AUTH] Local mode active (Auth0 credentials missing)");
      setIsLoading(false);
    } else if (auth0 && !auth0.isLoading) {
      console.log("[AUTH] Auth0 loaded, authenticated =", auth0.isAuthenticated, "user =", auth0.user?.email);
      setIsAuthenticated(auth0.isAuthenticated);
      setUser(auth0.user);
      setIsLoading(false);
    } else if (!auth0 && isAuthEnabled) {
      console.error("[AUTH] Auth enabled but auth0 object is missing from hook");
      // This usually happens if Auth0Provider is not wrapping this component
    }

    // Safety timeout to prevent infinite white screen
    const timer = setTimeout(() => {
      setIsLoading(current => {
        if (current) {
          console.warn("Auth loading timed out, forcing continue...");
          return false;
        }
        return false;
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, [isAuthEnabled, auth0?.isAuthenticated, auth0?.user, auth0?.isLoading]);

  const login = (options) => {
    if (isAuthEnabled) {
      auth0.loginWithRedirect(options);
    } else {
      setUser({ name: 'Guest Operator', email: 'local-ops@margrakshak.ai', picture: null });
      setIsAuthenticated(true);
    }
  };
  const logout = () => isAuthEnabled ? auth0.logout({ returnTo: window.location.origin }) : setIsAuthenticated(false);

  const value = {
    isAuthenticated,
    user,
    isLoading,
    login,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useMRAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useMRAuth must be used within an AuthProvider');
  }
  return context;
};
