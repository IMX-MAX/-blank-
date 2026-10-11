package app.blank.player;

/**
 * Draws one line of lyrics in the 5x7 pixel font across a round Glyph Matrix, scrolling the line past the
 * window as it plays. Pure Java so it can be exercised off-device.
 */
final class LyricsFrame {
    interface Source {
        /** Column bitmasks (top row in the lowest bit) for the character, or null when it has none. */
        int[] glyph(int codePoint);
    }

    private LyricsFrame() {}

    /** The line as columns of seven bits, with a blank column between characters. */
    static int[] layout(String text, Source source) {
        if (text == null || text.isEmpty()) return new int[0];
        int[] columns = new int[text.length() * 6];
        int used = 0;
        for (int at = 0; at < text.length(); ) {
            int codePoint = text.codePointAt(at);
            at += Character.charCount(codePoint);
            int[] glyph = Character.isWhitespace(codePoint) ? new int[3] : source.glyph(codePoint);
            if (glyph == null || glyph.length == 0) continue;
            if (used + glyph.length + 1 > columns.length) columns = java.util.Arrays.copyOf(columns, columns.length * 2);
            System.arraycopy(glyph, 0, columns, used, glyph.length);
            used += glyph.length + 1;
        }
        return java.util.Arrays.copyOf(columns, Math.max(0, used - 1));
    }

    static int scale(int length) {
        return length >= 20 ? 2 : 1;
    }

    /** A line that fits in the window stays centred. A longer one runs from the right edge to the left as progress goes 0 to 1. */
    static int[] render(int[] columns, double progress, int length) {
        int[] frame = new int[length * length];
        if (columns == null || columns.length == 0 || length <= 0) return frame;
        int scale = scale(length);
        int width = columns.length * scale;
        int left;
        if (width <= length - 2) {
            left = (length - width) / 2;
        } else {
            double p = Math.min(1d, Math.max(0d, progress));
            double from = length - length / 4d;
            double to = length / 4d - width;
            left = (int) Math.round(from + (to - from) * p);
        }
        int top = (length - PixelFont.HEIGHT * scale) / 2;
        for (int column = 0; column < columns.length; column++) {
            for (int row = 0; row < PixelFont.HEIGHT; row++) {
                if ((columns[column] >> row & 1) == 0) continue;
                for (int dx = 0; dx < scale; dx++) {
                    for (int dy = 0; dy < scale; dy++) {
                        int x = left + column * scale + dx;
                        int y = top + row * scale + dy;
                        if (x < 0 || y < 0 || x >= length || y >= length || !WaveformFrame.lit(x, y, length)) continue;
                        frame[y * length + x] = WaveformFrame.MAX;
                    }
                }
            }
        }
        return frame;
    }

    /** The line playing at the time, or -1 between lines. A line with no end runs until the next one starts. */
    static int lineAt(double[] starts, double[] ends, double seconds) {
        int found = -1;
        for (int i = 0; i < starts.length; i++) {
            if (starts[i] > seconds) break;
            found = i;
        }
        if (found < 0) return -1;
        return seconds < endOf(starts, ends, found) ? found : -1;
    }

    static double endOf(double[] starts, double[] ends, int index) {
        if (ends[index] > starts[index]) return ends[index];
        return index + 1 < starts.length ? starts[index + 1] : starts[index] + 5;
    }
}
