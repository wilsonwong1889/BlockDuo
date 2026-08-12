import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setMuted } from './audio/sfx';
import { loadMuted } from './storage';
import './styles/app.css';

setMuted(loadMuted());

// The board handles its own pointer input; Safari's pinch-zoom gesture would
// otherwise fire mid-drag. Not in the DOM typings — it is a WebKit-only event.
document.addEventListener('gesturestart' as keyof DocumentEventMap, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
