import Foundation

/// Minimal ordered JSON value used by the helper protocol (§5.5).
///
/// Hand-rolled rather than `JSONEncoder` so output is byte-stable (`"t"` first,
/// declared key order, integers never rendered as floats). Host-clock
/// nanosecond timestamps are `Int64`; JS parses them as doubles, which is exact
/// below 2^53 ns (~104 days of awake uptime) and off by a few ns beyond —
/// irrelevant at telemetry's millisecond resolution.
public indirect enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([(String, JSONValue)])

    public static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null): return true
        case let (.bool(a), .bool(b)): return a == b
        case let (.int(a), .int(b)): return a == b
        case let (.double(a), .double(b)): return a == b
        case let (.int(a), .double(b)), let (.double(b), .int(a)): return Double(a) == b
        case let (.string(a), .string(b)): return a == b
        case let (.array(a), .array(b)): return a == b
        case let (.object(a), .object(b)):
            guard a.count == b.count else { return false }
            let bm = Dictionary(b, uniquingKeysWith: { first, _ in first })
            return a.allSatisfy { key, value in bm[key] == value }
        default: return false
        }
    }

    public subscript(key: String) -> JSONValue? {
        guard case let .object(pairs) = self else { return nil }
        return pairs.first(where: { $0.0 == key })?.1
    }

    public var stringValue: String? {
        if case let .string(s) = self { return s }
        return nil
    }

    public var boolValue: Bool? {
        if case let .bool(b) = self { return b }
        return nil
    }

    /// Integer view; accepts integral doubles (JS has one number type).
    public var int64Value: Int64? {
        switch self {
        case let .int(i): return i
        case let .double(d):
            guard d.isFinite, d.rounded() == d, abs(d) < 9.0e18 else { return nil }
            return Int64(d)
        default: return nil
        }
    }

    public var doubleValue: Double? {
        switch self {
        case let .int(i): return Double(i)
        case let .double(d): return d
        default: return nil
        }
    }

    public var arrayValue: [JSONValue]? {
        if case let .array(a) = self { return a }
        return nil
    }

    // MARK: Serialization

    public func serialized() -> String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .int(i): out += String(i)
        case let .double(d): out += JSONValue.formatDouble(d)
        case let .string(s): JSONValue.writeString(s, into: &out)
        case let .array(items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case let .object(pairs):
            out += "{"
            for (i, pair) in pairs.enumerated() {
                if i > 0 { out += "," }
                JSONValue.writeString(pair.0, into: &out)
                out += ":"
                pair.1.write(into: &out)
            }
            out += "}"
        }
    }

    /// Non-finite numbers are not JSON; they serialize as 0. Integral values
    /// print without a fraction; others with up to 3 decimals.
    static func formatDouble(_ d: Double) -> String {
        guard d.isFinite else { return "0" }
        let rounded = (d * 1000).rounded() / 1000
        if rounded == rounded.rounded(), abs(rounded) < 1e15 {
            return String(Int64(rounded))
        }
        var s = String(format: "%.3f", rounded)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 || scalar == "\u{2028}" || scalar == "\u{2029}" {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }

    // MARK: Parsing

    public static func parse(_ line: String) throws -> JSONValue {
        guard let data = line.data(using: .utf8) else { throw ProtocolError.malformed("not UTF-8") }
        let any: Any
        do {
            any = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        } catch {
            throw ProtocolError.malformed("invalid JSON")
        }
        return fromFoundation(any)
    }

    static func fromFoundation(_ any: Any) -> JSONValue {
        switch any {
        case is NSNull: return .null
        case let s as String: return .string(s)
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            if CFNumberIsFloatType(n) { return .double(n.doubleValue) }
            return .int(n.int64Value)
        case let a as [Any]: return .array(a.map(fromFoundation))
        case let o as [String: Any]:
            return .object(o.keys.sorted().map { ($0, fromFoundation(o[$0] as Any)) })
        default: return .null
        }
    }
}

public enum ProtocolError: Error, Equatable, CustomStringConvertible {
    case malformed(String)
    case unknownType(String)
    case invalidField(String)

    public var code: String {
        switch self {
        case .malformed, .invalidField: return "badRequest"
        case .unknownType: return "unknownCommand"
        }
    }

    public var description: String {
        switch self {
        case let .malformed(m): return "malformed message: \(m)"
        case let .unknownType(t): return "unknown message type: \(t)"
        case let .invalidField(f): return "invalid or missing field: \(f)"
        }
    }
}
