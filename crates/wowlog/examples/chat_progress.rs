//! Sums the log writer's gains in a chat log: `cargo run -p wowlog --example chat_progress -- <WoWChatLog.txt>`
use std::io::BufRead;

fn main() {
    let path = std::env::args().nth(1).expect("usage: chat_progress <WoWChatLog.txt>");
    let file = std::io::BufReader::new(std::fs::File::open(&path).expect("open"));
    let (mut xp, mut copper, mut lines) = (0u64, 0u64, 0u32);
    for line in file.lines().map_while(Result::ok) {
        if let Some(p) = wowlog::parse_progress_line(&line, 2026) {
            lines += 1;
            match p.progress {
                wowlog::Progress::Xp { amount, .. } => xp += u64::from(amount),
                wowlog::Progress::Money { copper: c, .. } => copper += c,
                other => println!("{other:?}"),
            }
        }
    }
    eprintln!("progress lines {lines}, xp {xp}, money {copper} copper");
}
