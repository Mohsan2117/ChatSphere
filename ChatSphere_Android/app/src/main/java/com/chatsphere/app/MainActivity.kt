package com.chatsphere.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import android.Manifest
import android.content.pm.PackageManager
import android.webkit.PermissionRequest
import android.webkit.JavascriptInterface
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    private var isCallActive = false

    inner class WebAppInterface {
        @JavascriptInterface
        fun setCallActive(active: Boolean) {
            runOnUiThread {
                isCallActive = active
                android.util.Log.d("ChatSphere", "Call active state updated: $active")
            }
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            pendingPermissionRequest?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pendingPermissionRequest?.deny()
        }
        pendingPermissionRequest = null
    }

    private val multiplePermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val recordAudioGranted = permissions[Manifest.permission.RECORD_AUDIO] ?: (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        val cameraGranted = permissions[Manifest.permission.CAMERA] ?: (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        
        val grantedResources = mutableListOf<String>()
        if (recordAudioGranted) {
            grantedResources.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        }
        if (cameraGranted) {
            grantedResources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        }
        
        if (grantedResources.isNotEmpty()) {
            pendingPermissionRequest?.grant(grantedResources.toTypedArray())
        } else {
            pendingPermissionRequest?.deny()
        }
        pendingPermissionRequest = null
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val results = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(results)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Hide action bar if present in theme to make WebView fill the screen
        supportActionBar?.hide()

        webView = WebView(this)

        // Configure WebView settings
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.addJavascriptInterface(WebAppInterface(), "AndroidBridge")

        // Configure Cookies & Persistence
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // Keep navigation inside the WebView
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Persist cookies to disk
                cookieManager.flush()
            }
        }
        
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val resources = request.resources
                val neededPermissions = mutableListOf<String>()
                
                for (resource in resources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE == resource) {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            neededPermissions.add(Manifest.permission.RECORD_AUDIO)
                        }
                    }
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE == resource) {
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            neededPermissions.add(Manifest.permission.CAMERA)
                        }
                    }
                }
                
                if (neededPermissions.isNotEmpty()) {
                    this@MainActivity.pendingPermissionRequest = request
                    multiplePermissionsLauncher.launch(neededPermissions.toTypedArray())
                } else {
                    request.grant(resources)
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (this@MainActivity.filePathCallback != null) {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                }
                this@MainActivity.filePathCallback = filePathCallback

                val intent = fileChooserParams?.createIntent()
                if (intent != null) {
                    try {
                        fileChooserLauncher.launch(intent)
                    } catch (e: Exception) {
                        this@MainActivity.filePathCallback?.onReceiveValue(null)
                        this@MainActivity.filePathCallback = null
                        return false
                    }
                } else {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }
        }

        webView.loadUrl("https://chat-sphere-ruby.vercel.app/")

        setContentView(webView)

        // Implement backward-compatible AndroidX back-navigation handling
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    // Disable callback to allow system back navigation (which closes/minimizes activity)
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onPause() {
        super.onPause()
        if (!isCallActive) {
            webView.onPause()
            android.util.Log.d("ChatSphere", "WebView paused in background (no active call)")
        } else {
            android.util.Log.d("ChatSphere", "WebView kept active in background (active call ongoing)")
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        android.util.Log.d("ChatSphere", "WebView resumed")
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}