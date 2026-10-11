package app.blank.player;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;

import java.util.HashMap;
import java.util.Map;

/** Draws characters the pixel font lacks (CJK, Arabic, emoji) with the system font, thresholded to 1 bit. */
final class GlyphRaster implements LyricsFrame.Source {
    private static final int MAX_WIDTH = 8;
    private final Paint paint = new Paint();
    private final Map<Integer, int[]> cache = new HashMap<>();

    GlyphRaster() {
        paint.setAntiAlias(false);
        paint.setTypeface(Typeface.DEFAULT);
        paint.setTextSize(8f);
        paint.setColor(0xFFFFFFFF);
    }

    @Override
    public int[] glyph(int codePoint) {
        int[] pixel = PixelFont.glyph(codePoint);
        if (pixel != null) return pixel;
        int[] cached = cache.get(codePoint);
        if (cached != null) return cached.length == 0 ? null : cached;
        int[] drawn = draw(codePoint);
        cache.put(codePoint, drawn);
        return drawn.length == 0 ? null : drawn;
    }

    private int[] draw(int codePoint) {
        try {
            String text = new String(Character.toChars(codePoint));
            int width = Math.min(MAX_WIDTH, Math.max(1, (int) Math.ceil(paint.measureText(text))));
            Bitmap bitmap = Bitmap.createBitmap(width, PixelFont.HEIGHT, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint.FontMetrics metrics = paint.getFontMetrics();
            float baseline = (PixelFont.HEIGHT - (metrics.descent - metrics.ascent)) / 2f - metrics.ascent;
            canvas.drawText(text, 0, baseline, paint);
            int[] columns = new int[width];
            int used = 0;
            for (int x = 0; x < width; x++) {
                for (int y = 0; y < PixelFont.HEIGHT; y++) {
                    if ((bitmap.getPixel(x, y) >>> 24) >= 128) columns[x] |= 1 << y;
                }
                if (columns[x] != 0) used = x + 1;
            }
            bitmap.recycle();
            return used == 0 ? new int[0] : java.util.Arrays.copyOf(columns, used);
        } catch (Throwable failed) {
            return new int[0];
        }
    }
}
