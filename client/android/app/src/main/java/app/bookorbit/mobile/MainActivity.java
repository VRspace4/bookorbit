package app.bookorbit.mobile;

import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "BookOrbitNativeState";
    private static final String LAST_URL_KEY = "lastUrl";
    private static final String LAST_URL_SAVED_AT_KEY = "lastUrlSavedAt";
    private static final String STATE_URL_KEY = "bookorbitCurrentUrl";
    private static final long LAST_URL_MAX_AGE_MS = 1000L * 60L * 60L * 24L * 30L;

    private Bundle pendingSavedInstanceState;

    @Override
    public void onDestroy() {
        CookieManager.getInstance().flush();
        super.onDestroy();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        pendingSavedInstanceState = savedInstanceState;
        super.onCreate(savedInstanceState);
        pendingSavedInstanceState = null;
    }

    @Override
    protected void load() {
        String startupUrl = resolveStartupUrl();
        if (startupUrl != null) {
            CapConfig startupConfig = buildStartupConfig(startupUrl);
            if (startupConfig != null) {
                config = startupConfig;
            }
        }

        super.load();
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        persistWebViewState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onPause() {
        persistWebViewState(null);
        super.onPause();
    }

    @Override
    public void onStop() {
        persistWebViewState(null);
        super.onStop();
    }

    private void persistWebViewState(Bundle outState) {
        saveCurrentUrl(outState);
        CookieManager.getInstance().flush();
    }

    private String resolveStartupUrl() {
        String stateUrl = pendingSavedInstanceState != null ? pendingSavedInstanceState.getString(STATE_URL_KEY) : null;
        if (isRestorableUrl(stateUrl)) {
            return stateUrl;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        long savedAt = prefs.getLong(LAST_URL_SAVED_AT_KEY, 0L);
        if (savedAt <= 0L || System.currentTimeMillis() - savedAt > LAST_URL_MAX_AGE_MS) {
            clearSavedUrl(prefs);
            return null;
        }

        String savedUrl = prefs.getString(LAST_URL_KEY, null);
        if (isRestorableUrl(savedUrl)) {
            return savedUrl;
        }

        clearSavedUrl(prefs);
        return null;
    }

    private CapConfig buildStartupConfig(String startupUrl) {
        CapConfig baseConfig = CapConfig.loadDefault(this);
        Uri uri = Uri.parse(startupUrl);
        String startPath = getPathAndSuffix(uri);
        if (startPath == null || "/".equals(startPath)) {
            return null;
        }

        CapConfig.Builder builder = cloneConfig(baseConfig).setStartPath(startPath);
        String serverUrl = baseConfig.getServerUrl();
        if (serverUrl != null && !serverUrl.trim().isEmpty()) {
            Uri baseUri = Uri.parse(serverUrl);
            String baseOrigin = getOrigin(baseUri);
            String startupOrigin = getOrigin(uri);
            if (baseOrigin == null || startupOrigin == null || !baseOrigin.equals(startupOrigin)) {
                return null;
            }
            builder.setServerUrl(trimTrailingSlashes(serverUrl));
        } else {
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) {
                return null;
            }
            builder.setAndroidScheme(scheme);
            builder.setHostname(host);
        }

        return builder.create();
    }

    private CapConfig.Builder cloneConfig(CapConfig baseConfig) {
        CapConfig.Builder builder = new CapConfig.Builder(this)
            .setHTML5mode(baseConfig.isHTML5Mode())
            .setErrorPath(baseConfig.getErrorPath())
            .setHostname(baseConfig.getHostname())
            .setAndroidScheme(baseConfig.getAndroidScheme())
            .setAllowNavigation(baseConfig.getAllowNavigation())
            .setOverriddenUserAgentString(baseConfig.getOverriddenUserAgentString())
            .setAppendedUserAgentString(baseConfig.getAppendedUserAgentString())
            .setBackgroundColor(baseConfig.getBackgroundColor())
            .setAllowMixedContent(baseConfig.isMixedContentAllowed())
            .setCaptureInput(baseConfig.isInputCaptured())
            .setUseLegacyBridge(baseConfig.isUsingLegacyBridge())
            .setResolveServiceWorkerRequests(baseConfig.isResolveServiceWorkerRequests())
            .setWebContentsDebuggingEnabled(baseConfig.isWebContentsDebuggingEnabled())
            .setZoomableWebView(baseConfig.isZoomableWebView())
            .setLoggingEnabled(baseConfig.isLoggingEnabled())
            .setInitialFocus(baseConfig.isInitialFocus());

        String serverUrl = baseConfig.getServerUrl();
        if (serverUrl != null) {
            builder.setServerUrl(serverUrl);
        }

        JSONObject plugins = baseConfig.getObject("plugins");
        if (plugins != null) {
            builder.setPluginsConfiguration(plugins);
        }

        return builder;
    }

    private void saveCurrentUrl(Bundle outState) {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        String currentUrl = bridge.getWebView().getUrl();
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (!isRestorableUrl(currentUrl)) {
            clearSavedUrl(prefs);
            return;
        }

        if (outState != null) {
            outState.putString(STATE_URL_KEY, currentUrl);
        }

        prefs.edit().putString(LAST_URL_KEY, currentUrl).putLong(LAST_URL_SAVED_AT_KEY, System.currentTimeMillis()).apply();
    }

    private void clearSavedUrl(SharedPreferences prefs) {
        prefs.edit().remove(LAST_URL_KEY).remove(LAST_URL_SAVED_AT_KEY).apply();
    }

    private boolean isRestorableUrl(String value) {
        if (value == null || value.trim().isEmpty()) {
            return false;
        }

        Uri uri = Uri.parse(value);
        String path = uri.getPath();
        if (path == null || path.equals("/") || !path.startsWith("/") || path.startsWith("//")) {
            return false;
        }

        return (
            !path.startsWith("/login") &&
            !path.startsWith("/setup") &&
            !path.startsWith("/forgot-password") &&
            !path.startsWith("/reset-password") &&
            !path.startsWith("/oauth2-callback") &&
            !path.startsWith("/magic")
        );
    }

    private String getPathAndSuffix(Uri uri) {
        String path = uri.getEncodedPath();
        if (path == null || path.isEmpty()) {
            path = "/";
        }

        StringBuilder builder = new StringBuilder(path);
        String query = uri.getEncodedQuery();
        if (query != null && !query.isEmpty()) {
            builder.append("?").append(query);
        }

        String fragment = uri.getEncodedFragment();
        if (fragment != null && !fragment.isEmpty()) {
            builder.append("#").append(fragment);
        }

        return builder.toString();
    }

    private String getOrigin(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) {
            return null;
        }

        int port = uri.getPort();
        return scheme + "://" + host + (port >= 0 ? ":" + port : "");
    }

    private String trimTrailingSlashes(String value) {
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }
}
