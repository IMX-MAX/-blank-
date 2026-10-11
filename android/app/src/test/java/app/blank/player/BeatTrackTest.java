package app.blank.player;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class BeatTrackTest {
    private final BeatTrack track = new BeatTrack(new float[] {1f, 2f, 3f, 4f}, new float[] {0.9f, 0.1f, 0.5f, 2f});

    @Test
    public void findsTheLastBeatAtOrBeforeATime() {
        assertEquals(-1, track.indexAt(0.5));
        assertEquals(0, track.indexAt(1.0));
        assertEquals(0, track.indexAt(1.99));
        assertEquals(2, track.indexAt(3.5));
        assertEquals(3, track.indexAt(99));
    }

    @Test
    public void skipsBeatsThatAreTooWeakWhenLookingAhead() {
        assertEquals(0, track.nextAfter(0, 0.2f));
        assertEquals(2, track.nextAfter(1.0, 0.2f));
        assertEquals(1, track.nextAfter(1.0, 0f));
        assertEquals(-1, track.nextAfter(4.0, 0f));
    }

    @Test
    public void clampsStrengthsAndFillsInMissingOnes() {
        assertEquals(1f, track.strength(3), 0f);
        BeatTrack bare = new BeatTrack(new float[] {1f, 2f}, null);
        assertEquals(1f, bare.strength(1), 0f);
        assertEquals(0, new BeatTrack(null, null).size());
        assertEquals(-1, new BeatTrack(null, null).indexAt(5));
    }
}
