//! Personal records of the log owner from a whole combat log (open world included):
//! `cargo run -p wowrun --example personal -- <WoWCombatLog.txt>`
//! Prints what the Companion would send to `POST /companion/records` (own character only).

fn main() {
    let path = std::env::args().nth(1).expect("usage: personal <combat log>");
    let mut personal = wowrun::Personal::new(0);
    let (mut lines, mut bad) = (0u64, 0u64);
    for rec in wowlog::open(&path).expect("cannot open log") {
        lines += 1;
        match rec {
            Ok(Ok(r)) => personal.push(&r),
            _ => bad += 1,
        }
    }
    eprintln!("{lines} lines, {bad} bad");
    println!("{}", serde_json::to_string_pretty(&personal.upload()).expect("json"));
}
