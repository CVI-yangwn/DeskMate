import Cocoa
import ApplicationServices

// 最小执行器：activate / AXPress / key combo / unicode type / click。
// 只用于受控实验（Calculator、TextEdit、Finder），不做通用 computer-use。

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    if let value = attribute(element, name) as? String, !value.isEmpty { return value }
    return nil
}

func children(of element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func targetApp(_ bundle: String?) -> NSRunningApplication? {
    if let bundle, !bundle.isEmpty {
        return NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
    }
    return NSWorkspace.shared.frontmostApplication
}

func activate(_ app: NSRunningApplication) {
    app.activate(options: [.activateAllWindows])
    usleep(350_000)
}

func findButton(_ element: AXUIElement, label: String, depth: Int) -> AXUIElement? {
    if depth > 14 { return nil }
    let role = stringAttribute(element, kAXRoleAttribute) ?? ""
    if role == (kAXButtonRole as String) {
        let title = stringAttribute(element, kAXTitleAttribute) ?? ""
        let desc = stringAttribute(element, kAXDescriptionAttribute) ?? ""
        let value = stringAttribute(element, kAXValueAttribute) ?? ""
        if title == label || desc == label || value == label { return element }
        if title.contains(label) || desc.contains(label) { return element }
    }
    for child in children(of: element) {
        if let found = findButton(child, label: label, depth: depth + 1) { return found }
    }
    return nil
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
    "-": 27, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "return": 36,
    "l": 37, "j": 38, "k": 40, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49,
    "delete": 51, "esc": 53, "escape": 53, "enter": 36, "del": 51, "left": 123, "right": 124, "down": 125, "up": 126,
]

func postKey(code: CGKeyCode, flags: CGEventFlags) {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    usleep(15_000)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

func typeText(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var utf16 = Array(String(scalar).utf16)
        let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        down?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down?.post(tap: .cghidEventTap)
        usleep(12_000)
        let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        up?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up?.post(tap: .cghidEventTap)
        usleep(12_000)
    }
}

func fail(_ message: String) -> Never {
    let payload: [String: Any] = ["ok": false, "error": message]
    let data = try! JSONSerialization.data(withJSONObject: payload)
    FileHandle.standardOutput.write(data)
    exit(1)
}

var args = CommandLine.arguments
guard args.count >= 2 else { fail("missing command") }
let command = args[1]
args.removeFirst(2)

func option(_ name: String) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

var app: NSRunningApplication?
if let bundle = option("--bundle") {
    guard let found = targetApp(bundle) else { fail("app not running: \(bundle)") }
    app = found
    activate(found)
}

switch command {
case "activate":
    guard app != nil else { fail("activate needs --bundle") }
case "press":
    guard let bundle = option("--bundle"), let found = targetApp(bundle) else { fail("press needs --bundle") }
    activate(found)
    guard let label = option("--label") else { fail("press needs --label") }
    let root = AXUIElementCreateApplication(found.processIdentifier)
    AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    guard let button = findButton(root, label: label, depth: 0) else { fail("button not found: \(label)") }
    let error = AXUIElementPerformAction(button, kAXPressAction as CFString)
    if error != .success { fail("axpress failed: \(error.rawValue)") }
case "key":
    guard let combo = option("--combo") else { fail("key needs --combo") }
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let keyName = parts.last, let code = keyCodes[keyName] else { fail("unknown key: \(combo)") }
    var flags: CGEventFlags = []
    for modifier in parts.dropLast() {
        switch modifier {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: fail("unknown modifier: \(modifier)")
        }
    }
    postKey(code: code, flags: flags)
case "scroll":
    guard let dyRaw = option("--dy"), let dy = Int32(dyRaw) else { fail("scroll needs --dy") }
    let scrollSource = CGEventSource(stateID: .hidSystemState)
    if let xRaw = option("--x"), let yRaw = option("--y"),
       let x = Double(xRaw), let y = Double(yRaw) {
        CGEvent(mouseEventSource: scrollSource, mouseType: .mouseMoved,
                mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
            .post(tap: .cghidEventTap)
        usleep(60_000)
    }
    CGEvent(scrollWheelEvent2Source: scrollSource, units: .line, wheelCount: 1,
            wheel1: dy, wheel2: 0, wheel3: 0)?
        .post(tap: .cghidEventTap)
case "type":
    guard let text = option("--text") else { fail("type needs --text") }
    typeText(text)
case "move":
    guard let xRaw = option("--x"), let yRaw = option("--y"),
          let x = Double(xRaw), let y = Double(yRaw) else { fail("move needs --x/--y") }
    let moveSource = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: moveSource, mouseType: .mouseMoved,
            mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
        .post(tap: .cghidEventTap)
case "click":
    guard let xRaw = option("--x"), let yRaw = option("--y"),
          let x = Double(xRaw), let y = Double(yRaw) else { fail("click needs --x/--y") }
    let point = CGPoint(x: x, y: y)
    let source = CGEventSource(stateID: .hidSystemState)
    let buttonName = option("--button") ?? "left"
    let count = max(1, min(3, Int(option("--count") ?? "1") ?? 1))
    var button: CGMouseButton = .left
    var downType: CGEventType = .leftMouseDown
    var upType: CGEventType = .leftMouseUp
    if buttonName == "right" {
        button = .right
        downType = .rightMouseDown
        upType = .rightMouseUp
    } else if buttonName == "middle" {
        button = .center
        downType = .otherMouseDown
        upType = .otherMouseUp
    }
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: button)?
        .post(tap: .cghidEventTap)
    usleep(60_000)
    for index in 1...count {
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(index))
        down?.post(tap: .cghidEventTap)
        usleep(30_000)
        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(index))
        up?.post(tap: .cghidEventTap)
        if index < count { usleep(80_000) }
    }
case "drag":
    guard let x1Raw = option("--x1"), let y1Raw = option("--y1"),
          let x2Raw = option("--x2"), let y2Raw = option("--y2"),
          let x1 = Double(x1Raw), let y1 = Double(y1Raw),
          let x2 = Double(x2Raw), let y2 = Double(y2Raw) else {
        fail("drag needs --x1/--y1/--x2/--y2")
    }
    let startPoint = CGPoint(x: x1, y: y1)
    let endPoint = CGPoint(x: x2, y: y2)
    let source = CGEventSource(stateID: .hidSystemState)
    let duration = max(100, min(3000, Int(option("--duration") ?? "500") ?? 500))
    let steps = 24
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: startPoint, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: startPoint, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    for step in 1...steps {
        let t = Double(step) / Double(steps)
        let point = CGPoint(
            x: startPoint.x + (endPoint.x - startPoint.x) * t,
            y: startPoint.y + (endPoint.y - startPoint.y) * t
        )
        CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
        usleep(useconds_t(max(1, duration * 1000 / steps)))
    }
    CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: endPoint, mouseButton: .left)?
        .post(tap: .cghidEventTap)
default:
    fail("unknown command: \(command)")
}

let payload: [String: Any] = ["ok": true, "command": command]
let data = try! JSONSerialization.data(withJSONObject: payload)
FileHandle.standardOutput.write(data)
