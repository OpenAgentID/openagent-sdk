import Foundation

/// A CBOR value, covering the data model subset the ACT format uses:
/// unsigned/negative integers, byte strings, text strings, arrays, maps,
/// and the simple values false/true/null.
indirect enum CBORValue {
    case uint(UInt64)
    case nint(UInt64) // encoded value; actual is -1 - n
    case bytes([UInt8])
    case text(String)
    case array([CBORValue])
    case map([(CBORValue, CBORValue)])
    case simple(Bool?)
    case other(UInt8) // simple/float we do not interpret

    var asText: String? {
        if case let .text(s) = self { return s }
        return nil
    }

    var asBytes: [UInt8]? {
        if case let .bytes(b) = self { return b }
        return nil
    }

    var asInt: Int64? {
        switch self {
        case let .uint(u): return u <= UInt64(Int64.max) ? Int64(u) : nil
        case let .nint(n):
            guard n <= UInt64(Int64.max) else { return nil }
            return -1 - Int64(n)
        default: return nil
        }
    }

    var asArray: [CBORValue]? {
        if case let .array(a) = self { return a }
        return nil
    }

    func lookup(_ key: String) -> CBORValue? {
        guard case let .map(entries) = self else { return nil }
        return entries.first { $0.0.asText == key }?.1
    }
}

/// A scoped CBOR decoder (RFC 8949) for the ACT envelope and claim set.
///
/// Supports definite-length items of every major type the ACT format can
/// carry. Indefinite-length items and tags are rejected: the canonical
/// format never produces them, so a token carrying them is malformed here,
/// which is the correct refusal.
struct CBORDecoder {
    private var data: [UInt8]
    private var offset = 0

    init(_ bytes: [UInt8]) {
        self.data = bytes
    }

    mutating func decode() throws -> CBORValue {
        let value = try decodeValue()
        return value
    }

    private mutating func take(_ count: Int) throws -> [UInt8] {
        guard offset + count <= data.count else {
            throw OpenAgentError.envelopeDecode("truncated CBOR: need \(count) bytes at \(offset)")
        }
        let slice = Array(data[offset..<(offset + count)])
        offset += count
        return slice
    }

    private mutating func takeByte() throws -> UInt8 {
        let bytes = try take(1)
        return bytes[0]
    }

    private mutating func takeLength(_ additional: UInt8) throws -> UInt64 {
        switch additional {
        case 0..<24:
            return UInt64(additional)
        case 24:
            return UInt64(try takeByte())
        case 25:
            let b = try take(2)
            return UInt64(b[0]) << 8 | UInt64(b[1])
        case 26:
            let b = try take(4)
            return UInt64(b[0]) << 24 | UInt64(b[1]) << 16 | UInt64(b[2]) << 8 | UInt64(b[3])
        case 27:
            let b = try take(8)
            var value: UInt64 = 0
            for byte in b { value = value << 8 | UInt64(byte) }
            return value
        case 31:
            throw OpenAgentError.envelopeDecode("indefinite-length items are not part of the canonical format")
        default:
            throw OpenAgentError.envelopeDecode("invalid additional information \(additional)")
        }
    }

    private mutating func decodeValue() throws -> CBORValue {
        let initial = try takeByte()
        let major = initial >> 5
        let additional = initial & 0x1f

        switch major {
        case 0:
            return .uint(try takeLength(additional))
        case 1:
            return .nint(try takeLength(additional))
        case 2:
            let length = try takeLength(additional)
            guard length <= UInt64(Int.max) else {
                throw OpenAgentError.envelopeDecode("byte string too long")
            }
            return .bytes(try take(Int(length)))
        case 3:
            let length = try takeLength(additional)
            guard length <= UInt64(Int.max) else {
                throw OpenAgentError.envelopeDecode("text string too long")
            }
            let bytes = try take(Int(length))
            guard let text = String(bytes: bytes, encoding: .utf8) else {
                throw OpenAgentError.envelopeDecode("text string is not valid UTF-8")
            }
            return .text(text)
        case 4:
            let length = try takeLength(additional)
            guard length <= UInt64(Int.max) else {
                throw OpenAgentError.envelopeDecode("array too long")
            }
            var items: [CBORValue] = []
            items.reserveCapacity(Int(length))
            for _ in 0..<length {
                items.append(try decodeValue())
            }
            return .array(items)
        case 5:
            let length = try takeLength(additional)
            guard length <= UInt64(Int.max) else {
                throw OpenAgentError.envelopeDecode("map too long")
            }
            var entries: [(CBORValue, CBORValue)] = []
            entries.reserveCapacity(Int(length))
            for _ in 0..<length {
                let key = try decodeValue()
                let value = try decodeValue()
                entries.append((key, value))
            }
            return .map(entries)
        case 6:
            throw OpenAgentError.envelopeDecode("tags are not part of the canonical format")
        case 7:
            switch additional {
            case 20: return .simple(false)
            case 21: return .simple(true)
            case 22: return .simple(nil)
            case 23: return .other(initial) // undefined
            default: return .other(initial) // floats and other simple values
            }
        default:
            throw OpenAgentError.envelopeDecode("unknown major type \(major)")
        }
    }
}
