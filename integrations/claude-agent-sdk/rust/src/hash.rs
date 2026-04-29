//! Cryptographic hashing helpers used by the audit chain.

use serde::Serialize;

/// Hash a byte buffer with BLAKE3 and return lowercase hex.
pub fn hash_hex(bytes: &[u8]) -> String {
    let h = blake3::hash(bytes);
    hex::encode(h.as_bytes())
}

/// Stable JSON serialisation (object keys sorted) for canonical hashing.
///
/// `serde_json` orders object keys lexicographically when using
/// `serde_json::to_value` over a `BTreeMap`-like structure. We canonicalise
/// by round-tripping through `serde_json::Value` and re-emitting via a
/// helper that sorts maps.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let v = serde_json::to_value(value)?;
    let sorted = sort_value(&v);
    Ok(serde_json::to_string(&sorted)?)
}

/// Hash a serialisable value via canonical JSON.
pub fn hash_value<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let s = canonical_json(value)?;
    Ok(hash_hex(s.as_bytes()))
}

fn sort_value(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<(String, serde_json::Value)> = map
                .iter()
                .map(|(k, val)| (k.clone(), sort_value(val)))
                .collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out = serde_json::Map::new();
            for (k, val) in entries {
                out.insert(k, val);
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sort_value).collect())
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_orders_keys() {
        let a = canonical_json(&json!({"b": 1, "a": 2})).unwrap_or_default();
        let b = canonical_json(&json!({"a": 2, "b": 1})).unwrap_or_default();
        assert_eq!(a, b);
    }

    #[test]
    fn nested_objects_sort_recursively() {
        let a = canonical_json(&json!({"x": {"b": 1, "a": 2}})).unwrap_or_default();
        let b = canonical_json(&json!({"x": {"a": 2, "b": 1}})).unwrap_or_default();
        assert_eq!(a, b);
    }

    #[test]
    fn hash_hex_is_stable() {
        assert_eq!(hash_hex(b"hello"), hash_hex(b"hello"));
        assert_ne!(hash_hex(b"hello"), hash_hex(b"world"));
    }
}
