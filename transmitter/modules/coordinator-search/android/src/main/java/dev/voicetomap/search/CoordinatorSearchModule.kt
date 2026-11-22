package dev.voicetomap.search

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.InetAddress
import java.util.ArrayDeque

/**
 * Finds coordinators on the local network by itself, as the iPhone does: each coordinator
 * advertises a service of type `_voicetomap._tcp` (lib/runtime/hosts.ts). The phone then checks
 * every address it gets, so it needs no cable, no Metro and no address from the last run.
 */
class CoordinatorSearchModule : Module() {
  private val search = CoordinatorSearch()

  override fun definition() = ModuleDefinition {
    Name("CoordinatorSearch")

    // Starts the search; calling it again does nothing.
    Function("start") {
      appContext.reactContext?.let { search.start(it) }
      Unit
    }

    // What has been found so far: each service's name, id and addresses as URLs, and the last error.
    // It starts the search again if the first try failed, so a scan a few seconds later can still find it.
    AsyncFunction("found") {
      appContext.reactContext?.let { search.start(it) }
      search.snapshot()
    }

    OnDestroy { search.stop() }
  }
}

class CoordinatorSearch {
  private val lock = Any()
  private var nsd: NsdManager? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private val resolved = HashMap<String, Map<String, Any>>()
  private var lastError = ""
  // Before Android 14 the system resolves one service at a time, so the ones found wait in line.
  private val queue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false

  fun start(context: Context) {
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        synchronized(lock) { lastError = "search: $errorCode"; discovery = null }
      }
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) { enqueue(info) }
      override fun onServiceLost(info: NsdServiceInfo) {
        synchronized(lock) { resolved.remove(info.serviceName) }
      }
    }
    val manager = synchronized(lock) {
      if (discovery != null) return
      val manager = nsd ?: (context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager)
      nsd = manager
      discovery = listener
      manager
    }
    try {
      manager.discoverServices("_voicetomap._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: Exception) {
      synchronized(lock) { lastError = "search: ${e.message}"; discovery = null }
    }
  }

  fun stop() {
    val manager: NsdManager?
    val listener: NsdManager.DiscoveryListener?
    synchronized(lock) {
      manager = nsd
      listener = discovery
      discovery = null
      queue.clear()
    }
    if (manager != null && listener != null) runCatching { manager.stopServiceDiscovery(listener) }
  }

  fun snapshot(): Map<String, Any> = synchronized(lock) {
    mapOf("services" to resolved.values.toList(), "error" to lastError)
  }

  private fun enqueue(info: NsdServiceInfo) {
    synchronized(lock) {
      if (queue.none { it.serviceName == info.serviceName }) queue.add(info)
    }
    next()
  }

  private fun next() {
    val manager = synchronized(lock) { nsd } ?: return
    val info = synchronized(lock) {
      if (resolving) null else queue.poll()?.also { resolving = true }
    } ?: return
    val listener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(failed: NsdServiceInfo, errorCode: Int) {
        synchronized(lock) { lastError = "resolve ${failed.serviceName}: $errorCode"; resolving = false }
        next()
      }
      override fun onServiceResolved(found: NsdServiceInfo) {
        record(found)
        synchronized(lock) { resolving = false }
        next()
      }
    }
    try {
      resolve(manager, info, listener)
    } catch (e: Exception) {
      synchronized(lock) { lastError = "resolve ${info.serviceName}: ${e.message}"; resolving = false }
    }
  }

  private fun record(info: NsdServiceInfo) {
    val port = info.port
    // IPv4 only, as on the iPhone: a link-local IPv6 address needs a zone the app's requests cannot carry.
    val urls = addressesOf(info).filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }.distinct()
      .map { "http://$it:$port" }
    val id = info.attributes["id"]?.let { String(it, Charsets.UTF_8) } ?: ""
    val entry: Map<String, Any> = mapOf("name" to info.serviceName, "id" to id, "urls" to urls)
    synchronized(lock) { resolved[info.serviceName] = entry }
  }
}

// resolveService and host are deprecated from Android 14, which still runs them; older phones have nothing else.
@Suppress("DEPRECATION")
private fun resolve(manager: NsdManager, info: NsdServiceInfo, listener: NsdManager.ResolveListener) {
  manager.resolveService(info, listener)
}

@Suppress("DEPRECATION")
private fun addressesOf(info: NsdServiceInfo): List<InetAddress> =
  if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else listOfNotNull(info.host)
