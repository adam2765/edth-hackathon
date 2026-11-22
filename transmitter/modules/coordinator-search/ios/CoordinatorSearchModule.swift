import ExpoModulesCore
import Foundation

/// Finds coordinators on the local network by itself: each coordinator advertises a Bonjour service
/// of type `_voicetomap._tcp` (lib/runtime/hosts.ts). The phone then checks every address it gets,
/// so it needs no name or address from a build, from Metro or from the last run.
public final class CoordinatorSearchModule: Module {
  private let search = CoordinatorSearch()

  public func definition() -> ModuleDefinition {
    Name("CoordinatorSearch")

    // Starts browsing; calling it again does nothing.
    Function("start") {
      self.search.start()
    }

    // What has been found so far: each service's name, id and addresses as URLs, and the last error.
    AsyncFunction("found") { () -> [String: Any] in
      return self.search.snapshot()
    }

    OnDestroy {
      self.search.stop()
    }
  }
}

final class CoordinatorSearch: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  // Touched on the main thread only, where the browser and the services deliver their callbacks.
  private var browser: NetServiceBrowser?
  private var services: [NetService] = []
  // Read from the module's queue, so behind a lock.
  private let lock = NSLock()
  private var resolved: [String: [String: Any]] = [:]
  private var lastError = ""

  func start() {
    DispatchQueue.main.async {
      guard self.browser == nil else { return }
      let browser = NetServiceBrowser()
      browser.delegate = self
      browser.searchForServices(ofType: "_voicetomap._tcp.", inDomain: "local.")
      self.browser = browser
    }
  }

  func stop() {
    DispatchQueue.main.async {
      self.browser?.stop()
      self.browser = nil
      self.services.forEach { $0.stop() }
      self.services.removeAll()
    }
  }

  func snapshot() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return ["services": Array(resolved.values), "error": lastError]
  }

  private func record(_ update: () -> Void) {
    lock.lock()
    update()
    lock.unlock()
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    services.append(service)
    service.delegate = self
    service.resolve(withTimeout: 5)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    service.stop()
    services.removeAll { $0 == service }
    record { resolved.removeValue(forKey: service.name) }
  }

  // No permission for the local network, or the service type missing from NSBonjourServices.
  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    record { lastError = "search: \(errorDict)" }
    self.browser = nil
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    var urls: [String] = []
    if let host = sender.hostName {
      // The coordinator's own advert name, which iOS resolves to whichever address works.
      urls.append("http://\(host.hasSuffix(".") ? String(host.dropLast()) : host):\(sender.port)")
    }
    for data in sender.addresses ?? [] {
      if let ip = ipv4(data) { urls.append("http://\(ip):\(sender.port)") }
    }
    var id = ""
    if let txt = sender.txtRecordData(), let value = NetService.dictionary(fromTXTRecord: txt)["id"] {
      id = String(data: value, encoding: .utf8) ?? ""
    }
    let entry: [String: Any] = ["name": sender.name, "id": id, "urls": urls]
    record { resolved[sender.name] = entry }
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    record { lastError = "resolve \(sender.name): \(errorDict)" }
  }
}

/// The IPv4 address in a socket address, or nil for any other family.
private func ipv4(_ data: Data) -> String? {
  return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> String? in
    guard raw.count >= MemoryLayout<sockaddr_in>.size, let base = raw.baseAddress else { return nil }
    var address = base.loadUnaligned(as: sockaddr_in.self)
    guard address.sin_family == sa_family_t(AF_INET) else { return nil }
    var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    guard inet_ntop(AF_INET, &address.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { return nil }
    return String(cString: buffer)
  }
}
