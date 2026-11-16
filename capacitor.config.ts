import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.blank.local',
  appName: '[blank] local',
  webDir: 'dist',
  backgroundColor: '#000000',
  android: {
    allowMixedContent: false,
  },
};

export default config;
