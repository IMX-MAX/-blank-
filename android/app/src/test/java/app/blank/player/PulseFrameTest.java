package app.blank.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PulseFrameTest {
    private static final int LENGTH = 13;
    private final BeatTrack beats = new BeatTrack(new float[] {1f, 2f}, new float[] {1f, 1f});

    private static int sum(int[] frame) {
        int total = 0;
        for (int value : frame) total += value;
        return total;
    }

    @Test
    public void aBeatLightsTheDiscAndItFadesAway() {
        int[] onBeat = PulseFrame.render(beats, 1.0, LENGTH);
        int[] later = PulseFrame.render(beats, 1.3, LENGTH);
        int[] quiet = PulseFrame.render(beats, 1.9, LENGTH);
        assertTrue(sum(onBeat) > sum(later));
        assertTrue(sum(later) > sum(quiet));
        assertEquals(PulseFrame.MAX, onBeat[6 * LENGTH + 6]);
    }

    @Test
    public void aRingRipplesOutwardFromTheMiddle() {
        int[] early = PulseFrame.render(beats, 1.06, LENGTH);
        int[] late = PulseFrame.render(beats, 1.3, LENGTH);
        int rowAt = 6 * LENGTH;
        assertTrue(early[rowAt + 6] > 0);
        assertTrue(late[rowAt + 11] > early[rowAt + 11] || late[rowAt + 11] > 0);
    }

    @Test
    public void staysInsideTheCircleAndKeepsAnIdleGlowBeforeTheFirstBeat() {
        int[] frame = PulseFrame.render(beats, 0.2, LENGTH);
        assertTrue(frame[6 * LENGTH + 6] > 0);
        assertEquals(0, frame[0]);
        assertEquals(0, PulseFrame.render(beats, 1.0, LENGTH)[LENGTH - 1]);
    }

    @Test
    public void worksOnTheLargerMatrixAndWithNoBeats() {
        assertEquals(25 * 25, PulseFrame.render(null, 0, 25).length);
        assertTrue(PulseFrame.render(beats, 1.0, 25)[12 * 25 + 12] > 0);
    }
}
