import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setMuted, unlockAudio } from './audio/sfx';
import { initNative, isNative } from './native';
import { ProgressProvider } from './progress/ProgressContext';
import { loadMuted } from './storage';
import './styles/app.css';

setMuted(loadMuted());
void initNative();

// Direct invite links skip the Home and Duo lobby buttons. Listen for any real
// user activation so their WebSocket-driven sounds can play too. Keeping these
// listeners installed also lets a context suspended while backgrounded resume
// on the first interaction after returning.
window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// Classic mode works with no connection once the app has been opened once.
// Skipped inside the native shell, which is already serving from local files.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration is best-effort; the game runs fine online without it.
    });
  });
}

// The board handles its own pointer input; Safari's pinch-zoom gesture would
// otherwise fire mid-drag. Not in the DOM typings — it is a WebKit-only event.
document.addEventListener('gesturestart' as keyof DocumentEventMap, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProgressProvider>
      <App />
    </ProgressProvider>
  </StrictMode>,
);
