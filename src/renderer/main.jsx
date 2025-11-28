// React Entry Point
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '../styles/app.css';

// Mount React app to #root
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
