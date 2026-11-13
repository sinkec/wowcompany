//! `cargo run -p wowlog --example chat_loot -- <WoWChatLog.txt> [year]` – counts loot lines the parser understands
//! (for checking a real chat log; prints only counts and item names, no player names).
use std::collections::BTreeMap;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: chat_loot <WoWChatLog.txt> [year]");
    let year: i64 = args.next().and_then(|y| y.parse().ok()).unwrap_or(2026);
    let text = std::fs::read(&path).expect("read");
    let text = String::from_utf8_lossy(&text);
    let (mut raw, mut parsed, mut mine, mut others) = (0, 0, 0, 0);
    let mut items: BTreeMap<String, u32> = BTreeMap::new();
    for line in text.lines() {
        if line.contains("receive loot:") || line.contains("receives loot:") {
            raw += 1;
        }
        if let Some(l) = wowlog::parse_loot_line(line, year) {
            parsed += 1;
            if l.looter.is_none() { mine += 1 } else { others += 1 }
            *items.entry(l.item).or_default() += l.count;
        }
    }
    println!("loot lines: {raw}  parsed: {parsed}  (you: {mine}, others: {others})");
    for (item, n) in items.iter().take(15) {
        println!("  {n:>3} × {item}");
    }
}
