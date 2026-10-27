package in.srisaidentalcare.billing;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Prints an HTML document (bill, prescription, receipt, exam form) through
 * Android's print service: any installed printer, or "Save as PDF".
 *
 * JavaScript: Capacitor.registerPlugin('HtmlPrinter').print({ html, name })
 * (called from android-app/src/native-bridge.js → window.ssdcNativePrint)
 */
@CapacitorPlugin(name = "HtmlPrinter")
public class HtmlPrinterPlugin extends Plugin {

    // Android requires the WebView to stay referenced until printing has started.
    private WebView printWebView;

    @PluginMethod
    public void print(final PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("name", "Sri Sai Speciality Dental Care");
        if (html == null || html.isEmpty()) {
            call.reject("Nothing to print");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = new WebView(getActivity());
                webView.getSettings().setJavaScriptEnabled(false);
                webView.setWebViewClient(new WebViewClient() {
                    private boolean started = false;

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (started) return;
                        started = true;
                        PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                        PrintAttributes attributes = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                        printManager.print(jobName, adapter, attributes);
                        call.resolve();
                    }
                });
                webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
                printWebView = webView;
            } catch (Exception e) {
                call.reject("Printing failed: " + e.getMessage(), e);
            }
        });
    }
}
