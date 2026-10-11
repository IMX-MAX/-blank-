package app.blank.player;

/** Beat times and strengths for one song, sorted by time. Pure Java so it can be exercised off-device. */
final class BeatTrack {
    private final float[] times;
    private final float[] strengths;

    BeatTrack(float[] times, float[] strengths) {
        int count = times == null ? 0 : times.length;
        this.times = count == 0 ? new float[0] : times;
        this.strengths = new float[count];
        for (int i = 0; i < count; i++) {
            float value = strengths != null && i < strengths.length ? strengths[i] : 1f;
            this.strengths[i] = Math.min(1f, Math.max(0f, value));
        }
    }

    int size() {
        return times.length;
    }

    double time(int index) {
        return times[index];
    }

    float strength(int index) {
        return strengths[index];
    }

    /** The last beat at or before the time, or -1 when none has happened yet. */
    int indexAt(double seconds) {
        int low = 0;
        int high = times.length - 1;
        int found = -1;
        while (low <= high) {
            int middle = (low + high) >>> 1;
            if (times[middle] <= seconds) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return found;
    }

    /** The first beat after the time that is at least minStrength strong, or -1 when there is none. */
    int nextAfter(double seconds, float minStrength) {
        for (int i = indexAt(seconds) + 1; i < times.length; i++) {
            if (strengths[i] >= minStrength) return i;
        }
        return -1;
    }
}
