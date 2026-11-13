//! Dungeon run detection and analysis for WowCompany Companion.
//!
//! Feed parsed [`wowlog::Record`]s into a [`Detector`]; it returns a [`RunSummary`]
//! (serde, camelCase JSON) whenever a run finishes. Everything happens on the PC; only
//! the summary – group players only – is uploaded.
//!
//! ```no_run
//! let mut det = wowrun::Detector::new(wowrun::Config::default());
//! for item in wowlog::open("WoWCombatLog.txt").unwrap() {
//!     if let Ok(Ok(rec)) = item {
//!         for run in det.push(&rec) {
//!             println!("{}", serde_json::to_string(&run).unwrap());
//!         }
//!     }
//! }
//! let _last = det.finish();
//! ```

pub mod analyzer;
pub mod detector;
pub mod dungeons;
pub mod summary;

pub use analyzer::Config;
pub use detector::{Detector, run_key};
pub use summary::*;
