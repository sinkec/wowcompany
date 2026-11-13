//! Forever dungeons by `instanceID` (from `ZONE_CHANGE` / `ENCOUNTER_START`).
//!
//! Source: addon `postblink/KwikTip` (`Forever/DungeonData.lua`), marked by its author as
//! partly "pending validation" → **UNVERIFIED** until we have a real dungeon log
//! (see COMPANION.md §3.1). `boss_count` is `None` where the source only gave ID ranges
//! spanning several wings.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dungeon {
    pub instance_id: u32,
    pub name: &'static str,
    /// `(encounterID, name)` – may be empty when the source listed only ranges.
    pub encounters: &'static [(u32, &'static str)],
    pub boss_count: Option<u32>,
}

macro_rules! d {
    ($id:expr, $name:expr, [$(($e:expr, $n:expr)),* $(,)?]) => {
        Dungeon { instance_id: $id, name: $name, encounters: &[$(($e, $n)),*], boss_count: Some([$($e),*].len() as u32) }
    };
    ($id:expr, $name:expr, count $c:expr) => {
        Dungeon { instance_id: $id, name: $name, encounters: &[], boss_count: $c }
    };
}

pub const DUNGEONS: &[Dungeon] = &[
    d!(
        3065,
        "The Hall of Thanes",
        [
            (3493, "Faldrim Anvilmar"),
            (3495, "Infurnus"),
            (3494, "Plunder"),
            (3496, "Durgen Dirgehammer")
        ]
    ),
    d!(
        389,
        "Ragefire Chasm",
        [
            (2732, "Oggleflint"),
            (2733, "Taragaman the Hungerer"),
            (2734, "Jergosh the Invoker"),
            (2735, "Bazzalan")
        ]
    ),
    d!(
        34,
        "Stormwind Stockade",
        [
            (2756, "Targorr the Dread"),
            (2757, "Kam Deepfury"),
            (2758, "Hamhock"),
            (2759, "Dextren Ward"),
            (2760, "Bazil Thredd")
        ]
    ),
    d!(
        2999,
        "Ruins of Lordaeron",
        [
            (3353, "Witherfang"),
            (3357, "The Abandoned"),
            (3411, "Viktor the Vile"),
            (3412, "Bjork"),
            (3354, "Rath'mael")
        ]
    ),
    d!(
        2998,
        "Excavation Site: Wetlands",
        [
            (3480, "Saltspine"),
            (3481, "Shadetooth"),
            (3644, "Highland Horror"),
            (3482, "Relic Guardian")
        ]
    ),
    d!(
        2959,
        "City of Dalaran",
        [
            (3311, "Atrexis the Grave Knight"),
            (3310, "Lyn the Ignored"),
            (3298, "Arcane Anomaly"),
            (3299, "Fel Ancient"),
            (3300, "Mana Devourer"),
            (3302, "Unstable Sentinel"),
            (3303, "Shade of the Archmage"),
        ]
    ),
    d!(
        36,
        "Deadmines",
        [
            (2741, "Rhahk'Zor"),
            (2742, "Sneed"),
            (3676, "Miner Johnson"),
            (2743, "Gilnid"),
            (2745, "Mr. Smite"),
            (2744, "Captain Greenskin"),
            (2747, "Edwin VanCleef"),
            (2746, "Cookie"),
        ]
    ),
    d!(
        43,
        "Wailing Caverns",
        [
            (585, "Lady Anacondra"),
            (586, "Lord Cobrahn"),
            (587, "Kresh"),
            (588, "Lord Pythas"),
            (589, "Skum"),
            (590, "Lord Serpentis"),
            (591, "Verdan the Everliving"),
            (592, "Mutanus the Devourer"),
        ]
    ),
    d!(
        33,
        "Shadowfang Keep",
        [
            (2748, "Rethilgore"),
            (2749, "Razorclaw the Butcher"),
            (2750, "Baron Silverlaine"),
            (2751, "Commander Springvale"),
            (2752, "Odo the Blindwatcher"),
            (2753, "Fenrus the Devourer"),
            (2754, "Wolf Master Nandos"),
            (2755, "Archmage Arugal"),
        ]
    ),
    d!(
        48,
        "Blackfathom Deeps",
        [
            (2916, "Ghamoo-ra"),
            (2915, "Lady Sarevess"),
            (2913, "Lorgus Jett"),
            (2912, "Old Serra'kis"),
            (2911, "Twilight Lord Kelris"),
            (2910, "Aku'mai"),
        ]
    ),
    d!(
        90,
        "Gnomeregan",
        [
            (2768, "Grubbis"),
            (2769, "Viscous Fallout"),
            (2770, "Electrocutioner 6000"),
            (2771, "Crowd Pummeler 9-60"),
            (2772, "Mekgineer Thermaplugg"),
        ]
    ),
    d!(
        47,
        "Razorfen Kraul",
        [
            (2773, "Roogug"),
            (2774, "Aggem Thorncurse"),
            (2775, "Death Speaker Jargba"),
            (2776, "Overlord Ramtusk"),
            (2777, "Agathelos the Raging"),
            (2778, "Charlga Razorflank"),
        ]
    ),
    d!(
        70,
        "Uldaman",
        [
            (547, "Revelosh"),
            (548, "The Lost Dwarves"),
            (549, "Ironaya"),
            (1887, "Obsidian Sentinel"),
            (551, "Ancient Stone Keeper"),
            (552, "Galgann Firehammer"),
            (553, "Grimlok"),
            (554, "Archaedas"),
        ]
    ),
    d!(
        129,
        "Razorfen Downs",
        [
            (2780, "Tuten'kash"),
            (2781, "Plaguemaw the Rotting"),
            (2782, "Mordresh Fire Eye"),
            (2783, "Ragglesnout"),
            (2784, "Glutton"),
            (2785, "Amnennar the Coldbringer"),
        ]
    ),
    // Scarlet Monastery wings share one map → a "full clear" is not one run.
    d!(189, "Scarlet Monastery", count None),
    d!(209, "Zul'Farrak", count Some(8)),
    d!(349, "Maraudon", count Some(8)),
    d!(109, "Sunken Temple", count Some(8)),
    d!(230, "Blackrock Depths", count None),
    d!(429, "Dire Maul", count None),
    d!(289, "Scholomance", count None),
    d!(329, "Stratholme", count None),
];

pub fn by_instance(instance_id: u32) -> Option<&'static Dungeon> {
    DUNGEONS.iter().find(|d| d.instance_id == instance_id)
}

pub fn by_name(name: &str) -> Option<&'static Dungeon> {
    DUNGEONS.iter().find(|d| d.name.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup() {
        assert_eq!(by_instance(389).unwrap().name, "Ragefire Chasm");
        assert_eq!(by_instance(389).unwrap().boss_count, Some(4));
        assert_eq!(by_name("deadmines").unwrap().instance_id, 36);
        assert!(by_instance(0).is_none());
        let mut ids: Vec<_> = DUNGEONS.iter().map(|d| d.instance_id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), DUNGEONS.len());
    }
}
