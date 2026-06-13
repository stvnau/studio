import { useEffect, useState } from 'react';
import './screens.css';
import { api, type User } from './api.js';
import { AuthGate } from './auth.js';
import { Library } from './library.js';
import { Editor } from './editor/editor.js';
import { Icon } from './icons.js';

type Route = { view: 'library' } | { view: 'editor'; id: string };

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>({ view: 'library' });

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <Splash />;
  if (user === null) return <AuthGate onAuth={setUser} />;

  if (route.view === 'editor') {
    return <Editor id={route.id} onExit={() => setRoute({ view: 'library' })} />;
  }
  return (
    <Library
      user={user}
      onOpen={(id) => setRoute({ view: 'editor', id })}
      onSignOut={async () => {
        await api.logout().catch(() => {});
        setUser(null);
      }}
    />
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">
        <Icon name="logo" size={30} strokeWidth={1.2} />
      </div>
    </div>
  );
}
