import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={window.location.origin + '/tonconnect-manifest.json'}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);
