import Cocoa
import ApplicationServices

// 导出前台 App 的无障碍树（JSON）。
// 用途：评估“小图标/按钮能不能不靠像素定位”，而不是执行任何动作。

struct Node: Encodable {
    var path: String
    var role: String
    var subrole: String?
    var title: String?
    var desc: String?
    var identifier: String?
    var value: String?
    var frame: [Double]?
    var actions: [String]?
    var enabled: Bool?
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    if let value = attribute(element, name) as? String, !value.isEmpty { return value }
    return nil
}

func frame(of element: AXUIElement) -> [Double]? {
    guard let rawPosition = attribute(element, kAXPositionAttribute),
          let rawSize = attribute(element, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &point),
          AXValueGetValue(rawSize as! AXValue, .cgSize, &size) else { return nil }
    return [Double(point.x), Double(point.y), Double(size.width), Double(size.height)]
}

func children(of element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func actionNames(of element: AXUIElement) -> [String]? {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success,
          let list = names as? [String], !list.isEmpty else { return nil }
    return list
}

func truncate(_ value: String, _ limit: Int = 120) -> String {
    let clean = value.replacingOccurrences(of: "\n", with: " ")
    return clean.count <= limit ? clean : String(clean.prefix(limit)) + "…"
}

var nodes: [Node] = []
var visited = 0
let maxNodes = 1500
let maxDepth = 12

func walk(_ element: AXUIElement, path: String, depth: Int) {
    if visited >= maxNodes || depth > maxDepth { return }
    visited += 1

    let role = stringAttribute(element, kAXRoleAttribute) ?? "?"
    let subrole = stringAttribute(element, kAXSubroleAttribute)
    let title = stringAttribute(element, kAXTitleAttribute)
    let desc = stringAttribute(element, kAXDescriptionAttribute)
    let identifier = stringAttribute(element, kAXIdentifierAttribute)
    let rawValue = attribute(element, kAXValueAttribute)
    let value: String?
    if let text = rawValue as? String {
        value = truncate(text)
    } else if let number = rawValue as? NSNumber {
        value = number.stringValue
    } else {
        value = nil
    }
    let enabled = (attribute(element, kAXEnabledAttribute) as? NSNumber)?.boolValue

    let node = Node(
        path: path,
        role: role,
        subrole: subrole,
        title: title.map { truncate($0) },
        desc: desc.map { truncate($0) },
        identifier: identifier,
        value: value,
        frame: frame(of: element),
        actions: actionNames(of: element),
        enabled: enabled
    )
    nodes.append(node)

    let kids = children(of: element)
    for (index, child) in kids.enumerated() {
        walk(child, path: path.isEmpty ? "\(index)" : "\(path).\(index)", depth: depth + 1)
        if visited >= maxNodes { break }
    }
}

var target = NSWorkspace.shared.frontmostApplication
let arguments = CommandLine.arguments
if let index = arguments.firstIndex(of: "--bundle"), index + 1 < arguments.count {
    target = NSRunningApplication.runningApplications(withBundleIdentifier: arguments[index + 1]).first ?? target
}
if let index = arguments.firstIndex(of: "--pid"), index + 1 < arguments.count,
   let pid = pid_t(arguments[index + 1]) {
    target = NSRunningApplication(processIdentifier: pid) ?? target
}
guard let app = target else {
    FileHandle.standardError.write("no target app\n".data(using: .utf8)!)
    exit(2)
}

let appElement = AXUIElementCreateApplication(app.processIdentifier)
// Chromium 系默认不建无障碍树；显式打开后再遍历。
AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)

walk(appElement, path: "", depth: 0)

let payload: [String: Any] = [
    "app": app.localizedName ?? "",
    "bundle": app.bundleIdentifier ?? "",
    "pid": Int(app.processIdentifier),
    "count": nodes.count,
    "nodes": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(nodes)) as Any,
]

let data = try! JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
