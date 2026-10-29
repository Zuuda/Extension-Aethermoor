import { getContext } from '../../../extensions.js';

const ZONES = {
    1: { name: 'Thornhaven', base: 2, tier: 1, levels: [2, 3, 4] },
    2: { name: 'Reed-Fens', base: 4, tier: 1, levels: [7, 8, 9] },
    3: { name: 'Blighted Marsh', base: 7, tier: 2, levels: [12, 13, 14] },
    4: { name: 'Weeping Karst', base: 9, tier: 2, levels: [17, 18, 19] },
    5: { name: 'Highgate Pass', base: 12, tier: 3, levels: [22, 23, 24] }
};

const TANSY_SLOTS = [
    'weapon', 'gloves', 'chest', 'trousers',
    'headgear', 'boots', 'neck', 'ring1', 'ring2'
];
const QTIK_SLOTS = ['ring1', 'ring2', 'amulet', 'wristCuffs'];
const MODULAR_TANSY = new Set([
    'headgear', 'boots', 'neck', 'ring1', 'ring2'
]);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function int(value, label, minimum = 0) {
    assert(Number.isInteger(value) && value >= minimum,
        `${label} must be an integer >= ${minimum}`);
    return value;
}

function clone(value) {
    return structuredClone(value);
}

function enemyTier(level) {
    return 1 + Math.floor(level / 10);
}

function nextXp(level) {
    if (level < 10) return 250 * level;
    if (level < 30) return 500 * level;
    if (level < 50) return 1000 * level;
    return 2000 * level;
}

function mobStats(level, role) {
    int(level, 'mob level', 1);
    const specialist = ['archer', 'mender', 'hexer', 'buffer'].includes(role);

    if (specialist || role === 'trash') {
        return {
            maxHp: 10 + 5 * level,
            atk: 4 + 3 * level,
            def: Math.floor(level / 2),
            xpBase: 2 * level
        };
    }
    if (role === 'brute') {
        return {
            maxHp: 15 + 8 * level,
            atk: 6 + 4 * level,
            def: 2 + level,
            xpBase: 4 * level
        };
    }
    if (role === 'elite') {
        return {
            maxHp: 30 + 15 * level,
            atk: 10 + 5 * level,
            def: 2 + Math.floor(1.5 * level),
            xpBase: 20 * level
        };
    }
    if (role === 'boss') {
        return {
            maxHp: 60 + 30 * level,
            atk: 15 + 7 * level,
            def: 6 + 2 * level,
            xpBase: 50 * level
        };
    }
    throw new Error(`Unknown mob role: ${role}`);
}

function gearBonus(owner, slot, item) {
    /*
     * Empty slot objects are treated as empty gear. This allows compact
     * test fixtures such as gear: { tansy: {}, qtik: {} }.
     */
    if (
        item === null ||
        item === undefined ||
        Object.keys(item).length === 0
    ) {
        return {
            atk: 0,
            def: 0,
            hp: 0,
            luk: 0
        };
    }

    const stat = int(
        item.stat,
        `${owner}.${slot}.stat`
    );

    const variant = item.variant;

    const result = {
        atk: 0,
        def: 0,
        hp: 0,
        luk: 0
    };

    if (owner === 'tansy') {
        assert(
            TANSY_SLOTS.includes(slot),
            `Invalid Tansy slot: ${slot}`
        );

        if (slot === 'weapon') {
            result.atk = 2 * stat;
        } else if (slot === 'gloves') {
            result.atk = stat;
        } else if (
            slot === 'chest' ||
            slot === 'trousers'
        ) {
            result.hp = 5 * stat;
            result.luk = stat > 0 ? 1 : 0;
        } else {
            assert(
                MODULAR_TANSY.has(slot),
                `Invalid Tansy slot: ${slot}`
            );

            if (stat > 0) {
                assert(
                    ['vitality', 'luck'].includes(variant),
                    `${slot} needs exactly one tuning variant`
                );

                if (variant === 'vitality') {
                    result.hp = 5 * stat;
                } else {
                    result.luk = stat;
                }
            }
        }
    } else if (owner === 'qtik') {
        assert(
            QTIK_SLOTS.includes(slot),
            `Invalid Q'tik slot: ${slot}`
        );

        if (stat > 0) {
            assert(
                ['vitality', 'bulwark'].includes(variant),
                `${slot} needs exactly one tuning variant`
            );

            if (variant === 'vitality') {
                result.hp = 15 * stat;
            } else {
                result.def = 2 * stat;
            }
        }
    } else {
        throw new Error(
            `Unknown gear owner: ${owner}`
        );
    }

    return result;
}

function derived(crew) {
    assert(
        crew && typeof crew === 'object',
        'Crew state is required'
    );

    const level = int(
        crew.level,
        'crew.level',
        1
    );

    assert(
        crew.weasels &&
        typeof crew.weasels === 'object',
        'Crew weasel state is required'
    );

    const weasels = int(
        crew.weasels.active,
        'weasels.active'
    );

    const maxWeasels =
        2 + 2 * Math.floor(level / 2);

    assert(
        weasels <= maxWeasels,
        `Active weasels ${weasels} exceed level cap ${maxWeasels}`
    );

    const tansyGear =
        crew.gear?.tansy || {};

    const qtikGear =
        crew.gear?.qtik || {};

    const totals = {
        atk: 2 * level + 2 * weasels,
        def: level,
        luk: Math.floor(level / 2),
        qtikMaxHp: 125 + 25 * level,
        tansyMaxHp: 35 + 15 * level
    };

    for (const slot of TANSY_SLOTS) {
        const bonus = gearBonus(
            'tansy',
            slot,
            tansyGear[slot]
        );

        totals.atk += bonus.atk;
        totals.luk += bonus.luk;
        totals.tansyMaxHp += bonus.hp;
    }

    for (const slot of QTIK_SLOTS) {
        const bonus = gearBonus(
            'qtik',
            slot,
            qtikGear[slot]
        );

        totals.def += bonus.def;
        totals.qtikMaxHp += bonus.hp;
    }

    totals.regen =
        Math.round(totals.qtikMaxHp / 100);

    return totals;
}
function validate(state) {
    assert(
        state &&
        typeof state === 'object',
        'State object is required'
    );

    assert(
        ZONES[state.zone],
        `Unknown zone: ${state.zone}`
    );

    assert(
        state.crew &&
        state.encounter,
        'Need crew and encounter'
    );

    const c = state.crew;
    const encounter = state.encounter;

    assert(
        c.qtik &&
        typeof c.qtik === 'object',
        "Q'tik state is required"
    );

    assert(
        c.tansy &&
        typeof c.tansy === 'object',
        "Tansy state is required"
    );

    assert(
        c.weasels &&
        typeof c.weasels === 'object',
        'Weasel state is required'
    );

    assert(
        c.gear &&
        typeof c.gear === 'object',
        'Crew gear state is required'
    );

    /*
     * derived() accepts missing slot entries and compact empty gear
     * containers, but the two owner containers must exist.
     */
    assert(
        c.gear.tansy &&
        typeof c.gear.tansy === 'object',
        "Tansy's gear container is required"
    );

    assert(
        c.gear.qtik &&
        typeof c.gear.qtik === 'object',
        "Q'tik's gear container is required"
    );

    const d = derived(c);

    int(c.xp, 'crew.xp');
    int(c.purse, 'crew.purse');
    int(c.qtik.hp, 'qtik.hp');
    int(c.tansy.hp, 'tansy.hp');

    assert(
        c.qtik.hp <= d.qtikMaxHp,
        "Q'tik HP exceeds derived maximum"
    );

    assert(
        c.tansy.hp <= d.tansyMaxHp,
        'Tansy HP exceeds derived maximum'
    );

    assert(
        Array.isArray(c.qtik.belt) &&
        c.qtik.belt.length <= 4,
        "Q'tik's belt must contain at most four item IDs"
    );

    assert(
        Array.isArray(c.tansy.belt) &&
        c.tansy.belt.length <= 4,
        "Tansy's belt must contain at most four item IDs"
    );

    assert(
        typeof encounter.id === 'string' &&
        encounter.id.length > 0,
        'Encounter needs a non-empty ID'
    );

    assert(
        [
            'normal_pack',
            'elite',
            'boss'
        ].includes(encounter.type),
        `Unsupported encounter type: ${encounter.type}`
    );

    assert(
        Number.isInteger(encounter.turn) &&
        encounter.turn >= 0,
        'Encounter turn must be a non-negative integer'
    );

    assert(
        Array.isArray(encounter.foes),
        'Encounter needs a foes array'
    );

    assert(
        encounter.foes.length > 0,
        'Encounter needs at least one foe'
    );

    const ids = new Set();

    for (const foe of encounter.foes) {
        assert(
            foe &&
            typeof foe === 'object',
            'Each foe must be an object'
        );

        assert(
            typeof foe.id === 'string' &&
            foe.id.length > 0 &&
            !ids.has(foe.id),
            'Each foe needs a unique non-empty string ID'
        );

        ids.add(foe.id);

        const expected =
            mobStats(
                foe.level,
                foe.role
            );

        int(
            foe.level,
            `${foe.id}.level`,
            1
        );

        int(
            foe.hp,
            `${foe.id}.hp`
        );

        int(
            foe.maxHp,
            `${foe.id}.maxHp`
        );

        int(
            foe.atk,
            `${foe.id}.atk`
        );

        int(
            foe.def,
            `${foe.id}.def`
        );

        assert(
            foe.maxHp === expected.maxHp,
            `${foe.id} maxHp does not match ` +
            `${foe.role} formula`
        );

        assert(
            foe.atk === expected.atk,
            `${foe.id} atk does not match ` +
            `${foe.role} formula`
        );

        assert(
            foe.def === expected.def,
            `${foe.id} def does not match ` +
            `${foe.role} formula`
        );

        assert(
            foe.hp <= foe.maxHp,
            `${foe.id} HP exceeds maximum`
        );
    }

    if (encounter.type === 'normal_pack') {
        assert(
            encounter.foes.length === 3,
            'Normal packs must contain exactly three foes'
        );

        assert(
            encounter.composition >= 1 &&
            encounter.composition <= 6,
            'Normal pack composition must be 1-6'
        );

        if (encounter.composition === 1) {
            assert(
                encounter.foes.every(
                    foe => foe.role === 'brute'
                ),
                'Pure Fodder packs must contain three Brutes'
            );
        } else {
            assert(
                encounter.foes.filter(
                    foe => foe.role === 'brute'
                ).length === 1,
                'Mixed packs must contain one Brute'
            );

            assert(
                encounter.foes.filter(
                    foe => [
                        'mender',
                        'archer',
                        'hexer',
                        'buffer'
                    ].includes(foe.role)
                ).length === 2,
                'Mixed packs must contain two Specialists'
            );
        }

        assert(
            encounter.rewards &&
            encounter.rewards.kind === 'normal_pack',
            'Normal pack reward metadata is required'
        );

        assert(
            encounter.rewards.foeCount === 3,
            'Normal pack reward foeCount must be 3'
        );

        int(
            encounter.rewards.listedPackXp,
            'normal pack listedPackXp'
        );

        int(
            encounter.rewards.autoSalvage,
            'normal pack autoSalvage'
        );
    }

    if (
        encounter.type === 'elite' ||
        encounter.type === 'boss'
    ) {
        assert(
            encounter.foes.length === 1,
            'Elite and Boss encounters must contain one foe'
        );

        assert(
            encounter.foes[0].role === encounter.type,
            `${encounter.type} encounter needs a ` +
            `${encounter.type} foe`
        );

        assert(
            encounter.rewards &&
            encounter.rewards.kind === encounter.type,
            `${encounter.type} reward metadata is required`
        );

        int(
            encounter.rewards.baseKillXp,
            `${encounter.type} baseKillXp`
        );

        const gear =
            encounter.rewards.guaranteedGear;

        assert(
            gear &&
            Number.isInteger(gear.rawStat) &&
            Number.isInteger(gear.pawnSilver),
            `${encounter.type} guaranteed gear metadata is required`
        );

        const expectedRawStat =
            ZONES[state.zone].base +
            (
                encounter.type === 'elite'
                    ? 1
                    : 5
            );

        assert(
            gear.rawStat === expectedRawStat,
            `${encounter.type} guaranteed gear stat does not ` +
            'match zone'
        );

        assert(
            gear.pawnSilver === 2 * gear.rawStat,
            `${encounter.type} guaranteed gear pawn value ` +
            'does not match raw stat'
        );

        if (encounter.type === 'boss') {
            assert(
                encounter.rewards.bossTrophy === true,
                'Boss encounter must carry a trophy reward'
            );
        }
    }

    return d;
}

function live(state) {
    return state.encounter.foes.filter(foe => foe.hp > 0);
}

function roll(state, sides) {
    // Persist rngState in the bottom ledger. Repeating an input state
    // produces the same result, including after a swipe.
    let x = int(state.rngState, 'rngState', 1) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state.rngState = (x >>> 0) || 1;
    return 1 + (state.rngState % sides);
}

function xpForKill(crewLevel, foe) {
    const base = mobStats(foe.level, foe.role).xpBase;
    if (foe.level <= crewLevel - 10) return 0;
    if (foe.level <= crewLevel - 5) return Math.floor(base / 2);
    if (foe.level >= crewLevel + 2) return Math.floor(base * 1.25);
    return base;
}

function applyXp(crew, xp) {
    assert(
        Number.isInteger(xp) && xp >= 0,
        'XP reward must be a non-negative integer'
    );

    crew.xp += xp;
    const changes = [];

    while (crew.xp >= nextXp(crew.level)) {
        const before = derived(crew);
        const xpCost = nextXp(crew.level);

        crew.xp -= xpCost;
        crew.level += 1;

        const after = derived(crew);

        // Preserve the existing level-up HP increase: maximum HP gained
        // is also added to current HP, capped at the new maximum.
        crew.qtik.hp = Math.min(
            after.qtikMaxHp,
            crew.qtik.hp + (after.qtikMaxHp - before.qtikMaxHp)
        );

        crew.tansy.hp = Math.min(
            after.tansyMaxHp,
            crew.tansy.hp + (after.tansyMaxHp - before.tansyMaxHp)
        );

        // Keep the saved readouts synchronized with derived stats.
        crew.qtik.maxHp = after.qtikMaxHp;
        crew.qtik.def = after.def;
        crew.qtik.regen = after.regen;
        crew.tansy.maxHp = after.tansyMaxHp;

        changes.push({
            level: crew.level,
            xpRemaining: crew.xp,
            nextXp: nextXp(crew.level),
            before,
            after
        });
    }

    return changes;
}

function consumeBelt({ belt, items }) {
    assert(Array.isArray(belt) && belt.length <= 4,
        'Supply a four-slot belt array');
    assert(Array.isArray(items) && items.length > 0,
        'Supply item IDs to consume');

    const remaining = [...belt];
    for (const item of items) {
        const index = remaining.indexOf(item);
        assert(index >= 0, `Belt does not contain ${item}`);
        remaining.splice(index, 1);
    }
    return { consumed: items, remainingBelt: remaining };
}

function checkTape(state, rolls) {
    const tape = rolls || {
        player: [roll(state, 6), roll(state, 6), roll(state, 6)],
        enemy: [roll(state, 6), roll(state, 6), roll(state, 6)]
    };
    for (const side of ['player', 'enemy']) {
        assert(Array.isArray(tape[side]) && tape[side].length === 3 &&
            tape[side].every(n => Number.isInteger(n) && n >= 1 && n <= 6),
        `${side} needs three d6 results`);
    }
    return tape;
}

function dealDamage(state, target, amount, kills) {
    const hits = [];
    let remaining = Number(amount);
    let current = target;

    assert(
        Number.isFinite(remaining) && remaining >= 0,
        `Damage must be a finite non-negative number: ${amount}`
    );

    while (current && remaining > 0) {
        const applied = Math.min(current.hp, remaining);

        current.hp -= applied;
        remaining -= applied;

        hits.push({
            id: current.id,
            damage: applied,
            hp: current.hp,
            overkillAfterHit: remaining
        });

        if (current.hp === 0) {
            kills.push({
                id: current.id,
                level: current.level,
                role: current.role
            });
        }

        if (remaining > 0) {
            // Spill into the living foe with the lowest current HP.
            // Encounter order breaks ties.
            current = live(state)
                .map(foe => ({
                    foe,
                    index: state.encounter.foes.indexOf(foe)
                }))
                .sort((a, b) =>
                    a.foe.hp - b.foe.hp || a.index - b.index
                )[0]?.foe ?? null;
        } else {
            current = null;
        }
    }

    return hits;
}

function finalizeEncounterRewards(state, slainIds, lootRolls = {}) {
    const encounter = state.encounter;
    const crew = state.crew;

    assert(
        encounter && encounter.rewards,
        'Encounter has no locked reward data'
    );

    state.inventory ||= {};
    state.inventory.bagReserves ||= [];
    state.inventory.activeTradeListings ||= [];

    assert(
        Array.isArray(state.inventory.bagReserves),
        'inventory.bagReserves must be an array'
    );

    assert(
        Array.isArray(state.inventory.activeTradeListings),
        'inventory.activeTradeListings must be an array'
    );

    if (live(state).length > 0) {
        return {
            xp: 0,
            silver: 0,
            resolved: false,
            encounterCleared: false,
            loot: [],
            trophies: []
        };
    }

    assert(
        encounter.rewards.resolved !== true,
        'Encounter rewards have already been resolved'
    );

    const slain = new Set(slainIds);
    const slainFoes = encounter.foes.filter(
        foe => slain.has(foe.id)
    );

    let xp = 0;
    let silver = 0;
    const loot = [];
    const trophies = [];

    if (encounter.type === 'normal_pack') {
        xp = encounter.rewards.listedPackXp;
        silver = encounter.rewards.autoSalvage;

        assert(
            Number.isInteger(xp) && xp >= 0,
            'Locked normal-pack XP is invalid'
        );

        assert(
            Number.isInteger(silver) && silver >= 0,
            'Locked normal-pack salvage is invalid'
        );
    } else if (
        encounter.type === 'elite' ||
        encounter.type === 'boss'
    ) {
        assert(
            slainFoes.length === 1,
            'Elite/Boss clear requires its slain foe'
        );

        xp = xpForKill(crew.level, slainFoes[0]);

        const guaranteedGear =
            encounter.rewards.guaranteedGear;

        assert(
            guaranteedGear &&
            Number.isInteger(guaranteedGear.rawStat),
            'Elite/Boss guaranteed gear is missing'
        );

        const generated = resolveLootSeed({
            zone: encounter.zone,
            source: encounter.type,
            slotRoll: lootRolls.slotRoll
        });

        const item = {
            ...generated.item,
            acquiredFrom: encounter.type,
            acquiredAtEncounter: encounter.id,
            bound: false
        };

        assert(
            item.rawStat === guaranteedGear.rawStat,
            'Generated Elite/Boss gear stat does not match locked reward'
        );

        state.inventory.bagReserves.push(item);
        loot.push(item);

        if (
            encounter.type === 'boss' &&
            encounter.rewards.bossTrophy === true
        ) {
            trophies.push({
                kind: 'boss_trophy_pending_name',
                encounterId: encounter.id,
                bound: false
            });
        }
    } else {
        throw new Error(
            `Unsupported encounter reward type: ${encounter.type}`
        );
    }

    /*
     * Normal-pack Wild or Curiosity loot is resolved only if its seed
     * was already locked when the scene event happened.
     */
    if (
        encounter.type === 'normal_pack' &&
        encounter.lootSeed
    ) {
        const seed = encounter.lootSeed;

        assert(
            seed.result === 'wild_equipment_drop' ||
            seed.result === 'hidden_loot_stash',
            `Unsupported locked loot seed: ${seed.result}`
        );

        const generated = resolveLootSeed({
            zone: encounter.zone,
            source: 'wild',
            slotRoll: lootRolls.slotRoll,
            rarityRoll: lootRolls.rarityRoll
        });

        const item = {
            ...generated.item,
            acquiredFrom: seed.source,
            acquiredAtEncounter: encounter.id,
            bound: false
        };

        state.inventory.bagReserves.push(item);
        loot.push(item);
    }

    encounter.status = 'cleared';
    encounter.rewards.resolved = true;

    return {
        xp,
        silver,
        resolved: true,
        encounterCleared: true,
        loot,
        trophies
    };
}

function applyBeltItem(state, item, recipient) {
    const crew = state.crew;
    const encounter = state.encounter;

    assert(
        recipient === 'qtik' || recipient === 'tansy',
        `Invalid potion recipient: ${recipient}`
    );

    assert(
        [
            'basic_health_potion',
            'mid_health_potion',
            'cleansing_tonic'
        ].includes(item),
        `Unsupported belt item: ${item}`
    );

    crew[recipient].belt = consumeBelt({
        belt: crew[recipient].belt,
        items: [item]
    }).remainingBelt;

    if (
        item === 'basic_health_potion' ||
        item === 'mid_health_potion'
    ) {
        const amount =
            item === 'mid_health_potion' ? 120 : 50;

        const character = crew[recipient];
        const stats = derived(crew);
        const maxHp = recipient === 'qtik'
            ? stats.qtikMaxHp
            : stats.tansyMaxHp;

        const beforeHp = character.hp;

        character.hp = Math.min(
            maxHp,
            character.hp + amount
        );

        return {
            item,
            recipient,
            effect: 'heal',
            requested: amount,
            healed: character.hp - beforeHp,
            hp: character.hp,
            maxHp
        };
    }

    // Cleanse one Hexer stack first, if present.
    const hexEntry = Object.entries(
        encounter.hexStacks || {}
    ).find(([, stacks]) => Number(stacks) > 0);

    if (hexEntry) {
        const [hexerId, stacks] = hexEntry;

        if (Number(stacks) === 1) {
            delete encounter.hexStacks[hexerId];
        } else {
            encounter.hexStacks[hexerId] =
                Number(stacks) - 1;
        }

        return {
            item,
            recipient,
            effect: 'cleanse',
            stacksRemoved: 1,
            sourceType: 'hexer',
            source: hexerId
        };
    }

    // If no Hexer stack exists, cleanse one Elite/Boss passive stack.
    if (
        (
            encounter.type === 'elite' ||
            encounter.type === 'boss'
        ) &&
        Number(encounter.passiveStacks || 0) > 0
    ) {
        encounter.passiveStacks -= 1;

        return {
            item,
            recipient,
            effect: 'cleanse',
            stacksRemoved: 1,
            sourceType: 'elite_boss_passive',
            source: encounter.passive
        };
    }

    return {
        item,
        recipient,
        effect: 'cleanse',
        stacksRemoved: 0,
        note: 'No active debuff stack to remove'
    };
}

const ELITE_BOSS_TELEGRAPHS = [
    'berserk_heavy_windup',
    'spiked_carapace',
    'sweeping_cleave',
    'aether_drain'
];

function passiveState(encounter) {
    if (
        encounter.type !== 'elite' &&
        encounter.type !== 'boss'
    ) {
        return null;
    }

    if (!encounter.passive) {
        return null;
    }

    encounter.passiveStacks =
        Number(encounter.passiveStacks || 0);

    return {
        name: encounter.passive,
        stacks: encounter.passiveStacks
    };
}

function passiveAttackPenalty(encounter) {
    const passive = passiveState(encounter);

    if (
        !passive ||
        passive.name !== 'withering_lethargy'
    ) {
        return 0;
    }

    return 2 * passive.stacks;
}

function passiveDefensePenalty(encounter) {
    const passive = passiveState(encounter);

    if (
        !passive ||
        passive.name !== 'armor_sunder'
    ) {
        return 0;
    }

    return 2 * passive.stacks;
}

function passiveRegenPenalty(encounter) {
    const passive = passiveState(encounter);

    if (
        !passive ||
        passive.name !== 'grave_chill'
    ) {
        return 0;
    }

    return 2 * passive.stacks;
}

function passiveBleedBonus(encounter) {
    const passive = passiveState(encounter);

    if (
        !passive ||
        passive.name !== 'serrated_bleed'
    ) {
        return 0;
    }

    return passive.stacks;
}

function chooseNextTelegraph(encounter, rollValue) {
    assert(
        encounter.type === 'elite' ||
        encounter.type === 'boss',
        'Only elites and bosses can have telegraphs'
    );

    const rollIndex =
        ((Number(rollValue) - 1) %
            ELITE_BOSS_TELEGRAPHS.length +
            ELITE_BOSS_TELEGRAPHS.length) %
        ELITE_BOSS_TELEGRAPHS.length;

    const previous = encounter.nextTelegraph;
    let selected =
        ELITE_BOSS_TELEGRAPHS[rollIndex];

    /*
     * The engine forbids back-to-back telegraph repeats.
     */
    if (
        selected === previous
    ) {
        selected =
            ELITE_BOSS_TELEGRAPHS[
                (rollIndex + 1) %
                ELITE_BOSS_TELEGRAPHS.length
            ];
    }

    return selected;
}

function telegraphLabel(telegraph) {
    const labels = {
        berserk_heavy_windup:
            'Berserk / Heavy Wind-Up',
        spiked_carapace:
            'Spiked Carapace / Thorns Guard',
        sweeping_cleave:
            'Sweeping Cleave / Shockwave',
        aether_drain:
            'Aether-Drain / Life-Siphon'
    };

    return labels[telegraph] || telegraph;
}

function telegraphEffects(encounter) {
    return {
        berserk_heavy_windup: {
            name: 'berserk_heavy_windup',
            bleedMultiplier: 2,
            extraDebuffStacks: 1
        },

        spiked_carapace: {
            name: 'spiked_carapace',
            defenseBonus: 6 * encounter.enemyTier,
            reflectsMeleeWeasel: true
        },

        sweeping_cleave: {
            name: 'sweeping_cleave',
            destroysMeleeWeasel: true,
            tansySplashPercent: 10
        },

        aether_drain: {
            name: 'aether_drain',
            healPerHit: 10 * encounter.enemyTier,
            targetsRaisedShadow: true
        }
    }[encounter.nextTelegraph] || null;
}

function currentHexPenaltyForState(state) {
    const encounter = state.encounter;

    return Object.entries(
        encounter.hexStacks || {}
    ).reduce((total, [id, stacks]) => {
        const hexer = live(state).find(
            foe =>
                foe.id === id &&
                foe.role === 'hexer'
        );

        if (!hexer) {
            return total;
        }

        return total +
            2 *
            enemyTier(hexer.level) *
            Number(stacks);
    }, 0);
}

function resolveTurn({
    state,
    actions,
    rolls,
    rewardMode = 'immediate'
}) {
   const s = clone(state);
    s.inventory ||= {};
    s.inventory.bagReserves ||= [];
    s.inventory.activeTradeListings ||= [];
    const initial = validate(s);
    const c = s.crew;
    const encounter = s.encounter;

    assert(
        ['immediate', 'deferred'].includes(rewardMode),
        'rewardMode must be immediate or deferred'
    );
    assert(
        actions && typeof actions === 'object',
        'Turn actions are required'
    );
    assert(
        [
            'fire_melee', 'ice_melee', 'stun',
            'ice_patch', 'frost_stomp', 'drink'
        ].includes(actions.qtik),
        `Unsupported Q'tik action: ${actions.qtik}`
    );
    assert(
        [
            'visor', 'vitals', 'hamstring',
            'recall', 'surge', 'drink'
        ].includes(actions.tansy),
        `Unsupported Tansy action: ${actions.tansy}`
    );
    assert(
        typeof actions.target === 'string',
        'A combat target is required'
    );
    assert(live(s).length > 0, 'No living foes');
    assert(
        live(s).some(foe => foe.id === actions.target),
        `Target ${actions.target} is not alive`
    );

    const crewStats = {
        atk: Number(initial.atk),
        def: Number(initial.def),
        luk: Number(initial.luk),
        qtikMaxHp: Number(initial.qtikMaxHp),
        tansyMaxHp: Number(initial.tansyMaxHp),
        regen: Number(initial.regen)
    };

    for (const [name, value] of Object.entries(crewStats)) {
        assert(
            Number.isFinite(value),
            `Derived crew stat ${name} is not finite`
        );
    }

    const maxWeasels = 2 + 2 * Math.floor(c.level / 2);
    c.weasels.max = maxWeasels;

    const baseAndGearAttack =
        crewStats.atk - 2 * state.crew.weasels.active;

    encounter.used ||= { stun: false, icePatch: false };
    encounter.hexStacks ||= {};
    encounter.exposed = Number(encounter.exposed || 0);
    encounter.passiveStacks = Number(encounter.passiveStacks || 0);
    encounter.turn = Number(encounter.turn || 0) + 1;

    const previousTelegraph = encounter.nextTelegraph;
    let activeTelegraph = telegraphEffects(encounter);
    const turnEffects = [];

    if (actions.qtik === 'stun') {
        assert(
            !encounter.used.stun,
            'Stun has already been used this fight'
        );
        encounter.used.stun = true;

        if (activeTelegraph) {
            turnEffects.push(
                `Stun cancelled ${telegraphLabel(previousTelegraph)}`
            );
        }

        encounter.nextTelegraph = null;
        activeTelegraph = null;
    }

    if (actions.qtik === 'ice_patch') {
        assert(
            !encounter.used.icePatch,
            'Ice Patch has already been used this fight'
        );
        encounter.used.icePatch = true;
    }

    const itemUse = {};

    if (actions.qtik === 'drink') {
        assert(
            typeof actions.qtikItem === 'string',
            "Q'tik drink action requires actions.qtikItem"
        );
        itemUse.qtik = applyBeltItem(
            s, actions.qtikItem, 'qtik'
        );
    }

    if (actions.tansy === 'drink') {
        assert(
            typeof actions.tansyItem === 'string',
            'Tansy drink action requires actions.tansyItem'
        );
        itemUse.tansy = applyBeltItem(
            s, actions.tansyItem, 'tansy'
        );
    }

    if (actions.tansy === 'surge') {
        c.weasels.active = maxWeasels;
    }

    const tape = checkTape(s, rolls);
    const logs = [];
    const kills = [];
    const startingCount = live(s).length;
    let weaselsDestroyed = 0;
    /*
     * Pure Fodder Blitz:
     * A pure three-Brute pack can be resolved in one page when
     * effective Crew ATK exceeds Brute DEF and Q'tik's net damage
     * remains below 15% of her MaxHP.
     */
    let fodderBlitz = null;

    const isPureFodder =
        encounter.type === 'normal_pack' &&
        encounter.composition === 1 &&
        live(s).length > 0 &&
        live(s).every(foe => foe.role === 'brute');

    if (isPureFodder) {
        const directed =
            actions.tansy === 'visor' ||
            actions.tansy === 'vitals' ||
            actions.tansy === 'hamstring';

        const blitzWeaselAttack =
            actions.tansy === 'recall'
                ? 0
                : c.weasels.active *
                    (directed ? 2 : 1);

        const blitzAttack =
            (
                actions.tansy === 'recall'
                    ? 2 * c.level
                    : baseAndGearAttack + blitzWeaselAttack
            ) -
            currentHexPenaltyForState(s) -
            passiveAttackPenalty(encounter);

        const blitzTarget =
            live(s).find(foe => foe.role === 'brute');

        const blitzDefense =
            blitzTarget?.def ?? 0;

        const qDef =
            crewStats.def +
            (
                actions.qtik === 'ice_melee'
                    ? 2
                    : 0
            );

        const liveBruteCount =
            live(s).filter(
                foe => foe.role === 'brute'
            ).length;

        const lead =
            live(s).find(
                foe => foe.role === 'brute'
            );

        const tier =
            lead
                ? enemyTier(lead.level)
                : 1;

        let singleBaseBleed = lead
            ? Math.max(
                1,
                Math.round(
                    (lead.atk - qDef) / 10
                )
            )
            : 0;

        if (actions.qtik === 'ice_melee') {
            singleBaseBleed = Math.max(
                1,
                singleBaseBleed - 1
            );
        }

        const packBaseBleed =
            singleBaseBleed +
            tier * Math.max(
                0,
                liveBruteCount - 1
            );

        const enemyDamage =
            tape.enemy.reduce(
                (total, enemyRoll) => {
                    if (enemyRoll === 1) {
                        return total;
                    }

                    const rollDamage =
                        enemyRoll === 6
                            ? 4
                            : enemyRoll === 5
                                ? 2
                                : enemyRoll >= 3
                                    ? 1
                                    : 0;

                    return total +
                        packBaseBleed +
                        rollDamage;
                },
                0
            );

        const blitzRegen =
            crewStats.regen * 3;

        const netDamage =
            Math.max(
                0,
                enemyDamage - blitzRegen
            );

        const damageThreshold =
            crewStats.qtikMaxHp * 0.15;

        const eligible =
            Number.isFinite(blitzAttack) &&
            blitzAttack > blitzDefense &&
            netDamage < damageThreshold;

        if (eligible) {
            const blitzKills =
                live(s).map(foe => ({
                    id: foe.id,
                    level: foe.level,
                    role: foe.role
                }));

            for (const foe of live(s)) {
                foe.hp = 0;
            }

            kills.push(...blitzKills);

            c.qtik.hp = Math.min(
                crewStats.qtikMaxHp,
                Math.max(
                    0,
                    c.qtik.hp - netDamage
                )
            );

            fodderBlitz = {
                active: true,
                effectiveAttack: blitzAttack,
                targetDefense: blitzDefense,
                enemyDamage,
                regeneration: blitzRegen,
                netDamage,
                threshold: damageThreshold,
                foeCount: blitzKills.length
            };

            logs.push({
                exchange: 'blitz',
                fastForwarded: true,
                playerRolls: tape.player,
                enemyRolls: tape.enemy,
                target: blitzTarget.id,
                crit: false,
                damage: null,
                hits: blitzKills.map(kill => ({
                    id: kill.id,
                    damage: 'full_clear',
                    hp: 0,
                    overkillAfterHit: 0
                })),
                enemyMiss: null,
                frontlineDamage: enemyDamage,
                backlineDamage: 0,
                effectiveRegen: crewStats.regen,
                effects: [
                    'Pure Fodder Blitz',
                    `${blitzKills.length} Brutes cleared`,
                    `Net Q'tik damage: ${netDamage}`
                ],
                qtikHp: c.qtik.hp,
                tansyHp: c.tansy.hp,
                livingFoes: []
            });
        }
    }

    function lowestHpFoe() {
        // Stable sorting preserves encounter order for ties.
        return [...live(s)].sort((a, b) => a.hp - b.hp)[0];
    }

    function currentHexPenalty() {
        return Object.entries(encounter.hexStacks)
            .reduce((total, [id, stacks]) => {
                const hexer = live(s).find(
                    foe => foe.id === id && foe.role === 'hexer'
                );
                return total + (
                    hexer
                        ? 2 * enemyTier(hexer.level) * Number(stacks)
                        : 0
                );
            }, 0);
    }

    function currentBuffer() {
        return live(s).find(
            foe =>
                foe.id === encounter.bufferId &&
                foe.role === 'buffer'
        );
    }

    function enemyDefense(foe) {
        const buffer = currentBuffer();
        const bufferBonus = buffer
            ? 3 * enemyTier(buffer.level)
            : 0;

        const telegraphBonus = activeTelegraph
            ? Number(activeTelegraph.defenseBonus || 0)
            : 0;

        const stunReduction = actions.qtik === 'stun'
            ? 4 * enemyTier(foe.level)
            : 0;

        return Math.max(
            0,
            foe.def + bufferBonus + telegraphBonus - stunReduction
        );
    }

    function destroyWeasel(effects, cause) {
        const destroyed = Math.min(c.weasels.active, 1);
        c.weasels.active -= destroyed;
        weaselsDestroyed += destroyed;

        if (destroyed > 0) {
            effects.push(`${cause} destroyed 1 melee weasel`);
        }
    }

    for (
        let ex = fodderBlitz ? 3 : 0;
        ex < 3 &&
        live(s).length > 0 &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0;
        ex++
    ) {
        const p = tape.player[ex];
        const e = tape.enemy[ex];
        const effects = [];

        const patchActive = actions.qtik === 'ice_patch';
        const hamstringActive = actions.tansy === 'hamstring';

        const missLimit = patchActive
            ? (hamstringActive ? 4 : 3)
            : (hamstringActive ? 2 : 1);

        const enemyMiss =
            e <= missLimit ||
            (actions.qtik === 'stun' && ex === 0);

        const hexPenalty = currentHexPenalty();

        const directed = [
            'visor', 'vitals', 'hamstring'
        ].includes(actions.tansy);

        /*
         * Tansy's action controls summons.
         * Q'tik drinking has no effect on their contribution.
         */
        const weaselAttack = actions.tansy === 'recall'
            ? 0
            : c.weasels.active *
                (directed && !patchActive ? 2 : 1);

        const unpenalizedAttack = actions.tansy === 'recall'
            ? 2 * c.level
            : baseAndGearAttack + weaselAttack;

        const effectiveAttack = Math.max(
            0,
            unpenalizedAttack -
            hexPenalty -
            passiveAttackPenalty(encounter)
        );

        const effectiveDefense = Math.max(
            0,
            crewStats.def -
            hexPenalty -
            passiveDefensePenalty(encounter) +
            (actions.qtik === 'ice_melee' ? 2 : 0)
        );

        let target = live(s).find(
            foe => foe.id === actions.target
        );

        // Once the declared target dies, continue against lowest HP.
        if (!target) {
            target = lowestHpFoe();
            effects.push(`Retargeted to ${target.id}`);
        }

        const brute = live(s).find(
            foe => foe.role === 'brute'
        );

        if (
            brute &&
            target.role !== 'brute' &&
            !enemyMiss &&
            actions.tansy !== 'visor' &&
            actions.qtik !== 'frost_stomp'
        ) {
            effects.push(`${brute.id} intercepted with Guard`);
            target = brute;
        }

        /*
         * Fire uses current action/summon contribution before
         * ATK debuffs. Withering and Hexer penalties cannot reduce it.
         */
            const fireDamage = actions.qtik === 'fire_melee'
                ? Math.max(3, Math.floor(crewStats.atk / 5))
                : 0;

        const isCritical =
            p === 6 ||
            (actions.tansy === 'vitals' && p === 5);

        const targetDefense = enemyDefense(target);

        const vitalsBonus =
            actions.tansy === 'vitals' &&
            p >= 2 && p <= 4
                ? Math.min(
                    targetDefense,
                    Math.floor(c.weasels.active / 2)
                )
                : 0;

        /*
         * A miss does not consume Exposed.
         * The bonus is spent on the next successful physical hit.
         */
        const exposedBonus = p === 1
            ? 0
            : encounter.exposed;

        if (p !== 1) {
            encounter.exposed = 0;
        }

        let damage = 0;
        let hits = [];

        if (actions.qtik === 'frost_stomp') {
            const stompTargets = [...live(s)].sort((a, b) => {
                const aIndex = s.encounter.foes.indexOf(a);
                const bIndex = s.encounter.foes.indexOf(b);
                return aIndex - bIndex;
            });

            let totalAttempted = 0;
            let totalApplied = 0;

            for (let targetIndex = 0;
                 targetIndex < stompTargets.length;
                 targetIndex++) {
                const primaryTarget =
                    stompTargets[targetIndex];

                if (primaryTarget.hp <= 0) {
                    continue;
                }

                const baseStomp = Math.max(
                    0,
                    Math.floor(
                        (
                            effectiveAttack -
                            enemyDefense(primaryTarget)
                        ) / 2
                    )
                );

                let attempted = p === 1
                    ? Math.max(
                        1,
                        Math.floor(baseStomp / 2)
                    )
                    : baseStomp + p;

                /*
                 * Vitals/LUK and Exposed apply only to the declared
                 * primary target, never to spillover targets.
                 */
                if (
                    primaryTarget.id === target.id &&
                    p !== 1
                ) {
                    attempted += (
                        isCritical
                            ? crewStats.luk
                            : vitalsBonus
                    ) + exposedBonus;
                }

                attempted = Math.max(
                    1,
                    Number(attempted)
                );

                assert(
                    Number.isFinite(attempted),
                    `Frost Stomp damage is invalid against ` +
                    `${primaryTarget.id}`
                );

                totalAttempted += attempted;

                let remaining = attempted;
                let spillIndex = targetIndex;

                /*
                 * Any excess damage from a slain target moves into the
                 * next living target in encounter order. This preserves
                 * the original pack order and prevents the same foe from
                 * being selected repeatedly by an HP sort.
                 */
                while (remaining > 0) {
                    while (
                        spillIndex < stompTargets.length &&
                        stompTargets[spillIndex].hp <= 0
                    ) {
                        spillIndex++;
                    }

                    const spillTarget =
                        stompTargets[spillIndex];

                    if (!spillTarget) {
                        break;
                    }

                    const applied = Math.min(
                        spillTarget.hp,
                        remaining
                    );

                    spillTarget.hp -= applied;
                    remaining -= applied;
                    totalApplied += applied;

                    hits.push({
                        id: spillTarget.id,
                        damage: applied,
                        hp: spillTarget.hp,
                        overkillAfterHit: remaining,
                        source: primaryTarget.id
                    });

                    if (spillTarget.hp === 0) {
                        kills.push({
                            id: spillTarget.id,
                            level: spillTarget.level,
                            role: spillTarget.role
                        });

                        spillIndex++;
                    } else {
                        break;
                    }
                }
            }

            /*
             * Preserve the resolver's existing damage field as total
             * attempted AoE damage, while hit records show actual HP
             * removed and spillover.
             */
            damage = totalAttempted;

            assert(
                Number.isFinite(totalApplied),
                'Frost Stomp applied damage is not finite'
            );
        } else {

            /*
             * Drinking removes Fire/Ice bonuses, not ordinary
             * attack rolls, criticals, or Tansy's active command.
             */
            const physicalDamage = p === 1
                ? 1
                : isCritical
                    ? Math.max(
                        6 + crewStats.luk,
                        effectiveAttack -
                        targetDefense +
                        6 + crewStats.luk
                    )
                    : Math.max(
                        1,
                        effectiveAttack -
                        targetDefense +
                        p + vitalsBonus
                    );

            damage = physicalDamage + fireDamage + exposedBonus;

            assert(
                Number.isFinite(damage),
                'Player damage is not finite'
            );

            hits = dealDamage(s, target, damage, kills);
        }

        /*
         * Thorns reflects on melee participation each exchange,
         * including an enemy miss. Fire Melee and Recall avoid it.
         */
        if (
            activeTelegraph?.reflectsMeleeWeasel &&
            actions.qtik !== 'fire_melee' &&
            actions.tansy !== 'recall' &&
            live(s).length > 0
        ) {
            destroyWeasel(effects, 'Spiked Carapace');
        }

        if (live(s).length === 0) {
            logs.push({
                exchange: ex + 1,
                playerRoll: p,
                enemyRoll: null,
                target: target.id,
                crit: isCritical,
                damage,
                hits,
                enemyMiss: null,
                frontlineDamage: 0,
                backlineDamage: 0,
                effects: [
                    ...effects,
                    'Final foe slain before enemy response'
                ],
                qtikHp: c.qtik.hp,
                tansyHp: c.tansy.hp,
                livingFoes: []
            });
            break;
        }

        const frontliners = live(s).filter(
            foe => ['brute', 'elite', 'boss'].includes(foe.role)
        );

        const bruteAlive = live(s).some(
            foe => foe.role === 'brute'
        );

        let frontlineDamage = 0;
        let backlineDamage = 0;
        let enemyHitCount = 0;

        if (!enemyMiss) {
            /*
             * A successful Buffer cast activates its non-stacking
             * aura. DEF matters on subsequent player exchanges.
             * Base Bleed matters on this enemy response.
             */
            const castingBuffer = live(s).find(
                foe => foe.role === 'buffer'
            );

            if (castingBuffer) {
                encounter.bufferId = castingBuffer.id;
                effects.push(
                    `${castingBuffer.id} activated ` +
                    `+${3 * enemyTier(castingBuffer.level)} Pack DEF`
                );
            }

            if (frontliners.length > 0) {
                const lead = frontliners[0];

                let baseBleed = Math.max(
                    1,
                    Math.round((lead.atk - effectiveDefense) / 10)
                );

                if (actions.qtik === 'ice_melee') {
                    baseBleed = Math.max(1, baseBleed - 1);
                }

                if (hamstringActive) {
                    baseBleed = Math.max(
                        1,
                        baseBleed -
                        Math.floor(c.weasels.active / 6)
                    );
                }

                baseBleed += enemyTier(lead.level) *
                    Math.max(0, frontliners.length - 1);

                const buffer = currentBuffer();
                if (buffer) {
                    baseBleed += enemyTier(buffer.level);
                }

                if (activeTelegraph?.bleedMultiplier) {
                    baseBleed *= activeTelegraph.bleedMultiplier;
                    effects.push('Telegraph doubled Base Bleed');
                }

                const rollDamage = e === 6
                    ? 4
                    : e === 5
                        ? 2
                        : e >= 3 ? 1 : 0;

                frontlineDamage =
                    baseBleed +
                    rollDamage +
                    passiveBleedBonus(encounter);

                enemyHitCount++;

                if (
                    activeTelegraph?.destroysMeleeWeasel &&
                    actions.tansy !== 'recall'
                ) {
                    destroyWeasel(effects, 'Sweeping Cleave');

                    const splash = Math.ceil(
                        crewStats.tansyMaxHp *
                        activeTelegraph.tansySplashPercent / 100
                    );

                    backlineDamage += splash;
                    effects.push(
                        `Sweeping Cleave dealt ${splash} splash to Tansy`
                    );
                }
            }

                       for (const foe of live(s)) {
                const tier = enemyTier(foe.level);

                if (foe.role === 'archer') {
                    const amount = 4 * tier * (e === 6 ? 2 : 1);
                    backlineDamage += amount;
                    enemyHitCount++;

                    effects.push(
                        `${foe.id} dealt ${amount} damage to Tansy`
                    );
                }

                if (foe.role === 'mender') {
                    if (!bruteAlive) {
                        frontlineDamage++;
                        enemyHitCount++;

                        effects.push(
                            `${foe.id} dealt 1 panicked melee bleed`
                        );
                    } else {
                        const wounded = [...live(s)]
                            .filter(ally =>
                                ally.hp <
                                mobStats(ally.level, ally.role).maxHp
                            )
                            .sort((a, b) =>
                                a.hp /
                                    mobStats(a.level, a.role).maxHp -
                                b.hp /
                                    mobStats(b.level, b.role).maxHp
                            )[0];

                        if (wounded) {
                            const amount = Math.min(
                                10 * tier,
                                mobStats(
                                    wounded.level,
                                    wounded.role
                                ).maxHp - wounded.hp
                            );

                            wounded.hp += amount;

                            effects.push(
                                `${foe.id} healed ${wounded.id} for ${amount}`
                            );
                        }
                    }
                }

                if (foe.role === 'hexer') {
                    const blocked =
                        actions.tansy === 'visor' &&
                        e >= 2 &&
                        e <= 4;

                    if (!blocked) {
                        const stacks =
                            (e === 6 ? 2 : 1) +
                            Number(
                                activeTelegraph?.extraDebuffStacks || 0
                            );

                        encounter.hexStacks[foe.id] =
                            Number(encounter.hexStacks[foe.id] || 0) +
                            stacks;

                        effects.push(
                            `${foe.id} added ${stacks} hex stack(s)`
                        );
                    }
                }
            }

            if (
                ['elite', 'boss'].includes(encounter.type) &&
                encounter.passive &&
                frontliners.length > 0
            ) {
                const blocked =
                    actions.tansy === 'visor' &&
                    e >= 2 && e <= 4;

                if (!blocked) {
                    const stacks =
                        (e === 6 ? 2 : 1) +
                        Number(
                            activeTelegraph?.extraDebuffStacks || 0
                        );

                    encounter.passiveStacks += stacks;
                    effects.push(
                        `${encounter.passive} stack ` +
                        `${encounter.passiveStacks}`
                    );
                } else {
                    effects.push('Visor blocked passive debuff');
                }
            }

            if (
                activeTelegraph?.healPerHit &&
                enemyHitCount > 0
            ) {
                const drainTarget =
                    live(s).find(foe =>
                        ['elite', 'boss'].includes(foe.role)
                    ) || live(s)[0];

                const maxHp = mobStats(
                    drainTarget.level, drainTarget.role
                ).maxHp;

                const requested =
                    activeTelegraph.healPerHit * enemyHitCount;

                const healed = Math.min(
                    requested, maxHp - drainTarget.hp
                );

                drainTarget.hp += healed;
                effects.push(
                    `Aether-Drain restored ${healed} enemy HP`
                );
            }
        }

        c.qtik.hp = Math.max(0, c.qtik.hp - frontlineDamage);
        c.tansy.hp = Math.max(0, c.tansy.hp - backlineDamage);

        /*
         * End-of-exchange regeneration includes any Grave-Chill
         * stacks inflicted during this exchange.
         */
        const effectiveRegen =
            crewStats.regen - passiveRegenPenalty(encounter);

        if (c.qtik.hp > 0) {
            c.qtik.hp = Math.max(
                0,
                Math.min(
                    crewStats.qtikMaxHp,
                    c.qtik.hp + effectiveRegen
                )
            );

            if (effectiveRegen < 0) {
                effects.push(
                    `Negative regeneration dealt ` +
                    `${-effectiveRegen} internal damage`
                );
            }
        }

        if (actions.tansy === 'visor' && e === 1) {
            encounter.exposed = crewStats.luk;
            effects.push(
                `Target exposed for +${crewStats.luk} damage`
            );
        }

        logs.push({
            exchange: ex + 1,
            playerRoll: p,
            enemyRoll: e,
            target: target.id,
            crit: isCritical,
            damage,
            hits,
            enemyMiss,
            frontlineDamage,
            backlineDamage,
            effectiveRegen,
            effects,
            qtikHp: c.qtik.hp,
            tansyHp: c.tansy.hp,
            livingFoes: live(s).map(
                foe => ({ id: foe.id, hp: foe.hp })
            )
        });
    }

    /*
     * Swarm Momentum occurs once after a completed three-exchange
     * turn. Only weasels destroyed during this turn can reform.
     */
    let momentum = null;

    if (
        logs.length === 3 &&
        live(s).length > 0 &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0
    ) {
        const activeBefore = c.weasels.active;
        const quota =
            1 + Math.floor(activeBefore / 4);

        const restored = Math.min(
            weaselsDestroyed,
            quota,
            maxWeasels - activeBefore
        );

        c.weasels.active += restored;

        momentum = {
            activeBefore,
            destroyedThisTurn: weaselsDestroyed,
            quota,
            restored,
            activeAfter: c.weasels.active,
            maximum: maxWeasels
        };

        if (restored > 0) {
            turnEffects.push(
                `Swarm Momentum reformed ${restored} weasel(s)`
            );
        }
    }

    const encounterRewards = finalizeEncounterRewards(
        s,
        kills.map(kill => kill.id),
        {
            slotRoll: rolls?.lootSlotRoll,
            rarityRoll: rolls?.lootRarityRoll
        }
);


    let levelUps = [];

    if (
        rewardMode === 'immediate' &&
        encounterRewards.resolved
    ) {
        levelUps = applyXp(c, encounterRewards.xp);
        c.purse += encounterRewards.silver;
    }

    encounter.hexStacks = Object.fromEntries(
        Object.entries(encounter.hexStacks)
            .filter(([id]) =>
                live(s).some(foe => foe.id === id)
            )
    );

    if (!currentBuffer()) {
        delete encounter.bufferId;
    }

    if (live(s).length === 0) {
        encounter.status = 'cleared';
        encounter.nextTelegraph = null;
    } else if (
        ['elite', 'boss'].includes(encounter.type) &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0
    ) {
        const telegraphRoll =
            rolls?.telegraph !== undefined
                ? rolls.telegraph
                : roll(s, 4);

        assert(
            Number.isInteger(telegraphRoll) &&
            telegraphRoll >= 1 &&
            telegraphRoll <= 4,
            'Telegraph roll must be 1-4'
        );

        /*
         * Preserve the previous selection for the no-repeat check,
         * including when Stun cancelled its effects this turn.
         */
        encounter.nextTelegraph = previousTelegraph;
        encounter.nextTelegraph = chooseNextTelegraph(
            encounter, telegraphRoll
        );
    }

    c.weasels.max = 2 + 2 * Math.floor(c.level / 2);

    const finalStats = derived(c);
    c.qtik.maxHp = finalStats.qtikMaxHp;
    c.qtik.def = finalStats.def;
    c.qtik.regen = finalStats.regen;
    c.tansy.maxHp = finalStats.tansyMaxHp;

    const result = {
        ok: true,
        turn: encounter.turn,
        rolls: tape,
        itemUse,
        exchanges: logs,
        turnEffects,
        weaselsDestroyed,
        momentum,
        fodderBlitz,
        kills,
        rewards: {
            xp: encounterRewards.xp,
            silver: encounterRewards.silver,
            applied:
                rewardMode === 'immediate' &&
                encounterRewards.resolved,
            resolved: encounterRewards.resolved,
            loot: encounterRewards.loot,
            trophies: encounterRewards.trophies
        },
        levelUps,
        packCleared:
            startingCount > 0 && live(s).length === 0,
        state: s,
        derived: finalStats
    };

    function assertNoNonFinite(value, path = 'result') {
        if (typeof value === 'number') {
            assert(
                Number.isFinite(value),
                `${path} contains a non-finite number`
            );
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((child, index) =>
                assertNoNonFinite(child, `${path}[${index}]`)
            );
            return;
        }

        if (value !== null && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                assertNoNonFinite(child, `${path}.${key}`);
            }
        }
    }

    assertNoNonFinite(result);
    return result;
}

function createFoe({ id, level, role }) {
    const stats = mobStats(level, role);

    return {
        id,
        level,
        role,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        atk: stats.atk,
        def: stats.def
    };
}

function vendorStock(zone) {
    const z = ZONES[zone];
    assert(z, `Unknown zone ${zone}`);
    return {
        zone: z.name,
        stat: z.base,
        price: z.base * 8,
        pawn: z.base * 2,
        tansy: {
            weaponAtk: z.base * 2,
            glovesAtk: z.base,
            chestOrTrousersHp: z.base * 5,
            chestOrTrousersLuk: 1,
            modularVitalityHp: z.base * 5,
            modularLuckLuk: z.base
        },
        qtik: {
            bulwarkDef: z.base * 2,
            vitalityHp: z.base * 15
        }
    };
}

function register(name, displayName, description, parameters, operation) {
    const context = getContext();
    context.registerFunctionTool({
        name,
        displayName,
        description,
        parameters,
        action: async args => {
            try {
                return JSON.stringify(operation(args));
            } catch (error) {
                return JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        },
        formatMessage: () => `Running ${displayName}...`,
        stealth: false
    });
}
const NORMAL_BRACKETS = {
    1: {
        low:  { level: 2,  xpSwarm: 24,  xpMixed: 16 },
        mid:  { level: 3,  xpSwarm: 36,  xpMixed: 24 },
        high: { level: 4,  xpSwarm: 60,  xpMixed: 40 }
    },
    2: {
        low:  { level: 7, xpSwarm: 105, xpMixed: 70 },
        mid:  { level: 8, xpSwarm: 120, xpMixed: 80 },
        high: { level: 9, xpSwarm: 135, xpMixed: 90 }
    },
    3: {
        low:  { level: 12, xpSwarm: 180, xpMixed: 120 },
        mid:  { level: 13, xpSwarm: 195, xpMixed: 130 },
        high: { level: 14, xpSwarm: 210, xpMixed: 140 }
    },
    4: {
        low:  { level: 17, xpSwarm: 255, xpMixed: 170 },
        mid:  { level: 18, xpSwarm: 270, xpMixed: 180 },
        high: { level: 19, xpSwarm: 285, xpMixed: 190 }
    },
    5: {
        low:  { level: 22, xpSwarm: 330, xpMixed: 220 },
        mid:  { level: 23, xpSwarm: 345, xpMixed: 230 },
        high: { level: 24, xpSwarm: 360, xpMixed: 240 }
    }
};

const PACK_COMPOSITIONS = {
    1: ['brute', 'brute', 'brute'],
    2: ['brute', 'mender', 'archer'],
    3: ['brute', 'archer', 'archer'],
    4: ['brute', 'hexer', 'mender'],
    5: ['brute', 'buffer', 'archer'],
    6: ['brute', 'hexer', 'archer']
};

function spawnNormalPack({
    zone,
    bracket = 'mid',
    composition = 2,
    encounterId = `normal-pack-z${zone}`
}) {
    assert(
        Number.isInteger(zone) &&
        ZONES[zone],
        `Unknown zone: ${zone}`
    );

    assert(
        NORMAL_BRACKETS[zone] &&
        NORMAL_BRACKETS[zone][bracket],
        `Invalid bracket for zone ${zone}: ${bracket}`
    );

    assert(
        Number.isInteger(composition) &&
        PACK_COMPOSITIONS[composition],
        'Pack composition must be an integer from 1 to 6'
    );

    const zoneData =
        ZONES[zone];

    const bracketData =
        NORMAL_BRACKETS[zone][bracket];

    const roles =
        PACK_COMPOSITIONS[composition];

    const foes =
        roles.map((role, index) =>
            createFoe({
                id:
                    `${encounterId}-${role}-${index + 1}`,
                level: bracketData.level,
                role
            })
        );

    const pureFodder =
        composition === 1;

    const listedPackXp =
        pureFodder
            ? bracketData.xpSwarm
            : bracketData.xpMixed;

    const autoSalvage =
        foes.length *
        2 *
        zoneData.tier;

    const lockedRewards = {
        kind: 'normal_pack',
        listedPackXp,
        autoSalvage,
        foeCount: foes.length,
        resolved: false
    };

    return {
        ok: true,

        encounter: {
            id: encounterId,
            status: 'active',
            turn: 0,
            zone,
            type: 'normal_pack',
            bracket,
            composition,
            compositionName:
                pureFodder
                    ? 'Pure Fodder Swarm'
                    : 'Mixed Tactical Squad',
            enemyTier: zoneData.tier,
            foes,

            /*
             * These fields are deliberately null at spawn.
             * They become locked only when the corresponding event
             * actually occurs in the scene.
             */
            packDropRoll: null,
            curiosityRoll: null,
            rumorRoll: null,
            lootSeed: null,
            questSeed: null,

            rewards: lockedRewards,

            used: {
                stun: false,
                icePatch: false
            },
            hexStacks: {},
            exposed: 0
        },

        rewards: lockedRewards
    };
}

const ELITE_LEVELS = {
    1: { mid: 4, high: 5 },
    2: { mid: 8, high: 10 },
    3: { mid: 13, high: 15 },
    4: { mid: 18, high: 20 },
    5: { mid: 23, high: 25 }
};

const BOSS_LEVELS = {
    1: 5,
    2: 10,
    3: 15,
    4: 20,
    5: 25
};

const PASSIVES = {
    1: 'armor_sunder',
    2: 'grave_chill',
    3: 'withering_lethargy',
    4: 'serrated_bleed'
};

function spawnEncounter(test) {
    const kind =
        test.encounterType ||
        'normal_pack';

    if (kind === 'normal_pack') {
        return spawnNormalPack({
            zone: test.zone,
            bracket:
                test.bracket ||
                'mid',
            composition:
                test.composition ||
                2,
            encounterId:
                test.encounterId ||
                `normal-pack-z${test.zone}`
        });
    }

    assert(
        ZONES[test.zone],
        `Unknown zone: ${test.zone}`
    );

    assert(
        kind === 'elite' ||
        kind === 'boss',
        `Unsupported encounter type: ${kind}`
    );

    assert(
        Number.isInteger(test.passiveRoll) &&
        PASSIVES[test.passiveRoll],
        'Elite/boss spawn requires passiveRoll from 1 to 4'
    );

    let level;

    if (kind === 'elite') {
        const bracket =
            test.bracket ||
            'mid';

        assert(
            bracket === 'mid' ||
            bracket === 'high',
            'Elite bracket must be mid or high'
        );

        level =
            ELITE_LEVELS[test.zone][bracket];
    } else {
        level =
            BOSS_LEVELS[test.zone];
    }

    const id =
        test.encounterId ||
        `${kind}-z${test.zone}`;

    const foe =
        createFoe({
            id: `${id}-${kind}`,
            level,
            role: kind
        });

    const zoneBase =
        ZONES[test.zone].base;

    const rawStat =
        zoneBase +
        (
            kind === 'elite'
                ? 1
                : 5
        );

    const baseKillXp =
        mobStats(level, kind).xpBase;

    const encounterRewards = {
        kind,
        baseKillXp,
        xpOnKillDependsOnCrewLevel: true,
        guaranteedGear: {
            rarity:
                kind === 'elite'
                    ? 'uncommon'
                    : 'epic',
            rawStat,
            pawnSilver: 2 * rawStat,
            slotPending: true
        },
        bossTrophy:
            kind === 'boss',
        resolved: false
    };

    return {
        ok: true,

        encounter: {
            id,
            status: 'active',
            turn: 0,
            zone: test.zone,
            type: kind,
            enemyTier: enemyTier(level),
            foes: [foe],
            passive:
                PASSIVES[test.passiveRoll],
            passiveStacks: 0,
            nextTelegraph: null,

            /*
             * These fields are deliberately null at spawn.
             * Elite/Boss loot and trophies are selected only when
             * the encounter is cleared.
             */
            packDropRoll: null,
            curiosityRoll: null,
            rumorRoll: null,
            lootSeed: null,
            questSeed: null,

            rewards: encounterRewards,

            used: {
                stun: false,
                icePatch: false
            },
            hexStacks: {},
            exposed: 0
        },

        rewards: encounterRewards
    };
}
const QUEST_REWARD_TABLES = {
    1: {
        low: [
            { rank: 'F', gates: 1, xp: 60,   silver: 6,   repSteps: 1, salvageRarity: 'common',   salvageStat: 2 },
            { rank: 'E', gates: 1, xp: 90,   silver: 9,   repSteps: 1, salvageRarity: 'common',   salvageStat: 2 },
            { rank: 'D', gates: 1, xp: 180,  silver: 18,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 3 }
        ],
        high: [
            { rank: 'D', gates: 2, xp: 180,  silver: 18,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 3 },
            { rank: 'C', gates: 2, xp: 300,  silver: 30,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 3 },
            { rank: 'B', gates: 3, xp: 540,  silver: 54,  repSteps: 2, salvageRarity: 'rare',     salvageStat: 5 }
        ]
    },
    2: {
        low: [
            { rank: 'F', gates: 1, xp: 160,  silver: 16,  repSteps: 1, salvageRarity: 'common',   salvageStat: 4 },
            { rank: 'E', gates: 1, xp: 240,  silver: 24,  repSteps: 1, salvageRarity: 'common',   salvageStat: 4 },
            { rank: 'D', gates: 1, xp: 480,  silver: 48,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 5 }
        ],
        high: [
            { rank: 'D', gates: 2, xp: 480,  silver: 48,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 5 },
            { rank: 'C', gates: 3, xp: 800,  silver: 80,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 5 },
            { rank: 'B', gates: 3, xp: 1440, silver: 144, repSteps: 2, salvageRarity: 'rare',     salvageStat: 7 }
        ]
    },
    3: {
        low: [
            { rank: 'F', gates: 1, xp: 260,  silver: 26,  repSteps: 1, salvageRarity: 'common',   salvageStat: 7 },
            { rank: 'E', gates: 1, xp: 390,  silver: 39,  repSteps: 1, salvageRarity: 'common',   salvageStat: 7 },
            { rank: 'D', gates: 2, xp: 780,  silver: 78,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 8 }
        ],
        high: [
            { rank: 'D', gates: 2, xp: 780,  silver: 78,  repSteps: 2, salvageRarity: 'uncommon', salvageStat: 8 },
            { rank: 'C', gates: 3, xp: 1300, silver: 130, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 8 },
            { rank: 'B', gates: 4, xp: 2340, silver: 234, repSteps: 2, salvageRarity: 'rare',     salvageStat: 10 }
        ]
    },
    4: {
        low: [
            { rank: 'F', gates: 1, xp: 360,  silver: 36,  repSteps: 1, salvageRarity: 'common',   salvageStat: 9 },
            { rank: 'E', gates: 1, xp: 540,  silver: 54,  repSteps: 1, salvageRarity: 'common',   salvageStat: 9 },
            { rank: 'D', gates: 2, xp: 1080, silver: 108, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 10 }
        ],
        high: [
            { rank: 'D', gates: 2, xp: 1080, silver: 108, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 10 },
            { rank: 'C', gates: 3, xp: 1800, silver: 180, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 10 },
            { rank: 'B', gates: 4, xp: 3240, silver: 324, repSteps: 2, salvageRarity: 'rare',     salvageStat: 12 }
        ]
    },
    5: {
        low: [
            { rank: 'F', gates: 1, xp: 460,  silver: 46,  repSteps: 1, salvageRarity: 'common',   salvageStat: 12 },
            { rank: 'E', gates: 1, xp: 690,  silver: 69,  repSteps: 1, salvageRarity: 'common',   salvageStat: 12 },
            { rank: 'D', gates: 2, xp: 1380, silver: 138, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 13 }
        ],
        high: [
            { rank: 'D', gates: 2, xp: 1380, silver: 138, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 13 },
            { rank: 'C', gates: 3, xp: 2300, silver: 230, repSteps: 2, salvageRarity: 'uncommon', salvageStat: 13 },
            { rank: 'B', gates: 4, xp: 4140, silver: 414, repSteps: 2, salvageRarity: 'rare',     salvageStat: 15 }
        ]
    }
};

const QUEST_RANK_LABELS = {
    F: 'Chore',
    E: 'Local',
    D: 'Minor',
    C: 'Regional',
    B: 'Major'
};

const QUEST_SALVAGE_SLOTS = [
    { owner: 'tansy', slot: 'weapon',     variant: null },
    { owner: 'tansy', slot: 'gloves',     variant: null },
    { owner: 'tansy', slot: 'chest',      variant: null },
    { owner: 'tansy', slot: 'trousers',   variant: null },
    { owner: 'tansy', slot: 'ring1',      variant: 'vitality' },
    { owner: 'tansy', slot: 'ring1',      variant: 'luck' },
    { owner: 'tansy', slot: 'neck',       variant: 'vitality' },
    { owner: 'tansy', slot: 'headgear',   variant: 'luck' },
    { owner: 'tansy', slot: 'boots',      variant: 'vitality' },
    { owner: 'qtik',  slot: 'ring1',      variant: 'bulwark' },
    { owner: 'qtik',  slot: 'ring1',      variant: 'vitality' },
    { owner: 'qtik',  slot: 'amulet',     variant: 'bulwark' },
    { owner: 'qtik',  slot: 'amulet',     variant: 'vitality' },
    { owner: 'qtik',  slot: 'wristCuffs', variant: 'bulwark' },
    { owner: 'qtik',  slot: 'wristCuffs', variant: 'vitality' }
];

function normalizeQuestRepTier(value) {
    assert(
        typeof value === 'string',
        'repTier must be a string'
    );

    const tier = value
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
        .toLowerCase();

    if (
        tier === 'unknown' ||
        tier === 'slightly known'
    ) {
        return {
            band: 'low',
            label:
                tier === 'unknown'
                    ? 'Unknown'
                    : 'Slightly Known'
        };
    }

    if (
        tier === 'known' ||
        tier === 'well respected' ||
        tier === 'renowned'
    ) {
        const labelByTier = {
            known: 'Known',
            'well respected': 'Well Respected',
            renowned: 'Renowned'
        };

        return {
            band: 'high',
            label: labelByTier[tier]
        };
    }

    throw new Error(
        `Unsupported reputation tier: ${value}`
    );
}

function makeQuestSalvage(zone, slotRoll, row) {
    int(slotRoll, 'salvageSlotRoll', 1);

    assert(
        slotRoll <= QUEST_SALVAGE_SLOTS.length,
        `salvageSlotRoll must be 1-${QUEST_SALVAGE_SLOTS.length}`
    );

    const slot =
        QUEST_SALVAGE_SLOTS[slotRoll - 1];

    const rarityInfo =
        LOOT_RARITY_INFO[row.salvageRarity];

    const material =
        ZONE_LOOT_MATERIALS[zone];

    const slotNames = {
        weapon: 'Focus',
        gloves: 'Bracers',
        chest: 'Chest',
        trousers: 'Trousers',
        ring1: 'Ring',
        neck: 'Necklace',
        headgear: 'Headgear',
        boots: 'Boots',
        amulet: 'Amulet',
        wristCuffs: 'Wrist Cuffs'
    };

    const variantName = slot.variant
        ? ` ${slot.variant[0].toUpperCase()}${slot.variant.slice(1)}`
        : '';

    const ownerName =
        slot.owner === 'qtik'
            ? "Q'tik"
            : 'Tansy';

    const stat =
        row.salvageStat;

    return {
        name:
            `${ownerName} ${material}${variantName} ` +
            `${slotNames[slot.slot]} (Stat ${stat})`,
        owner: slot.owner,
        slot: slot.slot,
        variant: slot.variant,
        rarity: rarityInfo.label,
        rarityColor: rarityInfo.color,
        rawStat: stat,
        sellValue: 2 * stat,
        bound: false,
        classRestricted: false,
        tradeStreamEligible: true,
        bonus: lootBonus(
            slot.owner,
            slot.slot,
            slot.variant,
            stat
        )
    };
}

function resolveQuestSeed(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'quest requires state'
    );

    const state = clone(test.state);

    assert(
        state.encounter &&
        typeof state.encounter === 'object',
        'quest requires state.encounter'
    );

    const zone =
        test.zone ?? state.zone;

    assert(
        Number.isInteger(zone) && ZONES[zone],
        `Unknown zone: ${zone}`
    );

    const rep =
        normalizeQuestRepTier(test.repTier);

    int(test.questRoll, 'questRoll', 1);
    int(test.salvageSlotRoll, 'salvageSlotRoll', 1);

    assert(
        test.questRoll <= 3,
        'questRoll must be 1-3'
    );

    assert(
        test.salvageSlotRoll <= QUEST_SALVAGE_SLOTS.length,
        `salvageSlotRoll must be 1-${QUEST_SALVAGE_SLOTS.length}`
    );

    const sourceSeed =
        state.encounter.questSeed;

    assert(
        sourceSeed &&
        (
            sourceSeed.result ===
                'genuine_unclaimed_quest_or_dungeon_hook' ||
            sourceSeed.result ===
                'diegetic_quest_breadcrumb'
        ),
        'Quest offer requires a locked quest-trigger seed'
    );

    const seed = {
        zone,
        repTier: rep.label,
        questRoll: test.questRoll,
        salvageSlotRoll: test.salvageSlotRoll,
        source: sourceSeed.source,
        sourceRoll: sourceSeed.roll,
        sourceResult: sourceSeed.result
    };

    const existing =
        state.activeQuest;

    if (
        existing &&
        existing.status !== 'complete'
    ) {
        const existingSeed = existing.seed || {};

        const matches =
            existingSeed.zone === seed.zone &&
            existingSeed.repTier === seed.repTier &&
            existingSeed.questRoll === seed.questRoll &&
            existingSeed.salvageSlotRoll === seed.salvageSlotRoll &&
            existingSeed.source === seed.source &&
            existingSeed.sourceRoll === seed.sourceRoll &&
            existingSeed.sourceResult === seed.sourceResult;

        assert(
            matches,
            'An active quest is already locked with a different seed'
        );

        return {
            ok: true,
            created: false,
            quest: existing,
            state
        };
    }

    const table =
        QUEST_REWARD_TABLES[zone][rep.band];

    const row =
        table[test.questRoll - 1];

    assert(
        row,
        'No quest table entry exists for these inputs'
    );

    const salvage = makeQuestSalvage(
        zone,
        test.salvageSlotRoll,
        row
    );

    const tier =
        ZONES[zone].tier;

    const quest = {
        id:
            `quest-${state.encounter.id}-` +
            `${row.rank}-${test.questRoll}`,
        title:
            `Rank ${row.rank} ${QUEST_RANK_LABELS[row.rank]}`,
        rank: row.rank,
        gates: row.gates,
        status: 'offered',
        seed,

        /*
         * The model writes the scene-specific truth and objective.
         * Future gates are intentionally not generated here.
         */
        coreTruth: null,
        currentGate: {
            step: 1,
            total: row.gates,
            mode:
                row.gates === 1
                    ? 'arrival_warmup'
                    : 'traversal_discovery',
            objective: null
        },

        payout: {
            xp: row.xp,
            silver: row.silver,
            repSteps: row.repSteps
        },

        intermediateGateBonus: {
            xp: 100 * tier,
            silver: 10 * tier,
            applies:
                row.gates > 1
        },

        salvage,

        town:
            test.town ||
            null,

        repTierAtOffer:
            rep.label
    };

    state.activeQuest =
        quest;

    return {
        ok: true,
        created: true,
        quest,
        state
    };
}
function resolveQuestAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'quest action requires state'
    );

    const state = clone(test.state);
    const quest = state.activeQuest;

    assert(
        quest &&
        typeof quest === 'object',
        'No active quest'
    );

    assert(
        [
            'accept',
            'decline',
            'clear_gate',
            'complete'            
        ].includes(test.action),
        `Unsupported quest action: ${test.action}`
    );

    state.inventory ||= {};
    state.inventory.bagReserves ||= [];
    state.inventory.activeTradeListings ||= [];

    const result = {
        ok: true,
        action: test.action,
        rewards: {
            xp: 0,
            silver: 0,
            repSteps: 0,
            loot: []
        },
        state
    };

    if (test.action === 'accept') {
        assert(
            quest.status === 'offered',
            `Quest cannot be accepted from status ${quest.status}`
        );

        quest.status = 'in_progress';

        return result;
    }

    if (test.action === 'decline') {
        assert(
            quest.status === 'offered',
            `Quest cannot be declined from status ${quest.status}`
        );

        quest.status = 'declined';

        return result;
    }

    assert(
        quest.status === 'in_progress',
        `Quest action requires an in-progress quest, got ${quest.status}`
    );

    if (test.action === 'clear_gate') {
        assert(
            quest.currentGate &&
            Number.isInteger(quest.currentGate.step),
            'Quest current gate is invalid'
        );

        assert(
            quest.currentGate.step < quest.gates,
            'Final gate must use complete, not clear_gate'
        );

        const enemyTier =
            ZONES[quest.seed.zone].tier;

        const milestone = {
            xp: 100 * enemyTier,
            silver: 10 * enemyTier
        };

        quest.currentGate.step += 1;

        const nextModes = [
            'traversal_discovery',
            'brain_social_heist',
            'combat_twist_showdown'
        ];

        const selectedMode =
            test.nextGateMode ||
            nextModes[
                (quest.currentGate.step - 1) %
                nextModes.length
            ];

        assert(
            nextModes.includes(selectedMode),
            `Unsupported next gate mode: ${selectedMode}`
        );

        quest.currentGate.mode =
            selectedMode;

        quest.currentGate.objective =
            test.nextGateObjective || null;

        result.rewards.xp =
            milestone.xp;

        result.rewards.silver =
            milestone.silver;

        if (test.rewardMode === 'immediate') {
            const levelUps =
                applyXp(
                    state.crew,
                    milestone.xp
                );

            state.crew.purse +=
                milestone.silver;

            result.levelUps =
                levelUps;
        } else {
            result.levelUps = [];
        }

        return result;
    }

    assert(
        quest.currentGate.step === quest.gates,
        'Quest cannot complete before its final gate'
    );

    const payout =
        quest.payout;

    assert(
        payout &&
        Number.isInteger(payout.xp) &&
        Number.isInteger(payout.silver) &&
        Number.isInteger(payout.repSteps),
        'Quest payout is invalid'
    );

    const salvage =
        quest.salvage;

    assert(
        salvage &&
        typeof salvage === 'object',
        'Quest salvage is missing'
    );

    quest.status = 'complete';

    result.rewards.xp =
        payout.xp;

    result.rewards.silver =
        payout.silver;

    result.rewards.repSteps =
        payout.repSteps;

    const acquiredSalvage = {
        ...salvage,
        acquiredFrom: 'quest',
        acquiredAtQuest: quest.id,
        bound: false
    };

    state.inventory.bagReserves.push(
        acquiredSalvage
    );

    result.rewards.loot.push(
        acquiredSalvage
    );

    const town =
        test.town ||
        quest.town;

    if (town) {
        state.reputation ||= {};
        state.reputation[town] ||= {
            tier: 'Unknown',
            steps: 0
        };

        state.reputation[town].steps +=
            payout.repSteps;

        const tierOrder = [
            'Unknown',
            'Slightly Known',
            'Known',
            'Well Respected',
            'Renowned'
        ];

        const rep =
            state.reputation[town];

        const rung =
            Math.floor(rep.steps / 2);

        rep.tier =
            tierOrder[
                Math.min(
                    rung,
                    tierOrder.length - 1
                )
            ];
    }

    if (test.rewardMode === 'immediate') {
        result.levelUps =
            applyXp(
                state.crew,
                payout.xp
            );

        state.crew.purse +=
            payout.silver;
    } else {
        result.levelUps = [];
    }

    return result;
}
function equipBagItem(stateInput, itemIndex) {
    assert(
        stateInput &&
        typeof stateInput === 'object',
        'gear equip requires state'
    );

    const state = clone(stateInput);

    assert(
        state.crew &&
        state.inventory &&
        Array.isArray(state.inventory.bagReserves),
        'Gear equip requires crew and inventory.bagReserves'
    );

    int(
        itemIndex,
        'itemIndex'
    );

    assert(
        itemIndex < state.inventory.bagReserves.length,
        `No bag item at index ${itemIndex}`
    );

    const item =
        state.inventory.bagReserves[itemIndex];

    assert(
        item &&
        item.owner &&
        ['tansy', 'qtik'].includes(item.owner),
        'Item is not equippable by the crew'
    );

    assert(
        !item.classRestricted,
        'Class-restricted item cannot be equipped'
    );

    assert(
        typeof item.slot === 'string',
        'Gear item has no equipment slot'
    );

    assert(
        Number.isInteger(item.rawStat) &&
        item.rawStat > 0,
        'Gear item needs a positive rawStat'
    );

    const ownerSlots =
        item.owner === 'tansy'
            ? TANSY_SLOTS
            : QTIK_SLOTS;

    assert(
        ownerSlots.includes(item.slot),
        `Invalid ${item.owner} equipment slot: ${item.slot}`
    );

    if (item.owner === 'tansy' && MODULAR_TANSY.has(item.slot)) {
        assert(
            ['vitality', 'luck'].includes(item.variant),
            `Tansy ${item.slot} requires vitality or luck variant`
        );
    }

    if (item.owner === 'qtik') {
        assert(
            ['vitality', 'bulwark'].includes(item.variant),
            `Q'tik ${item.slot} requires vitality or bulwark variant`
        );
    }

    const oldDerived =
        derived(state.crew);

    const character =
        state.crew[item.owner];

    const oldItem =
        state.crew.gear[item.owner][item.slot] || null;

    const equippedItem = {
        name: item.name,
        stat: item.rawStat,
        variant: item.variant || null,
        rarity: item.rarity || null,
        bound: true,
        classRestricted: false
    };

    /*
     * Remove the selected reserve item before adding the replaced item,
     * so the returned bag index cannot accidentally refer to the new copy.
     */
    state.inventory.bagReserves.splice(itemIndex, 1);

    if (oldItem && Number(oldItem.stat) > 0) {
        state.inventory.bagReserves.push({
            name: oldItem.name || 'Replaced gear',
            owner: item.owner,
            slot: item.slot,
            variant: oldItem.variant || null,
            rarity: oldItem.rarity || null,
            rawStat: oldItem.stat,
            bound: Boolean(oldItem.bound),
            classRestricted: false,
            tradeStreamEligible: !oldItem.bound,
            bonus: lootBonus(
                item.owner,
                item.slot,
                oldItem.variant || null,
                oldItem.stat
            )
        });
    }

    state.crew.gear[item.owner][item.slot] =
        equippedItem;

    const newDerived =
        derived(state.crew);

    /*
     * Preserve current HP when MaxHP changes, adjusting it by the
     * MaxHP delta and clamping it to the new maximum.
     */
    if (item.owner === 'qtik') {
        character.hp = Math.max(
            0,
            Math.min(
                newDerived.qtikMaxHp,
                character.hp +
                (
                    newDerived.qtikMaxHp -
                    oldDerived.qtikMaxHp
                )
            )
        );
    } else {
        character.hp = Math.max(
            0,
            Math.min(
                newDerived.tansyMaxHp,
                character.hp +
                (
                    newDerived.tansyMaxHp -
                    oldDerived.tansyMaxHp
                )
            )
        );
    }

    state.crew.qtik.maxHp =
        newDerived.qtikMaxHp;
    state.crew.qtik.def =
        newDerived.def;
    state.crew.qtik.regen =
        newDerived.regen;
    state.crew.tansy.maxHp =
        newDerived.tansyMaxHp;

    return {
        ok: true,
        equipped: equippedItem,
        replaced: oldItem,
        derivedBefore: oldDerived,
        derivedAfter: newDerived,
        state
    };
}
function resolveTradeAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'trade action requires state'
    );

    const state = clone(test.state);

    state.crew ||= {};
    state.inventory ||= {};
    state.inventory.bagReserves ||= [];
    state.inventory.activeTradeListings ||= [];

    assert(
        Array.isArray(state.inventory.bagReserves),
        'inventory.bagReserves must be an array'
    );

    assert(
        Array.isArray(state.inventory.activeTradeListings),
        'inventory.activeTradeListings must be an array'
    );

    assert(
        ['pawn', 'list', 'settle'].includes(test.action),
        `Unsupported trade action: ${test.action}`
    );

    const result = {
        ok: true,
        action: test.action,
        silverGained: 0,
        item: null,
        state
    };

    if (test.action === 'pawn') {
        int(test.itemIndex, 'itemIndex', 0);

        assert(
            test.itemIndex < state.inventory.bagReserves.length,
            `No bag item at index ${test.itemIndex}`
        );

        const item =
            state.inventory.bagReserves[test.itemIndex];

        assert(
            item &&
            Number.isInteger(item.rawStat) &&
            item.rawStat > 0,
            'Bag item has no pawnable rawStat'
        );

        const value =
            item.rawStat * 2;

        state.inventory.bagReserves.splice(
            test.itemIndex,
            1
        );

        state.crew.purse =
            Number(state.crew.purse || 0) +
            value;

        result.silverGained = value;
        result.item = item;
        result.pawnValue = value;

        return result;
    }

    if (test.action === 'list') {
        int(test.itemIndex, 'itemIndex', 0);

        assert(
            state.inventory.activeTradeListings.length < 3,
            'Trade-Stream already has three active listings'
        );

        assert(
            test.itemIndex < state.inventory.bagReserves.length,
            `No bag item at index ${test.itemIndex}`
        );

        const item =
            state.inventory.bagReserves[test.itemIndex];

        assert(
            item &&
            item.bound !== true &&
            item.tradeStreamEligible !== false,
            'Only unbound Trade-Stream-eligible gear may be listed'
        );

        assert(
            Number.isInteger(item.rawStat) &&
            item.rawStat > 0,
            'Listed item needs a positive rawStat'
        );

        state.inventory.bagReserves.splice(
            test.itemIndex,
            1
        );

        state.inventory.activeTradeListings.push({
            ...item,
            listingId:
                test.listingId ||
                `listing-${state.inventory.activeTradeListings.length + 1}`,
            listedAt: test.listedAt || null
        });

        result.item =
            state.inventory.activeTradeListings[
                state.inventory.activeTradeListings.length - 1
            ];

        return result;
    }

    assert(
        Number.isInteger(test.listingIndex) &&
        test.listingIndex >= 0,
        'settle requires listingIndex'
    );

    assert(
        test.listingIndex <
        state.inventory.activeTradeListings.length,
        `No active listing at index ${test.listingIndex}`
    );

    assert(
        Number.isInteger(test.tradeRoll) &&
        test.tradeRoll >= 1 &&
        test.tradeRoll <= 6,
        'tradeRoll must be 1-6'
    );

    const listing =
        state.inventory.activeTradeListings[
            test.listingIndex
        ];

    assert(
        listing &&
        listing.bound !== true,
        'Bound gear cannot be settled through Trade-Stream'
    );

    const rarity =
        String(listing.rarity || 'Common')
            .toLowerCase();

    const stat =
        listing.tradeStat ||
        listing.rawStat;

    assert(
        Number.isInteger(stat) &&
        stat > 0,
        'Trade listing needs a positive trade stat'
    );

    let multiplier;

    if (test.tradeRoll === 1) {
        state.inventory.activeTradeListings.splice(
            test.listingIndex,
            1
        );

        state.inventory.bagReserves.push(listing);

        result.status = 'unsold';
        result.item = listing;
        result.silverGained = 0;

        return result;
    }

    if (test.tradeRoll === 2) {
        multiplier =
            rarity === 'common'
                ? 5
                : rarity === 'uncommon'
                    ? 8
                    : 15;
    } else if (test.tradeRoll === 3) {
        multiplier =
            rarity === 'common'
                ? 6
                : rarity === 'uncommon'
                    ? 9
                    : 18;
    } else if (test.tradeRoll === 4) {
        multiplier =
            rarity === 'common'
                ? 7
                : rarity === 'uncommon'
                    ? 11
                    : 20;
    } else if (test.tradeRoll === 5) {
        multiplier =
            rarity === 'common'
                ? 9
                : rarity === 'uncommon'
                    ? 13
                    : 25;
    } else {
        multiplier =
            rarity === 'common'
                ? 12
                : rarity === 'uncommon'
                    ? 16
                    : 35;
    }

    const proceeds =
        stat * multiplier;

    state.inventory.activeTradeListings.splice(
        test.listingIndex,
        1
    );

    state.crew.purse =
        Number(state.crew.purse || 0) +
        proceeds;

    result.status = 'sold';
    result.item = listing;
    result.silverGained = proceeds;
    result.multiplier = multiplier;

    return result;
}
function resolveVendorAction(test) {
    assert(
        Number.isInteger(test.zone) &&
        ZONES[test.zone],
        `Unknown zone: ${test.zone}`
    );

    const zone = test.zone;
    const zoneInfo = ZONES[zone];
    const stat = zoneInfo.base;
    const price = stat * 8;
    const pawnValue = stat * 2;

    const definitions = [
        { owner: 'tansy', slot: 'weapon', variants: [null] },
        { owner: 'tansy', slot: 'gloves', variants: [null] },
        { owner: 'tansy', slot: 'chest', variants: [null] },
        { owner: 'tansy', slot: 'trousers', variants: [null] },

        {
            owner: 'tansy',
            slot: 'headgear',
            variants: ['vitality', 'luck']
        },
        {
            owner: 'tansy',
            slot: 'boots',
            variants: ['vitality', 'luck']
        },
        {
            owner: 'tansy',
            slot: 'neck',
            variants: ['vitality', 'luck']
        },
        {
            owner: 'tansy',
            slot: 'ring1',
            variants: ['vitality', 'luck']
        },
        {
            owner: 'tansy',
            slot: 'ring2',
            variants: ['vitality', 'luck']
        },

        {
            owner: 'qtik',
            slot: 'ring1',
            variants: ['bulwark', 'vitality']
        },
        {
            owner: 'qtik',
            slot: 'ring2',
            variants: ['bulwark', 'vitality']
        },
        {
            owner: 'qtik',
            slot: 'amulet',
            variants: ['bulwark', 'vitality']
        },
        {
            owner: 'qtik',
            slot: 'wristCuffs',
            variants: ['bulwark', 'vitality']
        }
    ];

    const slotNames = {
        weapon: 'Focus',
        gloves: 'Bracers',
        chest: 'Chest',
        trousers: 'Trousers',
        headgear: 'Headgear',
        boots: 'Boots',
        neck: 'Necklace',
        ring1: 'Ring 1',
        ring2: 'Ring 2',
        amulet: 'Amulet',
        wristCuffs: 'Wrist Cuffs'
    };

    const variantTitle = variant => {
        if (!variant) return null;

        return (
            variant[0].toUpperCase() +
            variant.slice(1)
        );
    };

    if (test.action === 'stock') {
        const state = test.state || {};
        const gear = state.crew?.gear || {};

        const catalog = definitions.map(
            (definition, index) => {
                const equipped =
                    gear[definition.owner]?.[definition.slot];

                const equippedStat =
                    Number(equipped?.stat || 0);

                const upgradeable =
                    equippedStat < stat;

                return {
                    number: index + 1,
                    owner: definition.owner,
                    slot: definition.slot,
                    slotName: slotNames[definition.slot],
                    equippedStat,
                    stat,
                    price,
                    pawnValue,
                    upgradeable,
                    skip: !upgradeable,
                    variants: definition.variants.map(
                        variant => ({
                            variant,
                            label: variantTitle(variant),
                            bonus: lootBonus(
                                definition.owner,
                                definition.slot,
                                variant,
                                stat
                            )
                        })
                    )
                };
            }
        );

        return {
            ok: true,
            action: 'stock',
            zone,
            zoneName: zoneInfo.name,
            stat,
            price,
            pawnValue,
            upgradeableSlots: catalog
                .filter(entry => entry.upgradeable)
                .map(entry => entry.number),
            skipSlots: catalog
                .filter(entry => entry.skip)
                .map(entry => ({
                    number: entry.number,
                    owner: entry.owner,
                    slot: entry.slot,
                    equippedStat: entry.equippedStat
                })),
            catalog
        };
    }

    assert(
        test.action === 'buy',
        `Unsupported vendor action: ${test.action}`
    );

    assert(
        test.state &&
        typeof test.state === 'object',
        'Vendor purchase requires state'
    );

    const state = clone(test.state);

    assert(
        state.crew &&
        state.crew.gear &&
        state.inventory,
        'Vendor purchase requires crew and inventory state'
    );

    state.inventory.bagReserves ||= [];

    assert(
        Array.isArray(state.inventory.bagReserves),
        'inventory.bagReserves must be an array'
    );

    assert(
        Number.isInteger(state.crew.purse) &&
        state.crew.purse >= price,
        `Insufficient silver: purchase costs ${price}s`
    );

    assert(
        ['tansy', 'qtik'].includes(test.owner),
        'Purchase owner must be tansy or qtik'
    );

    const definition = definitions.find(
        entry =>
            entry.owner === test.owner &&
            entry.slot === test.slot
    );

    assert(
        definition,
        `Invalid ${test.owner} vendor slot: ${test.slot}`
    );

    const equipped =
        state.crew.gear[test.owner]?.[test.slot];

    const equippedStat =
        Number(equipped?.stat || 0);

    assert(
        equippedStat < stat,
        `${test.owner} ${test.slot} already meets ` +
        `the Zone ${zone} vendor floor of Stat ${stat}`
    );

    const variant =
        test.variant === undefined ||
        test.variant === null ||
        test.variant === ''
            ? null
            : test.variant;

    assert(
        definition.variants.includes(variant),
        `${test.owner} ${test.slot} requires one of: ` +
        definition.variants
            .map(value => value || 'no variant')
            .join(', ')
    );

    const material =
        ZONE_LOOT_MATERIALS[zone];

    const nameParts = [
        material,
        variantTitle(variant),
        slotNames[test.slot]
    ].filter(Boolean);

    const item = {
        name: nameParts.join(' '),
        owner: test.owner,
        slot: test.slot,
        variant,
        rarity: 'Common',
        rarityColor: LOOT_RARITY_INFO.common.color,
        rawStat: stat,
        cost: price,
        sellValue: pawnValue,
        bound: false,
        classRestricted: false,
        tradeStreamEligible: true,
        bonus: lootBonus(
            test.owner,
            test.slot,
            variant,
            stat
        ),
        acquiredFrom: 'armory'
    };

    const purseBefore =
        state.crew.purse;

    state.crew.purse -= price;
    state.inventory.bagReserves.push(item);

    return {
        ok: true,
        action: 'buy',
        item,
        purseBefore,
        purseAfter: state.crew.purse,
        state
    };
}
function resolveCurrencyAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'currency action requires state'
    );

    const state = clone(test.state);

    state.crew ||= {};
    state.crew.purse =
        Number(state.crew.purse || 0);

    assert(
        Number.isInteger(state.crew.purse) &&
        state.crew.purse >= 0,
        'Crew purse must be a non-negative integer'
    );

    assert(
        ['spend', 'earn'].includes(test.action),
        `Unsupported currency action: ${test.action}`
    );

    assert(
        Number.isInteger(test.amount) &&
        test.amount > 0,
        'Currency amount must be a positive integer'
    );

    const before =
        state.crew.purse;

    if (test.action === 'spend') {
        assert(
            before >= test.amount,
            `Insufficient silver: need ${test.amount}s, ` +
            `have ${before}s`
        );

        state.crew.purse -=
            test.amount;
    } else {
        state.crew.purse +=
            test.amount;
    }

    return {
        ok: true,
        action: test.action,
        amount: test.amount,
        reason: test.reason || null,
        purseBefore: before,
        purseAfter: state.crew.purse,
        state
    };
}
const CONSUMABLE_CATALOG = {
    basic_health_potion: {
        name: 'Basic Health Potion',
        type: 'potion',
        heal: 50,
        buyPrice: 10,
        sellPrice: 2
    },
    mid_health_potion: {
        name: 'Mid-Tier Health Potion',
        type: 'potion',
        heal: 120,
        buyPrice: 20,
        sellPrice: 5
    },
    cleansing_tonic: {
        name: 'Cleansing Tonic',
        type: 'tonic',
        buyPrice: 14,
        sellPrice: 3
    }
};

function normalizeConsumableInventory(inventory) {
    inventory.consumables ||= [];

    assert(
        Array.isArray(inventory.consumables),
        'inventory.consumables must be an array'
    );

    for (const entry of inventory.consumables) {
        assert(
            entry &&
            typeof entry.id === 'string' &&
            CONSUMABLE_CATALOG[entry.id],
            'Consumable inventory entry has an unknown item ID'
        );

        int(
            entry.quantity,
            `${entry.id}.quantity`,
            1
        );
    }
}

function resolveConsumableAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'Consumable action requires state'
    );

    const state = clone(test.state);

    state.crew ||= {};
    state.inventory ||= {};
    state.inventory.bagReserves ||= [];
    state.inventory.activeTradeListings ||= [];

    normalizeConsumableInventory(state.inventory);

    assert(
        ['buy', 'sell', 'restock'].includes(test.action),
        `Unsupported consumable action: ${test.action}`
    );

    assert(
        CONSUMABLE_CATALOG[test.item],
        `Unknown consumable item: ${test.item}`
    );

    const definition =
        CONSUMABLE_CATALOG[test.item];

    const result = {
        ok: true,
        action: test.action,
        item: test.item,
        quantity: 0,
        silverChanged: 0,
        state
    };

    if (test.action === 'buy') {
        const quantity =
            test.quantity === undefined
                ? 1
                : int(test.quantity, 'quantity', 1);

        const total =
            definition.buyPrice * quantity;

        state.crew.purse =
            Number(state.crew.purse || 0);

        assert(
            Number.isInteger(state.crew.purse) &&
            state.crew.purse >= total,
            `Insufficient silver: purchase costs ${total}s`
        );

        let entry =
            state.inventory.consumables.find(
                item => item.id === test.item
            );

        if (!entry) {
            entry = {
                id: test.item,
                name: definition.name,
                type: definition.type,
                quantity: 0,
                recipient: null
            };

            state.inventory.consumables.push(entry);
        }

        entry.quantity += quantity;
        state.crew.purse -= total;

        result.quantity = quantity;
        result.silverChanged = -total;
        result.totalCost = total;
        result.itemName = definition.name;

        return result;
    }

    if (test.action === 'sell') {
        const quantity =
            test.quantity === undefined
                ? 1
                : int(test.quantity, 'quantity', 1);

        const entry =
            state.inventory.consumables.find(
                item => item.id === test.item
            );

        assert(
            entry && entry.quantity >= quantity,
            `Not enough ${test.item} in consumables inventory`
        );

        entry.quantity -= quantity;

        if (entry.quantity === 0) {
            state.inventory.consumables =
                state.inventory.consumables.filter(
                    item => item.id !== test.item
                );
        }

        const proceeds =
            definition.sellPrice * quantity;

        state.crew.purse =
            Number(state.crew.purse || 0) +
            proceeds;

        result.quantity = quantity;
        result.silverChanged = proceeds;
        result.proceeds = proceeds;
        result.itemName = definition.name;

        return result;
    }

    assert(
        test.recipient === 'qtik' ||
        test.recipient === 'tansy',
        'Restock recipient must be qtik or tansy'
    );

    assert(
        state.crew[test.recipient] &&
        Array.isArray(state.crew[test.recipient].belt),
        `${test.recipient} needs a belt array`
    );

    const recipientBelt =
        state.crew[test.recipient].belt;

    assert(
        recipientBelt.length < 4,
        `${test.recipient}'s belt is full`
    );

    const entry =
        state.inventory.consumables.find(
            item => item.id === test.item
        );

    assert(
        entry && entry.quantity > 0,
        `${test.item} is not available in consumables inventory`
    );

    entry.quantity -= 1;

    if (entry.quantity === 0) {
        state.inventory.consumables =
            state.inventory.consumables.filter(
                item => item.id !== test.item
            );
    }

    recipientBelt.push(test.item);

    result.quantity = 1;
    result.recipient = test.recipient;
    result.belt = [...recipientBelt];
    result.itemName = definition.name;

    return result;
}
/*
 * Food is intentionally modular and starts empty.
 * Ordinary meals, lodging, bribes, and travel costs use the generic
 * currency operation and do not require food records.
 */
const FOOD_BUFF_RECIPES = {};

function resolveFoodAction(test) {
    assert(
        ['list', 'apply'].includes(test.action),
        `Unsupported food action: ${test.action}`
    );

    if (test.action === 'list') {
        return {
            ok: true,
            action: 'list',
            recipes: Object.values(FOOD_BUFF_RECIPES)
        };
    }

    assert(
        typeof test.recipeId === 'string',
        'Food apply requires recipeId'
    );

    const recipe =
        FOOD_BUFF_RECIPES[test.recipeId];

    assert(
        recipe,
        `Unknown food recipe: ${test.recipeId}`
    );

    assert(
        test.state &&
        typeof test.state === 'object',
        'Food apply requires state'
    );

    const state = clone(test.state);

    state.foodBuffs ||= [];

    assert(
        Array.isArray(state.foodBuffs),
        'state.foodBuffs must be an array'
    );

    const existing =
        state.foodBuffs.find(
            buff => buff.recipeId === recipe.id
        );

    if (existing) {
        assert(
            recipe.stackable === true,
            `Food recipe ${recipe.id} is not stackable`
        );

        existing.stacks =
            Number(existing.stacks || 1) + 1;
    } else {
        state.foodBuffs.push({
            recipeId: recipe.id,
            name: recipe.name,
            zone: recipe.zone,
            duration: recipe.duration,
            stacks: 1,
            effects: clone(recipe.effects)
        });
    }

    return {
        ok: true,
        action: 'apply',
        recipe: clone(recipe),
        state
    };
}

function resolveBatch(args) {
    function resolveWorldSeeds(test) {
        assert(
            test.state &&
            typeof test.state === 'object',
            'world_seeds requires state to lock results'
        );

        const state = clone(test.state);
        const encounter = state.encounter;

        assert(
            encounter &&
            typeof encounter === 'object',
            'world_seeds requires state.encounter'
        );

        /*
         * Older saved encounters may not have these fields. Normalize them
         * without changing any existing locked result.
         */
        for (const field of [
            'packDropRoll',
            'curiosityRoll',
            'rumorRoll',
            'lootSeed',
            'questSeed'
        ]) {
            if (!Object.prototype.hasOwnProperty.call(encounter, field)) {
                encounter[field] = null;
            }
        }

        function lockField(field, value) {
            const existing = encounter[field];

            if (existing !== null && existing !== undefined) {
                assert(
                    deepEqual(existing, value),
                    `${field} is already locked with a different result`
                );

                return false;
            }

            encounter[field] = clone(value);
            return true;
        }

        const result = {
            ok: true,
            applicable: {},
            findings: {},
            locked: {},
            state
        };

        const {
            curiosityRoll,
            rumorRoll,
            packDropRoll,
            newWildernessSite = false,
            investigatedRumor = false,
            packLooted = false
        } = test;

        if (curiosityRoll !== undefined) {
            assert(
                Number.isInteger(curiosityRoll) &&
                curiosityRoll >= 1 &&
                curiosityRoll <= 10,
                'curiosityRoll must be 1-10'
            );

            result.applicable.curiosity =
                newWildernessSite;

            if (!newWildernessSite) {
                result.findings.curiosity =
                    'not_applicable';
            } else {
                const curiosityResult =
                    curiosityRoll <= 7
                        ? 'nothing_hidden'
                        : curiosityRoll === 8
                            ? 'hidden_lore_or_shortcut'
                            : curiosityRoll === 9
                                ? 'trap_or_ambush_hazard'
                                : 'hidden_loot_stash';

                result.findings.curiosity =
                    curiosityResult;

                result.locked.curiosityRoll =
                    lockField(
                        'curiosityRoll',
                        curiosityRoll
                    );

                if (
                    curiosityResult ===
                    'hidden_loot_stash'
                ) {
                    result.locked.lootSeed =
                        lockField(
                            'lootSeed',
                            {
                                source: 'curiosity',
                                roll: curiosityRoll,
                                result: curiosityResult
                            }
                        );
                }
            }
        }

        if (rumorRoll !== undefined) {
            assert(
                Number.isInteger(rumorRoll) &&
                rumorRoll >= 1 &&
                rumorRoll <= 5,
                'rumorRoll must be 1-5'
            );

            result.applicable.rumor =
                investigatedRumor;

            if (!investigatedRumor) {
                result.findings.rumor =
                    'not_applicable';
            } else {
                const rumorResult =
                    rumorRoll <= 3
                        ? 'travelogue_flub_benign_oddity'
                        : rumorRoll === 4
                            ? 'already_cleared_by_other_immortals'
                            : 'genuine_unclaimed_quest_or_dungeon_hook';

                result.findings.rumor =
                    rumorResult;

                result.locked.rumorRoll =
                    lockField(
                        'rumorRoll',
                        rumorRoll
                    );

                if (
                    rumorResult ===
                    'genuine_unclaimed_quest_or_dungeon_hook'
                ) {
                    result.locked.questSeed =
                        lockField(
                            'questSeed',
                            {
                                source: 'rumor',
                                roll: rumorRoll,
                                result: rumorResult
                            }
                        );
                }
            }
        }

        if (packDropRoll !== undefined) {
            assert(
                Number.isInteger(packDropRoll) &&
                packDropRoll >= 1 &&
                packDropRoll <= 10,
                'packDropRoll must be 1-10'
            );

            result.applicable.packDrop =
                packLooted;

            if (!packLooted) {
                result.findings.packDrop =
                    'not_applicable';
            } else {
                const packResult =
                    packDropRoll <= 8
                        ? 'auto_salvage_only'
                        : packDropRoll === 9
                            ? 'wild_equipment_drop'
                            : 'diegetic_quest_breadcrumb';

                result.findings.packDrop =
                    packResult;

                result.locked.packDropRoll =
                    lockField(
                        'packDropRoll',
                        packDropRoll
                    );

                if (
                    packResult ===
                    'wild_equipment_drop'
                ) {
                    result.locked.lootSeed =
                        lockField(
                            'lootSeed',
                            {
                                source: 'pack_drop',
                                roll: packDropRoll,
                                result: packResult
                            }
                        );
                }

                if (
                    packResult ===
                    'diegetic_quest_breadcrumb'
                ) {
                    result.locked.questSeed =
                        lockField(
                            'questSeed',
                            {
                                source: 'pack_drop',
                                roll: packDropRoll,
                                result: packResult
                            }
                        );
                }
            }
        }

        result.unlocks = {
            loot:
                result.findings.curiosity ===
                    'hidden_loot_stash' ||
                result.findings.packDrop ===
                    'wild_equipment_drop',

            quest:
                result.findings.rumor ===
                    'genuine_unclaimed_quest_or_dungeon_hook' ||
                result.findings.packDrop ===
                    'diegetic_quest_breadcrumb'
        };

        return result;
    }

    function getPath(root, path) {
        const parts = path.split('.');
        let value = root;

        for (const part of parts) {
            if (
                value === null ||
                value === undefined ||
                !Object.prototype.hasOwnProperty.call(value, part)
            ) {
                return { exists: false, value: undefined };
            }

            value = value[part];
        }

        return { exists: true, value };
    }

    function deepEqual(a, b) {
        if (Object.is(a, b)) return true;

        if (
            a === null ||
            b === null ||
            typeof a !== 'object' ||
            typeof b !== 'object'
        ) {
            return false;
        }

        if (Array.isArray(a) !== Array.isArray(b)) {
            return false;
        }

        if (Array.isArray(a)) {
            return (
                a.length === b.length &&
                a.every((value, index) =>
                    deepEqual(value, b[index])
                )
            );
        }

        const aKeys = Object.keys(a).sort();
        const bKeys = Object.keys(b).sort();

        return (
            aKeys.length === bKeys.length &&
            aKeys.every((key, index) =>
                key === bKeys[index] &&
                deepEqual(a[key], b[key])
            )
        );
    }

    function evaluateExpectations(result, expectations, name) {
        assert(
            Array.isArray(expectations),
            `${name}: expect must be an array`
        );

        return expectations.map((check, index) => {
            assert(
                check &&
                typeof check.path === 'string' &&
                check.path.length > 0,
                `${name}: expect[${index}] needs a path`
            );

            const actual = getPath(result, check.path);
            const comparisons = [];

            if (Object.prototype.hasOwnProperty.call(check, 'exists')) {
                comparisons.push({
                    description: `exists=${check.exists}`,
                    passed: actual.exists === check.exists
                });
            }

            if (Object.prototype.hasOwnProperty.call(check, 'equals')) {
                comparisons.push({
                    description: 'equals expected value',
                    passed:
                        actual.exists &&
                        deepEqual(actual.value, check.equals)
                });
            }

            if (Object.prototype.hasOwnProperty.call(check, 'notEquals')) {
                comparisons.push({
                    description: 'does not equal forbidden value',
                    passed:
                        actual.exists &&
                        !deepEqual(actual.value, check.notEquals)
                });
            }

            if (Object.prototype.hasOwnProperty.call(check, 'minimum')) {
                comparisons.push({
                    description: `>= ${check.minimum}`,
                    passed:
                        actual.exists &&
                        typeof actual.value === 'number' &&
                        actual.value >= check.minimum
                });
            }

            if (Object.prototype.hasOwnProperty.call(check, 'maximum')) {
                comparisons.push({
                    description: `<= ${check.maximum}`,
                    passed:
                        actual.exists &&
                        typeof actual.value === 'number' &&
                        actual.value <= check.maximum
                });
            }

            assert(
                comparisons.length > 0,
                `${name}: expect[${index}] needs exists, equals, notEquals, minimum, or maximum`
            );

            return {
                path: check.path,
                actual: actual.exists ? actual.value : '<missing>',
                comparisons,
                ok: comparisons.every(item => item.passed)
            };
        });
    }

    assert(
        Array.isArray(args.cases) &&
        args.cases.length > 0,
        'Batch mode requires a non-empty cases array'
    );

    const results = [];

    for (let index = 0; index < args.cases.length; index++) {
        const test = args.cases[index];
        const name = test.name || `case_${index + 1}`;

        try {
            assert(
                test && typeof test === 'object',
                `${name}: case must be an object`
            );

            let result;

            switch (test.kind) {
                case 'gear':
                    assert(
                        test.action === 'equip',
                        `${name}: unsupported gear action '${test.action}'`
                    );
                    result = equipBagItem(
                        test.state,
                        test.itemIndex
                    );
                    break;
                case 'currency':
                    result = resolveCurrencyAction(test);
                    break;
                case 'consumable':
                    result = resolveConsumableAction(test);
                    break;
                case 'food':
                    result = resolveFoodAction({
                        ...test,
                        action: test.action === 'list_food'
                            ? 'list'
                            : test.action
                    });
                    break;
                case 'vendor':
                    result = resolveVendorAction(test);
                    break;

                case 'trade':
                    result = resolveTradeAction(test);
                    break;

                case 'spawn':
                    result = spawnEncounter(test);
                    break;

                case 'turn':
                    assert(
                        test.state &&
                        typeof test.state === 'object',
                        `${name}: turn case requires state`
                    );
                    assert(
                        test.actions &&
                        typeof test.actions === 'object',
                        `${name}: turn case requires actions`
                    );
                    assert(
                        typeof test.actions.qtik === 'string',
                        `${name}: actions.qtik is required`
                    );
                    assert(
                        typeof test.actions.tansy === 'string',
                        `${name}: actions.tansy is required`
                    );
                    assert(
                        typeof test.actions.target === 'string',
                        `${name}: actions.target is required`
                    );

                    result = resolveTurn({
                        state: test.state,
                        actions: test.actions,
                        rolls: test.rolls,
                        rewardMode: test.rewardMode || 'deferred'
                    });
                    break;

                case 'consume_belt':
                    result = consumeBelt({
                        belt: test.belt,
                        items: test.items
                    });
                    break;

                case 'reference':
                    result = {
                        ok: true,
                        zone: test.zone
                            ? vendorStock(test.zone)
                            : undefined,
                        mob: test.mob
                            ? mobStats(test.mob.level, test.mob.role)
                            : undefined,
                        crew: test.crew
                            ? derived(test.crew)
                            : undefined,
                        nextXp: test.crew
                            ? nextXp(test.crew.level)
                            : undefined
                    };
                    break;
                case 'world_seeds':
                    result = resolveWorldSeeds(test);
                    break;
                case 'loot':
                    result = resolveLootSeed(test);
                    break;

                case 'quest':
                    if (test.action) {
                        result = resolveQuestAction(test);
                    } else {
                        result = resolveQuestSeed(test);
                    }
                    break;

                default:
                    throw new Error(
                        `${name}: unknown batch case kind '${test.kind}'`
                    );
            }

            if (test.expectError) {
                results.push({
                    name,
                    ok: false,
                    error:
                        `Expected error containing '${test.expectError}', ` +
                        'but the operation succeeded',
                    result
                });
                continue;
            }

            const checks = Array.isArray(test.expect)
                ? evaluateExpectations(result, test.expect, name)
                : [];

            const explicitlyChecksStatus =
                checks.some(check => check.path === 'ok');

            const resultStatusOk =
                !result ||
                typeof result !== 'object' ||
                result.ok !== false ||
                explicitlyChecksStatus;

            const checksOk =
                checks.every(check => check.ok);

            results.push({
                name,
                ok: resultStatusOk && checksOk,
                checks,
                result
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);

            if (
                typeof test.expectError === 'string' &&
                message.toLowerCase().includes(
                    test.expectError.toLowerCase()
                )
            ) {
                results.push({
                    name,
                    ok: true,
                    expectedError: test.expectError,
                    actualError: message
                });
            } else {
                results.push({
                    name,
                    ok: false,
                    error: message
                });
            }
        }
    }

    const passed =
        results.filter(item => item.ok).length;

    return {
        ok: passed === results.length,
        total: results.length,
        passed,
        failed: results.length - passed,
        results
    };
}
const LOOT_RARITY_INFO = {
    common:   { label: 'Common',   color: '#ffffff' },
    uncommon: { label: 'Uncommon', color: '#4ade80' },
    rare:     { label: 'Rare',     color: '#38bdf8' },
    epic:     { label: 'Epic',     color: '#c084fc' },
    legendary:{ label: 'Legendary',color: '#fbbf24' }
};

const ZONE_LOOT_MATERIALS = {
    1: 'Valley Iron',
    2: 'Fen-Bronze',
    3: 'Cold Bog-Iron',
    4: 'Karst Chitin',
    5: 'Highgate Steel'
};

function usable(owner, slot, variant = null) {
    return { owner, slot, variant, usable: true };
}

function restricted(slot, restriction) {
    return {
        owner: null,
        slot,
        variant: null,
        usable: false,
        restriction
    };
}

const OFF_CLASS_LOOT = [
    restricted('heavy_plate', 'Off-Class Heavy Plate / Brigandine'),
    restricted('great_weapon', 'Off-Class 2H Greatsword / Halberd'),
    restricted('shield', 'Off-Class Tower Shield / Buckler'),
    restricted(
        'heavy_mail',
        'Off-Class Heavy Mail Gauntlets / Greathelm'
    ),
    restricted(
        'skill_tome',
        'Off-Class Martial / Mage Skill Tome'
    )
];

/*
 * These are separate source tables. Keep their order aligned with
 * the original SillyTavern random-option lists.
 */
const WILD_ELITE_LOOT_SLOTS = [
    usable('tansy', 'weapon'),
    usable('tansy', 'gloves'),
    usable('tansy', 'chest'),
    usable('tansy', 'trousers'),
    usable('tansy', 'ring1', 'vitality'),
    usable('tansy', 'ring1', 'luck'),
    usable('tansy', 'neck', 'vitality'),
    usable('tansy', 'boots', 'luck'),
    usable('qtik', 'ring1', 'bulwark'),
    usable('qtik', 'ring1', 'vitality'),
    usable('qtik', 'amulet', 'bulwark'),
    usable('qtik', 'wristCuffs', 'vitality'),
    ...OFF_CLASS_LOOT
];

const BOSS_LOOT_SLOTS = [
    usable('tansy', 'weapon'),
    usable('tansy', 'gloves'),
    usable('tansy', 'chest'),
    usable('tansy', 'trousers'),
    usable('tansy', 'ring1', 'vitality'),
    usable('tansy', 'neck', 'luck'),
    usable('qtik', 'ring1', 'bulwark'),
    usable('qtik', 'amulet', 'vitality'),
    usable('qtik', 'wristCuffs', 'bulwark'),
    ...OFF_CLASS_LOOT
];

function lootRarityFromRoll(roll) {
    assert(
        Number.isInteger(roll) && roll >= 1 && roll <= 6,
        'rarityRoll must be 1-6'
    );

    if (roll <= 3) return 'common';
    if (roll <= 5) return 'uncommon';
    return 'rare';
}

function lootStatFromRarity(zone, rarity) {
    const base = ZONES[zone].base;

    if (rarity === 'common') return base;
    if (rarity === 'uncommon') return base + 1;
    if (rarity === 'rare') return base + 3;
    if (rarity === 'epic') return base + 5;
    if (rarity === 'legendary') return base + 8;

    throw new Error(`Unsupported loot rarity: ${rarity}`);
}

function lootBonus(owner, slot, variant, stat) {
    const result = {
        crewAtk: 0,
        tansyMaxHp: 0,
        qtikMaxHp: 0,
        frontlineDef: 0,
        crewLuk: 0
    };

    if (owner === 'tansy') {
        if (slot === 'weapon') {
            result.crewAtk = stat * 2;
        } else if (slot === 'gloves') {
            result.crewAtk = stat;
        } else if (slot === 'chest' || slot === 'trousers') {
            result.tansyMaxHp = stat * 5;
            result.crewLuk = 1;
        } else if (variant === 'vitality') {
            result.tansyMaxHp = stat * 5;
        } else if (variant === 'luck') {
            result.crewLuk = stat;
        }
    }

    if (owner === 'qtik') {
        if (variant === 'bulwark') {
            result.frontlineDef = stat * 2;
        } else if (variant === 'vitality') {
            result.qtikMaxHp = stat * 15;
        }
    }

    return result;
}

function lootItemName(material, loot, stat) {
    if (!loot.usable) {
        return `${material} ${loot.restriction}`;
    }

    const ownerName = loot.owner === 'qtik'
        ? "Q'tik"
        : 'Tansy';

    const variantName = loot.variant
        ? ` ${loot.variant[0].toUpperCase()}${loot.variant.slice(1)}`
        : '';

    const slotNames = {
        weapon: 'Focus',
        gloves: 'Bracers',
        chest: 'Chest',
        trousers: 'Trousers',
        ring1: 'Band',
        neck: 'Necklace',
        boots: 'Boots',
        amulet: 'Amulet',
        wristCuffs: 'Wrist Cuffs'
    };

    return `${ownerName} ${material}${variantName} ` +
        `${slotNames[loot.slot]} (Stat ${stat})`;
}

function resolveLootSeed(test) {
    assert(ZONES[test.zone], `Unknown zone: ${test.zone}`);

    assert(
        ['wild', 'elite', 'boss'].includes(test.source),
        `Unsupported loot source: ${test.source}`
    );

    const slots = test.source === 'boss'
        ? BOSS_LOOT_SLOTS
        : WILD_ELITE_LOOT_SLOTS;

    assert(
        Number.isInteger(test.slotRoll) &&
        test.slotRoll >= 1 &&
        test.slotRoll <= slots.length,
        `slotRoll must be 1-${slots.length} for ${test.source}`
    );

    const loot = slots[test.slotRoll - 1];

    const rarity = test.source === 'wild'
        ? lootRarityFromRoll(test.rarityRoll)
        : test.source === 'elite'
            ? 'uncommon'
            : 'epic';

    const rarityInfo = LOOT_RARITY_INFO[rarity];
    const rawStat = lootStatFromRarity(test.zone, rarity);

    const item = {
        name: lootItemName(
            ZONE_LOOT_MATERIALS[test.zone],
            loot,
            rawStat
        ),
        source: test.source,
        slot: loot.slot,
        owner: loot.owner,
        variant: loot.variant,
        rarity: rarityInfo.label,
        rarityColor: rarityInfo.color,
        rawStat,
        bound: false,
        sellValue: rawStat * 2,
        bonus: lootBonus(
            loot.owner,
            loot.slot,
            loot.variant,
            rawStat
        ),
        classRestricted: !loot.usable,

        // Any never-equipped gear is unbound and may be listed.
        tradeStreamEligible: true
    };

    if (!loot.usable) {
        item.restriction = loot.restriction;
    }

    // The Trade-Stream values skill tomes using S=10. Their
    // NPC pawn value still follows the raw-stat gear rule.
    if (loot.slot === 'skill_tome') {
        item.tradeStat = 10;
    }

    return { ok: true, item };
}

function registerTools() {
    const context = getContext();

    if (!context?.registerFunctionTool) {
        console.warn(
            'Aethermoor Engine: function tools unavailable'
        );
        return;
    }

    register(
        'aethermoorResolveTurnV2',
        'Aethermoor: Resolve Turn or Batch',
        [
            'Resolve one declared PvE turn, or evaluate multiple independent',
            'mechanics cases in one call. Does not choose actions or narrate.',
            'Single mode uses state and actions. Batch mode uses cases.'
        ].join(' '),
        {
            type: 'object',
            properties: {
                state: {
                    type: 'object',
                    description:
                        'Previous locked state for single-turn mode'
                },

                actions: {
                    type: 'object',
                    properties: {
                        qtik: {
                            type: 'string',
                            enum: [
                                'fire_melee',
                                'ice_melee',
                                'stun',
                                'ice_patch',
                                'frost_stomp',
                                'drink'
                            ]
                        },
                        tansy: {
                            type: 'string',
                            enum: [
                                'visor',
                                'vitals',
                                'hamstring',
                                'recall',
                                'surge',
                                'drink'
                            ]
                        },
                        target: {
                            type: 'string'
                        },
                        qtikItem: {
                            type: 'string'
                        },
                        tansyItem: {
                            type: 'string'
                        }
                    }
                },

                rolls: {
                    type: 'object',
                    properties: {
                        player: {
                            type: 'array',
                            items: {
                                type: 'integer'
                            }
                        },
                        enemy: {
                            type: 'array',
                            items: {
                                type: 'integer'
                            }
                        },
                        telegraph: {
                            type: 'integer',
                            minimum: 1,
                            maximum: 4
                        },
                        lootSlotRoll: {
                            type: 'integer',
                            minimum: 1,
                            maximum: 17
                        },
                        lootRarityRoll: {
                            type: 'integer',
                            minimum: 1,
                            maximum: 6
                        }
                    }
                },

                rewardMode: {
                    type: 'string',
                    enum: [
                        'immediate',
                        'deferred'
                    ]
                },

                cases: {
                    type: 'array',
                    description:
                        'Independent mechanics cases with optional assertions',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string'
                            },

                            kind: {
                                type: 'string',
                                enum: [
                                    'spawn',
                                    'turn',
                                    'consume_belt',
                                    'reference',
                                    'world_seeds',
                                    'loot',
                                    'quest',
                                    'gear',
                                    'trade',
                                    'vendor',
                                    'currency',
                                    'consumable',
                                    'food'
                                ]
                            },

                            state: {
                                type: 'object'
                            },

                            actions: {
                                type: 'object'
                            },

                            rolls: {
                                type: 'object'
                            },

                            rewardMode: {
                                type: 'string',
                                enum: [
                                    'immediate',
                                    'deferred'
                                ]
                            },

                            belt: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            },

                            items: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            },

                             zone: {
                                type: 'integer'
                            },

                            owner: {
                                type: 'string',
                                enum: ['tansy', 'qtik']
                            },

                            slot: {
                                type: 'string',
                                enum: [
                                    'weapon',
                                    'gloves',
                                    'chest',
                                    'trousers',
                                    'headgear',
                                    'boots',
                                    'neck',
                                    'ring1',
                                    'ring2',
                                    'amulet',
                                    'wristCuffs'
                                ]
                            },

                            variant: {
                                type: 'string',
                                enum: ['vitality', 'luck', 'bulwark']
                            },

                            source: {

                                type: 'string',
                                enum: ['wild', 'elite', 'boss']
                            },

                            slotRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 17
                            },

                            rarityRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 6
                            },

                            encounterType: {
                                type: 'string',
                                enum: ['normal_pack', 'elite', 'boss']
                            },

                            bracket: {
                                type: 'string',
                                enum: ['low', 'mid', 'high']
                            },

                            composition: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 6
                            },

                            encounterId: {
                                type: 'string'
                            },

                            passiveRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 4
                            },

                            mob: {
                                type: 'object'
                            },

                            crew: {
                                type: 'object'
                            },
                            repTier: {
                                type: 'string',
                                enum: [
                                    'Unknown',
                                    'Slightly Known',
                                    'Known',
                                    'Well Respected',
                                    'Renowned'
                                ]
                            },

                            questRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 3
                            },

                            salvageSlotRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 15
                            },

                            town: {
                                type: 'string'
                            },
                            action: {
                                type: 'string',
                                enum: [
                                    'accept',
                                    'decline',
                                    'clear_gate',
                                    'complete',
                                    'equip',
                                    'pawn',
                                    'list',
                                    'settle',
                                    'stock',
                                    'buy',
                                    'spend',
                                    'earn',
                                    'sell',
                                    'restock',
                                    'list_food',
                                    'apply'
                                ]
                            },

                            itemIndex: {
                                type: 'integer',
                                minimum: 0
                            },
                            
                            item: {
                                type: 'string',
                                enum: [
                                    'basic_health_potion',
                                    'mid_health_potion',
                                    'cleansing_tonic'
                                ]
                            },

                            quantity: {
                                type: 'integer',
                                minimum: 1
                            },

                            recipient: {
                                type: 'string',
                                enum: ['qtik', 'tansy']
                            },

                            listingId: {
                                type: 'string'
                            },

                            listingIndex: {
                                type: 'integer',
                                minimum: 0
                            },

                            tradeRoll: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 6
                            },

                            listedAt: {
                                type: 'string'
                            },

                            recipeId: {
                                type: 'string'
                            },

                            amount: {
                                type: 'integer',
                                minimum: 1
                            },

                            amount: {
                                type: 'integer',
                                minimum: 1
                            },

                            reason: {
                                type: 'string'
                            },

                            nextGateMode: {
                                type: 'string',
                                enum: [
                                    'traversal_discovery',
                                    'brain_social_heist',
                                    'combat_twist_showdown'
                                ]
                            },

                            nextGateObjective: {
                                type: 'string'
                            },

                            curiosityRoll: {
                                type: 'integer'
                            },

                            rumorRoll: {
                                type: 'integer'
                            },

                            packDropRoll: {
                                type: 'integer'
                            },

                            newWildernessSite: {
                                type: 'boolean'
                            },

                            investigatedRumor: {
                                type: 'boolean'
                            },

                            packLooted: {
                                type: 'boolean'
                            },

                            expectError: {
                                type: 'string',
                                description:
                                    'Expected error substring for negative tests'
                            },

                            expect: {
                                type: 'array',
                                description:
                                    'Assertions against returned result paths',
                                items: {
                                    type: 'object',
                                    properties: {
                                        path: {
                                            type: 'string'
                                        },
                                        exists: {
                                            type: 'boolean'
                                        },
                                        equals: {},
                                        notEquals: {},
                                        minimum: {
                                            type: 'number'
                                        },
                                        maximum: {
                                            type: 'number'
                                        }
                                    },
                                    required: [
                                        'path'
                                    ]
                                }
                            }
                        },
                        required: [
                            'name',
                            'kind'
                        ]
                    }
                }
            }
        },
        args => {
            if (Array.isArray(args.cases)) {
                return resolveBatch(args);
            }

            return resolveTurn({
                state: args.state,
                actions: args.actions,
                rolls: args.rolls,
                rewardMode:
                    args.rewardMode || 'immediate'
            });
        }
    );

    register(
        'aethermoorConsumeBeltV2',
        'Aethermoor: Consume Belt',
        [
            'Deduct explicitly named item IDs.',
            'Does not decide why or who receives them.'
        ].join(' '),
        {
            type: 'object',
            properties: {
                belt: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                items: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }
            },
            required: [
                'belt',
                'items'
            ]
        },
        consumeBelt
    );

    register(
        'aethermoorReferenceV2',
        'Aethermoor: Mechanics Reference',
        [
            'Get zone vendor prices, mob stats, XP thresholds,',
            'or derived crew statistics.'
        ].join(' '),
        {
            type: 'object',
            properties: {
                zone: {
                    type: 'integer'
                },
                mob: {
                    type: 'object'
                },
                crew: {
                    type: 'object'
                }
            }
        },
        args => ({
            ok: true,
            zone: args.zone
                ? vendorStock(args.zone)
                : undefined,
            mob: args.mob
                ? mobStats(
                    args.mob.level,
                    args.mob.role
                )
                : undefined,
            crew: args.crew
                ? derived(args.crew)
                : undefined,
            nextXp: args.crew
                ? nextXp(args.crew.level)
                : undefined
        })
    );

    console.log(
        'Aethermoor Engine function tools registered'
    );
}

// Same startup approach as the working VrCombat prototype.
jQuery(registerTools);
