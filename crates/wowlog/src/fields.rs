//! Low-level helpers: splitting the CSV payload and converting single fields.

/// Splits the CSV payload of a combat log line (everything after the two spaces).
///
/// * `"quoted"` fields may contain commas (unit and spell names),
/// * `(...)` and `[...]` groups are kept together (used by `COMBATANT_INFO`).
///
/// Quotes are *not* stripped here; use [`text`] for that.
pub fn split(payload: &str) -> Vec<&str> {
    let mut out = Vec::with_capacity(48);
    let bytes = payload.as_bytes();
    let mut start = 0;
    let mut depth = 0i32;
    let mut in_quotes = false;
    for (i, &c) in bytes.iter().enumerate() {
        match c {
            b'"' => in_quotes = !in_quotes,
            b'(' | b'[' if !in_quotes => depth += 1,
            b')' | b']' if !in_quotes => depth -= 1,
            b',' if !in_quotes && depth <= 0 => {
                out.push(&payload[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&payload[start..]);
    out
}

/// A text field: strips surrounding quotes, `nil` → `None`.
pub fn text(f: &str) -> Option<String> {
    let f = f.trim();
    if f == "nil" {
        return None;
    }
    let f = f.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(f);
    Some(f.to_string())
}

/// Integer field. `nil` → 0. Accepts `0x` hex and decimals with a fraction (truncated).
pub fn int(f: &str) -> Option<i64> {
    let f = f.trim();
    if f == "nil" {
        return Some(0);
    }
    if let Some(hex) = f.strip_prefix("0x").or_else(|| f.strip_prefix("0X")) {
        return i64::from_str_radix(hex, 16).ok();
    }
    f.parse::<i64>()
        .ok()
        .or_else(|| f.parse::<f64>().ok().map(|v| v as i64))
}

/// Hex flags field (`0x518`). `nil` → 0.
pub fn hex(f: &str) -> Option<u32> {
    let f = f.trim();
    if f == "nil" {
        return Some(0);
    }
    let h = f.strip_prefix("0x").or_else(|| f.strip_prefix("0X"))?;
    u32::from_str_radix(h, 16).ok()
}

/// Float field. `nil` → 0.0.
pub fn float(f: &str) -> Option<f64> {
    let f = f.trim();
    if f == "nil" {
        return Some(0.0);
    }
    f.parse::<f64>().ok()
}

/// Boolean flag: `1` → true; `nil`, `0`, empty → false.
pub fn flag(f: &str) -> bool {
    matches!(f.trim(), "1" | "true")
}

/// `true` if the field looks like a unit GUID (`Player-…`, `Creature-…`, or the empty GUID).
pub fn is_guid(f: &str) -> bool {
    f == "0000000000000000"
        || (f.contains('-') && f.as_bytes().first().is_some_and(|c| c.is_ascii_alphabetic()) && !f.starts_with('"'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quotes_and_groups() {
        let f = split(r#"A,"Kel'Thuzad, Lich",0x10,[(1,2),(3)],nil"#);
        assert_eq!(f, vec!["A", r#""Kel'Thuzad, Lich""#, "0x10", "[(1,2),(3)]", "nil"]);
    }

    #[test]
    fn converts_fields() {
        assert_eq!(text(r#""Fire Blast""#).as_deref(), Some("Fire Blast"));
        assert_eq!(text("nil"), None);
        assert_eq!(int("-1"), Some(-1));
        assert_eq!(int("9.0000"), Some(9));
        assert_eq!(hex("0x518"), Some(0x518));
        assert!(flag("1") && !flag("nil"));
        assert!(is_guid("Player-1-0000000A") && is_guid("0000000000000000"));
        assert!(!is_guid("52") && !is_guid("-1"));
    }
}
