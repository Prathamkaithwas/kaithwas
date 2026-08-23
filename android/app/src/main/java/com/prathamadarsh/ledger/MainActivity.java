package com.prathamadarsh.ledger;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Keeps the app clear of the status bar and the navigation bar.
 *
 * This is done here, natively, by giving the WebView margins equal to the
 * window insets and consuming them. The web layer is then simply never told
 * about system bars: it fills the space it is given and cannot overlap them
 * in either gesture or 3-button navigation.
 *
 * Two earlier attempts pushed the insets into CSS variables instead, and both
 * failed for timing reasons:
 *
 *  1. Pushing from onApplyWindowInsets alone. Insets are dispatched during
 *     activity startup, before the WebView has finished loading, so the
 *     injected inline styles were on a document that was about to be replaced.
 *  2. Adding a @JavascriptInterface for the web layer to pull from. That
 *     cannot work on first launch either: BridgeActivity.onCreate() starts
 *     loading the page before this method body runs, and Android only exposes
 *     an interface added with addJavascriptInterface on the *next* page load.
 *     So window.LedgerBars was undefined exactly when it was needed.
 *
 * The result of both was a bottom inset of zero. Under gesture navigation the
 * bar is a thin transparent pill, so this was easy to miss. Under 3-button
 * navigation it is a tall opaque bar, and it sat directly on top of the app's
 * own bottom navigation — covering it and swallowing every tap.
 *
 * Margins have no such failure mode: they are applied by the layout, before
 * anything is drawn, regardless of what the web layer is doing.
 */
public class MainActivity extends BridgeActivity {

    /** Matches --bg in index.css, so the inset strips are not a bright gap. */
    private static final int DARK_BG = Color.parseColor("#0d0f12");
    private static final int LIGHT_BG = Color.parseColor("#f2f3f5");

    /**
     * Files handed in through Android's Share sheet (see the SEND/SEND_MULTIPLE
     * intent-filters in AndroidManifest.xml), waiting to be read by the web
     * layer via ShareBridge below. A field rather than something scoped to one
     * method call because the two paths that can populate it — a cold start
     * reading getIntent() in onCreate, and a warm start's onNewIntent() —
     * both need to land in the same place the JS side polls.
     *
     * Populated on a background thread (reading a shared file can mean
     * megabytes through base64) and drained from whatever thread the WebView
     * calls a @JavascriptInterface method on — synchronizedList plus a
     * synchronized block around the read-and-clear in ShareBridge is what
     * keeps those two from racing each other.
     */
    private final List<JSONObject> pendingShares = Collections.synchronizedList(new ArrayList<>());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new SystemBars(), "LedgerBars");
        webView.addJavascriptInterface(new ShareBridge(), "LedgerShare");
        handleShareIntent(getIntent());

        // Stop the WebView second-guessing our colours.
        //
        // With the phone in dark mode, Android applies "algorithmic
        // darkening" to web content — it inspects each element and inverts
        // what it judges to be light. This app already ships its own dark
        // theme, so that pass runs on top of colours that are correct, and it
        // gets them wrong: an input with a transparent background is read as
        // a light surface, so its text is forced dark, and typing into the
        // note editor produced black text on a near-black sheet. The text was
        // being saved correctly the whole time — it simply could not be seen.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.getSettings(), false);
        }

        // The strips behind the system bars show the window background, so it
        // has to match the app. Dark is the app's default; setDark() corrects
        // it if the user is in the light theme.
        applyTheme(true);

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            ViewGroup.MarginLayoutParams lp =
                (ViewGroup.MarginLayoutParams) view.getLayoutParams();

            // System bars only. The keyboard is deliberately NOT handled here.
            //
            // This margin used to be max(bars.bottom, ime.bottom), so opening
            // the keyboard physically resized the WebView. That is what turned
            // the screen black: resizing a WebView's bounds while the keyboard
            // is animating in is a long-standing Android compositor bug, where
            // the newly laid-out region never gets painted. The symptom matches
            // exactly — the header and type pills, already composited before
            // the keyboard appeared, survived; everything that needed a repaint
            // after the resize came back black, including the Save bar. Typing
            // kept working the whole time because the DOM was fine and only the
            // painting had failed.
            //
            // The keyboard is now entirely the web layer's problem, and nothing
            // native changes size while it opens:
            //
            //   1. index.html asks for `interactive-widget=resizes-content`, so
            //      Chrome shrinks its own layout viewport for the keyboard. The
            //      page relayouts into the smaller area by itself — no native
            //      view is resized, so there is nothing to fail to repaint.
            //   2. watchKeyboard() in lib/insets.ts measures the keyboard from
            //      visualViewport and publishes it as --kbh, which scrollers pad
            //      by. That is the fallback for any WebView that ignores (1).
            //
            // The two compose safely rather than double-counting: if (1) takes
            // effect, window.innerHeight shrinks along with visualViewport, so
            // the measurement in (2) comes out at zero on its own.
            int top = bars.top;
            int left = bars.left;
            int right = bars.right;
            int bottom = bars.bottom;

            // Only touch layout params when something actually moved.
            // setLayoutParams() requests a layout pass, a layout pass
            // re-dispatches insets, and re-dispatching insets brought us back
            // here — a loop that thrashed all the way through the keyboard's
            // slide-in animation.
            if (lp.topMargin != top
                || lp.leftMargin != left
                || lp.rightMargin != right
                || lp.bottomMargin != bottom) {
                lp.topMargin = top;
                lp.leftMargin = left;
                lp.rightMargin = right;
                lp.bottomMargin = bottom;
                view.setLayoutParams(lp);
            }

            // Consumed: nothing below this needs to inset itself again.
            return WindowInsetsCompat.CONSUMED;
        });

        // Startup can otherwise go a frame before the listener above runs.
        ViewCompat.requestApplyInsets(webView);
    }

    /**
     * android:launchMode="singleTask" means a share arriving while the app is
     * already running does not create a second instance and does not restart
     * this one — it is delivered here instead, to the same activity, with
     * onCreate never running again. Without this override that share would
     * bring the app to the foreground and then silently do nothing with the
     * file, which is a worse failure than a crash: nothing on screen would
     * say it went wrong.
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    /**
     * Reads whatever ACTION_SEND / ACTION_SEND_MULTIPLE handed in and queues
     * it for ShareBridge. Deliberately does none of the app's own
     * image-downscaling here — lib/photo.ts's fileToAttachment already does
     * that, correctly, from a real File. Reconstructing a File/Blob from this
     * raw base64 on the JS side and running it through that same existing
     * function was simpler and safer than teaching this native code the
     * app's own storage-size rules a second time and risking the two drifting
     * apart later.
     */
    private void handleShareIntent(final Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();

        final List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = getStreamExtra(intent);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = getStreamExtraList(intent);
            if (list != null) uris.addAll(list);
        } else {
            return;
        }
        if (uris.isEmpty()) return;

        // Off the UI thread: a multi-megabyte photo shared straight into a
        // cold start would otherwise jank the very first frame the user sees,
        // and ContentResolver I/O has no business on the main thread anyway.
        new Thread(() -> {
            for (Uri uri : uris) {
                try {
                    JSONObject obj = readUriAsJson(uri);
                    if (obj != null) pendingShares.add(obj);
                } catch (Exception e) {
                    // One unreadable share (a revoked content:// grant, a
                    // provider that misbehaves) should not lose the rest of
                    // a multi-select.
                }
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private Uri getStreamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private ArrayList<Uri> getStreamExtraList(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /** One shared file's bytes, mime type and display name, as a JSON object
     *  ready to hand to JS. Null if the provider gave back no stream at all. */
    private JSONObject readUriAsJson(Uri uri) throws Exception {
        ContentResolver resolver = getContentResolver();

        String mime = resolver.getType(uri);
        if (mime == null) mime = "application/octet-stream";

        // DISPLAY_NAME is what the sending app called the file — "IMG_2024.jpg",
        // a scanned "Aadhar.pdf" — a far better starting title than making one
        // up, though the Documents editor still lets it be typed over.
        String name = "shared-file";
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String n = cursor.getString(idx);
                    if (n != null && !n.isEmpty()) name = n;
                }
            }
        }

        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            byte[] chunk = new byte[16 * 1024];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
        }

        JSONObject obj = new JSONObject();
        obj.put("name", name);
        obj.put("mime", mime);
        obj.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
        return obj;
    }

    private void applyTheme(final boolean dark) {
        getWindow().setBackgroundDrawable(new ColorDrawable(dark ? DARK_BG : LIGHT_BG));
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    public class SystemBars {
        /**
         * Keeps the system-bar icons and the strips behind them matched to the
         * app's theme. Only cosmetic, which matters because this interface is
         * unavailable on the very first page load — see the note above.
         */
        @JavascriptInterface
        public void setDark(final boolean dark) {
            runOnUiThread(() -> applyTheme(dark));
        }
    }

    public class ShareBridge {
        /**
         * Pulled by the web layer on startup, and again a few times shortly
         * after — see lib/shareIntent.ts. The read in handleShareIntent()
         * happens on a background thread, so on a cold start the very first
         * call here can land before that thread has finished; polling a
         * couple more times a moment later is what catches it rather than
         * this method blocking the JS thread until the read completes.
         *
         * Returns null once nothing is left, and clears what it does return —
         * a share is handed to JS exactly once no matter how many times this
         * gets polled.
         */
        @JavascriptInterface
        public String consumePendingShare() {
            synchronized (pendingShares) {
                if (pendingShares.isEmpty()) return null;
                JSONArray arr = new JSONArray(pendingShares);
                pendingShares.clear();
                return arr.toString();
            }
        }
    }
}
