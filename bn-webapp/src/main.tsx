import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { stashLinkCode } from './auth/link-code';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';

/*
 * Before anything renders, because signing in is a redirect to Auth0 and back and the URL
 * fragment does not survive it. Arriving from the extension is exactly the case that also
 * needs to sign in, so the code has to be put somewhere safe first.
 */
stashLinkCode(window, window.sessionStorage);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Router outside the provider: AuthProvider navigates on the Auth0 redirect back. */}
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

