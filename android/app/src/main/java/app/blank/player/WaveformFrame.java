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
    private static final float CONTRAST = 1.6f;
    private static final float MIN_SPAN = 0.2f;

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
        float[] range = range(bars);
        for (int column = 0; column < length; column++) {
            double at = position + (column - centre);
            boolean playhead = column == centre;
            float peak = sample(bars, at);
            if (peak < 0f) {
                if (!playhead) continue;
                peak = 0f;
            }
            int half = Math.round(exaggerate(peak, range) * centre);
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

    /**
     * Songs are mastered loud, so most bars sit in a narrow band near the top. Stretching the quiet and loud
     * ends of this song to the full height, then bending the curve, makes the highs and lows obvious on 13 LEDs.
     */
    static float exaggerate(float peak, float[] range) {
        float unit = Math.min(1f, Math.max(0f, (peak - range[0]) / (range[1] - range[0])));
        return (float) Math.pow(unit, CONTRAST);
    }

    /** The quiet and loud ends of the song (10th and 95th percentile), never closer than MIN_SPAN. */
    static float[] range(float[] bars) {
        float[] sorted = bars.clone();
        java.util.Arrays.sort(sorted);
        float low = sorted[(int) Math.floor((sorted.length - 1) * 0.10)];
        float high = sorted[(int) Math.floor((sorted.length - 1) * 0.95)];
        if (high - low < MIN_SPAN) {
            float middle = (high + low) / 2f;
            low = middle - MIN_SPAN / 2f;
            high = middle + MIN_SPAN / 2f;
        }
        return new float[] {low, high};
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
