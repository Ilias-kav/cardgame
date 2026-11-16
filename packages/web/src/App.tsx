import { useEffect, useRef, useState } from 'react';
import { CatalogProvider } from './catalog.js';
import { GameProvider, useGame } from './gameContext.js';
import { AuthPage } from './pages/AuthPage.js';
import { DeckEditorPage } from './pages/DeckEditorPage.js';
import { DecksPage } from './pages/DecksPage.js';
import { GamePage } from './pages/GamePage.js';
import { LobbyPage } from './pages/LobbyPage.js';
import { navigate, paths, useRoute } from './router.js';
import { SessionProvider, useSession } from './session.js';
import { sound } from './sound.js';
import { ToastProvider } from './toasts.js';

function Layout() {
  const route = useRoute();
  const { user, logout } = useSession();
  const { state } = useGame();

  // When a game starts (someone joined ours, or a rematch began) go to it.
  const seenStarts = useRef(state.startedCount);
  useEffect(() => {
    if (state.startedCount !== seenStarts.current) {
      seenStarts.current = state.startedCount;
      navigate(paths.game);
    }
  }, [state.startedCount]);

  const [muted, setMuted] = useState(sound.muted);
  const toggleMute = () => {
    sound.setMuted(!muted);
    setMuted(!muted);
  };

  const inGame = state.gameId !== null && state.over === null;
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      {label}
    </a>
  );

  return (
    <>
      <header className="nav">
        <strong className="brand">Card Game</strong>
        <nav>
          {link(paths.lobby, 'Lobby', route.name === 'lobby')}
          {link(paths.decks, 'Decks', route.name === 'decks' || route.name === 'deck')}
          {(inGame || route.name === 'game') && link(paths.game, inGame ? 'Game ●' : 'Game', route.name === 'game')}
        </nav>
        <span className="spacer" />
        <button type="button" className="icon-button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Sound is off' : 'Sound is on'} title={muted ? 'Turn sound on' : 'Turn sound off'} data-testid="mute">
          {muted ? '🔇' : '🔊'}
        </button>
        <span className={`dot dot-${state.connection}`} title={`Connection: ${state.connection}`} />
        <span className="muted" data-testid="username">{user?.username}</span>
        <button type="button" onClick={() => void logout()} data-testid="logout">
          Log out
        </button>
      </header>
      {route.name === 'lobby' && <LobbyPage />}
      {route.name === 'decks' && <DecksPage />}
      {route.name === 'deck' && <DeckEditorPage key={route.id} id={route.id} />}
      {route.name === 'game' && <GamePage />}
      {route.name === 'notfound' && (
        <main className="page center">
          <p>Page not found.</p>
          <a href={paths.lobby}>Back to the lobby</a>
        </main>
      )}
    </>
  );
}

function Shell() {
  const { user, loading } = useSession();
  if (loading) return <p className="center muted">Loading…</p>;
  if (!user) return <AuthPage />;
  return (
    <CatalogProvider>
      <GameProvider>
        <Layout />
      </GameProvider>
    </CatalogProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </ToastProvider>
  );
}
