import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { NotificationProvider } from './components/NotificationContext';
import { ThemeProvider } from './hooks/useTheme';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <NotificationProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </NotificationProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
