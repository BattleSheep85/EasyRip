// React Entry Point
import React from 'react';
import ReactDOM from 'react-dom/client';
import AppRouter from './Router.jsx';
import '../styles/app.css';

// Mount React app to #root
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
