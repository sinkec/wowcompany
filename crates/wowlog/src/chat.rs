//! `WoWChatLog.txt` (`/chatlog`): only the loot lines are interesting.
//!
//! **Not verified on a Forever chat log yet** (COMPANION.md §14 B1) – the parser is
//! deliberately tolerant:
//! * timestamp with or without year (`11/13 18:00:01.123` or `11/13/2026 18:00:01.1234`),
//! * item as plain `[Linen Cloth]` or as a raw link `|cff1eff00|Hitem:2589::…|h[Linen Cloth]|h|r`,
//! * `You receive loot: …` (the log writer) and `Name receives loot: …` (party members),
//! * stack count `x2` after the item, trailing dot optional.

use crate::time;

#[derive(Debug, Clone, PartialEq)]
pub struct Loot {
    /// Naive local milliseconds (same clock as the combat log).
    pub timestamp: i64,
    /// `None` = the person who wrote the log ("You receive loot").
    pub looter: Option<String>,
    pub item: String,
    pub item_id: Option<u32>,
    /// 0 poor … 5 legendary, from the link colour when present.
    pub quality: Option<u8>,
    pub count: u32,
}

/// Item quality from a link colour code (`|cffa335ee` → epic).
fn quality_of(color: &str) -> Option<u8> {
    match color.to_ascii_lowercase().as_str() {
        "9d9d9d" => Some(0),
        "ffffff" => Some(1),
        "1eff00" => Some(2),
        "0070dd" | "0070de" => Some(3),
        "a335ee" => Some(4),
        "ff8000" => Some(5),
        "e6cc80" => Some(6),
        _ => None,
    }
}

/// Parses one chat log line; `Some` only for loot lines. `default_year` is used when the
/// timestamp has no year (pass the year of the file's modification time).
pub fn parse_loot_line(line: &str, default_year: i64) -> Option<Loot> {
    let line = line.trim_start_matches('\u{feff}').trim_end_matches(['\r', '\n']);
    let (ts, text) = line.split_once("  ")?;
    let timestamp = time::parse_with_year(ts, default_year)?;
    let text = text.trim();

    let (who, rest) = if let Some(r) = text.strip_prefix("You receive loot:") {
        (None, r)
    } else {
        let idx = text.find(" receives loot:")?;
        let name = text[..idx].trim();
        if name.is_empty() || name.len() > 64 {
            return None;
        }
        (Some(name.to_string()), &text[idx + " receives loot:".len()..])
    };
    let rest = rest.trim();

    // optional link parts
    let quality = rest
        .find("|c")
        .and_then(|i| rest.get(i + 4..i + 10))
        .and_then(quality_of);
    let item_id = rest
        .find("|Hitem:")
        .map(|i| &rest[i + 7..])
        .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|d| d.parse().ok());

    let open = rest.find('[')?;
    let close = rest[open..].find(']')? + open;
    let item = rest[open + 1..close].trim().to_string();
    if item.is_empty() {
        return None;
    }
    // count: "x2" somewhere after the closing bracket (link tail "|h|r" may sit in between)
    let after = &rest[close + 1..];
    let count = after
        .find('x')
        .map(|i| &after[i + 1..])
        .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|d| d.parse::<u32>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(1);

    Some(Loot {
        timestamp,
        looter: who,
        item,
        item_id,
        quality,
        count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_and_linked_loot_lines() {
        let a = parse_loot_line("11/20 20:00:05.123  You receive loot: [Linen Cloth]x2.", 2026).unwrap();
        assert_eq!(a.looter, None);
        assert_eq!(
            (a.item.as_str(), a.count, a.item_id, a.quality),
            ("Linen Cloth", 2, None, None)
        );
        assert_eq!(time::format(a.timestamp), "2026-11-20 20:00:05.123");

        let b = parse_loot_line(
            "11/20/2026 20:00:06.5000  Fizzle receives loot: |cff0070dd|Hitem:2084::::::::18:::::::|h[Darksteel Bastard Sword]|h|r.",
            1999,
        )
        .unwrap();
        assert_eq!(b.looter.as_deref(), Some("Fizzle"));
        assert_eq!(b.item, "Darksteel Bastard Sword");
        assert_eq!(b.item_id, Some(2084));
        assert_eq!(b.quality, Some(3));
        assert_eq!(b.count, 1);
        assert_eq!(time::format(b.timestamp), "2026-11-20 20:00:06.500");

        let c = parse_loot_line(
            "11/20 20:00:07.000  Mendy-Bandage receives loot: |cffffffff|Hitem:4306:::|h[Silk Cloth]|h|rx3.",
            2026,
        )
        .unwrap();
        assert_eq!(
            (c.looter.as_deref(), c.count, c.quality),
            (Some("Mendy-Bandage"), 3, Some(1))
        );
    }

    #[test]
    fn ignores_everything_else() {
        for l in [
            "11/20 20:00:05.123  [Guild] Fizzle: anyone need [Linen Cloth]?",
            "11/20 20:00:05.123  You loot 5 Silver, 3 Copper",
            "11/20 20:00:05.123  Fizzle has selected Need for: [Sword]",
            "11/20 20:00:05.123  Fizzle won: [Sword]",
            "garbage",
            "",
        ] {
            assert_eq!(parse_loot_line(l, 2026), None, "{l}");
        }
    }
}
