package app.blank.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LyricsFrameTest {
    private static int lit(int[] frame) {
        int count = 0;
        for (int value : frame) if (value > 0) count++;
        return count;
    }

    @Test
    public void laysCharactersOutWithAGapAndSkipsWhatTheFontLacks() {
        int[] one = LyricsFrame.layout("A", PixelFont::glyph);
        int[] two = LyricsFrame.layout("AA", PixelFont::glyph);
        assertEquals(one.length * 2 + 1, two.length);
        assertEquals(0, LyricsFrame.layout("", PixelFont::glyph).length);
        assertEquals(one.length, LyricsFrame.layout("A\u4e2d", PixelFont::glyph).length);
    }

    @Test
    public void aShortLineStaysCentredWhileItPlays() {
        int[] columns = LyricsFrame.layout("Hi", PixelFont::glyph);
        int[] start = LyricsFrame.render(columns, 0, 13);
        int[] end = LyricsFrame.render(columns, 1, 13);
        assertTrue(lit(start) > 0);
        assertTrue(java.util.Arrays.equals(start, end));
    }

    @Test
    public void aLongLineScrollsFromTheRightToTheLeft() {
        int[] columns = LyricsFrame.layout("Hello there, world", PixelFont::glyph);
        int[] start = LyricsFrame.render(columns, 0, 13);
        int[] middle = LyricsFrame.render(columns, 0.5, 13);
        int[] end = LyricsFrame.render(columns, 1, 13);
        assertTrue(lit(start) > 0 && lit(middle) > 0 && lit(end) > 0);
        assertTrue(!java.util.Arrays.equals(start, middle));
        assertTrue(!java.util.Arrays.equals(middle, end));
        boolean leftHalfAtStart = false;
        for (int y = 0; y < 13; y++) for (int x = 0; x < 5; x++) leftHalfAtStart |= start[y * 13 + x] > 0;
        assertTrue(!leftHalfAtStart);
    }

    @Test
    public void neverLightsAnLedOutsideTheCircle() {
        int[] columns = LyricsFrame.layout("MMMMMMMMMMMMMMMM", PixelFont::glyph);
        for (double p = 0; p <= 1; p += 0.1) {
            int[] frame = LyricsFrame.render(columns, p, 13);
            for (int y = 0; y < 13; y++) {
                for (int x = 0; x < 13; x++) {
                    if (!WaveformFrame.lit(x, y, 13)) assertEquals(0, frame[y * 13 + x]);
                }
            }
        }
    }

    @Test
    public void drawsTwiceAsBigOnTheLargerMatrix() {
        int[] columns = LyricsFrame.layout("I", PixelFont::glyph);
        assertTrue(lit(LyricsFrame.render(columns, 0, 25)) > lit(LyricsFrame.render(columns, 0, 13)) * 3);
    }

    @Test
    public void picksTheLineThatIsPlaying() {
        double[] starts = {1, 5, 9};
        double[] ends = {4, 0, 0};
        assertEquals(-1, LyricsFrame.lineAt(starts, ends, 0.5));
        assertEquals(0, LyricsFrame.lineAt(starts, ends, 2));
        assertEquals(-1, LyricsFrame.lineAt(starts, ends, 4.5));
        assertEquals(1, LyricsFrame.lineAt(starts, ends, 8.9));
        assertEquals(2, LyricsFrame.lineAt(starts, ends, 10));
        assertEquals(-1, LyricsFrame.lineAt(starts, ends, 14.1));
    }
}
