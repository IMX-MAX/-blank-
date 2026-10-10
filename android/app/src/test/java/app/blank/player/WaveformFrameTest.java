package app.blank.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WaveformFrameTest {
    private static float[] ramp() {
        float[] peaks = new float[140];
        for (int i = 0; i < peaks.length; i++) peaks[i] = (i % 10) / 9f;
        return peaks;
    }

    @Test
    public void roundMatricesHaveTheRealLedCount() {
        assertEquals(137, litCount(13));
        assertEquals(489, litCount(25));
    }

    @Test
    public void neverLightsLedsOutsideTheCircle() {
        int[] frame = WaveformFrame.render(ramp(), 0.5, 13, true, true);
        for (int y = 0; y < 13; y++) {
            for (int x = 0; x < 13; x++) {
                if (!WaveformFrame.lit(x, y, 13)) assertEquals(0, frame[y * 13 + x]);
            }
        }
    }

    @Test
    public void playedColumnsAreBrighterThanUpcomingOnes() {
        int[] frame = WaveformFrame.render(ramp(), 0.5, 13, false, true);
        int centre = 6;
        assertEquals(WaveformFrame.MAX, frame[centre * 13 + 2]);
        assertTrue(frame[centre * 13 + 10] > 0);
        assertTrue(frame[centre * 13 + 10] < WaveformFrame.MAX);
    }

    @Test
    public void thePlayheadBlinksOnlyWhilePlaying() {
        int centre = 6;
        int playhead = 6;
        int on = WaveformFrame.render(ramp(), 0.5, 13, true, true)[centre * 13 + playhead];
        int off = WaveformFrame.render(ramp(), 0.5, 13, true, false)[centre * 13 + playhead];
        int paused = WaveformFrame.render(ramp(), 0.5, 13, false, false)[centre * 13 + playhead];
        assertTrue(off < on);
        assertEquals(on, paused);
    }

    @Test
    public void silenceStillDrawsACentreLine() {
        int[] frame = WaveformFrame.render(new float[] {0f, 0f, 0f}, 0, 13, false, true);
        assertTrue(frame[6 * 13 + 6] > 0);
    }

    @Test
    public void missingPeaksAndOutOfRangeProgressDoNotCrash() {
        WaveformFrame.render(null, 3.0, 13, true, true);
        WaveformFrame.render(new float[0], -1.0, 25, true, false);
    }

    private static int litCount(int length) {
        int count = 0;
        for (int y = 0; y < length; y++) for (int x = 0; x < length; x++) if (WaveformFrame.lit(x, y, length)) count++;
        return count;
    }
}
