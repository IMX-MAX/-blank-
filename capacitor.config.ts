import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.blank.local',
  appName: '[blank] local',
  webDir: 'dist',
  backgroundColor: '#000000',
  plugins: {
    // Transparent bars over the edge-to-edge web view, light icons to start; the app updates them per screen.
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
