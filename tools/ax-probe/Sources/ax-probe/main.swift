import ApplicationServices
import Foundation

/// Reads macOS accessibility attributes of an app's focused element and prints them as JSON.
///
/// It turns on the app's full accessibility mode the way VoiceOver does (`AXEnhancedUserInterface`), because
/// Chromium reports caret bounds through text markers only in that mode.
///
/// Usage:
///   ax-probe trusted              exit 0 when this process has the Accessibility permission, 2 otherwise
///   ax-probe focused <pid>        print the focused element of <pid>
///   ax-probe focused <pid> <ms>   wait up to <ms> for a focused element with a text role
enum Probe {
    static let textAttributes = [
        "AXRole", "AXSubrole", "AXRoleDescription", "AXTitle", "AXDescription", "AXHelp", "AXFocused",
        "AXNumberOfCharacters", "AXSelectedText", "AXSelectedTextRange", "AXVisibleCharacterRange",
        "AXInsertionPointLineNumber", "AXEditableAncestor", "AXSelectedTextMarkerRange", "AXFrame",
    ]

    static func run(_ arguments: [String]) -> Int32 {
        guard arguments.count >= 2 else { return usage() }
        switch arguments[1] {
        case "trusted":
            print(AXIsProcessTrusted() ? "trusted" : "not-trusted")
            return AXIsProcessTrusted() ? 0 : 2
        case "focused":
            guard arguments.count >= 3, let pid = pid_t(arguments[2]) else { return usage() }
            let waitMs = arguments.count >= 4 ? Int(arguments[3]) ?? 0 : 0
            return printFocused(pid: pid, waitMs: waitMs)
        default:
            return usage()
        }
    }

    static func usage() -> Int32 {
        FileHandle.standardError.write("usage: ax-probe trusted | focused <pid> [wait-ms]\n".data(using: .utf8)!)
        return 64
    }

    static func printFocused(pid: pid_t, waitMs: Int) -> Int32 {
        guard AXIsProcessTrusted() else {
            print("{\"error\":\"not-trusted\"}")
            return 2
        }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        usleep(500_000)
        let deadline = Date().addingTimeInterval(Double(max(waitMs, 0)) / 1000)
        var element = focusedElement(of: app)
        while Date() < deadline && (element == nil || role(of: element!) == "AXWindow") {
            usleep(100_000)
            element = focusedElement(of: app)
        }
        guard let focused = element else {
            print("{\"error\":\"no-focused-element\"}")
            return 1
        }
        let report = describe(focused)
        let data = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted])
        print(String(data: data, encoding: .utf8)!)
        return 0
    }

    static func focusedElement(of app: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, "AXFocusedUIElement" as CFString, &value) == .success,
              let element = value, CFGetTypeID(element) == AXUIElementGetTypeID()
        else { return nil }
        return (element as! AXUIElement)
    }

    static func role(of element: AXUIElement) -> String {
        (copy(element, "AXRole") as? String) ?? ""
    }

    static func copy(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    static func copy(_ element: AXUIElement, _ name: String, parameter: CFTypeRef) -> CFTypeRef? {
        var value: CFTypeRef?
        let status = AXUIElementCopyParameterizedAttributeValue(element, name as CFString, parameter, &value)
        return status == .success ? value : nil
    }

    static func describe(_ element: AXUIElement) -> [String: Any] {
        var report: [String: Any] = [:]
        for name in textAttributes {
            if let value = copy(element, name) { report[name] = json(value) }
        }
        if let value = copy(element, "AXValue") {
            let text = (value as? String) ?? ""
            report["AXValueLength"] = text.utf16.count
            report["AXValuePrefix"] = String(text.prefix(200))
        }
        if let range = copy(element, "AXSelectedTextRange") {
            if let bounds = copy(element, "AXBoundsForRange", parameter: range) { report["AXBoundsForRange"] = json(bounds) }
            var cfRange = CFRange()
            AXValueGetValue(range as! AXValue, .cfRange, &cfRange)
            let index = NSNumber(value: cfRange.location)
            if let line = copy(element, "AXLineForIndex", parameter: index) {
                report["AXLineForIndex"] = json(line)
                if let lineRange = copy(element, "AXRangeForLine", parameter: line) {
                    report["AXRangeForLine"] = json(lineRange)
                    if let text = copy(element, "AXStringForRange", parameter: lineRange) { report["AXStringForLine"] = json(text) }
                }
            }
        }
        if let markers = copy(element, "AXSelectedTextMarkerRange") {
            if let text = copy(element, "AXStringForTextMarkerRange", parameter: markers) {
                report["AXStringForTextMarkerRange"] = String(((text as? String) ?? "").prefix(200))
                report["AXStringForTextMarkerRangeLength"] = ((text as? String) ?? "").utf16.count
            }
            if let bounds = copy(element, "AXBoundsForTextMarkerRange", parameter: markers) {
                report["AXBoundsForTextMarkerRange"] = json(bounds)
            }
        }
        var names: CFArray?
        if AXUIElementCopyAttributeNames(element, &names) == .success { report["attributeNames"] = names as? [String] ?? [] }
        if AXUIElementCopyParameterizedAttributeNames(element, &names) == .success {
            report["parameterizedAttributeNames"] = names as? [String] ?? []
        }
        return report
    }

    static func json(_ value: CFTypeRef) -> Any {
        if let string = value as? String { return String(string.prefix(200)) }
        if let number = value as? NSNumber { return number }
        if CFGetTypeID(value) == AXValueGetTypeID() { return axValue(value as! AXValue) }
        if CFGetTypeID(value) == AXUIElementGetTypeID() { return "<element \(role(of: value as! AXUIElement))>" }
        return "<\(CFCopyTypeIDDescription(CFGetTypeID(value)) as String)>"
    }

    static func axValue(_ value: AXValue) -> Any {
        switch AXValueGetType(value) {
        case .cfRange:
            var range = CFRange()
            AXValueGetValue(value, .cfRange, &range)
            return ["location": range.location, "length": range.length]
        case .cgRect:
            var rect = CGRect.zero
            AXValueGetValue(value, .cgRect, &rect)
            return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.size.width, "height": rect.size.height]
        case .cgPoint:
            var point = CGPoint.zero
            AXValueGetValue(value, .cgPoint, &point)
            return ["x": point.x, "y": point.y]
        default:
            return "<AXValue>"
        }
    }
}

exit(Probe.run(CommandLine.arguments))
