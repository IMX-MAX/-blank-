package app.blank.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WidgetBarsTest {
    @Test
    public void missingPeaksGiveAFlatLowRow() {
        float[] bars = WidgetBars.resample(null, 10);
        assertEquals(10, bars.length);
        for (float bar : bars) assertEquals(0.2f, bar, 0f);
    }

    @Test
    public void everyBarTakesTheLoudestPeakOfItsShare() {
        float[] peaks = new float[100];
        peaks[3] = 0.9f;
        peaks[55] = 0.5f;
        float[] bars = WidgetBars.resample(peaks, 10);
        assertEquals(10, bars.length);
        assertEquals(0.9f, bars[0], 1e-6f);
        assertEquals(0.5f, bars[5], 1e-6f);
        assertTrue(bars[9] >= 0.08f);
    }

    @Test
    public void fewerPeaksThanBarsStillFillsEveryBar() {
        float[] bars = WidgetBars.resample(new float[] {1f, 0.5f}, 8);
        assertEquals(8, bars.length);
        assertEquals(1f, bars[0], 0f);
        assertEquals(0.5f, bars[7], 0f);
    }

    @Test
    public void playedBarsFollowThePositionAndStayInRange() {
        assertEquals(0, WidgetBars.playedBars(0, 0, 70));
        assertEquals(35, WidgetBars.playedBars(50_000, 100_000, 70));
        assertEquals(70, WidgetBars.playedBars(500_000, 100_000, 70));
        assertEquals(0, WidgetBars.playedBars(-5, 100_000, 70));
    }

    @Test
    public void clockReadsLikeThePlayerBar() {
        assertEquals("0:00", WidgetBars.clock(0));
        assertEquals("1:05", WidgetBars.clock(65_000));
        assertEquals("12:30", WidgetBars.clock(750_000));
    }
}
