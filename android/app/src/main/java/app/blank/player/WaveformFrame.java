package app.blank.player;

/**
 * Draws a scrolling slice of the playback waveform for a round Glyph Matrix: bars centred on the middle row,
 * bright for what has played and dim for what is left, with the playhead in the middle column blinking while playing.
 * Pure Java so it can be exercised off-device.
 */
final class WaveformFrame {
    /** The matrix takes 12-bit brightness per LED. */
    static final int MAX = 4095;
    private static final int PLAYED = MAX;
    private static final int UPCOMING = MAX / 7;
    private static final int PLAYHEAD_DIM = MAX / 3;

    private WaveformFrame() {}

    static boolean lit(int x, int y, int length) {
        float centre = (length - 1) / 2f;
        float radius = length / 2f;
        float dx = x - centre;
        float dy = y - centre;
        return dx * dx + dy * dy <= radius * radius;
    }

    /**
     * A window of the waveform that slides under a fixed playhead in the middle column: what has played
     * is to the left, what is coming is to the right. One column is one waveform bar, and the bars on
     * either side of the playhead are blended so the window glides between bars instead of jumping.
     */
    static int[] render(float[] peaks, double progress, int length, boolean playing, boolean blinkOn) {
        int[] frame = new int[length * length];
        if (length <= 0) return frame;
        float[] bars = peaks == null || peaks.length == 0 ? new float[] {0.5f} : peaks;
        double position = Math.min(1d, Math.max(0d, progress)) * bars.length;
        int centre = (length - 1) / 2;
        for (int column = 0; column < length; column++) {
            double at = position + (column - centre);
            boolean playhead = column == centre;
            float peak = sample(bars, at);
            if (peak < 0f) {
                if (!playhead) continue;
                peak = 0f;
            }
            int half = Math.round((0.15f + 0.85f * peak) * centre);
            int level;
            if (column < centre) level = PLAYED;
            else if (playhead) level = playing && !blinkOn ? PLAYHEAD_DIM : PLAYED;
            else level = UPCOMING;
            for (int row = centre - half; row <= centre + half; row++) {
                if (row < 0 || row >= length || !lit(column, row, length)) continue;
                frame[row * length + column] = level;
            }
        }
        return frame;
    }

    /** The bar height at a point on the song, measured in bars. Negative outside the song. */
    static float sample(float[] bars, double at) {
        if (at < 0 || at >= bars.length) return -1f;
        double shifted = at - 0.5;
        int low = (int) Math.floor(shifted);
        double blend = shifted - low;
        float a = bars[Math.max(0, Math.min(bars.length - 1, low))];
        float b = bars[Math.max(0, Math.min(bars.length - 1, low + 1))];
        return clamp((float) (a + (b - a) * blend));
    }

    private static float clamp(float value) {
        return Math.min(1f, Math.max(0f, value));
    }
}
