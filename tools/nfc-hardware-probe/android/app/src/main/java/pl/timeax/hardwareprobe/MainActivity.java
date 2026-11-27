package pl.timeax.hardwareprobe;

import android.app.Activity;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.IsoDep;
import android.nfc.tech.Ndef;
import android.nfc.tech.NfcA;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Arrays;

/** An on-device compatibility probe, not a shift terminal or a tag provisioner. */
public final class MainActivity extends Activity {
    private final HttpsObservation observation = new HttpsObservation();
    private NfcAdapter adapter;
    private TextView status;
    private Button presenceButton, ndefButton, stopButton;
    private boolean scanning;
    private long generation;
    private int observedCount;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        adapter = NfcAdapter.getDefaultAdapter(this);
        ScrollView scroll = new ScrollView(this);
        LinearLayout contents = new LinearLayout(this);
        contents.setOrientation(LinearLayout.VERTICAL);
        int spacing = Math.round(20 * getResources().getDisplayMetrics().density);
        contents.setPadding(spacing, spacing, spacing, spacing);
        TextView header = new TextView(this);
        header.setText(R.string.app_name);
        header.setTextSize(25);
        header.setAccessibilityHeading(true);
        contents.addView(header);

        TextView explanation = new TextView(this);
        explanation.setText(R.string.intro);
        explanation.setTextSize(16);
        contents.addView(explanation);
        presenceButton = button(R.string.presence_button, () -> start(false));
        ndefButton = button(R.string.ndef_button, () -> start(true));
        stopButton = button(R.string.stop_button, () -> stop(true));
        contents.addView(presenceButton);
        contents.addView(ndefButton);
        contents.addView(stopButton);

        status = new TextView(this);
        status.setTextSize(18);
        status.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setSaveEnabled(false);
        contents.addView(status);
        scroll.addView(contents);
        setContentView(scroll);
        showHardwareStatus();
    }

    private Button button(int label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    @Override
    public void onResume() {
        super.onResume();
        showHardwareStatus();
    }

    @Override
    public void onPause() {
        stop(false);
        super.onPause();
    }

    private boolean ready() {
        return adapter != null && adapter.isEnabled();
    }

    private void showHardwareStatus() {
        if (status != null) status.setText(adapter == null ? R.string.no_nfc : ready() ? R.string.ready : R.string.nfc_off);
        updateButtons();
    }

    private void updateButtons() {
        boolean canStart = ready() && !scanning;
        presenceButton.setEnabled(canStart);
        ndefButton.setEnabled(canStart);
        stopButton.setEnabled(scanning);
    }

    private void start(boolean readNdef) {
        if (!ready() || scanning) return;
        observation.reset();
        observedCount = 0;
        long run = ++generation;
        int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        if (!readNdef) flags |= NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
        try {
            adapter.enableReaderMode(this, tag -> observe(run, tag, readNdef), flags, null);
            scanning = true;
            status.setText(readNdef ? R.string.wait_ndef : R.string.wait_presence);
            updateButtons();
        } catch (IllegalStateException | UnsupportedOperationException | SecurityException e) {
            scanning = false;
            status.setText(R.string.reader_error);
            updateButtons();
        }
    }

    private void stop(boolean showStatus) {
        ++generation;
        boolean wasReading = scanning;
        scanning = false;
        observation.reset();
        observedCount = 0;
        if (wasReading) {
            try { adapter.disableReaderMode(this); }
            catch (IllegalStateException | UnsupportedOperationException | SecurityException ignored) { }
        }
        if (showStatus && status != null) status.setText(R.string.stopped);
        if (status != null) updateButtons();
    }

    private static String firstUri(Tag tag) {
        Ndef technology = Ndef.get(tag);
        if (technology == null) return null;
        NdefMessage message = technology.getCachedNdefMessage();
        if (message == null) return null;
        for (NdefRecord record : message.getRecords()) {
            if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(record.getType(), NdefRecord.RTD_URI)) {
                Uri uri = record.toUri();
                return uri == null ? null : uri.toString();
            }
        }
        return null;
    }

    private void observe(long run, Tag tag, boolean readNdef) {
        // No tag connection, APDU, explicit read command, write or network.
        boolean typeA = NfcA.get(tag) != null;
        boolean isoDep = IsoDep.get(tag) != null;
        String uri = readNdef ? firstUri(tag) : null;
        runOnUiThread(() -> {
            if (!scanning || run != generation) return;
            int message = R.string.ndef_not_requested;
            if (readNdef) {
                switch (observation.observe(uri)) {
                    case NO_HTTPS: message = R.string.no_https; break;
                    case FIRST: message = R.string.first_https; break;
                    case SAME: message = R.string.same_https; break;
                    case DIFFERENT: message = R.string.different_https; break;
                }
            }
            if (observedCount < 999) observedCount++;
            status.setText(getString(R.string.observation, observedCount,
                getString(typeA ? R.string.yes : R.string.no),
                getString(isoDep ? R.string.yes : R.string.no),
                getString(message)));
        });
    }
}
