import { AuthProvider, useAuth } from './state/AuthProvider';
import { LibraryProvider } from './state/LibraryProvider';
import { PlayerProvider } from './state/PlayerProvider';
import { SettingsProvider } from './state/SettingsProvider';
import { AuthScreen } from './components/AuthScreen';
import { Shell } from './components/Shell';

function Gate() {
  const { user } = useAuth();
  if (!user) return <AuthScreen />;
  return (
    <LibraryProvider key={user.id}>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
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
