package chat.rogi.rogichat.core.media;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

/** Bounded static provider avatar. Animated input is represented by its first frame. */
public final class ProviderAvatarDecoder {
    private ProviderAvatarDecoder() {}

    public static Bitmap decode(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0
                || (long) bounds.outWidth * bounds.outHeight > 20_000_000) {
            throw new IllegalArgumentException("invalid_avatar_dimensions");
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 256);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IllegalArgumentException("invalid_avatar_image");
        return bitmap;
    }
}
