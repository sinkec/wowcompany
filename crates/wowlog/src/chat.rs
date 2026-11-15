//! `WoWChatLog.txt` (`/chatlog`): loot lines and need/greed rolls are interesting.
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

/// A need/greed choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RollChoice {
    Need,
    Greed,
    Pass,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RollEvent {
    /// `Loot: Item` – a roll starts for an item.
    Start,
    /// `Loot: X has selected Need for: Item` / `Loot: You have selected Greed for: Item` /
    /// `Loot: X passed on: Item`.
    Choice(RollChoice),
    /// `Loot: Greed Roll - 97 for Item by X`.
    Rolled(RollChoice, u32),
    /// `Loot: X won: Item` / `Loot: You won: Item`.
    Won,
}

/// One roll message. Verified on a real Forever chat log (15. 11. 2026, Wailing Caverns, 338 lines).
#[derive(Debug, Clone, PartialEq)]
pub struct Roll {
    /// Naive local milliseconds (same clock as the combat log).
    pub timestamp: i64,
    /// `None` = the person who wrote the log ("You"), and for `Start`.
    pub who: Option<String>,
    pub item: String,
    pub event: RollEvent,
}

fn who_of(s: &str) -> Option<Option<String>> {
    let s = s.trim();
    if s.is_empty() || s.len() > 64 {
        return None;
    }
    Some((s != "You").then(|| s.to_string()))
}

fn choice_of(s: &str) -> Option<RollChoice> {
    match s {
        "Need" => Some(RollChoice::Need),
        "Greed" => Some(RollChoice::Greed),
        _ => None,
    }
}

/// Item name from the end of a roll message: plain (Forever) or `[Item]` / a raw link.
fn roll_item(s: &str) -> Option<String> {
    let s = s.trim().trim_end_matches('.');
    let name = match (s.find('['), s.rfind(']')) {
        (Some(a), Some(b)) if b > a => &s[a + 1..b],
        _ => s,
    };
    let name = name.trim();
    (!name.is_empty() && name.len() <= 120).then(|| name.to_string())
}

/// Parses one chat log line; `Some` only for need/greed roll messages (they start with `Loot:`).
pub fn parse_roll_line(line: &str, default_year: i64) -> Option<Roll> {
    let line = line.trim_start_matches('\u{feff}').trim_end_matches(['\r', '\n']);
    let (ts, text) = line.split_once("  ")?;
    let timestamp = time::parse_with_year(ts, default_year)?;
    let text = text.trim().strip_prefix("Loot:")?.trim();

    // "Greed Roll - 97 for Item by Name" (item names may contain ": " or " by ", so cut from the end)
    for (prefix, choice) in [("Need Roll - ", RollChoice::Need), ("Greed Roll - ", RollChoice::Greed)] {
        if let Some(rest) = text.strip_prefix(prefix) {
            let (value, rest) = rest.split_once(" for ")?;
            let (item, who) = rest.rsplit_once(" by ")?;
            return Some(Roll {
                timestamp,
                who: who_of(who)?,
                item: roll_item(item)?,
                event: RollEvent::Rolled(choice, value.trim().parse().ok()?),
            });
        }
    }
    // "X has selected Need for: Item" / "You have selected Greed for: Item"
    for sep in [" has selected ", " have selected "] {
        if let Some((who, rest)) = text.split_once(sep) {
            let (choice, item) = rest.split_once(" for: ")?;
            return Some(Roll {
                timestamp,
                who: who_of(who)?,
                item: roll_item(item)?,
                event: RollEvent::Choice(choice_of(choice.trim())?),
            });
        }
    }
    // "X passed on: Item" / "You automatically passed on: Item because you cannot loot that item."
    for sep in [" automatically passed on: ", " passed on: "] {
        if let Some((who, item)) = text.split_once(sep) {
            let item = item.split(" because ").next().unwrap_or(item);
            return Some(Roll {
                timestamp,
                who: who_of(who)?,
                item: roll_item(item)?,
                event: RollEvent::Choice(RollChoice::Pass),
            });
        }
    }
    if let Some((who, item)) = text.split_once(" won: ") {
        return Some(Roll {
            timestamp,
            who: who_of(who)?,
            item: roll_item(item)?,
            event: RollEvent::Won,
        });
    }
    // anything else after "Loot:" is the item a roll starts for
    Some(Roll {
        timestamp,
        who: None,
        item: roll_item(text)?,
        event: RollEvent::Start,
    })
}

/// Who leads the group, from system messages and party chat (the combat log does not say).
#[derive(Debug, Clone, PartialEq)]
pub enum GroupEvent {
    /// `X is now the group leader.`; `None` = "You are now the group leader."
    Leader(Option<String>),
    /// `X has invited you to join a group.` (only the leader can invite).
    Invited(String),
    /// `[Party Leader] X: …` in party chat – only the name is kept, never the text.
    LeaderSpoke(String),
    /// `You leave the group.` / `Your group has been disbanded.`
    Left,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupLine {
    /// Naive local milliseconds (same clock as the combat log).
    pub timestamp: i64,
    pub event: GroupEvent,
}

fn person(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.len() <= 64 && !s.contains(':') && !s.contains('[')).then(|| s.to_string())
}

/// Parses one chat log line; `Some` only for lines that say who leads the group
/// (shapes verified on a real Forever chat log, 15. 11. 2026).
pub fn parse_group_line(line: &str, default_year: i64) -> Option<GroupLine> {
    let line = line.trim_start_matches('\u{feff}').trim_end_matches(['\r', '\n']);
    let (ts, text) = line.split_once("  ")?;
    let timestamp = time::parse_with_year(ts, default_year)?;
    let text = text.trim();
    let event = if text == "You are now the group leader." {
        GroupEvent::Leader(None)
    } else if let Some(who) = text.strip_suffix(" is now the group leader.") {
        GroupEvent::Leader(Some(person(who)?))
    } else if let Some(who) = text.strip_suffix(" has invited you to join a group.") {
        GroupEvent::Invited(person(who)?)
    } else if text == "You leave the group." || text == "Your group has been disbanded." {
        GroupEvent::Left
    } else {
        // "|Hchannel:PARTY|h[Party Leader]|h Name: text" or "[Party Leader] Name: text"
        let i = text.find("[Party Leader]")?;
        let rest = text[i + "[Party Leader]".len()..].trim_start_matches("|h").trim_start();
        let (who, _) = rest.split_once(": ")?;
        GroupEvent::LeaderSpoke(person(who)?)
    };
    Some(GroupLine { timestamp, event })
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

    #[test]
    fn forever_roll_messages() {
        let p = |l: &str| parse_roll_line(l, 2026).unwrap();
        // shapes from the real Forever chat log of 15. 11. 2026 (names replaced)
        let start = p("11/15 14:31:05.317  Loot: Waylaid Crate: Apprentice Fabrics");
        assert_eq!(
            (start.who, start.item.as_str(), start.event),
            (None, "Waylaid Crate: Apprentice Fabrics", RollEvent::Start)
        );
        let a = p("11/15 14:53:45.298  Loot: Grobos Stinkfoot has selected Greed for: Gleaming Claymore of the Wolf");
        assert_eq!(a.who.as_deref(), Some("Grobos Stinkfoot"));
        assert_eq!(a.event, RollEvent::Choice(RollChoice::Greed));
        assert_eq!(a.item, "Gleaming Claymore of the Wolf");
        let me = p("11/15 14:53:47.915  Loot: You have selected Need for: Slither Cord");
        assert_eq!((me.who, me.event), (None, RollEvent::Choice(RollChoice::Need)));
        let pass = p("11/15 14:53:51.217  Loot: Воля Незламна passed on: Gleaming Claymore of the Wolf");
        assert_eq!(
            (pass.who.as_deref(), pass.event),
            (Some("Воля Незламна"), RollEvent::Choice(RollChoice::Pass))
        );
        let r = p("11/15 14:53:51.219  Loot: Greed Roll - 97 for Waylaid Crate: Apprentice Fabrics by Fizzle Boom");
        assert_eq!(r.item, "Waylaid Crate: Apprentice Fabrics");
        assert_eq!(
            (r.who.as_deref(), r.event),
            (Some("Fizzle Boom"), RollEvent::Rolled(RollChoice::Greed, 97))
        );
        let w = p("11/15 14:53:51.223  Loot: Fizzle Boom won: Gleaming Claymore of the Wolf");
        assert_eq!((w.who.as_deref(), w.event), (Some("Fizzle Boom"), RollEvent::Won));
        let mine = p("11/15 14:59:42.798  Loot: You won: Hook Dagger of Intellect");
        assert_eq!((mine.who, mine.event), (None, RollEvent::Won));
        let auto = p(
            "11/15 14:59:43.000  Loot: You automatically passed on: Plans: Guard's Chain Shirt because you cannot loot that item.",
        );
        assert_eq!(
            (auto.item.as_str(), auto.event),
            ("Plans: Guard's Chain Shirt", RollEvent::Choice(RollChoice::Pass))
        );
        // other chat lines are not rolls; loot lines are not rolls either
        assert_eq!(
            parse_roll_line(
                "11/15 14:53:51.291  Fizzle Boom receives loot: Gleaming Claymore of the Wolf.",
                2026
            ),
            None
        );
        assert_eq!(
            parse_roll_line(
                "11/15 14:54:13.120  Deviate Crocolisk dies, you gain 18 experience.",
                2026
            ),
            None
        );
        assert_eq!(
            parse_roll_line("11/15 14:54:13.120  Loot: Need Roll - x for Sword by Fizzle", 2026),
            None
        );
    }

    #[test]
    fn group_leader_lines() {
        let p = |l: &str| parse_group_line(l, 2026).map(|g| g.event);
        assert_eq!(
            p("11/15 13:20:00.000  You are now the group leader."),
            Some(GroupEvent::Leader(None))
        );
        assert_eq!(
            p("11/15 13:20:01.000  Fizzle Boom is now the group leader."),
            Some(GroupEvent::Leader(Some("Fizzle Boom".into())))
        );
        assert_eq!(
            p("11/15 13:20:02.000  Fizzle Boom has invited you to join a group."),
            Some(GroupEvent::Invited("Fizzle Boom".into()))
        );
        assert_eq!(
            p("11/15 14:40:00.000  |Hchannel:PARTY|h[Party Leader]|h Fizzle Boom: yeah im trying :("),
            Some(GroupEvent::LeaderSpoke("Fizzle Boom".into()))
        );
        assert_eq!(
            p("11/15 14:40:01.000  [Party Leader] Воля Незламна: go"),
            Some(GroupEvent::LeaderSpoke("Воля Незламна".into()))
        );
        assert_eq!(p("11/15 15:40:00.000  You leave the group."), Some(GroupEvent::Left));
        // ordinary party chat and loot are not about the leader
        assert_eq!(
            p("11/15 14:40:02.000  |Hchannel:PARTY|h[Party]|h Fizzle Boom: is now the group leader."),
            None
        );
        assert_eq!(p("11/15 14:40:03.000  Fizzle Boom receives loot: Linen Cloth."), None);
    }
}
