final class PcscReaderProbeTest {
    public static void main(String[] args) {
        check(PcscReaderProbe.summarize(0, 0, 0), "no-reader", "{\"state\":\"no-reader\",\"readers\":0,\"cardsPresent\":0,\"readerErrors\":0}");
        check(PcscReaderProbe.summarize(2, 1, 0), "reader-ready", "{\"state\":\"reader-ready\",\"readers\":2,\"cardsPresent\":1,\"readerErrors\":0}");
        check(PcscReaderProbe.summarize(2, 1, 1), "partial-reader-status", "{\"state\":\"partial-reader-status\",\"readers\":2,\"cardsPresent\":1,\"readerErrors\":1}");
        check(PcscReaderProbe.summarize(0, 1, 0), "pcsc-unavailable", "{\"state\":\"pcsc-unavailable\",\"readers\":0,\"cardsPresent\":0,\"readerErrors\":0}");
        System.out.println("PC/SC report fixtures passed");
    }

    private static void check(PcscReaderProbe.Status status, String state, String json) {
        if (!state.equals(status.state()) || !json.equals(status.asJson())) {
            throw new AssertionError("Unexpected reader report");
        }
    }
}
