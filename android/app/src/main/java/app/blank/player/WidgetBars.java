package app.blank.player;

/** Turns a song's waveform peaks into the fixed number of bars the home screen widget draws. */
final class WidgetBars {
    private WidgetBars() {}

    /** Each bar takes the loudest peak of its share of the song, so short spikes still show. Never fully flat. */
    static float[] resample(float[] peaks, int bars) {
        float[] out = new float[bars];
        if (peaks == null || peaks.length == 0) {
            for (int i = 0; i < bars; i++) out[i] = 0.2f;
            return out;
        }
        for (int i = 0; i < bars; i++) {
            int from = (int) ((long) i * peaks.length / bars);
            int to = Math.max(from + 1, (int) ((long) (i + 1) * peaks.length / bars));
            float max = 0f;
            for (int j = from; j < Math.min(to, peaks.length); j++) max = Math.max(max, peaks[j]);
            out[i] = Math.min(1f, Math.max(0.08f, max));
        }
        return out;
    }

    /** How many of the bars are already played at this point of the song. */
    static int playedBars(long positionMs, long durationMs, int bars) {
        if (durationMs <= 0) return 0;
        double fraction = Math.min(1.0, Math.max(0.0, (double) positionMs / durationMs));
        return (int) Math.round(fraction * bars);
    }

    static String clock(long ms) {
        long total = Math.max(0, ms) / 1000;
        return (total / 60) + ":" + (total % 60 < 10 ? "0" : "") + (total % 60);
    }
}
