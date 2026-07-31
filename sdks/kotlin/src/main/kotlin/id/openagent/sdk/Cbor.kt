package id.openagent.sdk

/** A CBOR value, covering the data model subset the ACT format uses. */
internal sealed interface CborValue {
    @JvmInline value class Uint(val value: ULong) : CborValue
    @JvmInline value class Nint(val value: ULong) : CborValue
    @JvmInline value class Bytes(val value: ByteArray) : CborValue
    @JvmInline value class Text(val value: String) : CborValue
    @JvmInline value class Array(val value: List<CborValue>) : CborValue
    @JvmInline value class Map(val value: List<Pair<CborValue, CborValue>>) : CborValue
    @JvmInline value class Simple(val value: Boolean?) : CborValue
    @JvmInline value class Other(val tag: Int) : CborValue

    fun asText(): String? = (this as? Text)?.value

    fun asBytes(): ByteArray? = (this as? Bytes)?.value

    fun asInt(): Long? =
        when (this) {
            is Uint -> if (value <= Long.MAX_VALUE.toULong()) value.toLong() else null
            is Nint -> if (value <= Long.MAX_VALUE.toULong()) -1 - value.toLong() else null
            else -> null
        }

    fun asArray(): List<CborValue>? = (this as? Array)?.value

    fun lookup(key: String): CborValue? =
        (this as? Map)?.value?.firstOrNull { (k, _) -> k.asText() == key }?.second
}

/**
 * A scoped CBOR decoder (RFC 8949) for the ACT envelope and claim set.
 *
 * Supports definite-length items of every major type the ACT format can
 * carry. Indefinite-length items and tags are rejected: the canonical
 * format never produces them, so a token carrying them is malformed here,
 * which is the correct refusal.
 */
internal class CborDecoder(private val data: ByteArray) {
    private var offset = 0

    fun decode(): CborValue = decodeValue()

    private fun take(count: Int): ByteArray {
        if (offset + count > data.size) {
            throw OpenAgentError.EnvelopeDecode("truncated CBOR: need $count bytes at $offset")
        }
        val slice = data.copyOfRange(offset, offset + count)
        offset += count
        return slice
    }

    private fun takeByte(): Int = take(1)[0].toInt() and 0xFF

    private fun takeLength(additional: Int): ULong =
        when (additional) {
            in 0..23 -> additional.toULong()
            24 -> takeByte().toULong()
            25 -> {
                val b = take(2)
                ((b[0].toInt() and 0xFF shl 8) or (b[1].toInt() and 0xFF)).toULong()
            }
            26 -> {
                val b = take(4)
                ((b[0].toInt() and 0xFF shl 24) or (b[1].toInt() and 0xFF shl 16) or
                    (b[2].toInt() and 0xFF shl 8) or (b[3].toInt() and 0xFF)).toULong()
            }
            27 -> {
                val b = take(8)
                var value = 0UL
                for (byte in b) value = (value shl 8) or (byte.toInt() and 0xFF).toULong()
                value
            }
            31 ->
                throw OpenAgentError.EnvelopeDecode(
                    "indefinite-length items are not part of the canonical format")
            else -> throw OpenAgentError.EnvelopeDecode("invalid additional information $additional")
        }

    private fun decodeValue(): CborValue {
        val initial = takeByte()
        val major = initial ushr 5
        val additional = initial and 0x1f

        return when (major) {
            0 -> CborValue.Uint(takeLength(additional))
            1 -> CborValue.Nint(takeLength(additional))
            2 -> {
                val length = takeLength(additional)
                if (length > Int.MAX_VALUE.toULong()) {
                    throw OpenAgentError.EnvelopeDecode("byte string too long")
                }
                CborValue.Bytes(take(length.toInt()))
            }
            3 -> {
                val length = takeLength(additional)
                if (length > Int.MAX_VALUE.toULong()) {
                    throw OpenAgentError.EnvelopeDecode("text string too long")
                }
                CborValue.Text(String(take(length.toInt()), Charsets.UTF_8))
            }
            4 -> {
                val length = takeLength(additional)
                if (length > Int.MAX_VALUE.toULong()) {
                    throw OpenAgentError.EnvelopeDecode("array too long")
                }
                CborValue.Array((0 until length.toInt()).map { decodeValue() })
            }
            5 -> {
                val length = takeLength(additional)
                if (length > Int.MAX_VALUE.toULong()) {
                    throw OpenAgentError.EnvelopeDecode("map too long")
                }
                CborValue.Map((0 until length.toInt()).map { decodeValue() to decodeValue() })
            }
            6 -> throw OpenAgentError.EnvelopeDecode("tags are not part of the canonical format")
            7 ->
                when (additional) {
                    20 -> CborValue.Simple(false)
                    21 -> CborValue.Simple(true)
                    22 -> CborValue.Simple(null)
                    else -> CborValue.Other(initial)
                }
            else -> throw OpenAgentError.EnvelopeDecode("unknown major type $major")
        }
    }
}
