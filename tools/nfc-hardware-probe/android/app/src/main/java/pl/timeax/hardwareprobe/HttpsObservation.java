package pl.timeax.hardwareprobe;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Holds only the previous URI digest in memory. Does not open, log or return a tag URL. */
final class HttpsObservation {
    enum Result { NO_HTTPS, FIRST, SAME, DIFFERENT }

    private byte[] previous;
    private static final int MAX_URI_CHARS = 2048;

    Result observe(String uri) {
        if (uri == null || uri.length() > MAX_URI_CHARS || uri.isEmpty()) return Result.NO_HTTPS;
        try {
            URI value = URI.create(uri);
            if (!"https".equalsIgnoreCase(value.getScheme()) || value.getHost() == null ||
                value.getRawUserInfo() != null) return Result.NO_HTTPS;
        } catch (IllegalArgumentException e) {
            return Result.NO_HTTPS;
        }
        byte[] current = digest(uri);
        byte[] old = previous;
        previous = current;
        return old == null ? Result.FIRST : MessageDigest.isEqual(old, current) ? Result.SAME : Result.DIFFERENT;
    }

    void reset() {
        previous = null;
    }

    private static byte[] digest(String uri) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(uri.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Required local hash algorithm missing", e);
        }
    }
}
