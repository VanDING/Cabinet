import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';
import { NotificationProvider } from './components/NotificationContext';
import { ThemeProvider } from './hooks/useTheme';
import { ProjectProvider } from './contexts/ProjectContext';
import { ChatProvider } from './contexts/ChatContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { EventBusProvider } from './contexts/EventBusContext';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 1000,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <NotificationProvider>
            <ToastProvider>
              <EventBusProvider>
                <ProjectProvider>
                  <ChatProvider>
                    <LayoutProvider>
                      <App />
                    </LayoutProvider>
                  </ChatProvider>
                </ProjectProvider>
              </EventBusProvider>
            </ToastProvider>
          </NotificationProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
