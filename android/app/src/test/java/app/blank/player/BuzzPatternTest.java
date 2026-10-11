package app.blank.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BuzzPatternTest {
    @Test
    public void aBuzzSustainsAndEasesOff() {
        BuzzPattern pattern = BuzzPattern.build(1f, 500);
        assertTrue(pattern.total() >= BuzzPattern.MIN_MS);
        for (int i = 1; i < pattern.amplitudes.length; i++) {
            assertTrue(pattern.amplitudes[i] < pattern.amplitudes[i - 1]);
        }
        assertEquals(pattern.timings.length, pattern.amplitudes.length);
    }

    @Test
    public void staysShorterThanTheTimeToTheNextBeatAndNeverTooLong() {
        assertTrue(BuzzPattern.build(1f, 250).total() < 250);
        assertTrue(BuzzPattern.build(1f, 5000).total() <= BuzzPattern.MAX_MS);
        assertTrue(BuzzPattern.build(1f, -1).total() <= BuzzPattern.MAX_MS);
    }

    @Test
    public void strongerBeatsBuzzHarderAndLonger() {
        BuzzPattern soft = BuzzPattern.build(0.2f, 600);
        BuzzPattern hard = BuzzPattern.build(1f, 600);
        assertTrue(hard.amplitudes[0] > soft.amplitudes[0]);
        assertTrue(hard.total() > soft.total());
    }

    @Test
    public void everyStepIsValidForTheVibrator() {
        BuzzPattern pattern = BuzzPattern.build(0f, 100);
        for (int i = 0; i < pattern.timings.length; i++) {
            assertTrue(pattern.timings[i] > 0);
            assertTrue(pattern.amplitudes[i] >= 1 && pattern.amplitudes[i] <= 255);
        }
    }
}
