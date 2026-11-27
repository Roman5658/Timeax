import java.util.List;
import javax.smartcardio.CardException;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.TerminalFactory;

/** Only enumerates terminals and reads PC/SC presence status; never connects to a card. */
final class PcscReaderProbe {
    record Status(String state, int readers, int cardsPresent, int readerErrors, int exitCode) {
        String asJson() {
            return "{\"state\":\"" + state + "\",\"readers\":" + readers
                + ",\"cardsPresent\":" + cardsPresent + ",\"readerErrors\":" + readerErrors + "}";
        }
    }

    static Status summarize(int readers, int present, int errors) {
        if (readers < 0 || present < 0 || errors < 0 || present + errors > readers) {
            return new Status("pcsc-unavailable", 0, 0, 0, 3);
        }
        if (readers == 0) return new Status("no-reader", 0, 0, 0, 2);
        if (errors > 0) return new Status("partial-reader-status", readers, present, errors, 4);
        return new Status("reader-ready", readers, present, 0, 0);
    }

    static Status detect() {
        try {
            TerminalFactory factory = TerminalFactory.getInstance("PC/SC", null);
            List<CardTerminal> terminals = factory.terminals().list();
            int present = 0;
            int errors = 0;
            for (CardTerminal terminal : terminals) {
                try {
                    if (terminal.isCardPresent()) present++;
                } catch (CardException e) {
                    errors++;
                }
            }
            return summarize(terminals.size(), present, errors);
        } catch (Exception | LinkageError e) {
            // An inaccessible PC/SC service is not evidence of missing hardware.
            return new Status("pcsc-unavailable", 0, 0, 0, 3);
        }
    }

    public static void main(String[] args) {
        if (args.length != 0) {
            System.err.println("Usage: java PcscReaderProbe.java");
            System.exit(64);
        }
        Status status = detect();
        System.out.println(status.asJson());
        System.exit(status.exitCode());
    }
}
