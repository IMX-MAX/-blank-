package app.blank.player;

/**
 * The shape of one buzz on a beat: a sustained "zzz" that starts hard and eases off, as long as the beat
 * allows without running into the next one. Pure Java so it can be exercised off-device.
 */
final class BuzzPattern {
    static final long MIN_MS = 120;
    static final long MAX_MS = 380;
    private static final float[] SHARE = {0.12f, 0.28f, 0.3f, 0.3f};
    private static final float[] LEVEL = {1f, 0.85f, 0.65f, 0.45f};

    final long[] timings;
    final int[] amplitudes;

    private BuzzPattern(long[] timings, int[] amplitudes) {
        this.timings = timings;
        this.amplitudes = amplitudes;
    }

    long total() {
        long sum = 0;
        for (long timing : timings) sum += timing;
        return sum;
    }

    /** gapMs is the time to the next buzz, or a negative number when there is none. */
    static BuzzPattern build(float strength, long gapMs) {
        float s = Math.min(1f, Math.max(0f, strength));
        long room = gapMs < 0 ? MAX_MS : Math.round(gapMs * 0.85);
        long length = Math.min(MAX_MS, Math.max(MIN_MS, room));
        length = Math.round(length * (0.7 + 0.3 * s));
        length = Math.max(MIN_MS * 7 / 10, length);
        float peak = 110 + 145 * s;
        long[] timings = new long[SHARE.length];
        int[] amplitudes = new int[SHARE.length];
        for (int i = 0; i < SHARE.length; i++) {
            timings[i] = Math.max(1, Math.round(length * SHARE[i]));
            amplitudes[i] = Math.max(1, Math.min(255, Math.round(peak * LEVEL[i])));
        }
        return new BuzzPattern(timings, amplitudes);
    }
}
