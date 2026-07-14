package app.bookorbit.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.util.ArrayList;
import org.json.JSONArray;

public class AnnaMirrorResolverActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_MIRRORS = "mirrors";
    private static final int MIRROR_POLL_INTERVAL_MS = 1000;
    private static final int MAX_MIRROR_POLL_ATTEMPTS = 60;
    private static final String MIRROR_EXTRACTION_SCRIPT =
        "(function(){"
            + "var links=[];"
            + "if(location.href.indexOf('/slow_download/')!==-1){"
            + "var primary=document.querySelector('p.mb-4.text-xl.font-bold a[href]');"
            + "if(primary){links.push(primary.href);}"
            + "}"
            + "document.querySelectorAll('ul>li>a[href]').forEach(function(a){links.push(a.href);});"
            + "return Array.from(new Set(links)).filter(function(url){return /^https?:\\/\\//i.test(url);});"
            + "})()";

    private WebView webView;
    private ProgressBar progressBar;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int pollGeneration = 0;
    private boolean resolved = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || !url.startsWith("https://annas-archive.")) {
            setResult(Activity.RESULT_CANCELED);
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Complete Anna's Archive browser check");
        title.setTextColor(Color.rgb(20, 20, 20));
        title.setTextSize(15);
        title.setPadding(36, 28, 36, 18);
        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 6));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(root);
        webView.loadUrl(url);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.destroy();
        }
        CookieManager.getInstance().flush();
        super.onDestroy();
    }

    private void configureWebView(WebView view) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(view, true);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
        );

        view.setWebViewClient(
            new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    progressBar.setVisibility(ProgressBar.GONE);
                    startMirrorPolling(view);
                }

                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    pollGeneration++;
                    progressBar.setVisibility(ProgressBar.VISIBLE);
                }
            }
        );
    }

    private void startMirrorPolling(WebView view) {
        int generation = ++pollGeneration;
        pollForMirrors(view, generation, 0);
    }

    private void pollForMirrors(WebView view, int generation, int attempt) {
        if (resolved || isFinishing() || generation != pollGeneration) {
            return;
        }

        view.evaluateJavascript(
            MIRROR_EXTRACTION_SCRIPT,
            rawJson -> {
                if (resolved || isFinishing() || generation != pollGeneration) {
                    return;
                }
                if (finishIfMirrorsFound(rawJson)) {
                    return;
                }
                if (attempt >= MAX_MIRROR_POLL_ATTEMPTS) {
                    return;
                }
                handler.postDelayed(() -> pollForMirrors(view, generation, attempt + 1), MIRROR_POLL_INTERVAL_MS);
            }
        );
    }

    private boolean finishIfMirrorsFound(String rawJson) {
        ArrayList<String> mirrors = new ArrayList<>();
        try {
            JSONArray values = new JSONArray(rawJson == null ? "[]" : rawJson);
            for (int i = 0; i < values.length(); i++) {
                String value = values.optString(i, "");
                if (value.startsWith("http://") || value.startsWith("https://")) {
                    mirrors.add(value);
                }
            }
        } catch (Exception ignored) {
            mirrors.clear();
        }

        if (mirrors.isEmpty()) {
            return false;
        }

        resolved = true;
        handler.removeCallbacksAndMessages(null);
        Intent result = new Intent();
        result.putStringArrayListExtra(EXTRA_MIRRORS, mirrors);
        setResult(Activity.RESULT_OK, result);
        finish();
        return true;
    }
}
