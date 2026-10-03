package com.avaapp.mylibrary;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The library, held inside the app: its pages are served from the APK's own
 * assets, so it works with no signal and keeps everything on the phone.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/library/index.html";
    private static final int PICK_FILES = 1;

    private WebView web;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> pending;

    // A file being handed out of the app, written a piece at a time.
    private File outFile;
    private OutputStream out;
    private String outName;
    private String outType;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(0xFF070809);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Links out of the app open in the phone's browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException e) {
                    toast("No app to open this link");
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pending != null) pending.onReceiveValue(null);
                pending = callback;
                Intent pick = params.createIntent();
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                String[] types = params.getAcceptTypes();
                if (types == null || types.length == 0 || (types.length == 1 && types[0].isEmpty())) {
                    pick.setType("*/*");
                }
                try {
                    startActivityForResult(Intent.createChooser(pick, "Choose files"), PICK_FILES);
                } catch (ActivityNotFoundException e) {
                    pending = null;
                    toast("No app to choose files with");
                    return false;
                }
                return true;
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || pending == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                uris = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
        }
        pending.onReceiveValue(uris);
        pending = null;
    }

    @Override
    public void onBackPressed() {
        // The page closes what is open or goes up a level; at the top, back leaves.
        web.evaluateJavascript("window.__androidBack ? window.__androidBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    /** What the page can ask of the phone: to hand a file out of the app. */
    private class Bridge {
        @JavascriptInterface
        public boolean begin(String name, String type) {
            try {
                File dir = new File(getCacheDir(), "out");
                dir.mkdirs();
                for (File old : dir.listFiles()) old.delete();
                outName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                outType = (type == null || type.isEmpty()) ? "application/octet-stream" : type;
                outFile = new File(dir, outName);
                out = new FileOutputStream(outFile);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean append(String base64) {
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** Keeps a copy in Downloads, then offers it to any app: Drive, mail, WhatsApp. */
        @JavascriptInterface
        public boolean finish() {
            try {
                out.close();
                out = null;
                String where = saveToDownloads();
                if (where != null) toast("Saved to Downloads: " + outName);
                Uri uri = FileProvider.getUriForFile(MainActivity.this, "com.avaapp.mylibrary.files", outFile);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(outType);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, outName)));
                return true;
            } catch (Exception e) {
                toast("Could not save the file: " + e.getMessage());
                return false;
            }
        }

        private String saveToDownloads() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, outName);
                v.put(MediaStore.Downloads.MIME_TYPE, outType);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (target == null) return null;
                try (InputStream in = new FileInputStream(outFile);
                     OutputStream dst = getContentResolver().openOutputStream(target)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) dst.write(buf, 0, n);
                }
                return target.toString();
            } catch (Exception e) {
                return null;
            }
        }
    }
}
