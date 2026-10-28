// Latch helper: a small macOS program the browser starts through native messaging.
//
// It does two jobs and nothing else:
//   1. Talks to the extension over stdin/stdout (a 4-byte length, then JSON, in both directions).
//   2. While the profile is locked, keeps an opaque lock window exactly over each of this profile's browser windows,
//      tab strip and address bar included. The passcode is typed into this program, never into a web page, and is
//      handed to the extension, which is the only thing that knows whether it is right.
//
// It never touches the browser's windows, tabs or data: it only draws its own windows on top.
import Cocoa
import LocalAuthentication

let protocolVersion = 1
let browserPid = getppid()                       // the browser started us, so it is our parent
let testMode = ProcessInfo.processInfo.environment["LATCH_HELPER_TEST"] == "1"

// Is Touch ID there to use on this Mac (hardware present and a finger enrolled)?
func biometricAvailable() -> Bool {
    var error: NSError?
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
}

// Shows the system Touch ID sheet. Only a successful scan is reported, and the extension decides what it is worth.
var biometricBusy = false
func askBiometric(done: @escaping (Bool) -> Void) {
    guard !biometricBusy else { return }
    biometricBusy = true
    let context = LAContext()
    context.localizedCancelTitle = "Use passcode"
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "unlock your browser") { ok, _ in
        DispatchQueue.main.async { biometricBusy = false; done(ok) }
    }
}

// MARK: - native messaging

let writeLock = NSLock()
func send(_ object: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: object) else { return }
    var length = UInt32(body.count).littleEndian
    var packet = Data(bytes: &length, count: 4)
    packet.append(body)
    writeLock.lock(); defer { writeLock.unlock() }
    FileHandle.standardOutput.write(packet)
}

func readExactly(_ count: Int) -> Data? {
    var data = Data()
    while data.count < count {
        guard let chunk = try? FileHandle.standardInput.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

func readMessage() -> [String: Any]? {
    guard let header = readExactly(4) else { return nil }
    let length = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
    guard length > 0, length < 1_048_576, let body = readExactly(length) else { return nil }
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
}

// MARK: - what one browser window looks like to us

struct ProfileWindow {
    var left: Double, top: Double, width: Double, height: Double
    var fullscreen: Bool
}

func parseWindows(_ raw: Any?) -> [ProfileWindow] {
    guard let list = raw as? [[String: Any]] else { return [] }
    return list.compactMap { item in
        guard let l = (item["left"] as? NSNumber)?.doubleValue, let t = (item["top"] as? NSNumber)?.doubleValue,
              let w = (item["width"] as? NSNumber)?.doubleValue, let h = (item["height"] as? NSNumber)?.doubleValue else { return nil }
        return ProfileWindow(left: l, top: t, width: w, height: h, fullscreen: (item["fullscreen"] as? Bool) ?? false)
    }
}

// MARK: - the lock screen drawn on every overlay

extension NSColor {
    static func dynamic(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light }
    }
}

final class LockPanel: NSView {
    let field = NSSecureTextField()
    let message = NSTextField(labelWithString: "")
    let button = NSButton(title: "Unlock", target: nil, action: nil)
    let touch = NSButton(title: "Use Touch ID", target: nil, action: nil)
    var onSubmit: ((String) -> Void)?
    var onTouch: (() -> Void)?
    private var countdown: Timer?
    private var touchOn = false
    private let stack = NSStackView()
    private let icon = NSImageView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.dynamic(light: NSColor(red: 0.965, green: 0.957, blue: 0.937, alpha: 1),
                                                 dark: NSColor(red: 0.043, green: 0.055, blue: 0.086, alpha: 1)).cgColor

        if let image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: "Locked") {
            icon.image = image.withSymbolConfiguration(.init(pointSize: 34, weight: .regular))
        }
        icon.contentTintColor = NSColor.dynamic(light: NSColor(red: 0.169, green: 0.31, blue: 0.859, alpha: 1),
                                                dark: NSColor(red: 0.486, green: 0.596, blue: 1, alpha: 1))

        let title = NSTextField(labelWithString: "This window is locked")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.textColor = .labelColor
        let sub = NSTextField(labelWithString: "Your tabs, windows and groups are untouched.")
        sub.font = .systemFont(ofSize: 13)
        sub.textColor = .secondaryLabelColor

        field.placeholderString = "Passcode"
        field.font = .systemFont(ofSize: 15)
        field.alignment = .center
        field.focusRingType = .default
        field.target = self
        field.action = #selector(submit)
        field.translatesAutoresizingMaskIntoConstraints = false
        field.widthAnchor.constraint(equalToConstant: 280).isActive = true
        field.heightAnchor.constraint(equalToConstant: 34).isActive = true

        button.bezelStyle = .rounded
        button.controlSize = .large
        button.keyEquivalent = "\r"
        button.target = self
        button.action = #selector(submit)

        touch.bezelStyle = .inline
        touch.isBordered = false
        touch.contentTintColor = .secondaryLabelColor
        touch.font = .systemFont(ofSize: 13)
        touch.title = "  Unlock with Touch ID"
        if let image = NSImage(systemSymbolName: "touchid", accessibilityDescription: "Touch ID") ?? NSImage(systemSymbolName: "lock.open", accessibilityDescription: nil) {
            touch.image = image.withSymbolConfiguration(.init(pointSize: 18, weight: .regular))
            touch.imagePosition = .imageLeft
        }
        touch.isHidden = true
        touch.target = self
        touch.action = #selector(useTouch)

        message.font = .systemFont(ofSize: 12)
        message.textColor = .systemRed
        message.alignment = .center
        message.maximumNumberOfLines = 2

        for view in [icon, title, sub, field, button, message, touch] { stack.addArrangedSubview(view) }
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.setCustomSpacing(6, after: title)
        stack.setCustomSpacing(22, after: sub)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -10),
        ])
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    @objc func submit() {
        // Return on an empty field asks for Touch ID, when it is on.
        if field.stringValue.isEmpty { if touchOn && field.isEnabled { onTouch?() }; return }
        guard field.isEnabled else { return }
        let typed = field.stringValue
        field.stringValue = ""
        message.stringValue = ""
        setBusy(true)
        onSubmit?(typed)
    }
    @objc func useTouch() { onTouch?() }

    func setTouch(_ on: Bool) { touchOn = on; touch.isHidden = !on; if !on { touch.isHidden = true } }

    // What this lock window shows depends on its shape:
    //   a full lock screen when there is room;
    //   just a padlock on a small tile (a whole window shrunk into the Stage Manager strip);
    //   nothing on a wide, thin strip (the toolbar or tab strip of a full-screen window), which is only a covering,
    //   so that the lock screen is not repeated along the top of the screen.
    override func layout() {
        super.layout()
        let tile = bounds.width < 420
        let strip = !tile && bounds.height < 300
        let compact = tile || strip
        for view in stack.arrangedSubviews where view !== icon { view.isHidden = compact || (view === touch && !touchOn) }
        icon.isHidden = strip
        icon.symbolConfiguration = .init(pointSize: tile ? 26 : 34, weight: .regular)
    }

    func setBusy(_ busy: Bool) { field.isEnabled = !busy; button.isEnabled = !busy }

    func showWrong(retryAfterMs: Int?) {
        countdown?.invalidate()
        if let wait = retryAfterMs, wait > 0 {
            var left = Int((Double(wait) / 1000).rounded(.up))
            message.stringValue = "Too many tries. Wait \(left) s."
            field.isEnabled = false; button.isEnabled = false
            countdown = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
                left -= 1
                guard let self else { return timer.invalidate() }
                if left <= 0 { timer.invalidate(); self.message.stringValue = ""; self.setBusy(false); self.window?.makeFirstResponder(self.field) }
                else { self.message.stringValue = "Too many tries. Wait \(left) s." }
            }
            return
        }
        message.stringValue = "Wrong passcode. Try again."
        setBusy(false)
        window?.makeFirstResponder(field)
        field.wantsLayer = true
        let base = field.layer?.position.x ?? 0
        let shake = CAKeyframeAnimation(keyPath: "position.x")
        shake.values = [0, -9, 9, -6, 6, -3, 3, 0].map { base + CGFloat($0) }
        shake.duration = 0.4
        field.layer?.add(shake, forKey: "shake")
    }

    func note(_ text: String) { message.stringValue = text }

    func reset() { countdown?.invalidate(); field.stringValue = ""; message.stringValue = ""; setBusy(false) }
}

final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    // A window of ours must be able to sit exactly where a browser window sits, even at the very top of the screen, where macOS
    // would otherwise push it down to keep it clear of the menu bar.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// MARK: - overlays kept exactly over this profile's windows

final class Overlays {
    private var windows: [Int: OverlayWindow] = [:]      // keyed by the browser window's number in the window server
    private var profile: [ProfileWindow] = []
    private(set) var locked = false
    private var timer: Timer?
    private var keyed = false
    private var touchOn = false
    private var lastReport = (-1, -1)

    var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

    func lock(_ list: [ProfileWindow]) {
        profile = list
        locked = true
        keyed = false
        lastReport = (-1, -1)
        tick()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in self?.tick() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.tick() }
    }

    func update(_ list: [ProfileWindow]) { profile = list; if locked { tick() } }

    func setTouch(_ on: Bool) {
        touchOn = on
        for window in windows.values { (window.contentView as? LockPanel)?.setTouch(on) }
    }

    func unlock() {
        locked = false
        timer?.invalidate(); timer = nil
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        for window in windows.values { (window.contentView as? LockPanel)?.reset(); window.orderOut(nil); window.close() }
        windows.removeAll()
        NSRunningApplication(processIdentifier: browserPid)?.activate()      // give the browser its focus back
    }

    func showWrong(retryAfterMs: Int?) { for window in windows.values { (window.contentView as? LockPanel)?.showWrong(retryAfterMs: retryAfterMs) } }

    func submitFromTest(_ passcode: String) { send(["event": "attempt", "passcode": passcode]) }

    // Test only: draws the first lock screen into a PNG (just that view, never the screen), so its look can be checked.
    func snapshot(to path: String) {
        guard let view = windows.values.first?.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
    }

    // Does this browser window (as the window server reports it) belong to the locked profile?
    private func belongs(_ bounds: CGRect) -> Bool {
        for p in profile {
            if p.fullscreen {
                // In full screen the browser draws its page, toolbar, tab strip and menu bar as separate windows, each as wide as
                // the screen but not as tall. Every piece that spans a screen is part of the full-screen window.
                if NSScreen.screens.contains(where: { screen in
                    let c = cgFrame(screen)          // this screen in the window server's coordinates, so another display works too
                    return abs(c.width - bounds.width) <= 2 && bounds.minX >= c.minX - 2 && bounds.maxX <= c.maxX + 2 && bounds.minY >= c.minY - 2 && bounds.maxY <= c.maxY + 2
                }) { return true }
            } else if abs(p.left - bounds.minX) <= 8 && abs(p.top - bounds.minY) <= 8 && abs(p.width - bounds.width) <= 8 && abs(p.height - bounds.height) <= 8 {
                return true
            }
        }
        return false
    }

    // A window that Stage Manager has shrunk into its side strip is still the real window, so it gets a lock tile too. It is
    // recognised by its shape: smaller than one of ours, with the same width-to-height ratio.
    private func looksLikeStripThumbnail(_ bounds: CGRect) -> Bool {
        guard bounds.width > 40, bounds.height > 30, bounds.width <= 420 else { return false }
        let ratio = bounds.width / bounds.height
        let screen = NSScreen.screens.first?.frame.size ?? .zero
        return profile.contains { p in
            let width = p.fullscreen ? Double(screen.width) : p.width, height = p.fullscreen ? Double(screen.height) : p.height
            return height > 0 && bounds.width < width * 0.6 && abs(ratio - width / height) / (width / height) < 0.02
        }
    }

    // A screen's frame as the window server reports windows: origin at the top-left of the main display, y pointing down.
    private func cgFrame(_ screen: NSScreen) -> CGRect {
        let f = screen.frame
        return CGRect(x: f.minX, y: primaryHeight - f.maxY, width: f.width, height: f.height)
    }

    private func cocoaRect(_ b: CGRect) -> NSRect { NSRect(x: b.minX, y: primaryHeight - b.maxY, width: b.width, height: b.height) }

    private func makeWindow(_ rect: NSRect) -> OverlayWindow {
        let window = OverlayWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = true
        window.hasShadow = false
        window.level = .normal                                         // stacked directly above the browser window, not above everything
        window.collectionBehavior = [.fullScreenAuxiliary, .ignoresCycle]   // may live in a full-screen Space; not shown in the app switcher
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let panel = LockPanel(frame: NSRect(origin: .zero, size: rect.size))
        panel.onSubmit = { passcode in send(["event": "attempt", "passcode": passcode]) }
        panel.setTouch(touchOn)
        panel.onTouch = { [weak panel] in
            askBiometric { ok in
                if ok { send(["event": "biometric"]) } else { panel?.note("Touch ID did not match. Use your passcode.") }
            }
        }
        window.contentView = panel
        window.setFrame(rect, display: true)
        return window
    }

    // Runs several times a second while locked: one overlay per visible browser window of this profile, kept the same
    // place and size, so a window that opens, moves or changes Space is covered at once.
    func tick() {
        guard locked else { return }
        let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
        var seen = Set<Int>()
        for entry in info {
            guard (entry[kCGWindowOwnerPID as String] as? Int32) == browserPid, (entry[kCGWindowLayer as String] as? Int) == 0,
                  let number = entry[kCGWindowNumber as String] as? Int,
                  let dictionary = entry[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dictionary) else { continue }
            guard bounds.width > 40, bounds.height > 30, belongs(bounds) || looksLikeStripThumbnail(bounds) else { continue }
            seen.insert(number)
            let rect = cocoaRect(bounds)
            if let existing = windows[number] {
                if existing.frame != rect { existing.setFrame(rect, display: true) }
                existing.order(.above, relativeTo: number)
            } else {
                let window = makeWindow(rect)
                windows[number] = window
                if !keyed {                                            // the front-most one takes the keyboard
                    keyed = true
                    NSApp.activate(ignoringOtherApps: true)
                    window.makeKeyAndOrderFront(nil)
                    window.makeFirstResponder((window.contentView as? LockPanel)?.field)
                } else {
                    window.order(.above, relativeTo: number)
                }
            }
        }
        for (number, window) in windows where !seen.contains(number) { window.orderOut(nil); window.close(); windows[number] = nil }

        // Tell the extension how it is going, so it can show its own unlock screen if this finds nothing to cover.
        let visible = info.filter { entry in
            guard (entry[kCGWindowOwnerPID as String] as? Int32) == browserPid, (entry[kCGWindowLayer as String] as? Int) == 0,
                  let d = entry[kCGWindowBounds as String] as? NSDictionary, let b = CGRect(dictionaryRepresentation: d) else { return false }
            return b.width >= 300 && b.height >= 200
        }.count
        if lastReport.0 != windows.count || lastReport.1 != visible {
            lastReport = (windows.count, visible)
            send(["event": "coverage", "overlays": windows.count, "browserWindows": visible])
        }
    }
}

// MARK: - wiring

let overlays = Overlays()

func handle(_ message: [String: Any]) {
    switch message["cmd"] as? String {
    case "lock": overlays.setTouch((message["touchId"] as? Bool) ?? false); overlays.lock(parseWindows(message["windows"]))
    case "update": overlays.setTouch((message["touchId"] as? Bool) ?? false); overlays.update(parseWindows(message["windows"]))
    case "result": overlays.showWrong(retryAfterMs: (message["retryAfterMs"] as? NSNumber)?.intValue)
    case "unlock": overlays.unlock()
    case "ping": send(["event": "ready", "version": protocolVersion, "biometric": biometricAvailable()])
    case "test-submit": if testMode, let passcode = message["passcode"] as? String { overlays.submitFromTest(passcode) }
    case "test-coverage": if testMode { send(["event": "coverage", "overlays": (message["overlays"] as? NSNumber)?.intValue ?? 0, "browserWindows": (message["browserWindows"] as? NSNumber)?.intValue ?? 0]) }
    case "test-biometric": if testMode { send(["event": "biometric"]) }
    case "test-snapshot": if testMode, let file = message["path"] as? String { overlays.snapshot(to: file) }
    case "quit": exit(0)
    default: break
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)                 // no Dock icon, no menu bar

DispatchQueue.main.async { send(["event": "ready", "version": protocolVersion, "biometric": biometricAvailable()]) }

Thread.detachNewThread {
    while let message = readMessage() { DispatchQueue.main.async { handle(message) } }
    // The browser closed the connection (it quit, or the extension restarted). If the lock is up, leave it for a few
    // seconds so a restarting extension can take over without a gap, then go.
    DispatchQueue.main.async {
        if overlays.locked { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { exit(0) } } else { exit(0) }
    }
}

app.run()
