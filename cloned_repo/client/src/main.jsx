import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { AuthProvider } from './hooks/useMRAuth'
import './index.css'
import App from './App.jsx'

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

const isAuthEnabled = !!(domain && clientId);

const MainWrapper = () => {
  if (!isAuthEnabled) {
    return (
      <AuthProvider isAuthEnabled={false}>
        <App />
      </AuthProvider>
    );
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience
      }}
      cacheLocation="localstorage"
    >
      <AuthProvider isAuthEnabled={true}>
        <App />
      </AuthProvider>
    </Auth0Provider>
  );
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MainWrapper />
  </StrictMode>,
)
