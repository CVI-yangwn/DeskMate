import Cocoa
import Carbon
import ApplicationServices

// 两个用途，一次调用都返回：
// 1) 光标附近的文本（知道“在写什么”）；
// 2) 前台窗口的 app / 标题 / 位置（比 get-windows 快两个数量级）。
// 输出一行 JSON，调用方负责超时与降级。

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    if let value = attribute(element, name) as? String, !value.isEmpty { return value }
    return nil
}

func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    if let focused = attribute(system, kAXFocusedUIElementAttribute) {
        return (focused as! AXUIElement)
    }
    if let front = NSWorkspace.shared.frontmostApplication {
        let appElement = AXUIElementCreateApplication(front.processIdentifier)
        if let focused = attribute(appElement, kAXFocusedUIElementAttribute) {
            return (focused as! AXUIElement)
        }
    }
    return nil
}

func focusedWindow() -> AXUIElement? {
    guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
    let appElement = AXUIElementCreateApplication(front.processIdentifier)
    if let win = attribute(appElement, kAXFocusedWindowAttribute) {
        return (win as! AXUIElement)
    }
    if let wins = attribute(appElement, kAXWindowsAttribute) as? [AXUIElement] {
        return wins.first
    }
    return nil
}

/// Chromium 系默认不建无障碍树，显式打开后才会把页面文本暴露出来。
func enableChromiumAccessibility() {
    guard let front = NSWorkspace.shared.frontmostApplication else { return }
    let appElement = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetAttributeValue(
        appElement,
        "AXManualAccessibility" as CFString,
        kCFBooleanTrue
    )
}

func caretRange(_ element: AXUIElement) -> CFRange? {
    guard let raw = attribute(element, kAXSelectedTextRangeAttribute) else { return nil }
    let value = raw as! AXValue
    var range = CFRange()
    guard AXValueGetValue(value, .cfRange, &range) else { return nil }
    return range
}

func slice(_ text: String, around location: Int, radius: Int) -> String {
    guard !text.isEmpty else { return "" }
    let characters = Array(text)
    let center = min(max(location, 0), characters.count)
    let start = max(0, center - radius)
    let end = min(characters.count, center + radius)
    return String(characters[start..<end])
}

func frame(of element: AXUIElement) -> [String: Double]? {
    guard let rawPosition = attribute(element, kAXPositionAttribute),
          let rawSize = attribute(element, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &point),
          AXValueGetValue(rawSize as! AXValue, .cgSize, &size),
          size.width > 0, size.height > 0 else { return nil }
    return [
        "x": Double(point.x),
        "y": Double(point.y),
        "width": Double(size.width),
        "height": Double(size.height),
    ]
}

/// Chromium 的 AXWebArea 不给 AXValue，文本散在子节点里。
/// 用有上限的广度遍历把可见文本拼回来——限量是为了不让一次扫描卡住。
func collectText(_ root: AXUIElement, limit: Int, maxNodes: Int) -> String {
    var queue: [(AXUIElement, Int)] = [(root, 0)]
    var pieces: [String] = []
    var visited = 0
    var total = 0

    while !queue.isEmpty && visited < maxNodes && total < limit {
        let (element, depth) = queue.removeFirst()
        visited += 1

        if depth > 0 {
            let role = stringAttribute(element, kAXRoleAttribute) ?? ""
            let text = stringAttribute(element, kAXValueAttribute)
                ?? stringAttribute(element, kAXTitleAttribute)
                ?? ""
            if !text.isEmpty, role == kAXStaticTextRole as String || role == "AXTextField" || role == "AXTextArea" {
                let line = text.replacingOccurrences(of: "\n", with: " ")
                pieces.append(line)
                total += line.count
            }
        }

        if depth < 9, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            for child in children.prefix(40) {
                queue.append((child, depth + 1))
            }
        }
    }

    return pieces.joined(separator: "\n")
}

func emit(_ payload: [String: Any]) {
    let data = try? JSONSerialization.data(withJSONObject: payload, options: [])
    if let data, let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"ok\":false,\"reason\":\"encode-failed\"}")
    }
}

let frontApp = NSWorkspace.shared.frontmostApplication
let appName = frontApp?.localizedName ?? ""

guard AXIsProcessTrusted() else {
    // 没有辅助功能权限：至少把前台 app 报上去，扫描不至于完全瞎。
    emit(["ok": false, "reason": "no-accessibility", "app": appName])
    exit(0)
}

// 密码框：系统会打开 secure input，这时主动放弃，避免读到敏感内容。
let secureInput = IsSecureEventInputEnabled()
if !secureInput {
    enableChromiumAccessibility()
}

let window = focusedWindow()
var element = focusedElement() ?? window

var role = ""
var title = ""
var document = ""
var text = ""
var selected = ""
var caret = -1

if let current = element {
    if (stringAttribute(current, kAXValueAttribute) ?? "").isEmpty && !secureInput {
        // Chromium 开完无障碍树要一点时间才建好；值为空时再等一次。
        usleep(120_000)
        element = focusedElement() ?? current
    }
    if let target = element {
        role = stringAttribute(target, kAXRoleAttribute) ?? ""
        title = stringAttribute(target, kAXTitleAttribute) ?? ""
        document = stringAttribute(target, "AXDocument") ?? ""
        text = secureInput ? "" : stringAttribute(target, kAXValueAttribute) ?? ""
        selected = secureInput ? "" : stringAttribute(target, kAXSelectedTextAttribute) ?? ""
        caret = caretRange(target).map { $0.location } ?? -1
    }
}

// 原生控件一般有 AXValue；Chromium 的 WebArea 要靠遍历子树取文本。
if text.isEmpty && !secureInput, let target = window ?? element {
    text = collectText(target, limit: 4000, maxNodes: 400)
}

if title.isEmpty, let win = window {
    title = stringAttribute(win, kAXTitleAttribute) ?? ""
}

let context: String
if text.isEmpty {
    context = ""
} else if caret >= 0 && caret <= text.count {
    context = slice(text, around: caret, radius: 220)
} else {
    context = String(text.suffix(440))
}

var payload: [String: Any] = [
    "ok": true,
    "app": appName,
    "role": role,
    "title": String(title.prefix(200)),
    "doc": String(document.prefix(400)),
    "valueLength": text.count,
    "caret": caret,
    "selected": String(selected.prefix(400)),
    "context": String(context.prefix(900)),
    "secure": secureInput,
]
if let win = window, let rect = frame(of: win) {
    payload["bounds"] = rect
}
emit(payload)
