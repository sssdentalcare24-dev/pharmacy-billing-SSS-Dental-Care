package in.srisaidentalcare.billing;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App's own plugins must be registered before super.onCreate()
        registerPlugin(HtmlPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
