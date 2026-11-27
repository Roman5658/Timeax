package pl.timeax.hardwareprobe;

final class HttpsObservationTest {
    public static void main(String[] args) {
        HttpsObservation probe = new HttpsObservation();
        expect(probe.observe(null), HttpsObservation.Result.NO_HTTPS);
        expect(probe.observe("http://fixture.example.test/nfc"), HttpsObservation.Result.NO_HTTPS);
        expect(probe.observe("https:opaque"), HttpsObservation.Result.NO_HTTPS);
        expect(probe.observe("https://someone@fixture.example.test"), HttpsObservation.Result.NO_HTTPS);
        expect(probe.observe("https://fixture.example.test/"+"x".repeat(4096)), HttpsObservation.Result.NO_HTTPS);
        expect(probe.observe("https://fixture.example.test/nfc?read=1"), HttpsObservation.Result.FIRST);
        expect(probe.observe("https://fixture.example.test/nfc?read=1"), HttpsObservation.Result.SAME);
        expect(probe.observe("https://fixture.example.test/nfc?read=2"), HttpsObservation.Result.DIFFERENT);
        probe.reset();
        expect(probe.observe("https://fixture.example.test/nfc?read=2"), HttpsObservation.Result.FIRST);
        System.out.println("NDEF HTTPS classification fixtures passed");
    }
    private static void expect(HttpsObservation.Result actual, HttpsObservation.Result wanted) {
        if (actual != wanted) throw new AssertionError("Unexpected local observation classification");
    }
}
