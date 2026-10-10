import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.blank.player',
  appName: '[blank]',
  webDir: 'dist',
  backgroundColor: '#151515',
  android: {
    allowMixedContent: false,
  },
};

export default config;
