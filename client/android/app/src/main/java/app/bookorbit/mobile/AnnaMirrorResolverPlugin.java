package app.bookorbit.mobile;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import org.json.JSONArray;

@CapacitorPlugin(name = "AnnaMirrorResolver")
public class AnnaMirrorResolverPlugin extends Plugin {

    @PluginMethod
    public void resolve(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://annas-archive.")) {
            call.reject("Invalid Anna's Archive URL");
            return;
        }

        Intent intent = new Intent(getContext(), AnnaMirrorResolverActivity.class);
        intent.putExtra(AnnaMirrorResolverActivity.EXTRA_URL, url);
        startActivityForResult(call, intent, "resolveResult");
    }

    @ActivityCallback
    private void resolveResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Anna's Archive browser verification was cancelled");
            return;
        }

        ArrayList<String> mirrors = result.getData().getStringArrayListExtra(AnnaMirrorResolverActivity.EXTRA_MIRRORS);
        JSObject response = new JSObject();
        response.put("mirrors", new JSONArray(mirrors == null ? new ArrayList<>() : mirrors));
        call.resolve(response);
    }
}
