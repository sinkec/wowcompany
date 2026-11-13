mod common;

use common::*;
use wowrun::*;

const RFC: u32 = 389;

struct Cast {
    me: U,
    lock: U,
    healer: U,
    imp: U,
    rando: U,
}

fn cast() -> Cast {
    Cast {
        me: me("Grobos-Stinkfoot", "0000000A"),
        lock: party("Fizzle-Boom", "0000000B"),
        healer: party("Mendy-Bandage", "0000000C"),
        imp: pet("Imp", "0100000001"),
        rando: stranger("Random-Dude", "0000000F"),
    }
}

/// Full Ragefire Chasm run: trash, boss kill with a healer death, recorder dies in lava,
/// corpse run (leave + re-enter), boss wipe + kill, leave for good.
fn full_run() -> (Log, Cast) {
    let c = cast();
    let trogg = mob("Ragefire Trogg", 11318, 7001, "000000BBBB");
    let ogg = mob("Oggleflint", 11517, 7001, "000000AAAA");
    let tara = mob("Taragaman the Hungerer", 11520, 7001, "000000CCCC");
    let mut l = Log::new();
    l.zone(1, "Orgrimmar").wait(1000).zone(RFC, "Ragefire Chasm");
    l.wait(2000).summon(&c.lock, &c.imp);
    // t = 8000: first group combat → run starts
    l.wait(5000).spell(&c.me, &trogg, 133, "Fireball", 100, false);
    l.wait(500).swing(&c.imp, &trogg, 30, Some(&c.lock));
    l.wait(500)
        .swing(&c.me, &trogg, 40, None)
        .swing_landed(&c.me, &trogg, 40);
    l.wait(100).swing_landed(&trogg, &c.me, 15);
    l.spell(&c.rando, &trogg, 133, "Fireball", 999, false);
    l.wait(1000).heal(&c.healer, &c.me, 80, 20, 900);
    l.spell_ok(&c.lock, &trogg, 686, "Shadow Bolt", 200, true, 50, 0)
        .died(&trogg);
    // boss 1
    l.wait(20000).encounter_start(2732, "Oggleflint");
    l.wait(1000)
        .spell(&c.me, &ogg, 133, "Fireball", 300, false)
        .interrupt(&c.me, &ogg);
    l.wait(1000).absorb(&ogg, &c.healer, &c.healer, 60);
    l.hit_player(&ogg, &c.healer, 9053, "Fireball", 400, -1, 600);
    l.wait(1000).heal(&c.healer, &c.healer, 100, 0, 700);
    l.wait(1000)
        .hit_player(&ogg, &c.healer, 9053, "Fireball", 800, 100, 0)
        .died(&c.healer);
    l.wait(2000)
        .spell_ok(&c.lock, &ogg, 686, "Shadow Bolt", 500, false, 20, 0)
        .died(&ogg);
    l.encounter_end(2732, "Oggleflint", true, 6000);
    // recorder dies in lava, releases, runs back
    l.wait(5000).lava(&c.me, 1200, 200).died(&c.me);
    l.wait(10000).zone(1, "Orgrimmar");
    l.wait(180_000).zone(RFC, "Ragefire Chasm");
    l.wait(5000).spell(&c.me, &tara, 133, "Fireball", 150, false);
    // boss 2: wipe, then kill
    l.encounter_start(2733, "Taragaman the Hungerer");
    l.wait(3000).spell(&c.lock, &tara, 686, "Shadow Bolt", 100, false);
    l.encounter_end(2733, "Taragaman the Hungerer", false, 3000);
    l.wait(30000).encounter_start(2733, "Taragaman the Hungerer");
    l.wait(3000)
        .spell_ok(&c.lock, &tara, 686, "Shadow Bolt", 900, false, 10, 0)
        .died(&tara);
    l.encounter_end(2733, "Taragaman the Hungerer", true, 3000);
    l.wait(2000).zone(1, "Orgrimmar");
    // 16 min later anything happens → grace (15 min) expired
    l.wait(16 * 60_000).spell(&c.me, &c.rando, 133, "Fireball", 1, false);
    (l, c)
}

fn player<'a>(run: &'a RunSummary, slug: &str) -> &'a PlayerSummary {
    run.players
        .iter()
        .find(|p| p.slug == slug)
        .unwrap_or_else(|| panic!("no {slug}"))
}

#[test]
fn full_run_is_detected_and_analysed() {
    let (log, _) = full_run();
    let mut det = Detector::new(Config::default());
    let mut runs = Vec::new();
    for r in log.records() {
        runs.extend(det.push(&r));
    }
    // finished by the late event (grace expired), not by finish()
    assert_eq!(runs.len(), 1);
    assert!(det.finish().is_empty());
    let run = &runs[0];

    assert_eq!(run.zone.instance_id, RFC);
    assert_eq!(run.zone.name, "Ragefire Chasm");
    assert_eq!(run.zone.instance_uid, Some(7001), "pet uid must not win");
    assert_eq!(run.end_reason, EndReason::LeftInstance);
    // 2026-11-20 20:00:08 local, UTC offset 0
    assert_eq!(run.started_at, wowlog::time::parse("11/20/2026 20:00:08.000").unwrap());
    let last_kill = log.t - 16 * 60_000 - 2000;
    assert_eq!(run.duration_ms, last_kill - 8000);
    assert_eq!(
        run.result,
        RunResult {
            bosses_killed: 2,
            bosses_total: Some(4),
            wipes: 1,
            cleared: false
        }
    );
    assert_eq!(run.recorder.as_deref(), Some("grobos-stinkfoot"));

    // only the group; the stranger's 999 damage is nowhere
    let slugs: Vec<_> = run.players.iter().map(|p| p.slug.as_str()).collect();
    assert_eq!(slugs, vec!["fizzle-boom", "grobos-stinkfoot", "mendy-bandage"]);
    assert!(!serde_json::to_string(run).unwrap().contains("Random"));

    let lock = player(run, "fizzle-boom");
    assert_eq!(
        lock.damage,
        30 + 200 + 500 + 100 + 900,
        "imp melee counts for the warlock"
    );
    assert!(
        lock.top_damage
            .iter()
            .any(|s| s.pet && s.name == "Melee" && s.amount == 30)
    );
    assert_eq!(lock.crit_pct, 20.0);

    let me = player(run, "grobos-stinkfoot");
    assert!(me.recorder);
    assert_eq!(me.damage, 100 + 40 + 300 + 150, "swing + its LANDED copy count once");
    assert_eq!(me.damage_taken, 15 + 1200, "unpaired LANDED counts, lava counts");
    assert_eq!(me.environmental_taken, 1200);
    assert_eq!(me.interrupts, 1);
    assert_eq!(me.deaths, 1);
    assert_eq!(me.name, "Grobos Stinkfoot");

    let healer = player(run, "mendy-bandage");
    assert_eq!(healer.healing, 60 + 100);
    assert_eq!(healer.overheal, 20);
    assert_eq!(healer.shielding, 60);
    assert_eq!(healer.deaths, 1);

    // deaths with recap
    assert_eq!(run.deaths.len(), 2);
    let d = &run.deaths[0];
    assert_eq!(d.slug, "mendy-bandage");
    assert_eq!(d.killer.as_deref(), Some("Oggleflint"));
    assert_eq!(d.killing_blow.as_deref(), Some("Fireball"));
    let amounts: Vec<_> = d.recap.iter().map(|r| r.amount).collect();
    assert_eq!(amounts, vec![-400, 100, -800]);
    assert_eq!(d.recap.last().unwrap().overkill, 100);
    assert_eq!(d.recap[0].hp, Some(600));
    assert_eq!(d.recap.last().unwrap().at_ms, 0);
    let lava = &run.deaths[1];
    assert_eq!(
        (lava.killer.as_deref(), lava.killing_blow.as_deref()),
        (None, Some("Lava"))
    );
    // The recorder's earlier recap (trash hit, heal) is part of their death recap too.
    assert_eq!(
        lava.recap.iter().map(|r| r.amount).collect::<Vec<_>>(),
        vec![-15, 60, -1200]
    );

    // segments: trash, boss kill, trash (lava + pull), boss wipe, boss kill
    let segs: Vec<_> = run
        .segments
        .iter()
        .map(|s| (s.kind, s.encounter_id, s.result))
        .collect();
    assert_eq!(
        segs,
        vec![
            (SegmentKind::Trash, None, SegmentResult::None),
            (SegmentKind::Boss, Some(2732), SegmentResult::Kill),
            (SegmentKind::Trash, None, SegmentResult::None),
            (SegmentKind::Boss, Some(2733), SegmentResult::Wipe),
            (SegmentKind::Boss, Some(2733), SegmentResult::Kill),
        ]
    );
    let boss1 = &run.segments[1];
    assert_eq!(boss1.end_ms - boss1.start_ms, 6000);
    let lock_in_boss1 = boss1.players.iter().find(|p| p.slug == "fizzle-boom").unwrap();
    assert_eq!(lock_in_boss1.damage, 500);

    // timeline: one bucket per started 10 s, totals match
    let buckets = ((run.duration_ms + 9999) / 10_000) as usize;
    for t in &run.timeline.players {
        assert_eq!(t.damage.len(), buckets);
        let p = player(run, &t.slug);
        assert_eq!(t.damage.iter().sum::<i64>(), p.damage);
        assert_eq!(t.healing.iter().sum::<i64>(), p.healing);
        assert_eq!(t.taken.iter().sum::<i64>(), p.damage_taken);
    }
}

#[test]
fn utc_offset_is_applied() {
    let (log, _) = full_run();
    let cfg = Config {
        utc_offset_ms: 60 * 60_000,
        ..Config::default()
    };
    let (runs, _) = detect(&log, cfg);
    assert_eq!(
        runs[0].started_at,
        wowlog::time::parse("11/20/2026 19:00:08.000").unwrap()
    );
}

#[test]
fn json_is_camel_case_and_round_trips() {
    let (log, _) = full_run();
    let (runs, _) = detect(&log, Config::default());
    let json = serde_json::to_string(&runs[0]).unwrap();
    for key in [
        "\"runKey\"",
        "\"durationMs\"",
        "\"endReason\":\"leftInstance\"",
        "\"bossesKilled\"",
        "\"topDamage\"",
    ] {
        assert!(json.contains(key), "{key} missing");
    }
    let back: RunSummary = serde_json::from_str(&json).unwrap();
    assert_eq!(back, runs[0]);
    assert!(json.len() < 20_000, "summary is {} bytes", json.len());
}

#[test]
fn solo_farming_is_discarded() {
    let c = cast();
    let m = mob("Ragefire Trogg", 11318, 7001, "000000BBBB");
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm")
        .wait(1000)
        .spell(&c.me, &m, 133, "Fireball", 100, false);
    l.wait(1000).died(&m).wait(1000).zone(1, "Orgrimmar");
    let (runs, det) = detect(&l, Config::default());
    assert!(runs.is_empty());
    assert_eq!(det.discarded(), 1);

    // ...unless the threshold is lowered
    let (runs, _) = detect(
        &l,
        Config {
            min_players: 1,
            ..Config::default()
        },
    );
    assert_eq!(runs.len(), 1);
}

#[test]
fn visiting_without_combat_is_ignored() {
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(60_000).zone(1, "Orgrimmar");
    let (runs, det) = detect(&l, Config::default());
    assert!(runs.is_empty());
    assert_eq!(det.discarded(), 0);
}

fn pull(l: &mut Log, c: &Cast, uid: u32) {
    let m = mob("Ragefire Trogg", 11318, uid, "000000BBBB");
    l.spell(&c.me, &m, 133, "Fireball", 100, false);
    l.wait(1000).spell(&c.lock, &m, 686, "Shadow Bolt", 100, false);
}

#[test]
fn inactivity_splits_runs() {
    let c = cast();
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(1000);
    pull(&mut l, &c, 7001);
    l.wait(11 * 60_000);
    pull(&mut l, &c, 7001);
    let (runs, _) = detect(&l, Config::default());
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].end_reason, EndReason::Inactivity);
    assert_eq!(
        runs[0].duration_ms, 1000,
        "ends at the last activity, not at the timeout"
    );
    assert_eq!(runs[1].end_reason, EndReason::EndOfLog);
}

#[test]
fn instance_reset_starts_a_new_run() {
    let c = cast();
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(1000);
    pull(&mut l, &c, 7001);
    l.wait(5000)
        .zone(1, "Orgrimmar")
        .wait(60_000)
        .zone(RFC, "Ragefire Chasm")
        .wait(5000);
    pull(&mut l, &c, 7002);
    let (runs, _) = detect(&l, Config::default());
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].end_reason, EndReason::InstanceReset);
    assert_eq!(
        (runs[0].zone.instance_uid, runs[1].zone.instance_uid),
        (Some(7001), Some(7002))
    );
    assert_ne!(runs[0].run_key, runs[1].run_key);
}

#[test]
fn next_dungeon_closes_the_previous_one() {
    let c = cast();
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(1000);
    pull(&mut l, &c, 7001);
    l.wait(5000)
        .zone(1, "Orgrimmar")
        .wait(60_000)
        .zone(36, "Deadmines")
        .wait(5000);
    pull(&mut l, &c, 8001);
    let (runs, _) = detect(&l, Config::default());
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].end_reason, EndReason::NewInstance);
    assert_eq!(runs[1].zone.name, "Deadmines");
    assert_eq!(runs[1].result.bosses_total, Some(8));
}

#[test]
fn snapshot_and_manual_end() {
    let c = cast();
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(1000);
    pull(&mut l, &c, 7001);
    let mut det = Detector::new(Config::default());
    assert!(det.snapshot().is_none());
    for r in l.records() {
        assert!(det.push(&r).is_empty());
    }
    assert_eq!(det.current_dungeon(), Some("Ragefire Chasm"));
    let snap = det.snapshot().expect("in progress");
    assert_eq!(snap.end_reason, EndReason::InProgress);
    assert_eq!(snap.players.len(), 2);

    let runs = det.end_manual();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].end_reason, EndReason::Manual);
    assert_eq!(runs[0].run_key, snap.run_key);
    assert!(!det.run_in_progress());
    assert_eq!(
        det.current_dungeon(),
        Some("Ragefire Chasm"),
        "still inside, ready for a new run"
    );
}

#[test]
fn tick_closes_idle_runs_without_new_lines() {
    let c = cast();
    let mut l = Log::new();
    l.zone(RFC, "Ragefire Chasm").wait(1000);
    pull(&mut l, &c, 7001);
    let mut det = Detector::new(Config::default());
    let recs = l.records();
    for r in &recs {
        det.push(r);
    }
    let last = recs.last().unwrap().timestamp;
    assert!(det.tick(last + 60_000).is_empty());
    let runs = det.tick(last + 11 * 60_000);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].end_reason, EndReason::Inactivity);
}

#[test]
fn run_key_is_shared_between_recorders() {
    // Same instance copy, seen by two different players who started logging at different times.
    let a = me("Grobos-Stinkfoot", "0000000A");
    let b_as_party = party("Fizzle-Boom", "0000000B");
    let b = me("Fizzle-Boom", "0000000B");
    let a_as_party = party("Grobos-Stinkfoot", "0000000A");
    let m = mob("Ragefire Trogg", 11318, 7001, "000000BBBB");

    let mut la = Log::new();
    la.zone(RFC, "Ragefire Chasm")
        .wait(1000)
        .spell(&a, &m, 133, "Fireball", 1, false);
    la.spell(&b_as_party, &m, 686, "Shadow Bolt", 1, false);
    let mut lb = Log::new();
    lb.wait(40_000)
        .zone(RFC, "Ragefire Chasm")
        .wait(1000)
        .spell(&b, &m, 686, "Shadow Bolt", 1, false);
    lb.spell(&a_as_party, &m, 133, "Fireball", 1, false);

    let (ra, _) = detect(&la, Config::default());
    let (rb, _) = detect(&lb, Config::default());
    assert_eq!(ra[0].run_key, rb[0].run_key);
    assert_eq!(ra[0].recorder.as_deref(), Some("grobos-stinkfoot"));
    assert_eq!(rb[0].recorder.as_deref(), Some("fizzle-boom"));
}

#[test]
fn wowlog_fixture_file_yields_one_run() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../wowlog/tests/fixtures/synthetic_rfc.txt"
    );
    let mut det = Detector::new(Config::default());
    let mut runs = Vec::new();
    for item in wowlog::open(path).unwrap() {
        runs.extend(det.push(&item.unwrap().unwrap()));
    }
    runs.extend(det.finish());
    assert_eq!(runs.len(), 1);
    let run = &runs[0];
    assert_eq!(run.end_reason, EndReason::LeftInstance);
    assert_eq!(run.result.bosses_killed, 1);
    assert_eq!(run.players.len(), 3);
    assert_eq!(run.deaths.len(), 1);
    assert_eq!(run.deaths[0].killing_blow.as_deref(), Some("Lava"));
}

/// Real solo sample (gitignored): open world only → no runs.
#[test]
fn real_solo_sample_has_no_runs() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../wowlog/WoWCombatLog-111326_173926.txt"
    );
    if !std::path::Path::new(path).exists() {
        eprintln!("skipping: sample not found");
        return;
    }
    let mut det = Detector::new(Config::default());
    for item in wowlog::open(path).unwrap() {
        assert!(det.push(&item.unwrap().unwrap()).is_empty());
    }
    assert!(det.finish().is_empty());
    assert_eq!(det.discarded(), 0);
}
