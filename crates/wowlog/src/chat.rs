//! `WoWChatLog.txt` (`/chatlog`): only the loot lines are interesting.
//!
//! Verified on a real Forever chat log (13. 11. 2026): plain item names without brackets,
//! stack count glued on (`Linen Clothx3`), trailing dot only for other players, timestamps
//! without year (`11/13 18:39:24.307`), looters as `Firstname Surname`. Also accepted
//! (other WoW versions):
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

/// `Linen Clothx3` → (`Linen Cloth`, 3); `Linen Cloth` → (`Linen Cloth`, 1).
fn split_count(s: &str) -> (String, u32) {
    if let Some(i) = s.rfind('x') {
        let (name, digits) = (&s[..i], &s[i + 1..]);
        if !name.is_empty()
            && !digits.is_empty()
            && digits.bytes().all(|b| b.is_ascii_digit())
            && let Ok(n) = digits.parse::<u32>()
            && n > 0
        {
            return (name.trim_end().to_string(), n);
        }
    }
    (s.to_string(), 1)
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

    let (item, count) = match rest.find('[') {
        // bracketed / linked item: "[Linen Cloth]x2." or "|c…|h[Linen Cloth]|h|rx2."
        Some(open) => {
            let close = rest[open..].find(']')? + open;
            let item = rest[open + 1..close].trim().to_string();
            // count: "x2" somewhere after the closing bracket (link tail "|h|r" may sit in between)
            let after = &rest[close + 1..];
            let count = after
                .find('x')
                .map(|i| &after[i + 1..])
                .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
                .and_then(|d| d.parse::<u32>().ok())
                .filter(|&n| n > 0)
                .unwrap_or(1);
            (item, count)
        }
        // Forever (verified 13. 11. 2026): plain name, "x2" glued on, trailing dot only for others:
        //   "You receive loot: Linen Clothx3" / "Name Surname receives loot: Wool Clothx2."
        None => split_count(rest.trim().trim_end_matches('.').trim()),
    };
    if item.is_empty() {
        return None;
    }

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
    fn forever_format_plain_names() {
        // shapes from a real Forever chat log (names/items replaced)
        let a = parse_loot_line("11/13 18:39:24.307  You receive loot: Warped Leather Bracers", 2026).unwrap();
        assert_eq!(
            (a.looter.as_deref(), a.item.as_str(), a.count, a.quality),
            (None, "Warped Leather Bracers", 1, None)
        );
        let b = parse_loot_line("11/13 18:51:10.325  You receive loot: Linen Clothx3", 2026).unwrap();
        assert_eq!((b.item.as_str(), b.count), ("Linen Cloth", 3));
        let c = parse_loot_line(
            "11/13 18:57:03.091  Grobos Stinkfoot receives loot: Wool Clothx2.",
            2026,
        )
        .unwrap();
        assert_eq!(
            (c.looter.as_deref(), c.item.as_str(), c.count),
            (Some("Grobos Stinkfoot"), "Wool Cloth", 2)
        );
        let d = parse_loot_line(
            "11/13 18:57:04.000  Grobos Stinkfoot receives loot: Box of Bolts.",
            2026,
        )
        .unwrap();
        assert_eq!((d.item.as_str(), d.count), ("Box of Bolts", 1));
        assert_eq!(split_count("Sphinx"), ("Sphinx".to_string(), 1));
        assert_eq!(
            parse_loot_line(
                "11/13 18:57:05.000  Grobos Stinkfoot creates Heavy Linen Bandage.",
                2026
            ),
            None
        );
        assert_eq!(
            parse_loot_line("11/13 18:57:06.000  Your share of the loot is 7 Silver.", 2026),
            None
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
