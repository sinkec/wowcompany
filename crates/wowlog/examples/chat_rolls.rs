//! Prints every need/greed roll message of a chat log: `cargo run -p wowlog --example chat_rolls -- <WoWChatLog.txt>`
use std::io::BufRead;

fn main() {
    let path = std::env::args().nth(1).expect("usage: chat_rolls <WoWChatLog.txt>");
    let file = std::io::BufReader::new(std::fs::File::open(&path).expect("open"));
    let (mut rolls, mut unparsed) = (0, 0);
    for line in file.lines().map_while(Result::ok) {
        let is_roll_line = line.split_once("  ").is_some_and(|(_, t)| t.starts_with("Loot:"));
        match wowlog::parse_roll_line(&line, 2026) {
            Some(r) => {
                rolls += 1;
                println!("{:?} {:?} {}", r.event, r.who, r.item);
            }
            None if is_roll_line => {
                unparsed += 1;
                eprintln!("UNPARSED {line}");
            }
            None => {}
        }
    }
    eprintln!("rolls {rolls}, unparsed Loot: lines {unparsed}");
}
