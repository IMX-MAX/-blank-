import { AuthProvider, useAuth } from './state/AuthProvider';
import { LibraryProvider } from './state/LibraryProvider';
import { PlayerProvider } from './state/PlayerProvider';
import { AuthScreen } from './components/AuthScreen';
import { Shell } from './components/Shell';

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="boot">
        <h1>[blank]</h1>
      </div>
    );
  }
  if (!user) return <AuthScreen />;
  return (
    <LibraryProvider key={user.$id}>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </LibraryProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
