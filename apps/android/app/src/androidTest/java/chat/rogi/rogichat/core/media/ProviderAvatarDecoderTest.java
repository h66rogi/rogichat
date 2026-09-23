package chat.rogi.rogichat.core.media;

import android.graphics.Bitmap;
import android.graphics.Color;
import java.nio.charset.StandardCharsets;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Synthetic image bytes stay in the isolated test target. */
@RunWith(AndroidJUnit4.class)
public final class ProviderAvatarDecoderTest {
    private byte[] gif(String version) {
        byte[] body = new byte[]{1,0,1,0,(byte)128,0,0, (byte)255,0,0, 0,(byte)255,0,
            44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,
            44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59};
        byte[] bytes = new byte[6 + body.length];
        System.arraycopy(("GIF" + version).getBytes(StandardCharsets.US_ASCII),0,bytes,0,6);
        System.arraycopy(body,0,bytes,6,body.length); return bytes;
    }
    @Test public void testGif87And89UseFirstStaticFrame() {
        for (String version : new String[]{"87a", "89a"}) {
            Bitmap bitmap = ProviderAvatarDecoder.decode(gif(version));
            try { assertEquals(1,bitmap.getWidth()); assertEquals(1,bitmap.getHeight());
                assertEquals(Color.RED,bitmap.getPixel(0,0)); } finally { bitmap.recycle(); }
        }
    }
    @Test public void testMalformedAndOversizedPixelsRejected() {
        reject("not an image".getBytes(StandardCharsets.US_ASCII));
        for (String version : new String[]{"87a", "89a"}) {
            byte[] bytes = gif(version);
            for (int offset : new int[]{6,8,24,26}) { bytes[offset]=(byte)136; bytes[offset+1]=19; }
            reject(bytes);
        }
    }
    private void reject(byte[] bytes) {
        try { Bitmap unexpected=ProviderAvatarDecoder.decode(bytes); unexpected.recycle(); fail("invalid image admitted"); }
        catch (IllegalArgumentException expected) { }
    }
}
