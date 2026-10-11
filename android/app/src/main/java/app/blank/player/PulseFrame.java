package app.blank.player;

/**
 * Flashes and pulses a round Glyph Matrix to the beat: each beat lights the whole disc, which fades quickly,
 * and sends a ring rippling out from the middle. Pure Java so it can be exercised off-device.
 */
final class PulseFrame {
    static final int MAX = WaveformFrame.MAX;
    static final double FLASH_SECONDS = 0.12;
    static final double RING_SECONDS = 0.45;
    private static final float RING_WIDTH = 0.2f;
    private static final float FLOOR = 0.4f;
    private static final int IDLE = MAX / 24;

    private PulseFrame() {}

    static int[] render(BeatTrack beats, double seconds, int length) {
        int[] frame = new int[length * length];
        if (length <= 0) return frame;
        float flash = 0f;
        float ringLevel = 0f;
        float ringAt = -1f;
        int index = beats == null ? -1 : beats.indexAt(seconds);
        if (index >= 0) {
            double age = seconds - beats.time(index);
            float strength = FLOOR + (1f - FLOOR) * beats.strength(index);
            flash = (float) (strength * Math.exp(-age / FLASH_SECONDS));
            if (age < RING_SECONDS) {
                ringAt = (float) (age / RING_SECONDS);
                ringLevel = strength * (1f - ringAt);
            }
        }
        float centre = (length - 1) / 2f;
        float radius = length / 2f;
        for (int y = 0; y < length; y++) {
            for (int x = 0; x < length; x++) {
                if (!WaveformFrame.lit(x, y, length)) continue;
                float distance = (float) Math.hypot(x - centre, y - centre) / radius;
                float level = flash * (1f - 0.5f * distance);
                if (ringAt >= 0f) {
                    float away = Math.abs(distance - ringAt);
                    if (away < RING_WIDTH) level = Math.max(level, ringLevel * (1f - away / RING_WIDTH));
                }
                int value = Math.round(Math.min(1f, level) * MAX);
                if (distance < 0.2f) value = Math.max(value, IDLE);
                frame[y * length + x] = value;
            }
        }
        return frame;
    }
}
