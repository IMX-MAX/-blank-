package app.blank.player;

/**
 * Draws the playback waveform bar for a round Glyph Matrix: one bar per column, centred on the middle row,
 * bright for what has played and dim for what is left, with the column at the playhead blinking while playing.
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

    static int[] render(float[] peaks, double progress, int length, boolean playing, boolean blinkOn) {
        int[] frame = new int[length * length];
        if (length <= 0) return frame;
        double clamped = Math.min(1d, Math.max(0d, progress));
        int playhead = Math.min(length - 1, (int) Math.floor(clamped * length));
        int centre = (length - 1) / 2;
        for (int column = 0; column < length; column++) {
            float peak = columnPeak(peaks, column, length);
            int half = Math.round((0.15f + 0.85f * peak) * centre);
            int level;
            if (column < playhead) level = PLAYED;
            else if (column == playhead) level = playing && !blinkOn ? PLAYHEAD_DIM : PLAYED;
            else level = UPCOMING;
            for (int row = centre - half; row <= centre + half; row++) {
                if (row < 0 || row >= length || !lit(column, row, length)) continue;
                frame[row * length + column] = level;
            }
        }
        return frame;
    }

    static float columnPeak(float[] peaks, int column, int columns) {
        if (peaks == null || peaks.length == 0) return 0.5f;
        int from = (int) Math.floor((double) column * peaks.length / columns);
        int to = Math.max(from + 1, (int) Math.floor((double) (column + 1) * peaks.length / columns));
        float peak = 0f;
        for (int i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, peaks[i]);
        return Math.min(1f, Math.max(0f, peak));
    }
}
