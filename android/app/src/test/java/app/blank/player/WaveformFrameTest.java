package app.blank.player;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WaveformFrameTest {
    private static final int N = 13;
    private static final int CENTRE = 6;

    private static float[] ramp() {
        float[] peaks = new float[140];
        for (int i = 0; i < peaks.length; i++) peaks[i] = (i % 10) / 9f;
        return peaks;
    }

    private static int at(int[] frame, int column, int row) {
        return frame[row * N + column];
    }

    private static boolean columnLit(int[] frame, int column) {
        for (int row = 0; row < N; row++) if (at(frame, column, row) > 0) return true;
        return false;
    }

    @Test
    public void roundMatricesHaveTheRealLedCount() {
        assertEquals(137, litCount(13));
        assertEquals(489, litCount(25));
    }

    @Test
    public void neverLightsLedsOutsideTheCircle() {
        int[] frame = WaveformFrame.render(ramp(), 0.5, N, true, true);
        for (int y = 0; y < N; y++) {
            for (int x = 0; x < N; x++) {
                if (!WaveformFrame.lit(x, y, N)) assertEquals(0, frame[y * N + x]);
            }
        }
    }

    @Test
    public void thePlayheadIsInTheMiddleAndThePastIsBrighterThanTheFuture() {
        int[] frame = WaveformFrame.render(ramp(), 0.5, N, false, true);
        assertEquals(WaveformFrame.MAX, at(frame, 2, CENTRE));
        assertEquals(WaveformFrame.MAX, at(frame, CENTRE, CENTRE));
        int future = at(frame, 10, CENTRE);
        assertTrue(future > 0);
        assertTrue(future < WaveformFrame.MAX);
    }

    @Test
    public void theWindowSlidesAsTheSongPlays() {
        float[] peaks = new float[140];
        java.util.Arrays.fill(peaks, 0.2f);
        peaks[45] = 0.6f;
        int[] early = WaveformFrame.render(peaks, 42.5 / 140, N, false, true);
        int[] later = WaveformFrame.render(peaks, 45.5 / 140, N, false, true);
        assertEquals(9, tallestColumn(early));
        assertEquals(CENTRE, tallestColumn(later));
    }

    private static int tallestColumn(int[] frame) {
        int best = -1;
        int most = -1;
        for (int column = 0; column < N; column++) {
            int count = 0;
            for (int row = 0; row < N; row++) if (at(frame, column, row) > 0) count++;
            if (count > most) {
                most = count;
                best = column;
            }
        }
        return best;
    }

    @Test
    public void thePlayheadBlinksOnlyWhilePlaying() {
        int on = at(WaveformFrame.render(ramp(), 0.5, N, true, true), CENTRE, CENTRE);
        int off = at(WaveformFrame.render(ramp(), 0.5, N, true, false), CENTRE, CENTRE);
        int paused = at(WaveformFrame.render(ramp(), 0.5, N, false, false), CENTRE, CENTRE);
        assertTrue(off < on);
        assertEquals(on, paused);
    }

    @Test
    public void thePastIsEmptyAtTheStartAndTheFutureIsEmptyAtTheEnd() {
        int[] start = WaveformFrame.render(ramp(), 0, N, true, true);
        assertFalse(columnLit(start, 0));
        assertTrue(columnLit(start, CENTRE));
        assertTrue(columnLit(start, N - 1));
        int[] end = WaveformFrame.render(ramp(), 1, N, true, true);
        assertTrue(columnLit(end, 0));
        assertTrue(columnLit(end, CENTRE));
        assertFalse(columnLit(end, N - 1));
    }

    @Test
    public void loudSongsStillSwingFromAThinLineToFullHeight() {
        float[] peaks = new float[140];
        for (int i = 0; i < peaks.length; i++) peaks[i] = i % 2 == 0 ? 0.62f : 0.9f;
        int[] frame = WaveformFrame.render(peaks, 70.5 / 140, N, false, true);
        int shortest = N;
        int tallest = 0;
        for (int column = 3; column <= 9; column++) {
            int count = 0;
            for (int row = 0; row < N; row++) if (at(frame, column, row) > 0) count++;
            shortest = Math.min(shortest, count);
            tallest = Math.max(tallest, count);
        }
        assertTrue(shortest <= 3);
        assertTrue(tallest >= 11);
    }

    @Test
    public void silenceStillDrawsACentreLine() {
        int[] frame = WaveformFrame.render(new float[] {0f, 0f, 0f}, 0.5, N, false, true);
        assertTrue(at(frame, CENTRE, CENTRE) > 0);
    }

    @Test
    public void sameInputsGiveTheSameFrame() {
        assertArrayEquals(WaveformFrame.render(ramp(), 0.4, N, true, true), WaveformFrame.render(ramp(), 0.4, N, true, true));
    }

    @Test
    public void missingPeaksAndOutOfRangeProgressDoNotCrash() {
        WaveformFrame.render(null, 3.0, N, true, true);
        WaveformFrame.render(new float[0], -1.0, 25, true, false);
    }

    private static int litCount(int length) {
        int count = 0;
        for (int y = 0; y < length; y++) for (int x = 0; x < length; x++) if (WaveformFrame.lit(x, y, length)) count++;
        return count;
    }
}
