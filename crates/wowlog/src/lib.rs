//! Parser for WoW combat log files as written by **WoW Forever** (`COMBAT_LOG_VERSION,22`,
//! the same family as Classic Era / Anniversary).
//!
//! ```no_run
//! for item in wowlog::open("WoWCombatLog-111326_173926.txt").unwrap() {
//!     match item.unwrap() {
//!         Ok(record) => println!("{} {}", record.event, record.source.name.unwrap_or_default()),
//!         Err(bad) => eprintln!("line {}: {}", bad.line_no, bad.error),
//!     }
//! }
//! ```
//!
//! The crate has no dependencies and no I/O besides [`open`]; the desktop app
//! tails the file itself and feeds lines into [`parse_line`].

pub mod chat;
pub mod event;
pub mod fields;
pub mod reader;
pub mod time;
pub mod unit;

pub use chat::{Loot, parse_loot_line};
pub use event::{
    AuraChange, AuraType, CastPhase, Damage, DamageSource, DeathKind, Heal, Kind, Miss, ParseError, Record, parse_line,
};
pub use reader::{BadLine, Reader, open};
pub use unit::{Advanced, Spell, Unit, player_slug};
