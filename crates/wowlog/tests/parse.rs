use std::collections::BTreeMap;
use std::path::PathBuf;
use wowlog::*;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn read_all(path: &PathBuf) -> Vec<Record> {
    open(path)
        .expect("open")
        .map(|r| {
            r.expect("io")
                .unwrap_or_else(|b| panic!("line {}: {}", b.line_no, b.error))
        })
        .collect()
}

#[test]
fn synthetic_dungeon_parses_every_line() {
    let recs = read_all(&fixture("synthetic_rfc.txt"));
    assert_eq!(recs.len(), 29);

    // header + zone
    assert!(matches!(
        &recs[0].kind,
        Kind::CombatLogVersion {
            version: 22,
            advanced: true,
            project_id: 18,
            ..
        }
    ));
    assert!(
        matches!(&recs[1].kind, Kind::ZoneChange { instance_id: 389, name, difficulty_id: 1 } if name == "Ragefire Chasm")
    );

    // encounter start/end
    let start = recs.iter().find(|r| r.event == "ENCOUNTER_START").unwrap();
    assert_eq!(
        start.kind,
        Kind::EncounterStart {
            encounter_id: 2732,
            name: "Oggleflint".into(),
            difficulty_id: 1,
            group_size: 5,
            instance_id: Some(389)
        }
    );
    let end = recs.iter().find(|r| r.event == "ENCOUNTER_END").unwrap();
    assert!(matches!(
        end.kind,
        Kind::EncounterEnd {
            encounter_id: 2732,
            success: true,
            fight_time_ms: Some(7100),
            ..
        }
    ));
    assert_eq!(end.timestamp - start.timestamp, 7100);

    // party flags: mine / party / raid are group, pet name with comma survives
    let aoe = recs.iter().find(|r| r.event == "SPELL_DAMAGE").unwrap();
    assert!(aoe.source.is_group() && !aoe.source.is_mine());
    assert_eq!(aoe.source.player_slug().as_deref(), Some("fizzle-boom"));
    assert_eq!(aoe.dest.npc_id(), Some(11517));
    match &aoe.kind {
        Kind::Damage {
            source_kind,
            spell,
            advanced,
            damage,
            ..
        } => {
            assert_eq!(*source_kind, DamageSource::Spell);
            assert_eq!(spell.as_ref().unwrap().name, "Flamestrike");
            let adv = advanced.as_ref().unwrap();
            assert_eq!(adv.info_guid, "Creature-0-1-389-1-11517-000000AAAA");
            assert_eq!(
                (adv.current_hp, adv.max_hp, adv.ui_map_id, adv.level),
                (800, 1000, 213, 16)
            );
            assert_eq!((damage.amount, damage.base_amount, damage.overkill), (160, 107, 0));
            assert!(damage.critical && damage.aoe == Some(true));
        }
        k => panic!("unexpected {k:?}"),
    }
    let pet = recs.iter().find(|r| r.source.guid.starts_with("Pet-")).unwrap();
    assert_eq!(pet.source.name.as_deref(), Some("Imp, the Cheeky"));
    assert!(pet.source.is_pet() && pet.source.is_group() && pet.source.player_slug().is_none());

    // swing + landed copy
    let swings: Vec<_> = recs
        .iter()
        .filter_map(|r| match &r.kind {
            Kind::Damage {
                source_kind, damage, ..
            } if r.event.starts_with("SWING") => Some((*source_kind, damage.amount)),
            _ => None,
        })
        .collect();
    assert_eq!(swings, vec![(DamageSource::Swing, 40), (DamageSource::SwingLanded, 40)]);

    // heal with overheal on a raid member
    let heal = recs.iter().find(|r| r.event == "SPELL_HEAL").unwrap();
    assert!(matches!(
        &heal.kind,
        Kind::Heal {
            heal: Heal {
                amount: 150,
                overheal: 50,
                critical: false,
                ..
            },
            periodic: false,
            ..
        }
    ));
    assert!(heal.source.is_group());

    // absorbs: melee (no spell) and spell variant
    let absorbs: Vec<_> = recs
        .iter()
        .filter_map(|r| match &r.kind {
            Kind::Absorbed {
                spell,
                absorber,
                absorb_spell,
                amount,
                critical,
            } => Some((
                spell.as_ref().map(|s| s.id),
                absorber.name.clone().unwrap(),
                absorb_spell.id,
                *amount,
                *critical,
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        absorbs,
        vec![
            (None, "Mendy-Bandage-PvP-EU".into(), 17, 25, false),
            (Some(1234), "Mendy-Bandage-PvP-EU".into(), 17, 12, true)
        ]
    );

    // interrupt, dispel, dose, partial resist, energize
    assert!(recs.iter().any(
        |r| matches!(&r.kind, Kind::Interrupt { spell, interrupted } if spell.id == 6552 && interrupted.id == 9053)
    ));
    assert!(recs.iter().any(|r| matches!(&r.kind, Kind::Dispel { removed, aura_type: AuraType::Debuff, stolen: false, .. } if removed.id == 8040)));
    assert!(recs.iter().any(|r| matches!(
        &r.kind,
        Kind::Aura {
            change: AuraChange::AppliedDose,
            stacks: Some(3),
            ..
        }
    )));
    assert!(recs.iter().any(|r| matches!(
        &r.kind,
        Kind::Missed {
            miss: Miss { amount: 40, .. },
            ..
        }
    )));
    assert!(
        recs.iter().any(
            |r| matches!(&r.kind, Kind::Energize { amount, power_type: 1, max_power: 100, .. } if *amount == 10.0)
        )
    );

    // broken by a spell: second school is decimal in Forever (real line, 13. 11. 2026)
    assert!(recs.iter().any(
        |r| matches!(&r.kind, Kind::Aura { change: AuraChange::BrokenSpell, aura_type: AuraType::Debuff,
        broken_by: Some(b), spell, .. } if b.id == 1449 && b.school == 64 && spell.school == 0x40)
    ));

    // killing blow: overkill + death + party kill at the same timestamp
    let killing = recs
        .iter()
        .find(|r| matches!(&r.kind, Kind::Damage { damage, .. } if damage.overkill > 0))
        .unwrap();
    let died = recs.iter().find(|r| r.event == "UNIT_DIED").unwrap();
    assert_eq!(killing.timestamp, died.timestamp);
    assert_eq!(died.dest.npc_id(), Some(11517));

    // environmental death of a party member
    let lava = recs.iter().find(|r| r.event == "ENVIRONMENTAL_DAMAGE").unwrap();
    assert!(
        matches!(&lava.kind, Kind::Damage { environment: Some(e), damage: Damage { amount: 700, overkill: 100, .. }, .. } if e == "Lava")
    );
    assert_eq!(
        recs.iter()
            .filter(|r| matches!(r.kind, Kind::Died { .. }) && r.dest.is_group())
            .count(),
        1
    );

    // raw / unknown events are kept
    assert!(
        matches!(&recs[recs.len() - 3].kind, Kind::CombatantInfo { guid, fields } if guid == "Player-1-0000000A" && fields.len() == 12)
    );
    assert!(matches!(&recs[recs.len() - 2].kind, Kind::Other { fields } if fields.len() == 3));
}

/// Real solo sample (Tirisfal Glades, 13. 11. 2026). Lives in `wowlog/` (gitignored,
/// contains player names) – skipped when absent, e.g. in CI.
#[test]
fn real_solo_sample() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../wowlog/WoWCombatLog-111326_173926.txt");
    if !path.exists() {
        eprintln!("skipping: {} not found", path.display());
        return;
    }
    let recs = read_all(&path);
    assert_eq!(recs.len(), 9726);

    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for r in &recs {
        *counts.entry(r.event.as_str()).or_default() += 1;
    }
    for (event, n) in [
        ("SPELL_AURA_APPLIED", 3825),
        ("SPELL_CAST_SUCCESS", 900),
        ("ENVIRONMENTAL_DAMAGE", 199),
        ("SWING_DAMAGE", 35),
        ("SWING_DAMAGE_LANDED", 62),
        ("SPELL_DAMAGE", 28),
        ("SPELL_HEAL", 24),
        ("UNIT_DIED", 15),
        ("ZONE_CHANGE", 1),
    ] {
        assert_eq!(counts.get(event), Some(&n), "{event}");
    }
    // Nothing in the sample should fall through to the catch-all.
    assert!(recs.iter().all(|r| !matches!(r.kind, Kind::Other { .. })));

    // Every damage/heal line has the advanced block although the header says it is off.
    for r in &recs {
        if let Kind::Damage { advanced, .. } | Kind::Heal { advanced, .. } = &r.kind {
            assert!(advanced.is_some(), "{} without advanced block", r.event);
        }
    }

    // The log writer is the only "mine" player.
    let mine: std::collections::BTreeSet<_> = recs
        .iter()
        .filter(|r| r.source.is_player() && r.source.is_mine())
        .map(|r| r.source.guid.clone())
        .collect();
    assert_eq!(mine.len(), 1);
    // No party in the solo sample.
    assert!(
        recs.iter()
            .all(|r| !(r.source.is_player() && r.source.is_group() && !r.source.is_mine()))
    );

    // Duration ~15 min.
    let span = recs.last().unwrap().timestamp - recs[0].timestamp;
    assert!((14 * 60_000..16 * 60_000).contains(&span), "span {span}");
}
