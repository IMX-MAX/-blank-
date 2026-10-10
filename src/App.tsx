import { AuthProvider, useAuth } from './state/AuthProvider';
import { LibraryProvider } from './state/LibraryProvider';
import { OfflineProvider } from './state/OfflineProvider';
import { PlayerProvider } from './state/PlayerProvider';
import { SettingsProvider } from './state/SettingsProvider';
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
    <LibraryProvider key={user.id}>
      <OfflineProvider>
        <PlayerProvider>
          <Shell />
        </PlayerProvider>
      </OfflineProvider>
    </LibraryProvider>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SettingsProvider>
  );
}
