import { getContext } from '../../../extensions.js';

const ZONE_NAMES = {
    1: 'Thornhaven',
    2: 'Reed-Fens',
    3: 'Blighted Marsh',
    4: 'Weeping Karst',
    5: 'Highgate Pass'
};

function zoneNumber(key) {
    if (typeof key !== 'string') return null;

    const zone = Number(key);
    return Number.isSafeInteger(zone) &&
        zone >= 1 &&
        String(zone) === key
            ? zone
            : null;
}

const ZONES = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        return {
            name: ZONE_NAMES[zone] || `Zone ${zone}`,
            base: Math.floor((5 * zone - 1) / 2),
            tier: Math.ceil(zone / 2),
            levels: [
                5 * zone - 3,
                5 * zone - 2,
                5 * zone - 1
            ]
        };
    }
});


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
    int(level, 'level', 1);

    if (level < 10) {
        return 250 * level;
    }

    const targetPunchUpPacks =
        10 + 0.3 * (level - 10);

    const mixedPackXpAtTenLevelsAbove =
        16 * (level + 10);

    return Math.round(
        targetPunchUpPacks *
        mixedPackXpAtTenLevelsAbove
    );
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

function shadowMechanics(crew) {
    const active = crew.shadows?.active || [];
    const deck = crew.shadows?.deck || [];
    assert(Array.isArray(active) && Array.isArray(deck),
        'Shadow deck and active shadows must be arrays');

    const result = {
        slots: 0, attack: 0, archerAttack: 0,
        menderHeal: 0, hexStrip: 0, bruteReduction: 0
    };
    const ids = new Set();
    const uniqueRoles = new Set();

    for (const shadow of active) {
        assert(shadow && typeof shadow.id === 'string' && !ids.has(shadow.id),
            'Active shadows need unique deck IDs');
        ids.add(shadow.id);

        const entry = deck.find(item => item.id === shadow.id);
        assert(entry && entry.type === shadow.type &&
            entry.sourceMobLevel === shadow.sourceMobLevel,
            `Active shadow ${shadow.id} must match its deck entry`);

        const count = int(shadow.count, `${shadow.id}.count`, 1);
        const tier = 1 + Math.floor(
            int(shadow.sourceMobLevel, `${shadow.id}.sourceMobLevel`, 1) / 10
        );
        assert(shadow.shadowTier === tier,
            `${shadow.id} has an incorrect Shadow Tier`);

        if (shadow.type !== 'archer') {
            assert(count === 1 && !uniqueRoles.has(shadow.type),
                `Only one active Shadow ${shadow.type} is allowed`);
            uniqueRoles.add(shadow.type);
        }

        result.slots += 3 * count;
        if (shadow.type === 'archer') {
            result.archerAttack += count * (1 + tier);
            result.attack += count * (1 + tier);
        } else if (shadow.type === 'mender') {
            result.menderHeal += 2 * tier;
        } else if (shadow.type === 'hexer') {
            result.attack += 1 + tier;
            result.hexStrip += 4 * tier;
        } else if (shadow.type === 'warder') {
            result.attack += 1 + tier;
            result.bruteReduction += Math.max(1, Math.floor(tier / 2));
        } else {
            throw new Error(`Unsupported active shadow type: ${shadow.type}`);
        }
    }
    return result;
}

function derived(crew) {
    assert(crew && typeof crew === 'object', 'Crew state is required');
    const level = int(crew.level, 'crew.level', 1);
    assert(crew.weasels, 'Crew weasel state is required');

    const weasels = int(crew.weasels.active, 'weasels.active');
    const totalSlots = 3 + Math.floor(level / 2);
    const shadows = shadowMechanics(crew);
    assert(weasels + shadows.slots <= totalSlots,
        `Active summons exceed ${totalSlots} total summon slots`);

    const totals = {
        atk: 2 * level + 2 * weasels + shadows.attack,
        def: level,
        luk: Math.floor(level / 2),
        qtikMaxHp: 125 + 25 * level,
        tansyMaxHp: 35 + 15 * level
    };

    for (const slot of TANSY_SLOTS) {
        const bonus = gearBonus('tansy', slot, crew.gear?.tansy?.[slot]);
        totals.atk += bonus.atk;
        totals.luk += bonus.luk;
        totals.tansyMaxHp += bonus.hp;
    }
    for (const slot of QTIK_SLOTS) {
        const bonus = gearBonus('qtik', slot, crew.gear?.qtik?.[slot]);
        totals.def += bonus.def;
        totals.qtikMaxHp += bonus.hp;
    }

    totals.regen = Math.round(totals.qtikMaxHp / 100);
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

    state.inventory ||= {};
    normalizeConsumableInventory(state.inventory);

    encounter.potionsUsed ||= 0;
    int(encounter.potionsUsed, 'encounter.potionsUsed');
    assert(
        encounter.potionsUsed <= 4,
        'At most four potions may be used per encounter'
    );

    assert(
        typeof encounter.id === 'string' &&
        encounter.id.length > 0,
        'Encounter needs a non-empty ID'
    );

    assert(
        [
            'normal_pack',
            'declared',
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

    if (encounter.type === 'declared') {
        const declaredRoles = [
            'brute',
            'archer',
            'mender',
            'hexer',
            'buffer',
            'elite',
            'boss'
        ];

        assert(
            encounter.foes.every(foe =>
                declaredRoles.includes(foe.role)
            ),
            'Declared encounter contains an unsupported role'
        );

        assert(
            encounter.rewards?.kind === 'declared',
            'Declared encounter reward metadata is required'
        );

        const expectedGear =
            encounter.foes.filter(
                foe =>
                    foe.role === 'elite' ||
                    foe.role === 'boss'
            );

        assert(
            Array.isArray(
                encounter.rewards.guaranteedGear
            ),
            'Declared guaranteedGear must be an array'
        );

        assert(
            encounter.rewards.guaranteedGear.length ===
            expectedGear.length,
            'Declared guaranteedGear does not match elite/boss roster'
        );

        for (const foe of expectedGear) {
            const gear =
                encounter.rewards.guaranteedGear.find(
                    entry => entry.foeId === foe.id
                );

            assert(
                gear,
                `Missing guaranteed gear for ${foe.id}`
            );

            const expectedRawStat =
                ZONES[encounter.zone].base +
                (
                    foe.role === 'elite'
                        ? 1
                        : 5
                );

            assert(
                gear.rawStat === expectedRawStat,
                `${foe.id} guaranteed gear stat is invalid`
            );

            assert(
                gear.pawnSilver === 2 * gear.rawStat,
                `${foe.id} guaranteed gear pawn value is invalid`
            );
        }
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
            ZONES[encounter.zone].base +
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
     }

    return d;
}

function live(state) {
    return state.encounter.foes.filter(foe => foe.hp > 0);
}

function roll(state, sides) {
    int(sides, 'roll sides', 1);

    /*
     * The RNG seed belongs to the saved extension state. Initialize it
     * once if this is an older save that does not have a seed yet.
     */
    if (!Number.isInteger(state.rngState) || state.rngState < 1) {
        const seed = new Uint32Array(1);

        if (globalThis.crypto?.getRandomValues) {
            globalThis.crypto.getRandomValues(seed);
            state.rngState = seed[0] || 1;
        } else {
            state.rngState =
                (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
        }
    }

    let x = state.rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;

    state.rngState = (x >>> 0) || 1;

    return 1 + (state.rngState % sides);
}


function xpForKill(crewLevel, foe) {
    const base = mobStats(foe.level, foe.role).xpBase;
    const gap = foe.level - crewLevel;

    if (gap <= -10) return 0;
    if (gap <= -5) return Math.floor(base * 0.5);
    if (gap >= 10) return Math.floor(base * 2);
    if (gap >= 5) return Math.floor(base * 1.5);

    return base;
}

function silverForKill(foe) {
    const base = Math.max(1, Math.floor(foe.level / 3));

    if (foe.role === 'elite') return base * 3;
    if (foe.role === 'boss') return base * 6;

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

function checkTape(state) {
    return {
        player: [
            roll(state, 6),
            roll(state, 6),
            roll(state, 6)
        ],
        enemy: [
            roll(state, 6),
            roll(state, 6),
            roll(state, 6)
        ]
    };
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

function finalizeEncounterRewards(state, slainIds) {
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
        Array.isArray(state.inventory.bagReserves) &&
        Array.isArray(state.inventory.activeTradeListings),
        'Encounter reward inventory must contain arrays'
    );

    if (live(state).length > 0) {
        return {
            xp: 0, silver: 0, resolved: false,
            encounterCleared: false, loot: [], trophies: []
        };
    }

    assert(
        encounter.rewards.resolved !== true,
        'Encounter rewards have already been resolved'
    );

    let xp = 0;
    let silver = 0;
    const loot = [];

    if (encounter.type === 'normal_pack') {
        /*
         * Normal-pack XP follows the same level-gap rules as every
         * other foe. The old listedPackXp remains locked metadata
         * for reference, but is no longer the payout authority.
         */
        xp = encounter.foes.reduce(
            (total, foe) =>
                total + xpForKill(crew.level, foe),
            0
        );

        silver = encounter.foes.reduce(
                (total, foe) => total + silverForKill(foe),
            0
        );


    } else if (encounter.type === 'declared') {
/*
 * A declared roster pays level-gap XP and level-based silver
 * for every slain foe. Elite/Boss members receive their
 * appropriate silver multiplier and guaranteed gear drop.
 */

        xp = encounter.foes.reduce(
            (total, foe) =>
                total + xpForKill(crew.level, foe),
            0
        );

        silver = encounter.foes.reduce(
                (total, foe) => total + silverForKill(foe),
            0
        );

        for (const foe of encounter.foes) {
            if (
                foe.role !== 'elite' &&
                foe.role !== 'boss'
            ) {
                continue;
            }

            const guaranteedGear =
                encounter.rewards.guaranteedGear.find(
                    entry => entry.foeId === foe.id
                );

            assert(
                guaranteedGear,
                `Missing guaranteed gear for ${foe.id}`
            );

            const generated =
                rollLootFromState(
                    state,
                    foe.role
                );

            assert(
                generated.item.rawStat ===
                guaranteedGear.rawStat,
                `${foe.id} generated gear stat does not ` +
                'match locked reward'
            );

            const item = {
                ...generated.item,
                acquiredFrom: foe.role,
                acquiredAtEncounter: encounter.id,
                acquiredFromFoe: foe.id,
                bound: false
            };

            state.inventory.bagReserves.push(item);
            loot.push(item);
        }

    } else if (
        encounter.type === 'elite' ||
        encounter.type === 'boss'
    ) {
        const slain = new Set(slainIds);
        const foe = encounter.foes[0];

        assert(
            slain.has(foe.id),
            'Elite/Boss clear requires its slain foe'
        );

        xp = xpForKill(crew.level, foe);
        silver = silverForKill(foe);

        const guaranteedGear =
            encounter.rewards.guaranteedGear;

        assert(
            guaranteedGear &&
            Number.isInteger(guaranteedGear.rawStat),
            'Elite/Boss guaranteed gear is missing'
        );

        const generated = rollLootFromState(
            state,
            encounter.type
        );
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
    } else {
        throw new Error(
            `Unsupported encounter reward type: ${encounter.type}`
        );
    }
    encounter.status = 'cleared';
    encounter.rewards.resolved = true;

    if (encounter.questTerminal) {
        const activeQuest =
            state.activeQuest;

        assert(
            activeQuest &&
            activeQuest.id ===
                encounter.questTerminal.questId,
            'Quest-terminal encounter is linked to the wrong quest'
        );

        assert(
            activeQuest.terminalThreat,
            'Linked quest has no terminal threat record'
        );

        activeQuest.terminalThreat.resolved = true;
    }

    return {

        xp,
        silver,
        resolved: true,
        encounterCleared: true,
        loot,
        trophies: []
    };
}

function applyConsumableItem(state, item, recipient) {
    const crew = state.crew;
    const encounter = state.encounter;

    assert(
        recipient === 'qtik' || recipient === 'tansy',
        `Invalid potion recipient: ${recipient}`
    );
    assert(
        CONSUMABLE_CATALOG[item],
        `Unsupported consumable: ${item}`
    );

    normalizeConsumableInventory(state.inventory);

    encounter.potionsUsed ||= 0;
    assert(
        encounter.potionsUsed < 4,
        'Four potions have already been used this encounter'
    );

    const entry = state.inventory.consumables.find(
        entry => entry.id === item
    );
    assert(
        entry && entry.quantity > 0,
        `No ${item} remains in shared stock`
    );

    entry.quantity -= 1;
    if (entry.quantity === 0) {
        state.inventory.consumables =
            state.inventory.consumables.filter(
                entry => entry.id !== item
            );
    }
    encounter.potionsUsed += 1;

    if (
        item === 'basic_health_potion' ||
        item === 'mid_health_potion'
    ) {
        const amount = item === 'mid_health_potion' ? 120 : 50;
        const character = crew[recipient];
        const stats = derived(crew);
        const maxHp = recipient === 'qtik'
            ? stats.qtikMaxHp
            : stats.tansyMaxHp;
        const beforeHp = character.hp;

        character.hp = Math.min(maxHp, character.hp + amount);

        return {
            item,
            recipient,
            effect: 'heal',
            requested: amount,
            healed: character.hp - beforeHp,
            hp: character.hp,
            maxHp,
            potionsUsed: encounter.potionsUsed
        };
    }

    const hexEntry = Object.entries(encounter.hexStacks || {})
        .find(([, stacks]) => Number(stacks) > 0);

    if (hexEntry) {
        const [hexerId, stacks] = hexEntry;
        if (Number(stacks) === 1) {
            delete encounter.hexStacks[hexerId];
        } else {
            encounter.hexStacks[hexerId] = Number(stacks) - 1;
        }
        return {
            item, recipient, effect: 'cleanse',
            stacksRemoved: 1, sourceType: 'hexer',
            source: hexerId, potionsUsed: encounter.potionsUsed
        };
    }

    const passiveFoe = encounter.foes.find(
        foe =>
            foe.hp > 0 &&
            ['elite', 'boss'].includes(foe.role) &&
            Number(foe.passiveStacks || 0) > 0
    );

    if (passiveFoe) {
        passiveFoe.passiveStacks -= 1;
        return {
            item, recipient, effect: 'cleanse',
            stacksRemoved: 1,
            sourceType: 'elite_boss_passive',
            source: passiveFoe.id,
            potionsUsed: encounter.potionsUsed
        };
    }

    return {
        item, recipient, effect: 'cleanse',
        stacksRemoved: 0,
        note: 'No active debuff stack to remove',
        potionsUsed: encounter.potionsUsed
    };
}

const ELITE_TELEGRAPHS = [
    'berserk_heavy_windup',
    'spiked_carapace',
    'sweeping_cleave',
    'aether_drain'
];

const BOSS_TELEGRAPHS = [
    ...ELITE_TELEGRAPHS,
    'call_reinforcements'
  ];


function passiveStates(encounter) {
    return encounter.foes
        .filter(foe =>
            foe.hp > 0 &&
            ['elite', 'boss'].includes(foe.role) &&
            foe.passive
        )
        .map(foe => {
            foe.passiveStacks =
                Number(foe.passiveStacks || 0);

            return {
                foe,
                name: foe.passive,
                stacks: foe.passiveStacks
            };
        });
}

function passiveAttackPenalty(encounter) {
    return passiveStates(encounter)
        .filter(passive =>
            passive.name === 'withering_lethargy'
        )
        .reduce(
            (total, passive) =>
                total + 2 * passive.stacks,
            0
        );
}

function passiveDefensePenalty(encounter) {
    return passiveStates(encounter)
        .filter(passive =>
            passive.name === 'armor_sunder'
        )
        .reduce(
            (total, passive) =>
                total + 2 * passive.stacks,
            0
        );
}

function passiveRegenPenalty(encounter) {
    return passiveStates(encounter)
        .filter(passive =>
            passive.name === 'grave_chill'
        )
        .reduce(
            (total, passive) =>
                total + 2 * passive.stacks,
            0
        );
}

function passiveBleedBonus(encounter) {
    return passiveStates(encounter)
        .filter(passive =>
            passive.name === 'serrated_bleed'
        )
        .reduce(
            (total, passive) =>
                total + passive.stacks,
            0
        );
}

function chooseNextTelegraph(foe, rollValue) {
    assert(
        foe && ['elite', 'boss'].includes(foe.role),
        'Only elite and boss foes can have telegraphs'
    );

    const pool =
        foe.role === 'boss' &&
        foe.reinforcementsCalled !== true
            ? BOSS_TELEGRAPHS
            : ELITE_TELEGRAPHS;

    const rollIndex =
        ((Number(rollValue) - 1) % pool.length + pool.length) %
        pool.length;

    const previous = foe.nextTelegraph;
    let selected = pool[rollIndex];

    if (selected === previous) {
        selected = pool[(rollIndex + 1) % pool.length];
    }

    return selected;
}

function telegraphLabel(telegraph) {
    const labels = {
        berserk_heavy_windup: 'Berserk / Heavy Wind-Up',
        spiked_carapace: 'Spiked Carapace / Thorns Guard',
        sweeping_cleave: 'Sweeping Cleave / Shockwave',
        aether_drain: 'Aether-Drain / Life-Siphon',
        call_reinforcements: 'Call Reinforcements'
    };

    return labels[telegraph] || telegraph;
}

function telegraphEffects(foe) {
    if (!foe || !['elite', 'boss'].includes(foe.role)) {
        return null;
    }

    const tier = enemyTier(foe.level);

    return {
        berserk_heavy_windup: {
            name: 'berserk_heavy_windup',
            bleedMultiplier: 2,
            extraDebuffStacks: 1
        },

        spiked_carapace: {
            name: 'spiked_carapace',
            defenseBonus: 6 * tier,
            reflectsMeleeWeasel: true,
            reflectsQtikDamage: true
        },

        sweeping_cleave: {
            name: 'sweeping_cleave',
            destroysMeleeWeasel: true,
            tansySplashPercent: 10
        },

        aether_drain: {
            name: 'aether_drain',
            healPerHit: 10 * tier
        },
        call_reinforcements: {
            name: 'call_reinforcements'
        }

    }[foe.nextTelegraph] || null;
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
function materializeBossReinforcements(state) {
    const encounter = state.encounter;

    const bosses = encounter.foes.filter(
        foe =>
            foe.hp > 0 &&
            foe.role === 'boss' &&
            foe.nextTelegraph === 'call_reinforcements' &&
            foe.reinforcementsCalled !== true
    );

    if (bosses.length === 0) {
        return [];
    }

    /*
     * A standalone boss encounter becomes a declared roster once
     * reinforcements arrive. Preserve its already-locked boss gear.
     */
    if (encounter.type === 'boss') {
        const oldGear =
            encounter.rewards.guaranteedGear;

        encounter.type = 'declared';
        encounter.rewards = {
            kind: 'declared',
            resolved: false,
            guaranteedGear: [{
                foeId: encounter.foes[0].id,
                source: 'boss',
                rawStat: oldGear.rawStat,
                pawnSilver: oldGear.pawnSilver
            }]
        };
    }

    const added = [];
    const ordinaryRoles = [
        'brute',
        'archer',
        'mender',
        'hexer',
        'buffer'
    ];
    const zoneLevels =
        ZONES[encounter.zone].levels;

    for (const boss of bosses) {
        const count = roll(state, 3);
        const bossAdded = [];

        for (let index = 0; index < count; index++) {
            const role =
                ordinaryRoles[
                    roll(state, ordinaryRoles.length) - 1
                ];

            const level =
                zoneLevels[
                    roll(state, zoneLevels.length) - 1
                ];

            const id =
                `${encounter.id}-${boss.id}-reinforcement-` +
                `${index + 1}`;

            assert(
                !encounter.foes.some(
                    foe => foe.id === id
                ),
                `Reinforcement ID already exists: ${id}`
            );

            const foe = createFoe({
                id,
                level,
                role
            });

            encounter.foes.push(foe);
            added.push(foe);
            bossAdded.push(foe.id);
        }

        boss.reinforcementsCalled = true;
        boss.nextTelegraph = null;

        encounter.reinforcementLog ||= [];
        encounter.reinforcementLog.push({
            bossId: boss.id,
            foeIds: bossAdded
        });
    }

    return added;
}

function resolveTurn({
    state,
    actions,
    rolls
}) {

    const s = clone(state);
    s.inventory ||= {};
    s.inventory.bagReserves ||= [];
    s.inventory.activeTradeListings ||= [];

    const initial = validate(s);
    const c = s.crew;
    const encounter = s.encounter;
        assert(
        encounter.status === 'active',
        `Cannot resolve a turn from encounter status ${encounter.status}`
    );

    assert(
        actions && typeof actions === 'object',
        'Turn actions are required'
    );

    const fleeing =
        actions.flee === true;

    if (fleeing) {
        assert(
            actions.qtik === undefined &&
            actions.tansy === undefined &&
            actions.target === undefined,
            'Flee cannot be combined with combat actions'
        );
    } else {
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
                'recall', 'surge', 'drink', 'raise_shadow'
            ].includes(actions.tansy),
            `Unsupported Tansy action: ${actions.tansy}`
        );

        assert(
            typeof actions.target === 'string',
            'A combat target is required'
        );

        assert(
            live(s).some(foe => foe.id === actions.target),
            `Target ${actions.target} is not alive`
        );
    }

    assert(
        live(s).length > 0,
        'No living foes'
    );

    let fleeRoll = null;
    let fleeBonus = null;
    let fleeTotal = null;

    if (fleeing) {
        const stats = derived(c);
        fleeRoll = roll(s, 6);
        fleeBonus = Math.min(3, Math.floor(stats.luk / 5));
        fleeTotal = fleeRoll + fleeBonus;
        encounter.fleeAttempts =
            Number(encounter.fleeAttempts || 0) + 1;

        if (fleeTotal >= 6) {
            encounter.status = 'fled';
            encounter.fledOnAttempt =
                encounter.fleeAttempts;

            return {
                ok: true,
                turn: encounter.turn,
                action: 'flee',
                flee: {
                    roll: fleeRoll,
                    lukBonus: fleeBonus,
                    total: fleeTotal,
                    threshold: 6,
                    success: true
                },
                exchanges: [],
                turnEffects: ['Flee succeeded'],
                rewards: {
                    xp: 0,
                    silver: 0,
                    loot: [],
                    applied: false,
                    resolved: false
                },
                state: s,
                derived: stats
            };
        }
    }

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

    const maxWeasels = 3 + Math.floor(c.level / 2);

    c.weasels.max = maxWeasels;

    const initialShadows = shadowMechanics(c);
    const baseAndGearAttack =
        crewStats.atk -
        2 * state.crew.weasels.active -
        initialShadows.attack;
/*
 * Only Vitals empowers loose Shadow-Weasels and Shadow-Archers.
 * Visor and Hamstring are utility commands.
 * Ice Patch still suppresses the Vitals summon multiplier.
 */

const summonDamageMultiplier =
    actions.tansy === 'vitals' &&
    actions.qtik !== 'ice_patch'
        ? 2
        : 1;

    function activeDamageShadowAttack(shadows) {
        /*
         * Recall removes loose-weasel participation but preserves
         * Shadow-Archer damage.
         */
        if (actions.tansy === 'recall') {
            return shadows.archerAttack;
        }

        /*
         * Only Archer attack is command-amplified.
         * Hexer/Warder attack remains at its normal value.
         */
        const specialistAttack =
            shadows.attack - shadows.archerAttack;

        const archerAttack =
            shadows.archerAttack *
            summonDamageMultiplier;

        return specialistAttack + archerAttack;
    }

    function looseWeaselAttack() {
        if (actions.tansy === 'recall') {
            return 0;
        }

        return c.weasels.active *
            summonDamageMultiplier;
    }


    encounter.used ||= { stun: false, icePatch: false, surge: false };
    encounter.used.surge ??= false;
    encounter.hexStacks ||= {};
    encounter.exposed = Number(encounter.exposed || 0);
    let eliteBossFoes = live(s).filter(
        foe => ['elite', 'boss'].includes(foe.role)
    );

    encounter.turn = Number(encounter.turn || 0) + 1;
    encounter.shadowWarderSacrificeUsed ||= [];

    assert(
        Array.isArray(encounter.shadowWarderSacrificeUsed),
        'Shadow-Warder sacrifice history must be an array'
    );

    let pendingshadowWarderSacrificeId =
        actions.shadowSacrificeId || null;

    if (pendingshadowWarderSacrificeId) {
        const shadow = c.shadows?.active?.find(
            entry =>
                entry.id === pendingshadowWarderSacrificeId &&
                entry.type === 'warder'
        );

        assert(
            shadow,
            'Shadow sacrifice requires an active Shadow-Warder'
        );

        assert(
            !encounter.shadowWarderSacrificeUsed.includes(
                pendingshadowWarderSacrificeId
            ),
            'This Shadow-Warder has already sacrificed itself this fight'
        );
    }
    const turnEffects = [];
    const itemUse = {};
    const tape = checkTape(s);

    if (fleeing) {
        /*
         * The flee roll was already consumed above. The combat tape
         * now supplies the enemy response, while the player-action
         * section below is skipped.
         */
        tape.flee = {
            roll: fleeRoll,
            lukBonus: fleeBonus,
            total: fleeTotal,
            threshold: 6,
            success: false
        };
    }

    const declaredStunTarget =
        actions.qtik === 'stun'
            ? live(s).find(foe => foe.id === actions.target)
            : null;

    const guardingBrute = live(s).find(
        foe => foe.role === 'brute'
    );

    const stunTargetId =
        declaredStunTarget &&
        declaredStunTarget.role !== 'brute' &&
        guardingBrute &&
        tape.enemy[0] >
            (actions.tansy === 'hamstring' ? 2 : 1) &&
        actions.tansy !== 'visor'
            ? guardingBrute.id
            : declaredStunTarget?.id || null;

    let activeTelegraphs =
        eliteBossFoes.map(foe => ({
            foe,
            effect: telegraphEffects(foe)
        }));

    let activeTelegraphEffects =
        activeTelegraphs
            .map(entry => entry.effect)
            .filter(Boolean);

   
    if (actions.qtik === 'stun') {
        assert(
            !encounter.used.stun,
            'Stun has already been used this fight'
        );
        encounter.used.stun = true;

        const stunnedEliteBoss =
            eliteBossFoes.find(
                foe => foe.id === stunTargetId
            );

        if (stunnedEliteBoss?.nextTelegraph) {
            turnEffects.push(
                `Stun cancelled ` +
                `${telegraphLabel(
                    stunnedEliteBoss.nextTelegraph
                )}`
            );

            stunnedEliteBoss.nextTelegraph = null;
                        activeTelegraphs
                .filter(
                    entry =>
                        entry.foe.id === stunnedEliteBoss.id
                )
                .forEach(entry => {
                    entry.effect = null;
                });

            activeTelegraphEffects =
                activeTelegraphs
                    .map(entry => entry.effect)
                    .filter(Boolean);
        }
    }

    /*
     * A successful boss Call Reinforcements telegraph resolves only
     * after the players have had their chance to Stun the boss.
     */
    const reinforcements =
        materializeBossReinforcements(s);

    if (reinforcements.length > 0) {
        turnEffects.push(
            `Boss reinforcements arrived: ` +
            reinforcements
                .map(foe => foe.id)
                .join(', ')
        );

        eliteBossFoes = live(s).filter(
            foe => ['elite', 'boss'].includes(foe.role)
        );

        activeTelegraphs =
            eliteBossFoes.map(foe => ({
                foe,
                effect: telegraphEffects(foe)
            }));

        activeTelegraphEffects =
            activeTelegraphs
                .map(entry => entry.effect)
                .filter(Boolean);
    }

    if (actions.qtik === 'ice_patch') {

        assert(
            !encounter.used.icePatch,
            'Ice Patch has already been used this fight'
        );
        encounter.used.icePatch = true;
    }

    if (actions.qtik === 'drink') {
        assert(
            typeof actions.qtikItem === 'string',
            "Q'tik drink action requires actions.qtikItem"
        );
        itemUse.qtik = applyConsumableItem(

            s, actions.qtikItem, 'qtik'
        );
    }

    if (actions.tansy === 'drink') {
        assert(
            typeof actions.tansyItem === 'string',
            'Tansy drink action requires actions.tansyItem'
        );
        itemUse.tansy = applyConsumableItem(

            s, actions.tansyItem, 'tansy'
        );
    }

    if (actions.tansy === 'raise_shadow') {
        assert(
            typeof actions.shadowId === 'string',
            'Raise Shadow requires actions.shadowId'
        );
        const activation = resolveShadowDeckAction({
            action: 'activate',
            shadowId: actions.shadowId,
            count: actions.count,
            state: s
        });
        c.weasels = activation.state.crew.weasels;
        c.shadows = activation.state.crew.shadows;
        turnEffects.push(
            `Summoned ${actions.shadowId}; fused ` +
            `${activation.weaselsFused} loose weasel(s)`
        );
    }

if (actions.tansy === 'surge') {
    assert(
        !encounter.used.surge,
        'Surge has already been used this fight'
    );
    encounter.used.surge = true;

    c.weasels.active =
        maxWeasels - shadowMechanics(c).slots;
}

    const logs = [];
    const kills = [];
    const startingCount = live(s).length;
    let weaselsDestroyed = 0;
    const fodderBlitz = null;
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

function visorDisrupts(foe, enemyRoll) {
    return (
        actions.tansy === 'visor' &&
        foe &&
        foe.id === actions.target &&
        enemyRoll >= 2 &&
        enemyRoll <= 4
    );
}

        function enemyDefense(foe) {
        const buffer = currentBuffer();
        const bufferBonus = buffer ? 3 * enemyTier(buffer.level) : 0;
        const telegraphBonus = Number(
            activeTelegraphs.find(
                entry => entry.foe.id === foe.id
            )?.effect?.defenseBonus || 0
        );

        const stunReduction =
            actions.qtik === 'stun' &&
             foe.id === stunTargetId

                ? 4 * enemyTier(foe.level)
                : 0;

        return Math.max(
            0,
            foe.def + bufferBonus + telegraphBonus -
            stunReduction - shadowMechanics(c).hexStrip
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
        let ex = 0;
        ex < 3 &&
        live(s).length > 0 &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0;
        ex++
    ) {
        const p = tape.player[ex];
        const e = tape.enemy[ex];
        const effects = [];
        if (
            actions.qtik === 'frost_stomp' &&
            ex === 0
        ) {
            effects.push(
                'Frost Stomp interrupted ordinary specialists for Ex1'
            );
        }

        const patchActive = actions.qtik === 'ice_patch';
        const hamstringActive = actions.tansy === 'hamstring';

        const missLimit = patchActive
            ? (hamstringActive ? 4 : 3)
            : (hamstringActive ? 2 : 1);

        const enemyMiss = e <= missLimit;

        const stunnedFoeId =
            ex === 0 ? stunTargetId : null;

        const specialistInterrupted =
            actions.qtik === 'frost_stomp' &&
            ex === 0;

        const hexPenalty = currentHexPenalty();

        /*
         * Tansy's action controls summons.
         * Q'tik drinking has no effect on their contribution.
         */
        const raised = shadowMechanics(c);

        const exchangeWeaselAttack =
            looseWeaselAttack();

        const activeShadowAttack =
            activeDamageShadowAttack(raised);

        const unpenalizedAttack =
            actions.tansy === 'recall'
            ? baseAndGearAttack + activeDamageShadowAttack(raised)
            : baseAndGearAttack +
            exchangeWeaselAttack +
            activeDamageShadowAttack(raised);

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
        if (stunnedFoeId && target.id !== stunnedFoeId) {
            target = live(s).find(
                foe => foe.id === stunnedFoeId
            );
            effects.push(`${target.id} intercepted Stun with Guard`);
        }

        const brute = live(s).find(
            foe =>
                foe.role === 'brute' &&
                foe.id !== stunnedFoeId
        );

        if (
            brute &&
            target.role !== 'brute' &&
            !(actions.qtik === 'stun' && ex === 0) &&
            !enemyMiss &&
            brute.id !== stunnedFoeId &&
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
            ? Math.max(3, Math.floor(derived(c).atk / 5))
            : 0;

        const isCritical =
            p === 6 ||
            (actions.tansy === 'vitals' && p === 5);

        const targetDefense = enemyDefense(target);

        /*
         * Q'tik's personal damage is kept separate from Tansy's
         * summons. Thorns reflects only this amount back to Q'tik.
         */
        const qtikPhysicalDamage =
            p === 1
                ? 1
                : Math.max(
                    1,
                    2 * c.level -
                    targetDefense +
                    p
                );

        const qtikFireDamage =
            actions.qtik === 'fire_melee'
                ? Math.max(
                    3,
                    Math.floor(derived(c).atk / 5)
                )
                : 0;

        const qtikPersonalDamage =
            qtikPhysicalDamage +
            qtikFireDamage;

        const vitalsBonus =

            actions.tansy === 'vitals' && p >= 2 && p <= 4
                ? Math.min(
                    targetDefense,
                    Math.floor((c.weasels.active + raised.slots) / 2)
                )
                : 0;

        /*
         * A miss does not consume Exposed.
         * The bonus is spent on the next successful physical hit.
         */
        const exposedBonus =
            fleeing || p === 1
                ? 0
                : encounter.exposed;

        if (!fleeing && p !== 1) {
            encounter.exposed = 0;
        }

        let damage = 0;
        let hits = [];
        
        const targetedCarapace =
            activeTelegraphs.find(
                entry => entry.foe.id === target.id
            )?.effect?.reflectsQtikDamage === true;

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
                } else if (!fleeing) {


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
         * Spiked Carapace is reactive damage, not a shield.
         *
         * The enemy still receives the complete Crew attack.
         * Only Q'tik's personal damage is reflected to Q'tik.
         * Tansy's loose weasels and Shadows are not reflected.
         *
         * Fire Melee is intentionally dangerous here: its Fire
         * contribution is part of Q'tik's personal damage.
         * Ice Patch and Hamstring do not prevent Thorns.
         * Recall prevents loose-weasel participation but does not
         * prevent Q'tik's own damage from reflecting.
         */
        if (
            targetedCarapace &&
            actions.qtik !== 'frost_stomp' &&
            hits.some(hit => hit.id === target.id)
        ) {

            const reflected =
                Math.min(
                    c.qtik.hp,
                    qtikPersonalDamage
                );

            c.qtik.hp -= reflected;

            effects.push(
                `Spiked Carapace reflected ` +
                `${reflected} pure damage to Q'tik`
            );

            if (
                c.weasels.active > 0 &&
                actions.tansy !== 'recall'
            ) {
                destroyWeasel(
                    effects,
                    'Spiked Carapace'
                );
            }
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
                enemyAttackAbsorbed: false,
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
        const responseTelegraphs = activeTelegraphs
            .filter(
                entry =>
                    entry.foe.hp > 0 &&
                    entry.effect &&
                    entry.effect.name !== 'call_reinforcements'
            );

        const responseEffects = responseTelegraphs
            .map(entry => entry.effect);

        const telegraphBleedMultiplier = responseEffects.reduce(
            (total, effect) =>
                total * Number(effect.bleedMultiplier || 1),
            1
        );

        const telegraphExtraDebuffStacks = responseEffects.reduce(
            (total, effect) =>
                total + Number(effect.extraDebuffStacks || 0),
            0
        );

        const telegraphDestroysMeleeWeasel = responseEffects.some(
            effect => effect.destroysMeleeWeasel
        );

        const telegraphTansySplashPercent = responseEffects.reduce(
            (total, effect) =>
                total + Number(effect.tansySplashPercent || 0),
            0
        );

        const frontliners = live(s).filter(
            foe =>
                foe.id !== stunnedFoeId &&
                ['brute', 'elite', 'boss'].includes(foe.role)
        );

        const bruteAlive = live(s).some(
            foe => foe.role === 'brute'
        );

        let frontlineDamage = 0;
        let backlineDamage = 0;
        let enemyHitCount = 0;
        let shadowWarderAbsorbed = false;

        /*
         * A declared active Shadow-Warder can sacrifice itself once
         * per fight to absorb one successful telegraph hit or E:6
         * critical completely.
         */
          if (
            pendingshadowWarderSacrificeId &&
            !enemyMiss &&
            (
                e === 6 ||
            responseEffects.length > 0

            )
        ) {

            const activeIndex =
                c.shadows.active.findIndex(
                    entry =>
                        entry.id === pendingshadowWarderSacrificeId &&
                        entry.type === 'warder'
                );

            assert(
                activeIndex >= 0,
                'Declared Shadow-Warder is no longer active'
            );

            const [sacrificed] =
                c.shadows.active.splice(activeIndex, 1);

            encounter.shadowWarderSacrificeUsed.push(
                pendingshadowWarderSacrificeId
            );

            pendingshadowWarderSacrificeId = null;
            shadowWarderAbsorbed = true;

            const absorbed = e === 6
                ? 'enemy critical'
                : `active elite/boss telegraph`;


            const message =
                `Shadow-Warder ${sacrificed.id} sacrificed itself ` +
                `to absorb ${absorbed}`;

            effects.push(message);
            turnEffects.push(message);
        }

                if (!enemyMiss && !shadowWarderAbsorbed) {

            /*
             * A successful Buffer cast activates its non-stacking
             * aura. DEF matters on subsequent player exchanges.
             * Base Bleed matters on this enemy response.
             */
const castingBuffer = live(s).find(
    foe =>
        foe.role === 'buffer' &&
        foe.id !== stunnedFoeId &&
        !specialistInterrupted &&
        !visorDisrupts(foe, e)
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
                        Math.floor(
                            (c.weasels.active + raised.slots) / 6
                        )
                    );
                }

                baseBleed = Math.max(
                    1,
                    baseBleed - raised.bruteReduction
                );

                baseBleed += enemyTier(lead.level) *
                    Math.max(0, frontliners.length - 1);

                const buffer = currentBuffer();
                if (buffer) {
                    baseBleed += enemyTier(buffer.level);
                }

                if (telegraphBleedMultiplier > 1) {
                    baseBleed *= telegraphBleedMultiplier;
                    effects.push(
                        'Telegraphs multiplied Base Bleed'
                    );
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
                    telegraphDestroysMeleeWeasel &&
                    actions.tansy !== 'recall'
                ) {
                    destroyWeasel(effects, 'Sweeping Cleave');

                    const splash = Math.ceil(
                        crewStats.tansyMaxHp *
                        telegraphTansySplashPercent / 100

                    );

                    backlineDamage += splash;
                    effects.push(
                        `Sweeping Cleave dealt ${splash} splash to Tansy`
                    );
                }
            }

                        for (const foe of live(s)) {
                const tier = enemyTier(foe.level);

                if (foe.id === stunnedFoeId) {
                    effects.push(
                        `${foe.id} lost its Ex1 response to Stun`
                    );
                    continue;
                }

                if (
                    specialistInterrupted &&
                    [
                        'archer',
                        'mender',
                        'hexer',
                        'buffer'
                    ].includes(foe.role)
                ) {
                    effects.push(
                        `${foe.id} was interrupted by Frost Stomp`
                    );
                    continue;
                }

                if (
                    [
                        'archer',
                        'mender',
                        'hexer',
                        'buffer'
                    ].includes(foe.role) &&
                    visorDisrupts(foe, e)
                ) {
                    effects.push(
                        `Visor disrupted ` +
                        `${foe.id}'s ${foe.role} action`
                    );
                    continue;
                }

                if (foe.role === 'archer') {
                    const amount =
                        4 * tier * (e === 6 ? 2 : 1);

                    backlineDamage += amount;
                    enemyHitCount++;

                    effects.push(
                        `${foe.id} dealt ` +
                        `${amount} damage to Tansy`
                    );
                }

                if (foe.role === 'mender') {
                    if (!bruteAlive) {
                        frontlineDamage++;
                        enemyHitCount++;

                        effects.push(
                            `${foe.id} dealt ` +
                            `1 panicked melee bleed`
                        );
                    } else {
                        const wounded = [...live(s)]
                            .filter(ally =>
                                ally.hp <
                                mobStats(
                                    ally.level,
                                    ally.role
                                ).maxHp
                            )
                            .sort((a, b) =>
                                a.hp /
                                    mobStats(
                                        a.level,
                                        a.role
                                    ).maxHp -
                                b.hp /
                                    mobStats(
                                        b.level,
                                        b.role
                                    ).maxHp
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
                                `${foe.id} healed ` +
                                `${wounded.id} for ${amount}`
                            );
                        }
                    }
                }

                if (foe.role === 'hexer') {
                    const stacks =
                        (e === 6 ? 2 : 1) +
                        telegraphExtraDebuffStacks;

                    encounter.hexStacks[foe.id] =
                        Number(
                            encounter.hexStacks[foe.id] || 0
                        ) + stacks;

                    effects.push(
                        `${foe.id} added ` +
                        `${stacks} hex stack(s)`
                    );
                }
            }

if (frontliners.length > 0) {
    const stacks =
        (e === 6 ? 2 : 1) +
        telegraphExtraDebuffStacks;

    for (const foe of eliteBossFoes) {
        if (
            foe.hp <= 0 ||
            foe.id === stunnedFoeId ||
            !foe.passive
        ) {
            continue;
        }

        if (visorDisrupts(foe, e)) {
            effects.push(
                `Visor disrupted ${foe.id}'s passive`
            );
            continue;
        }

        foe.passiveStacks =
            Number(foe.passiveStacks || 0) +
            stacks;

        effects.push(
            `${foe.id} ${foe.passive} stack ` +
            `${foe.passiveStacks}`
        );
    }
}


            if (enemyHitCount > 0) {
                for (const { foe, effect } of responseTelegraphs) {
                    if (!effect.healPerHit || foe.hp <= 0) {
                        continue;
                    }

                    const requested =
                        effect.healPerHit * enemyHitCount;
                    const healed = Math.min(
                        requested,
                        foe.maxHp - foe.hp
                    );

                    foe.hp += healed;
                    effects.push(
                        `${foe.id} Aether-Drain restored ` +
                        `${healed} HP`
                    );
                }
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
        const menderHeal = shadowMechanics(c).menderHeal;

        if (c.qtik.hp > 0) {
            c.qtik.hp = Math.max(
                0,
                Math.min(
                    crewStats.qtikMaxHp,
                    c.qtik.hp + effectiveRegen + menderHeal
                )
            );
            if (effectiveRegen < 0) {
                effects.push(
                    `Negative regeneration dealt ` +
                    `${-effectiveRegen} internal damage`
                );
            }
            if (menderHeal > 0) {
                effects.push(`Shadow-Mender healed ${menderHeal} HP`);
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
            enemyAttackAbsorbed: shadowWarderAbsorbed,
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
            maxWeasels - shadowMechanics(c).slots - activeBefore

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
    if (shadowMechanics(c).menderHeal > 0) {
        const hex = Object.keys(encounter.hexStacks || {})
            .find(id => encounter.hexStacks[id] > 0);

        if (hex) {
            encounter.hexStacks[hex] -= 1;
            if (encounter.hexStacks[hex] === 0) {
                delete encounter.hexStacks[hex];
            }
            turnEffects.push('Shadow-Mender cleansed one Hexer stack');
        } else {
            const passiveFoe =
                eliteBossFoes.find(
                    foe =>
                        Number(foe.passiveStacks || 0) > 0
                );

            if (passiveFoe) {
                passiveFoe.passiveStacks -= 1;
                turnEffects.push(
                    `Shadow-Mender cleansed one ` +
                    `${passiveFoe.id} passive stack`
                );
            }
        }
    }

    const encounterRewards = finalizeEncounterRewards(
        s,
        kills.map(kill => kill.id)
    );

    let levelUps = [];

    if (encounterRewards.resolved) {
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

    for (const foe of eliteBossFoes) {
        if (foe.hp === 0) {
            foe.nextTelegraph = null;
        }
    }

    if (live(s).length === 0) {
        encounter.status = 'cleared';
    } else if (
        eliteBossFoes.some(foe => foe.hp > 0) &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0
    ) {
        for (const foe of eliteBossFoes.filter(foe => foe.hp > 0)) {
            const telegraphSides =
                foe.role === 'boss' &&
                foe.reinforcementsCalled !== true
                    ? BOSS_TELEGRAPHS.length
                    : ELITE_TELEGRAPHS.length;

            const telegraphRoll = roll(s, telegraphSides);
            foe.nextTelegraph = chooseNextTelegraph(
                foe,
                telegraphRoll
            );
        }
    }


    c.weasels.max = 3 + Math.floor(c.level / 2);

    const finalStats = derived(c);
    c.qtik.maxHp = finalStats.qtikMaxHp;
    c.qtik.def = finalStats.def;
    c.qtik.regen = finalStats.regen;
    c.tansy.maxHp = finalStats.tansyMaxHp;

    const result = {
        ok: true,
        turn: encounter.turn,
        rolls: tape,
        flee: fleeing
            ? tape.flee
            : null,

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
            applied: encounterRewards.resolved,
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
const NORMAL_BRACKETS = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        const [low, mid, high] = ZONES[zone].levels;

        function bracket(level) {
            return {
                level,
                // Reference base XP only. Paid XP uses xpForKill().
                xpSwarm: 12 * level,
                xpMixed: 8 * level
            };
        }

        return {
            low: bracket(low),
            mid: bracket(mid),
            high: bracket(high)
        };
    }
});

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

     const autoSalvage = foes.reduce(
            (total, foe) => total + silverForKill(foe),
        0
    );


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
                icePatch: false,
                surge: false
            },
            hexStacks: {},
            exposed: 0
        },

        rewards: lockedRewards
    };
}

const ELITE_LEVELS = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        return {
            mid: Math.max(4, 5 * zone - 2),
            high: 5 * zone
        };
    }
});

const BOSS_LEVELS = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        return zone === null ? undefined : 5 * zone;
    }
});

const PASSIVES = {
    1: 'armor_sunder',
    2: 'grave_chill',
    3: 'withering_lethargy',
    4: 'serrated_bleed'
};

function spawnEncounter(test) {
    const state = clone(test.state || {});

assert(
    !state.encounter ||
    state.encounter.status === 'fled' ||
    (
        ['cleared', 'dead'].includes(state.encounter.status) &&
        state.encounter.rewards?.resolved === true
    ),
    'Cannot spawn while an encounter is active or has unresolved rewards'
);

    const requestedKind =
        test.encounterType ||
        'normal_pack';

    let kind =
        requestedKind;

    let encounterTypeRoll =
        null;

    let questTerminal =
        null;

    if (requestedKind === 'quest_terminal') {
        const activeQuest =
            state.activeQuest;

        assert(
            activeQuest &&
            activeQuest.status === 'in_progress',
            'Quest-terminal spawn requires an in-progress quest'
        );

        const lockedThreat =
            activeQuest.seed?.terminalThreat;

        assert(
            lockedThreat &&
            ['normal_pack', 'elite'].includes(
                lockedThreat.kind
            ),
            'Quest has no supported locked terminal threat'
        );

        assert(
            Number.isInteger(lockedThreat.zone) &&
            ZONES[lockedThreat.zone],
            'Quest terminal threat has an invalid zone'
        );

        assert(
            activeQuest.terminalThreat &&
            activeQuest.terminalThreat.revealed !== true &&
            activeQuest.terminalThreat.resolved !== true,
            'Quest terminal threat has already been revealed or resolved'
        );

        assert(
            test.zone === undefined ||
            test.zone === lockedThreat.zone,
            'Quest-terminal spawn zone does not match locked threat zone'
        );

        kind =
            lockedThreat.kind;

        /*
         * The quest seed, not the caller, supplies the zone and
         * encounter identity. A caller may provide a more specific
         * encounter ID, but cannot change the threat type or zone.
         */
        test = {
            ...test,
            zone: lockedThreat.zone,
            encounterId:
                test.encounterId ||
                `quest-terminal-${activeQuest.id}`
        };

        questTerminal = {
            questId: activeQuest.id,
            kind: lockedThreat.kind,
            zone: lockedThreat.zone
        };
    }

    if (requestedKind === 'wild') {
        encounterTypeRoll =
            roll(state, 100);

        const eliteChance =
            Math.min(30, 10 + test.zone);
        kind =
            encounterTypeRoll <= eliteChance
                ? 'elite'
                : 'normal_pack';
    }


    const bracketNames = [

        'low',
        'mid',
        'high'
    ];

    let spawned;

    if (kind === 'declared') {
        assert(
            Number.isInteger(test.zone) && ZONES[test.zone],
            `Unknown zone: ${test.zone}`
        );
        assert(
            Array.isArray(test.foes) && test.foes.length > 0,
            'Declared encounter needs at least one foe'
        );

        const allowed = new Set([
            'brute',
            'archer',
            'mender',
            'hexer',
            'buffer',
            'elite',
            'boss'
        ]);

        const id = test.encounterId || `declared-z${test.zone}`;

        const foes = test.foes.map((entry, index) => {
            assert(
                entry && allowed.has(entry.role),
                `Unsupported declared foe role at index ${index}`
            );

            int(
                entry.level,
                `foes[${index}].level`,
                1
            );

            const foe = createFoe({
                id: `${id}-${entry.role}-${index + 1}`,
                level: entry.level,
                role: entry.role
            });

            if (
                entry.role === 'elite' ||
                entry.role === 'boss'
            ) {
                const passiveRoll = roll(state, 4);

                foe.passive = PASSIVES[passiveRoll];
                foe.passiveRoll = passiveRoll;
                foe.passiveStacks = 0;
                foe.nextTelegraph = null;

                if (entry.role === 'boss') {
                    foe.reinforcementsCalled = false;
                }
            }

            return foe;

        });

        const rewards = {
            kind: 'declared',
            resolved: false,
            guaranteedGear: foes
                .filter(foe =>
                    foe.role === 'elite' ||
                    foe.role === 'boss'
                )
                .map(foe => ({
                    foeId: foe.id,
                    source: foe.role,
                    rawStat:
                        ZONES[test.zone].base +
                        (
                            foe.role === 'elite'
                                ? 1
                                : 5
                        ),
                    pawnSilver:
                        2 * (
                            ZONES[test.zone].base +
                            (
                                foe.role === 'elite'
                                    ? 1
                                    : 5
                            )
                        )
                }))
        };

        spawned = {
            ok: true,
            encounter: {
                id,
                status: 'active',
                turn: 0,
                zone: test.zone,
                type: 'declared',
                enemyTier: ZONES[test.zone].tier,
                foes,
                packDropRoll: null,
                curiosityRoll: null,
                rumorRoll: null,
                lootSeed: null,
                questSeed: null,
                rewards,
                used: { stun: false, icePatch: false, surge: false },
                hexStacks: {},
                exposed: 0
            },
            rewards
        };
    } else if (kind === 'normal_pack') {

        const bracketRoll =
            roll(state, bracketNames.length);

        const compositionRoll =
            roll(state, 6);

        const bracket =
            bracketNames[bracketRoll - 1];

        spawned = spawnNormalPack({
            zone: test.zone,
            bracket,
            composition: compositionRoll,
            encounterId:
                test.encounterId ||
                `normal-pack-z${test.zone}`
        });

        spawned.encounter.composition =
            compositionRoll;
        spawned.encounter.spawnRolls = {
            encounterTypeRoll,
            bracketRoll,
            compositionRoll
        };

    } else {
        assert(
            ZONES[test.zone],
            `Unknown zone: ${test.zone}`
        );

        assert(
            kind === 'elite' ||
            kind === 'boss',
            `Unsupported encounter type: ${kind}`
        );

        const passiveRoll =
            roll(state, 4);

        const passive =
            PASSIVES[passiveRoll];

        let level;
        let bracket = null;
        let bracketRoll = null;

        if (kind === 'elite') {
            bracketRoll =
                roll(state, 2);

            bracket =
                bracketRoll === 1
                    ? 'mid'
                    : 'high';

            level =
                ELITE_LEVELS[test.zone][bracket];
        } else {
            level =
                BOSS_LEVELS[test.zone];
        }

        const id =
            test.encounterId ||
            `${kind}-z${test.zone}`;

        const foe = {
            ...createFoe({
                id: `${id}-${kind}`,
                level,
                role: kind
            }),
            passive,
            passiveStacks: 0,
            nextTelegraph: null,
            reinforcementsCalled:
                kind === 'boss'
                    ? false
                    : undefined
        };

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
            resolved: false
        };

        spawned = {
            ok: true,
            encounter: {
                id,
                status: 'active',
                turn: 0,
                zone: test.zone,
                type: kind,
                bracket,
                enemyTier: enemyTier(level),
                foes: [foe],

                packDropRoll: null,
                curiosityRoll: null,
                rumorRoll: null,
                lootSeed: null,
                questSeed: null,

                rewards: encounterRewards,

                used: {
                    stun: false,
                    icePatch: false,
                    surge: false
                },
                hexStacks: {},
                exposed: 0,

                spawnRolls: {
                    encounterTypeRoll,
                    passiveRoll,
                    bracketRoll
                }

            },
            rewards: encounterRewards
        };
    }

    if (questTerminal) {
        const activeQuest =
            state.activeQuest;

        const encounterId =
            spawned.encounter.id;

        activeQuest.terminalThreat.revealed = true;
        activeQuest.terminalThreat.resolved = false;
        activeQuest.terminalThreat.encounterId =
            encounterId;

        activeQuest.seed.terminalThreat.encounterId =
            encounterId;

        spawned.encounter.questTerminal = {
            questId: questTerminal.questId,
            kind: questTerminal.kind,
            zone: questTerminal.zone
        };
    }
    assert(
    state.crew?.qtik &&
    state.crew?.tansy &&
    state.crew?.weasels &&
    state.crew?.gear?.tansy &&
    state.crew?.gear?.qtik &&
    state.inventory &&
    typeof state.inventory === 'object',
    'Spawn requires complete crew and inventory state'
);

state.zone = test.zone;
state.encounter = spawned.encounter;
validate(state);

    return {

        ...spawned,
        rngState: state.rngState,
        state
    };
}

const QUEST_REWARD_TABLES = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        const base = ZONES[zone].base;
        const unit = 100 * zone - 40;

        function reward(
            rank, gates, multiplier, repSteps, rarity, stat
        ) {
            const xp = unit * multiplier;

            return {
                rank,
                gates,
                xp,
                silver: xp / 10,
                repSteps,
                salvageRarity: rarity,
                salvageStat: stat
            };
        }

        return {
            low: [
                reward('F', 1, 1, 1, 'common', base),
                reward('E', 1, 1.5, 1, 'common', base),
                reward(
                    'D', zone <= 2 ? 1 : 2,
                    3, 2, 'uncommon', base + 1
                )
            ],
            high: [
                reward('D', 2, 3, 2, 'uncommon', base + 1),
                reward(
                    'C', zone === 1 ? 2 : 3,
                    5, 2, 'uncommon', base + 1
                ),
                reward(
                    'B', zone <= 2 ? 3 : 4,
                    9, 2, 'rare', base + 3
                )
            ]
        };
    }
});

const QUEST_PROGRESSION = {
    F: { minGates: 1, maxGates: 2, xpFraction: 0.05 },
    E: { minGates: 2, maxGates: 3, xpFraction: 0.08 },
    D: { minGates: 2, maxGates: 3, xpFraction: 0.14 },
    C: { minGates: 3, maxGates: 4, xpFraction: 0.22 },
    B: { minGates: 4, maxGates: 5, xpFraction: 0.32 }
};

const EXTRA_QUEST_GATE_XP_FRACTION = 0.02;
const MAX_EXTRA_QUEST_GATE_XP_FRACTION = 0.06;

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
function rollQuestTerminalThreat(state, rank, zone) {
    assert(
        ZONES[zone],
        `Unknown quest threat zone: ${zone}`
    );

    let terminalThreatRoll = null;
    let kind;

    if (rank === 'F' || rank === 'E') {
        kind = 'normal_pack';
    } else if (rank === 'D' || rank === 'C') {
        terminalThreatRoll = roll(state, 2);

        kind =
            terminalThreatRoll === 1
                ? 'normal_pack'
                : 'elite';
    } else if (rank === 'B') {
        kind = 'elite';
    } else {
        throw new Error(
            `Unsupported quest terminal-threat rank: ${rank}`
        );
    }

    return {
        kind,
        zone,
        roll: terminalThreatRoll
    };
}

function resolveQuestSeed(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'quest requires state'
    );

    const state = clone(test.state);

    state.inquiries ||= {};

    const zone =
        test.zone ?? state.zone;


    assert(
        Number.isInteger(zone) && ZONES[zone],
        `Unknown zone: ${zone}`
    );

    const rep =
        normalizeQuestRepTier(test.repTier);

    const inquiryRecord = test.inquiryId === undefined
        ? null
        : state.inquiries?.[`rumor:${test.inquiryId}`];

    if (inquiryRecord) {
        assert(
            zone === inquiryRecord.zone,
            'Quest zone does not match locked rumor inquiry'
        );
    }

    assert(
        test.inquiryId === undefined || inquiryRecord,
        'Unknown locked rumor inquiry'
    );

    const trigger = inquiryRecord || state.encounter;
    assert(
    trigger && typeof trigger === 'object',
    'Quest offer requires an encounter or rumor inquiry'
    );

    const sourceSeed = trigger.questSeed;

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

    const existing =
        state.activeQuest;

    /*
     * An offered or in-progress quest is already locked. Return it
     * without consuming RNG or generating a new rank/salvage result.
     */
    if (
        existing &&
        ['offered', 'in_progress'].includes(existing.status)
    ) {
        return {
            ok: true,
            created: false,
            quest: existing,
            state
        };
    }

    /*
     * The current encounter's trigger can produce only one offer.
     * A later encounter may provide a fresh trigger after this
     * quest is declined or completed.
     */
    assert(
    trigger.questSeedConsumed !== true,
        'This quest trigger was already consumed'
    );

    const questRoll =
        roll(state, 3);

    const gateCountRoll =
        roll(state, 2);

    const salvageSlotRoll =
        roll(state, QUEST_SALVAGE_SLOTS.length);

    const table =
        QUEST_REWARD_TABLES[zone][rep.band];

    const row =
        table[questRoll - 1];

    assert(
        row,
        'No quest table entry exists for these inputs'
    );

    const progression =
        QUEST_PROGRESSION[row.rank];

    assert(
        progression,
        `No quest progression settings for rank ${row.rank}`
    );

    const gates =
        progression.minGates +
        (
            gateCountRoll === 2 &&
            progression.maxGates > progression.minGates
                ? 1
                : 0
        );

    const nextLevelXp =
        nextXp(state.crew.level);

    const extraGateFraction = Math.min(
        MAX_EXTRA_QUEST_GATE_XP_FRACTION,
        Math.max(
            0,
            gates - progression.minGates
        ) * EXTRA_QUEST_GATE_XP_FRACTION
    );

    const questXp = Math.round(
        nextLevelXp *
        (progression.xpFraction + extraGateFraction)
    );

    const terminalThreat =
        rollQuestTerminalThreat(
            state,
            row.rank,
            zone
        );

    const salvage =
        makeQuestSalvage(
            zone,
            salvageSlotRoll,
            row
        );

    const seed = {
        zone,
        repTier: rep.label,
        questRoll,
        gateCountRoll,
        salvageSlotRoll,
        source: sourceSeed.source,
        sourceRoll: sourceSeed.roll,
        sourceResult: sourceSeed.result,
        terminalThreat: {
            kind: terminalThreat.kind,
            zone: terminalThreat.zone,
            roll: terminalThreat.roll
        }
    };

    const tier =
        ZONES[zone].tier;

    const quest = {
        id:
            `quest-${inquiryRecord
                ? `rumor-${inquiryRecord.id}`
                : state.encounter.id}-` +
            `${row.rank}-${questRoll}`,
        title:
            `Rank ${row.rank} ${QUEST_RANK_LABELS[row.rank]}`,
        rank: row.rank,
        gates,
        status: 'offered',
        seed,

        /*
         * The model writes the scene-specific truth and objective.
         * Future gates are intentionally not generated here.
         */
        coreTruth: null,
        currentGate: {
            step: 1,
            total: gates,
            mode:
                gates === 1
                    ? 'arrival_warmup'
                    : 'traversal_discovery',
            objective: null
        },

        payout: {
            xp: questXp,
            silver: row.silver,
            repSteps: row.repSteps,
            xpBasis: nextLevelXp,
            baseXpFraction: progression.xpFraction,
            extraGateXpFraction: extraGateFraction
        },

               salvage,

        /*
         * This is locked now but may remain hidden in the diegetic
         * contract presentation until the crew reaches the objective.
         */
        terminalThreat: {
            kind: terminalThreat.kind,
            zone: terminalThreat.zone,
            revealed: false,
            resolved: false
        },

        town:
            test.town ||
            null,


        repTierAtOffer:
            rep.label
    };

    state.activeQuest =
        quest;
        trigger.questSeedConsumed = true;

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

    if (quest.terminalThreat) {
        quest.terminalThreat.resolved = true;
    }

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

        const tierOrder = [
            'Unknown',
            'Slightly Known',
            'Known',
            'Well Respected',
            'Renowned'
        ];

        const rep = state.reputation[town];
        let rung = tierOrder.indexOf(rep.tier);

        assert(
            rung >= 0,
            `Unknown reputation tier: ${rep.tier}`
        );
        int(rep.steps, `${town} reputation steps`);
        assert(
            rep.steps < 2 || rung === tierOrder.length - 1,
            `${town} reputation steps must be 0 or 1`
        );

        let steps = rep.steps + payout.repSteps;

        while (steps >= 2 && rung < tierOrder.length - 1) {
            steps -= 2;
            rung++;
        }

        rep.tier = tierOrder[rung];
        rep.steps =
            rung === tierOrder.length - 1 ? 0 : steps;
    }
    result.levelUps =
        applyXp(
            state.crew,
            payout.xp
        );

    state.crew.purse +=
        payout.silver;

    return result;
}

function resolveGearGrant(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'Gear grant requires state'
    );

    const state = clone(test.state);

    state.inventory ||= {};
    state.inventory.bagReserves ||= [];
    state.inventory.activeTradeListings ||= [];
    state.gearGrantIds ||= {};

    assert(
        Array.isArray(state.inventory.bagReserves) &&
        Array.isArray(state.inventory.activeTradeListings),
        'Gear grant inventory is invalid'
    );

    assert(
        state.gearGrantIds &&
        typeof state.gearGrantIds === 'object' &&
        !Array.isArray(state.gearGrantIds),
        'state.gearGrantIds must be an object'
    );

    assert(
        typeof test.grantId === 'string' &&
        test.grantId.trim().length > 0,
        'Gear grant requires grantId'
    );

    assert(
        [
            'npc_gift',
            'exploration',
            'migration',
            'manual_correction'
        ].includes(test.grantSource),
        `Unsupported gear grant source: ${test.grantSource}`
    );

    assert(
        test.grantSource === 'migration' ||
        (
            typeof test.sourceName === 'string' &&
            test.sourceName.trim().length > 0
        ),
        'Non-migration gear grants require sourceName'
    );

    assert(
        typeof test.reason === 'string' &&
        test.reason.trim().length > 0,
        'Gear grants require a reason'
    );

    const grantId = test.grantId.trim();

    const alreadyGranted =
        state.gearGrantIds[grantId] === true ||
        state.inventory.bagReserves.some(
            item => item.acquiredByGrantId === grantId
        ) ||
        state.inventory.activeTradeListings.some(
            item => item.acquiredByGrantId === grantId
        ) ||
        Object.values(state.crew?.gear || {})
            .some(ownerGear =>
                Object.values(ownerGear || {})
                    .some(item =>
                        item?.acquiredByGrantId === grantId
                    )
            );

    assert(
        !alreadyGranted,
        `Gear grant ${grantId} has already been applied`
    );

    const item = test.gearItem;

    assert(
        item &&
        typeof item === 'object' &&
        !Array.isArray(item),
        'Gear grant requires gearItem'
    );

    assert(
        typeof item.name === 'string' &&
        item.name.trim().length > 0,
        'Gear grant item requires a name'
    );

    assert(
        Number.isInteger(item.rawStat) &&
        item.rawStat > 0,
        'Gear grant item requires a positive rawStat'
    );

    assert(
        item.bound !== true,
        'Gear grants enter Bag Reserves unbound; equip the item to bind it'
    );

    const usableOwners = ['tansy', 'qtik'];

    if (item.classRestricted === true) {
        assert(
            item.owner === null ||
            item.owner === undefined,
            'Class-restricted gear cannot have a crew owner'
        );

        assert(
            item.tradeStreamEligible !== true,
            'Class-restricted gear cannot be Trade-Stream eligible'
        );
    } else {
        assert(
            usableOwners.includes(item.owner),
            'Usable gear grant requires owner tansy or qtik'
        );
    }

    if (item.owner === 'tansy') {
        assert(
            TANSY_SLOTS.includes(item.slot),
            `Invalid Tansy gear slot: ${item.slot}`
        );

        if (MODULAR_TANSY.has(item.slot)) {
            assert(
                ['vitality', 'luck'].includes(item.variant),
                `Tansy ${item.slot} requires vitality or luck variant`
            );
        } else {
            assert(
                item.variant === null ||
                item.variant === undefined,
                `Tansy ${item.slot} does not use a tuning variant`
            );
        }
    }

    if (item.owner === 'qtik') {
        assert(
            QTIK_SLOTS.includes(item.slot),
            `Invalid Q'tik gear slot: ${item.slot}`
        );

        assert(
            ['vitality', 'bulwark'].includes(item.variant),
            `Q'tik ${item.slot} requires vitality or bulwark variant`
        );
    }

    assert(
        LOOT_RARITY_INFO[
            String(item.rarity || '').toLowerCase()
        ],
        `Unsupported gear rarity: ${item.rarity}`
    );

    const normalizedRarity =
        LOOT_RARITY_INFO[
            String(item.rarity).toLowerCase()
        ];

    const classRestricted =
        item.classRestricted === true;

    const stored = {
        name: item.name,
        owner: classRestricted ? null : item.owner,
        slot: item.slot || null,
        variant: item.variant ?? null,
        rarity: normalizedRarity.label,
        rarityColor: normalizedRarity.color,
        rawStat: item.rawStat,
        bound: false,
        classRestricted,
        tradeStreamEligible: classRestricted
            ? false
            : item.tradeStreamEligible !== false,
        sellValue: item.rawStat * 2,
        bonus: lootBonus(
            classRestricted ? null : item.owner,
            classRestricted ? null : item.slot,
            classRestricted ? null : item.variant,
            item.rawStat
        ),
        acquiredFrom: test.grantSource,
        acquiredFromName: test.sourceName || null,
        acquiredByGrantId: grantId,
        grantReason: test.reason
    };

    state.inventory.bagReserves.push(stored);
    state.gearGrantIds[grantId] = true;

    return {
        ok: true,
        action: 'grant',
        grantId,
        grantSource: test.grantSource,
        item: stored,
        state
    };
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
        ...item,
        stat: item.rawStat,
        bound: true,
        classRestricted: false,
        tradeStreamEligible: false
    };


    /*
     * Remove the selected reserve item before adding the replaced item,
     * so the returned bag index cannot accidentally refer to the new copy.
     */
    state.inventory.bagReserves.splice(itemIndex, 1);

if (oldItem && Number(oldItem.stat) > 0) {
    state.inventory.bagReserves.push({
        ...oldItem,
        name: oldItem.name || 'Replaced gear',
        owner: item.owner,
        slot: item.slot,
        rawStat: oldItem.stat,
        bound: Boolean(oldItem.bound),
        classRestricted: false,
        tradeStreamEligible: oldItem.bound !== true,
        sellValue: oldItem.sellValue ?? 2 * oldItem.stat,
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
    state.crew.purse = Number(state.crew.purse || 0);
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

        const pawnValue = item.rawStat * 2;

        state.inventory.bagReserves.splice(
            test.itemIndex,
            1
        );

        state.crew.purse += pawnValue;

        result.silverGained = pawnValue;
        result.pawnValue = pawnValue;
        result.item = item;

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

        const tradeStat =
            Number(item.tradeStat || item.rawStat);

        assert(
            Number.isInteger(tradeStat) &&
            tradeStat > 0,
            'Listed item needs a positive trade value'
        );

        const tradeRoll = roll(state, 6);
        const buyerRoll = roll(state, 6);
        const rarity =
            String(item.rarity || 'Common').toLowerCase();

        let multiplier;
        let saleStatus;
        let marketResult;

        if (tradeRoll === 1) {
            saleStatus = 'unsold';
            marketResult = 'lowball_trolls';
            multiplier = 0;
        } else {
            saleStatus = 'sold';

            if (tradeRoll === 2) {
                marketResult = 'standard_market';
                multiplier =
                    rarity === 'common' ? 5 :
                    rarity === 'uncommon' ? 8 :
                    15;
            } else if (tradeRoll === 3) {
                marketResult = 'standard_market';
                multiplier =
                    rarity === 'common' ? 6 :
                    rarity === 'uncommon' ? 9 :
                    18;
            } else if (tradeRoll === 4) {
                marketResult = 'guild_bulk_buyer';
                multiplier =
                    rarity === 'common' ? 7 :
                    rarity === 'uncommon' ? 11 :
                    20;
            } else if (tradeRoll === 5) {
                marketResult = 'bidding_war';
                multiplier =
                    rarity === 'common' ? 9 :
                    rarity === 'uncommon' ? 13 :
                    25;
            } else {
                marketResult = 'whale_collector_buyout';
                multiplier =
                    rarity === 'common' ? 12 :
                    rarity === 'uncommon' ? 16 :
                    35;
            }
        }

        const buyers = {
            1: 'Sweaty Min-Maxer',
            2: 'Roleplayer in Fancy Cloak',
            3: 'Guild Logistics Mule',
            4: 'Nervous Lowbie',
            5: 'Over-Geared Alt',
            6: 'Crafter Looking for Scrap'
        };

        const listingId =
            test.listingId ||
            `listing-${Date.now()}-${state.inventory.activeTradeListings.length + 1}`;

        const lockedListing = {
            ...item,
            listingId,
            listedAt: test.listedAt || null,

            /*
             * This result is locked at listing time. Settlement reveals
             * it later and does not accept or generate a new trade roll.
             */
            lockedSale: {
                status: saleStatus,
                result: marketResult,
                tradeRoll: tradeRoll,
                buyer: buyers[buyerRoll],
                buyerRoll: buyerRoll,
                tradeStat,
                multiplier,
                proceeds:
                    saleStatus === 'sold'
                        ? tradeStat * multiplier
                        : 0,
                revealed: false
            }
        };

        state.inventory.bagReserves.splice(
            test.itemIndex,
            1
        );

        state.inventory.activeTradeListings.push(
            lockedListing
        );

        result.item = {
            name: lockedListing.name,
            listingId,
            locked: true
        };

        result.status = 'listed';

        return result;
    }

    int(test.listingIndex, 'listingIndex', 0);

    assert(
        test.listingIndex <
        state.inventory.activeTradeListings.length,
        `No active listing at index ${test.listingIndex}`
    );

    const listing =
        state.inventory.activeTradeListings[test.listingIndex];

    assert(
        listing &&
        listing.bound !== true,
        'Bound gear cannot be settled through Trade-Stream'
    );

    assert(
        listing.lockedSale &&
        ['sold', 'unsold'].includes(listing.lockedSale.status),
        'Listing has no locked sale result'
    );

    const lockedSale =
        listing.lockedSale;

    assert(
        lockedSale.revealed !== true,
        'Trade-Stream listing has already been settled'
    );

    lockedSale.revealed = true;
    result.item = listing;

    state.inventory.activeTradeListings.splice(
        test.listingIndex,
        1
    );

    if (lockedSale.status === 'unsold') {
        delete listing.lockedSale;
        delete listing.listingId;
        delete listing.listedAt;

        state.inventory.bagReserves.push(listing);

        result.status = 'unsold';
        result.silverGained = 0;
        result.returnedToBag = true;

        return result;
    }

    const proceeds =
        Number(lockedSale.proceeds);

    assert(
        Number.isInteger(proceeds) && proceeds >= 0,
        'Locked Trade-Stream proceeds are invalid'
    );

    result.status = 'sold';
    result.silverGained = proceeds;
    result.multiplier = lockedSale.multiplier;
    result.buyer = lockedSale.buyer;
    result.marketResult = lockedSale.result;

    state.crew.purse += proceeds;

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
function resolveXpAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object' &&
        test.state.crew,
        'XP action requires state.crew'
    );

    assert(
        ['grant', 'remove'].includes(test.action),
        `Unsupported XP action: ${test.action}`
    );

    int(test.amount, 'XP amount', 1);

    assert(
        typeof test.reason === 'string' &&
        test.reason.trim(),
        'XP adjustment requires a reason'
    );

    const state = clone(test.state);
    const crew = state.crew;
    const levelBefore = int(crew.level, 'crew.level', 1);
    const xpBefore = int(crew.xp, 'crew.xp');

    assert(
        xpBefore < nextXp(levelBefore),
        'Current XP must be below the next-level threshold'
    );

    let levelUps = [];

    if (test.action === 'grant') {
        levelUps = applyXp(crew, test.amount);
    } else {
        assert(
            test.amount <= crew.xp,
            'Cannot remove more XP than remains in the current level; level-down correction is not implemented'
        );

        crew.xp -= test.amount;
    }

    return {
        ok: true,
        action: test.action,
        amount: test.amount,
        reason: test.reason,
        levelBefore,
        levelAfter: crew.level,
        xpBefore,
        xpAfter: crew.xp,
        levelUps,
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
    const allowedActions = [
        'stock', 'buy', 'sell', 'grant', 'remove', 'use'
    ];

    assert(
        allowedActions.includes(test.action),
        `Unsupported consumable action: ${test.action}`
    );

    if (test.action === 'stock') {
        return {
            ok: true,
            action: 'stock',
            catalog: Object.entries(CONSUMABLE_CATALOG).map(
                ([id, item]) => ({
                    id,
                    name: item.name,
                    type: item.type,
                    heal: item.heal || 0,
                    buyPrice: item.buyPrice,
                    sellPrice: item.sellPrice
                })
            )
        };
    }

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
    if (test.action === 'use') {
        assert(
            state.encounter?.status !== 'active',
            'Outside-combat use is unavailable during an active fight; use a combat drink action'
        );

        const quantity = test.quantity === undefined
            ? 1
            : int(test.quantity, 'quantity', 1);

        const entry = state.inventory.consumables.find(
            entry => entry.id === test.item
        );

        assert(
            entry && entry.quantity >= quantity,
            `Not enough ${test.item} in shared stock`
        );

        const recipient = test.recipient || null;

        assert(
            recipient === null ||
            recipient === 'qtik' ||
            recipient === 'tansy',
            'Recipient must be qtik, tansy, or omitted for someone outside the crew'
        );

        let healing = 0;

        if (recipient) {
            assert(
                state.crew[recipient] &&
                Number.isInteger(state.crew[recipient].hp),
                `Missing ${recipient} HP`
            );

            if (definition.heal) {
                const stats = derived(state.crew);
                const maxHp = recipient === 'qtik'
                    ? stats.qtikMaxHp
                    : stats.tansyMaxHp;
                const beforeHp = state.crew[recipient].hp;

                state.crew[recipient].hp = Math.min(
                    maxHp,
                    beforeHp + definition.heal * quantity
                );

                healing = state.crew[recipient].hp - beforeHp;
            }
        }

        entry.quantity -= quantity;

        if (entry.quantity === 0) {
            state.inventory.consumables =
                state.inventory.consumables.filter(
                    other => other.id !== test.item
                );
        }

        result.quantity = quantity;
        result.itemName = definition.name;
        result.recipient = recipient;
        result.healing = healing;
        result.reason = test.reason || null;
        result.stockAfter =
            state.inventory.consumables.find(
                other => other.id === test.item
            )?.quantity || 0;

        return result;
    }

     const quantity = test.quantity === undefined
        ? 1
        : int(test.quantity, 'quantity', 1);

    if (test.action === 'grant') {
        assert(
            typeof test.reason === 'string' && test.reason.trim(),
            'Grant requires a reason'
        );

        let entry = state.inventory.consumables.find(
            entry => entry.id === test.item
        );

        if (!entry) {
            entry = {
                id: test.item,
                name: definition.name,
                type: definition.type,
                quantity: 0
            };
            state.inventory.consumables.push(entry);
        }

        entry.quantity += quantity;
    } else {
        assert(
            typeof test.reason === 'string' && test.reason.trim(),
            'Removal requires a reason'
        );

        const entry = state.inventory.consumables.find(
            entry => entry.id === test.item
        );
        assert(
            entry && entry.quantity >= quantity,
            `Not enough ${test.item} in shared stock`
        );

        entry.quantity -= quantity;
        if (entry.quantity === 0) {
            state.inventory.consumables =
                state.inventory.consumables.filter(
                    other => other.id !== test.item
                );
        }
    }

    result.quantity = quantity;
    result.reason = test.reason;
    result.itemName = definition.name;
    result.stockAfter = state.inventory.consumables.find(
        entry => entry.id === test.item
    )?.quantity || 0;

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
function resolveBossGearCheck(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'boss_check requires state'
    );

    const state = clone(test.state);
    const encounter = state.encounter;

    assert(
        encounter &&
        ['active', 'cleared'].includes(encounter.status),
        'boss_check requires an active encounter'
    );

    const boss = live(state).find(
        foe => foe.role === 'boss'
    );

    assert(
        boss,
        'Encounter has no living Boss'
    );

    const crewStats = derived(state.crew);
    const effectiveCrewAtk = crewStats.atk;

    return {
        ok: true,
        encounterId: encounter.id,
        boss: {
            id: boss.id,
            level: boss.level,
            hp: boss.hp,
            def: boss.def
        },
        effectiveCrewAtk,
        gearCheckFailed: effectiveCrewAtk <= boss.def,
        combatAllowed: effectiveCrewAtk > boss.def,
        state
    };
}

function resolveFleeRoll(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'flee requires state'
    );

    const state = clone(test.state);
    const encounter = state.encounter;

    assert(
        encounter &&
        encounter.status === 'active',
        'flee requires state.encounter to be active'
    );

    const crewStats =
        derived(state.crew);

    const rollValue =
        roll(state, 6);

    const lukBonus =
        Math.min(
            3,
            Math.floor(crewStats.luk / 5)
        );

    const total =
        rollValue + lukBonus;

    const threshold = 6;
    const success = total >= threshold;

    encounter.fleeAttempts =
        Number(encounter.fleeAttempts || 0) + 1;

    if (success) {
        encounter.status = 'fled';
        encounter.fledOnAttempt =
            encounter.fleeAttempts;
    }

    return {
        ok: true,
        action: 'flee',
        roll: rollValue,
        lukBonus,
        total,
        threshold,
        success,
        enemyResponseResolved: false,
        note: success
            ? 'Encounter fled successfully'
            : 'Flee failed',
        rewards: {
            xp: 0,
            silver: 0,
            loot: []
        },
        state
    };
}

function resolveDeathPenalty(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'death penalty requires state'
    );

    const state = clone(test.state);
        assert(
        state.encounter?.status === 'active' &&
        state.encounter.deathResolved !== true,
        'Death requires an active, unresolved encounter'
    );

    assert(
        state.crew?.qtik?.hp === 0 ||
        state.crew?.tansy?.hp === 0,
        'Death requires a protagonist at 0 HP'
    );

    assert(
        state.crew &&
        typeof state.crew === 'object',
        'death penalty requires state.crew'
    );

    assert(
        state.crew.qtik &&
        state.crew.tansy,
        'Death resolution requires both protagonists'
    );

    const level =
        int(state.crew.level, 'crew.level', 1);

    const xpBefore =
        int(state.crew.xp, 'crew.xp');

    const threshold =
        nextXp(level);

    assert(
        xpBefore < threshold,
        'crew.xp must be below the next-level threshold'
    );

    const requestedPenalty =
        Math.floor(threshold / 10);

    const xpLost =
        Math.min(xpBefore, requestedPenalty);

    state.crew.xp =
        xpBefore - xpLost;

    const stats =
        derived(state.crew);

    state.crew.qtik.hp =
        stats.qtikMaxHp;

    state.crew.tansy.hp =
        stats.tansyMaxHp;

    state.crew.qtik.maxHp =
        stats.qtikMaxHp;

    state.crew.qtik.def =
        stats.def;

    state.crew.qtik.regen =
        stats.regen;

    state.crew.tansy.maxHp =
        stats.tansyMaxHp;

    const encounter =
        state.encounter || null;

    if (encounter) {
        encounter.status = 'dead';
        encounter.deathResolved = true;
        encounter.rewards ||= {
            xp: 0,
            silver: 0,
            loot: []
        };
        encounter.rewards.resolved = true;
    }

    return {
        ok: true,
        action: 'death',
        level,
        nextXp: threshold,
        xpBefore,
        requestedPenalty,
        xpLost,
        xpAfter: state.crew.xp,
        respawned: true,
        respawnStone:
            state.respawnStone || null,
        encounterAbandoned: Boolean(encounter),
        rewards: {
            xp: 0,
            silver: 0,
            loot: []
        },
        state
    };
}

function resolveShadowDeckAction(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Shadow deck action requires state'
    );

    const state = clone(test.state);

    state.crew ||= {};
    state.crew.weasels ||= {
        active: 0,
        max: 3 + Math.floor((state.crew.level || 1) / 2)
    };
    state.crew.shadows ||= {
        deck: [],
        active: []
    };

    state.crew.shadows.deck ||= [];
    state.crew.shadows.active ||= [];

    assert(
        Array.isArray(state.crew.shadows.deck),
        'Shadow deck must be an array'
    );

    assert(
        Array.isArray(state.crew.shadows.active),
        'Active shadows must be an array'
    );

    assert(
        [
            'record',
            'replace',
            'remove',
            'activate',
            'deactivate'
        ].includes(test.action),
        `Unsupported shadow deck action: ${test.action}`
    );

    const allowedTypes = [
        'archer',
        'mender',
        'hexer',
        'warder'
    ];

    const deck = state.crew.shadows.deck;
    const active = state.crew.shadows.active;

    function validateShadow(shadow) {
        assert(
            shadow &&
            typeof shadow.id === 'string' &&
            shadow.id.length > 0,
            'Shadow requires a non-empty ID'
        );

        assert(
            allowedTypes.includes(shadow.type),
            `Unsupported shadow type: ${shadow.type}`
        );

        int(
            shadow.sourceMobLevel,
            'shadow.sourceMobLevel',
            1
        );

        return {
            ...shadow,
            shadowTier:
                1 + Math.floor(shadow.sourceMobLevel / 10)
        };
    }

    function activeSlotCount() {
        return active.reduce(
            (total, shadow) => total + 3 * shadow.count,
            0
        );
    }

    if (test.action === 'record') {
        assert(
            typeof test.shadowId === 'string' &&
            test.shadowId.length > 0,
            'Recording a shadow requires shadowId'
        );

        assert(
            allowedTypes.includes(test.shadowType),
            `Unsupported shadow type: ${test.shadowType}`
        );

        int(
            test.sourceMobLevel,
            'sourceMobLevel',
            1
        );

        assert(
            !deck.some(shadow => shadow.id === test.shadowId),
            `Shadow ${test.shadowId} is already in the deck`
        );

        const shadow = validateShadow({
            id: test.shadowId,
            type: test.shadowType,
            sourceMobLevel: test.sourceMobLevel,
            capturedFrom: test.sourceMobName || null
        });

        deck.push(shadow);

        return {
            ok: true,
            action: 'record',
            shadow,
            state
        };
    }

    assert(
        typeof test.shadowId === 'string' &&
        test.shadowId.length > 0,
        `${test.action} requires shadowId`
    );

    const shadowIndex =
        deck.findIndex(shadow => shadow.id === test.shadowId);

    assert(
        shadowIndex >= 0,
        `Shadow ${test.shadowId} is not in the deck`
    );

    const shadow =
        validateShadow(deck[shadowIndex]);

    if (test.action === 'replace') {
        assert(
            !active.some(entry => entry.id === test.shadowId),
            'Cannot replace an active shadow; deactivate it first'
        );

        assert(
            allowedTypes.includes(test.shadowType),
            `Unsupported replacement type: ${test.shadowType}`
        );

        int(test.sourceMobLevel, 'sourceMobLevel', 1);

        const previous = deck[shadowIndex];

        const replacement = validateShadow({
            id: test.shadowId,
            type: test.shadowType,
            sourceMobLevel: test.sourceMobLevel,
            capturedFrom: test.sourceMobName || null
        });

        deck[shadowIndex] = replacement;

        return {
            ok: true,
            action: 'replace',
            previous,
            shadow: replacement,
            state
        };
    }

    if (test.action === 'remove') {
        assert(
            !active.some(entry => entry.id === test.shadowId),
            'Cannot remove an active shadow from the deck'
        );

        const [removed] = deck.splice(shadowIndex, 1);

        return {
            ok: true,
            action: 'remove',
            shadow: removed,
            state
        };
    }

    if (test.action === 'deactivate') {
        const activeIndex =
            active.findIndex(entry => entry.id === test.shadowId);

        assert(
            activeIndex >= 0,
            `Shadow ${test.shadowId} is not active`
        );

        const [deactivated] =
            active.splice(activeIndex, 1);

        return {
            ok: true,
            action: 'deactivate',
            shadow: deactivated,
            shadowSlotsReleased: 3 * deactivated.count,
            state
        };
    }

    const requestedCount =
        test.count === undefined
            ? 1
            : int(test.count, 'count', 1);

    if (shadow.type !== 'archer') {
        assert(
            requestedCount === 1,
            'Only Shadow Archers may have multiple active copies'
        );

        assert(
            !active.some(entry => entry.type === shadow.type),
            `Only one active Shadow ${shadow.type[0].toUpperCase() + shadow.type.slice(1)} is allowed`
        );
    }

    const currentCount =
        active
            .filter(entry => entry.id === shadow.id)
            .reduce((total, entry) => total + entry.count, 0);

    const additionalCount =
        requestedCount - currentCount;

    assert(
        additionalCount > 0,
        `Shadow ${shadow.id} is already active at that count`
    );

    const totalSlots =
        3 + Math.floor(state.crew.level / 2);

    const occupiedBefore =
        Number(state.crew.weasels.active) +
        activeSlotCount();

    assert(
        occupiedBefore <= totalSlots,
        'Active summons exceed total summon slots'
    );

    const slotsNeeded = additionalCount * 3;
    const freeSlots = totalSlots - occupiedBefore;
    const weaselsToFuse = Math.max(0, slotsNeeded - freeSlots);

    assert(
        state.crew.weasels.active >= weaselsToFuse,
        `Not enough summon slots: need ${slotsNeeded}, ` +
        `have ${freeSlots} free and ` +
        `${state.crew.weasels.active} weasels available to fuse`
    );

    state.crew.weasels.active -= weaselsToFuse;
    state.crew.weasels.max = totalSlots;

    const activeEntry =
        active.find(entry => entry.id === shadow.id);

    if (activeEntry) {
        activeEntry.count += additionalCount;
    } else {
        active.push({
            ...shadow,
            count: requestedCount
        });
    }

    return {
        ok: true,
        action: 'activate',
        shadow,
        count: requestedCount,
        shadowSlotsUsed: slotsNeeded,
        weaselsFused: weaselsToFuse,
        activeShadowSlots: activeSlotCount(),
        looseWeaselCapacity: totalSlots - activeSlotCount(),
        state
    };
}
function resolveSocialSeed(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'social seed requires state'
    );

    assert(
        typeof test.socialId === 'string' &&
        test.socialId.trim().length > 0,
        'social seed requires socialId'
    );

    const state = clone(test.state);
    state.socialSeeds ||= {};

    assert(
        state.socialSeeds &&
        typeof state.socialSeeds === 'object' &&
        !Array.isArray(state.socialSeeds),
        'state.socialSeeds must be an object'
    );

    const id = test.socialId.trim();
    const existing = state.socialSeeds[id];

    if (existing) {
        assert(
            Number.isInteger(existing.sincerityRoll) &&
            existing.sincerityRoll >= 1 &&
            existing.sincerityRoll <= 10 &&
            Number.isInteger(existing.demeanorRoll) &&
            existing.demeanorRoll >= 1 &&
            existing.demeanorRoll <= 10,
            `Invalid locked social seed: ${id}`
        );

        return {
            ok: true,
            created: false,
            socialId: id,
            seed: existing,
            state
        };
    }

    const sincerityRoll = roll(state, 10);
    const demeanorRoll = roll(state, 10);

    const sincerity =
        sincerityRoll <= 8
            ? 'genuine'
            : sincerityRoll === 9
                ? 'self_interested_exaggeration'
                : 'deceptive';

    const demeanor =
        demeanorRoll <= 2
            ? 'warm'
            : demeanorRoll <= 5
                ? 'businesslike'
                : demeanorRoll <= 7
                    ? 'guarded'
                    : demeanorRoll <= 9
                        ? 'indifferent'
                        : 'abrasive';

    const seed = {
        socialId: id,
        sincerityRoll,
        sincerity,
        demeanorRoll,
        demeanor
    };

    state.socialSeeds[id] = seed;

    return {
        ok: true,
        created: true,
        socialId: id,
        seed,
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

        state.inquiries ||= {};

        assert(
            state.inquiries &&
            typeof state.inquiries === 'object' &&
            !Array.isArray(state.inquiries),
            'state.inquiries must be an object'
        );

        if (test.packLooted === true) {
            assert(
                encounter &&
                typeof encounter === 'object',
                'packLooted requires state.encounter'
            );
        }

        if (
            test.newWildernessSite === true ||
            test.investigatedRumor === true
        ) {
            assert(
                typeof test.inquiryId === 'string' &&
                test.inquiryId.trim().length > 0,
                'Site and rumor checks require inquiryId'
            );
            assert(
                ZONES[state.zone],
                'Site and rumor checks require a valid state.zone'
            );
        }

         if (encounter) {
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
        }

        const result = {
            ok: true,
            applicable: {},
            findings: {},
            locked: {},
            state
        };

        /*
         * Reuse a result already locked on this encounter.
         * Otherwise generate it using the extension's saved RNG.
         */
        function lockedOrRolled(field, sides) {
            const existing = encounter[field];

            if (existing !== null && existing !== undefined) {
                assert(
                    Number.isInteger(existing) &&
                    existing >= 1 &&
                    existing <= sides,
                    `${field} must be 1-${sides}`
                );

                result.locked[field] = false;
                return existing;
            }

            const value = roll(state, sides);
            encounter[field] = value;
            result.locked[field] = true;
            return value;
        }

        /*
         * Each encounter stores at most one loot seed and one quest
         * seed. If another eligible result hits, keep the first seed;
         * never overwrite an outcome that was already locked.
         */
        function lockSeed(field, value) {
            const existing = encounter[field];

            if (existing !== null && existing !== undefined) {
                result.locked[field] = false;
                return existing;
            }

            encounter[field] = clone(value);
            result.locked[field] = true;
            return encounter[field];
        }

        function inquiry(type, sides, outcome) {
            const key = `${type}:${test.inquiryId}`;
            let record = state.inquiries[key];

            if (record) {
                assert(
                    record.type === type &&
                    record.zone === state.zone &&
                    Number.isInteger(record.roll) &&
                    record.roll >= 1 &&
                    record.roll <= sides,
                    `Invalid locked inquiry: ${key}`
                );
            } else {
                const value = roll(state, sides);
                record = {
                    id: test.inquiryId,
                    type,
                    zone: state.zone,
                    roll: value,
                    result: outcome(value),
                    lootSeed: null,
                    questSeed: null,
                    questSeedConsumed: false
                };
                state.inquiries[key] = record;
            }

            return record;
        }

        if (test.newWildernessSite === true) {
            const key = `site:${test.inquiryId}`;
            const existed = Object.prototype.hasOwnProperty.call(
                state.inquiries, key
            );
            const site = inquiry('site', 10, value =>
                value <= 7 ? 'nothing_hidden' :
                value === 8 ? 'hidden_lore_or_shortcut' :
                value === 9 ? 'trap_or_ambush_hazard' :
                'hidden_loot_stash'
            );

            result.locked.curiosityRoll = !existed;
            result.applicable.curiosity = true;
            result.findings.curiosity = site.result;

            if (site.result === 'hidden_loot_stash' && !site.lootSeed) {
                site.lootSeed = {
                    source: 'curiosity',
                    roll: site.roll,
                    result: site.result,
                    claimed: false
                };
            }
        }

        if (test.investigatedRumor === true) {
            const key = `rumor:${test.inquiryId}`;
            const existed = Object.prototype.hasOwnProperty.call(
                state.inquiries, key
            );
            const rumor = inquiry('rumor', 5, value =>
                value <= 3 ? 'travelogue_flub_benign_oddity' :
                value === 4 ? 'already_cleared_by_other_immortals' :
                'genuine_unclaimed_quest_or_dungeon_hook'
            );

            result.locked.rumorRoll = !existed;
            result.applicable.rumor = true;
            result.findings.rumor = rumor.result;

            if (
                rumor.result ===
                'genuine_unclaimed_quest_or_dungeon_hook' &&
                !rumor.questSeed
            ) {
                rumor.questSeed = {
                    source: 'rumor',
                    roll: rumor.roll,
                    result: rumor.result
                };
            }
        }

             if (test.packLooted === true) {
            assert(
                encounter.status === 'cleared',
                'Cannot loot a pack before it is cleared'
            );
            assert(
                encounter.type === 'normal_pack' ||
                (
                    encounter.type === 'declared' &&
                    encounter.foes.every(foe =>
                        ['brute', 'archer', 'mender', 'hexer', 'buffer']
                            .includes(foe.role)
                    ) &&
                    !encounter.reinforcementLog?.length
                ),
                'Only an ordinary cleared pack can roll a pack drop'
            );

            result.applicable.packDrop = true;

            const packDropRoll =
                lockedOrRolled('packDropRoll', 10);

            const packResult =
                packDropRoll <= 8
                    ? 'auto_salvage_only'
                    : packDropRoll === 9
                        ? 'wild_equipment_drop'
                        : 'diegetic_quest_breadcrumb';

            result.findings.packDrop =
                packResult;

            if (packResult === 'wild_equipment_drop') {
                lockSeed('lootSeed', {
                    source: 'pack_drop',
                    roll: packDropRoll,
                    result: packResult
                });
            }

            if (packResult === 'diegetic_quest_breadcrumb') {
                lockSeed('questSeed', {
                    source: 'pack_drop',
                    roll: packDropRoll,
                    result: packResult
                });
            }
        }

        const site = test.newWildernessSite
            ? state.inquiries[`site:${test.inquiryId}`]
            : null;
        const rumor = test.investigatedRumor
            ? state.inquiries[`rumor:${test.inquiryId}`]
            : null;

        result.unlocks = {
            loot: Boolean(
                (site?.lootSeed && site.lootSeed.claimed !== true) ||
                (encounter?.lootSeed &&
                    encounter.lootSeed.claimed !== true)
            ),
            quest: Boolean(
                (rumor?.questSeed &&
                    rumor.questSeedConsumed !== true) ||
                (encounter?.questSeed &&
                    encounter.questSeedConsumed !== true)
            )
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
                    if (test.action === 'equip') {
                        result = equipBagItem(
                            test.state,
                            test.itemIndex
                        );
                    } else if (test.action === 'grant') {
                        result = resolveGearGrant(test);
                    } else {
                        throw new Error(
                            `${name}: unsupported gear action '${test.action}'`
                        );
                    }
                    break;

                case 'death':
                    result = resolveDeathPenalty(test);
                    break;
                case 'xp':
                    result = resolveXpAction(test);
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
                    
                case 'shadows':
                    result = resolveShadowDeckAction(test);
                    break;
                
                case 'boss_check':
                    result = resolveBossGearCheck(test);
                    break;

                case 'flee':
                    result = resolveTurn({
                        state: test.state,
                        actions: {
                            flee: true
                        },
                        rolls: test.rolls
                    });
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

                    if (test.actions.flee !== true) {
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
                    }

                    result = resolveTurn({
                        state: test.state,
                        actions: test.actions,
                        rolls: test.rolls
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
                case 'social':
                    result = resolveSocialSeed(test);
                    break;

                case 'loot':
                    result = claimLockedLoot(test);
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

const ZONE_MATERIAL_NAMES = {
    1: 'Valley Iron',
    2: 'Fen-Bronze',
    3: 'Cold Bog-Iron',
    4: 'Karst Chitin',
    5: 'Highgate Steel'
};

const ZONE_LOOT_MATERIALS = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        return ZONE_MATERIAL_NAMES[zone] || ZONES[zone].name;

    }
});

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

function rollLootFromState(
    state,
    source,
    zone = state.encounter?.zone ?? state.zone
) {
    assert(ZONES[zone], `Unknown loot zone: ${zone}`);

    const slots = source === 'boss'
        ? BOSS_LOOT_SLOTS
        : WILD_ELITE_LOOT_SLOTS;

    const slotRoll = roll(state, slots.length);
    const rarityRoll = source === 'wild'
        ? roll(state, 6)
        : undefined;

    return {
        ...resolveLootSeed({
            zone,
            source,
            slotRoll,
            rarityRoll
        }),
        rolls: { slotRoll, rarityRoll }
    };
}

function claimLockedLoot(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Loot claim requires state'
    );

    const state = clone(test.state);
    const encounter = state.encounter;
    const inquiryRecord = test.inquiryId === undefined
        ? null
        : state.inquiries?.[`site:${test.inquiryId}`];

    assert(
        test.inquiryId === undefined || inquiryRecord,
        'Unknown locked site inquiry'
    );

    const seed = inquiryRecord
        ? inquiryRecord.lootSeed
        : encounter?.lootSeed;

    assert(seed, 'Loot claim requires a locked loot seed');
    assert(seed.claimed !== true, 'This loot seed was already claimed');

    const packDrop = seed.result === 'wild_equipment_drop';
    const stash = seed.result === 'hidden_loot_stash';

    assert(
        packDrop || stash,
        `Unsupported locked loot seed: ${seed.result}`
    );

    if (packDrop) {
        assert(
            encounter.status === 'cleared',
            'Pack-drop loot requires a cleared encounter'
        );
    }

    state.inventory ||= {};
    state.inventory.bagReserves ||= [];

    assert(
        Array.isArray(state.inventory.bagReserves),
        'inventory.bagReserves must be an array'
    );

        const generated = rollLootFromState(
        state,
        'wild',
        inquiryRecord?.zone
    );

    const item = {
        ...generated.item,
        acquiredFrom: seed.source,
        ...(inquiryRecord
            ? { acquiredAtInquiry: inquiryRecord.id }
            : { acquiredAtEncounter: encounter.id }),

        bound: false
    };

    state.inventory.bagReserves.push(item);
    seed.claimed = true;

    return {
        ok: true,
        item,
        rolls: generated.rolls,
        state
    };
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
                        flee: {
                            type: 'boolean'
                        },

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
                                'drink',
                                'raise_shadow'
                            ]
                        },
                        target: {
                            type: 'string'
                        },
                        shadowId: {
                            type: 'string'
                        },
                        
                        shadowSacrificeId: {
                            type: 'string'
                        },

                        count: {
                            type: 'integer',
                            minimum: 1
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

                    }
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
                                    'reference',
                                    'world_seeds',
                                    'social',
                                    'loot',
                                    'quest',
                                    'gear',
                                    'trade',
                                    'vendor',
                                    'currency',
                                    'consumable',
                                    'food',
                                    'death',
                                    'xp',
                                    'boss_check',
                                    'flee',
                                    'shadows'
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

                            encounterType: {
                                type: 'string',
                                enum: [
                                    'wild',
                                    'quest_terminal',
                                    'normal_pack',
                                    'declared',
                                    'elite',
                                    'boss'
                                ]
                            },


                            foes: {
                                type: 'array',
                                description:
                                 'Declared roster. Required when encounterType is declared.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        role: {
                                            type: 'string',
                                            enum: [
                                                'brute',
                                                'archer',
                                                'mender',
                                                'hexer',
                                                'buffer',
                                                'elite',
                                                'boss'
                                            ]
                                        },
                                        level: {
                                            type: 'integer',
                                            minimum: 1
                                        }
                                    },
                                    required: [
                                        'role',
                                        'level'
                                    ]
                                }
                            },

                            encounterId: {
                                type: 'string'
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
                            shadowId: {
                                type: 'string'
                            },
                            
                            shadowType: {
                                type: 'string',
                                enum: [
                                    'archer',
                                    'mender',
                                    'hexer',
                                    'warder'
                                ]
                            },

                            sourceMobLevel: {
                                type: 'integer',
                                minimum: 1
                            },

                            sourceMobName: {
                                type: 'string'
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
                                    'grant',
                                    'pawn',
                                    'list',
                                    'settle',
                                    'stock',
                                    'buy',
                                    'spend',
                                    'earn',
                                    'sell',
                                    'grant',
                                    'use',
                                    'list_food',
                                    'apply',
                                    'boss_check',
                                    'flee',
                                    'record',
                                    'replace',
                                    'remove',
                                    'activate',
                                    'deactivate'

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
                                                        grantId: {
                                type: 'string',
                                description:
                                    'Stable idempotency ID for one explicit gear acquisition'
                            },

                            grantSource: {
                                type: 'string',
                                enum: [
                                    'npc_gift',
                                    'exploration',
                                    'migration',
                                    'manual_correction'
                                ]
                            },

                            sourceName: {
                                type: 'string'
                            },

                            gearItem: {
                                type: 'object',
                                description:
                                    'Fully specified gear item to place unbound in Bag Reserves'
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

                            listedAt: {
                                type: 'string'
                            },
                            count: {
                                type: 'integer',
                                minimum: 1
                            },
                            
                            recipeId: {
                                type: 'string'
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
                           socialId: {
                                type: 'string',
                                description:
                                    'Stable NPC or consequential-deal ID; choose before rolling'
                            },


                            inquiryId: {
                                type: 'string',
                                description:
                                    'Stable ID for one site or rumor inquiry; choose before rolling'
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
                rolls: args.rolls
            });

        }
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

function registerAethermoorTools() {
    try {
        registerTools();
        console.log(
            'Aethermoor Engine function tools registered successfully'
        );
    } catch (error) {
        console.error(
            'Aethermoor Engine: Error registering function tools',
            error
        );
    }
}

jQuery(function () {
    registerAethermoorTools();
});
