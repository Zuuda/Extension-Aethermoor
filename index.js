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
    if (!item) return { atk: 0, def: 0, hp: 0, luk: 0 };

    const stat = int(item.stat, `${owner}.${slot}.stat`);
    const variant = item.variant;
    const result = { atk: 0, def: 0, hp: 0, luk: 0 };

    if (owner === 'tansy') {
        assert(TANSY_SLOTS.includes(slot), `Invalid Tansy slot: ${slot}`);
        if (slot === 'weapon') result.atk = 2 * stat;
        else if (slot === 'gloves') result.atk = stat;
        else if (slot === 'chest' || slot === 'trousers') {
            result.hp = 5 * stat;
            result.luk = stat > 0 ? 1 : 0;
        } else {
            assert(MODULAR_TANSY.has(slot), `Invalid Tansy slot: ${slot}`);
            if (stat > 0) {
                assert(['vitality', 'luck'].includes(variant),
                    `${slot} needs exactly one tuning variant`);
                if (variant === 'vitality') result.hp = 5 * stat;
                else result.luk = stat;
            }
        }
    } else if (owner === 'qtik') {
        assert(QTIK_SLOTS.includes(slot), `Invalid Q'tik slot: ${slot}`);
        if (stat > 0) {
            assert(['vitality', 'bulwark'].includes(variant),
                `${slot} needs exactly one tuning variant`);
            if (variant === 'vitality') result.hp = 15 * stat;
            else result.def = 2 * stat;
        }
    } else {
        throw new Error(`Unknown gear owner: ${owner}`);
    }
    return result;
}

function derived(crew) {
    const level = int(crew.level, 'crew.level', 1);
    const weasels = int(crew.weasels.active, 'weasels.active');
    const maxWeasels = 2 + 2 * Math.floor(level / 2);
    assert(weasels <= maxWeasels,
        `Active weasels ${weasels} exceed level cap ${maxWeasels}`);

    const totals = {
        atk: 2 * level + 2 * weasels,
        def: level,
        luk: Math.floor(level / 2),
        qtikMaxHp: 125 + 25 * level,
        tansyMaxHp: 35 + 15 * level
    };

    for (const slot of TANSY_SLOTS) {
        const bonus = gearBonus('tansy', slot, crew.gear.tansy[slot]);
        totals.atk += bonus.atk;
        totals.luk += bonus.luk;
        totals.tansyMaxHp += bonus.hp;
    }
    for (const slot of QTIK_SLOTS) {
        const bonus = gearBonus('qtik', slot, crew.gear.qtik[slot]);
        totals.def += bonus.def;
        totals.qtikMaxHp += bonus.hp;
    }

    totals.regen = Math.round(totals.qtikMaxHp / 100);
    return totals;
}

function validate(state) {
    assert(ZONES[state.zone], `Unknown zone: ${state.zone}`);
    assert(state.crew && state.encounter, 'Need crew and encounter');
    const c = state.crew;
    const d = derived(c);

    int(c.xp, 'crew.xp');
    int(c.purse, 'crew.purse');
    int(c.qtik.hp, 'qtik.hp');
    int(c.tansy.hp, 'tansy.hp');
    assert(c.qtik.hp <= d.qtikMaxHp, 'Q\'tik HP exceeds derived maximum');
    assert(c.tansy.hp <= d.tansyMaxHp, 'Tansy HP exceeds derived maximum');
    assert(Array.isArray(c.belt) && c.belt.length <= 4,
        'Belt must contain at most four item IDs');

    assert(Array.isArray(state.encounter.foes), 'Encounter needs foes');
    const ids = new Set();
    for (const foe of state.encounter.foes) {
        assert(typeof foe.id === 'string' && !ids.has(foe.id),
            'Each foe needs a unique string ID');
        ids.add(foe.id);

        const expected = mobStats(foe.level, foe.role);
        int(foe.hp, `${foe.id}.hp`);
        assert(foe.hp <= expected.maxHp, `${foe.id} HP exceeds maximum`);
        // Stats are derived, not accepted as editable combat inputs.
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
    const changes = [];
    crew.xp += xp;

    while (crew.xp >= nextXp(crew.level)) {
        const before = derived(crew);
        const cost = nextXp(crew.level);
        crew.xp -= cost;
        crew.level++;

        const after = derived(crew);
        crew.qtik.hp = Math.min(after.qtikMaxHp,
            crew.qtik.hp + after.qtikMaxHp - before.qtikMaxHp);
        crew.tansy.hp = Math.min(after.tansyMaxHp,
            crew.tansy.hp + after.tansyMaxHp - before.tansyMaxHp);
        changes.push({
            level: crew.level,
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
    let remaining = amount;
    let foe = target;

    while (foe && remaining > 0) {
        const applied = Math.min(foe.hp, remaining);
        foe.hp -= applied;
        remaining -= applied;
        hits.push({ id: foe.id, damage: applied, hp: foe.hp });

        if (foe.hp === 0) {
            kills.push({
                id: foe.id,
                xp: xpForKill(state.crew.level, foe),
                silver: 2 * enemyTier(foe.level)
            });
            foe = live(state)[0];
        } else {
            foe = null;
        }
    }
    return hits;
}

function resolveTurn({ state, actions, rolls, rewardMode = 'immediate' }) {
    const s = clone(state);
    const initial = validate(s);
    const c = s.crew;
    const encounter = s.encounter;

    assert(['immediate', 'deferred'].includes(rewardMode),
        'rewardMode must be immediate or deferred');
    assert(['fire_melee', 'ice_melee', 'stun', 'ice_patch',
        'frost_stomp', 'drink'].includes(actions.qtik),
        `Unsupported Q'tik action: ${actions.qtik}`);
    assert(['visor', 'vitals', 'hamstring', 'recall',
        'surge'].includes(actions.tansy),
        `Unsupported Tansy action: ${actions.tansy}`);
    assert(live(s).length > 0, 'No living foes');

    encounter.used ||= { stun: false, icePatch: false };
    encounter.hexStacks ||= {};
    encounter.exposed ||= 0;
    encounter.turn = (encounter.turn || 0) + 1;

    if (actions.qtik === 'stun' || actions.qtik === 'ice_patch') {
        const key = actions.qtik === 'stun' ? 'stun' : 'icePatch';
        assert(!encounter.used[key], `${key} already used this fight`);
        encounter.used[key] = true;
    }

    if (actions.qtik === 'drink') {
        assert(['basic_health_potion', 'mid_health_potion',
            'cleansing_tonic'].includes(actions.item),
            'Specify a supported belt item');
        c.belt = consumeBelt({
            belt: c.belt, items: [actions.item]
        }).remainingBelt;
    }

    if (actions.tansy === 'surge') {
        c.weasels.active = 2 + 2 * Math.floor(c.level / 2);
    }

    const tape = checkTape(s, rolls);
    const logs = [];
    const kills = [];
    const startingCount = live(s).length;

    for (let ex = 0; ex < 3 && live(s).length &&
        c.qtik.hp > 0 && c.tansy.hp > 0; ex++) {

        const p = tape.player[ex];
        const e = tape.enemy[ex];

        const patch = actions.qtik === 'ice_patch';
        const hamstring = actions.tansy === 'hamstring';
        const missLimit = patch ? (hamstring ? 4 : 3) :
            (hamstring ? 2 : 1);
        const enemyMiss = e <= missLimit ||
            (actions.qtik === 'stun' && ex === 0);

        const hexPenalty = Object.entries(encounter.hexStacks)
            .reduce((total, [id, stacks]) => {
                const hexer = live(s).find(f => f.id === id);
                return total + (hexer ? 2 * enemyTier(hexer.level) * stacks : 0);
            }, 0);

        const directed = ['visor', 'vitals', 'hamstring']
            .includes(actions.tansy);
        const weaselAtk = actions.tansy === 'recall' ? 0 :
            c.weasels.active * (directed && !patch ? 2 : 1);
        const gearAndBaseAtk = initial.atk -
            2 * int(state.crew.weasels.active, 'initial weasels');
        const atk = Math.max(0, gearAndBaseAtk + weaselAtk - hexPenalty);
        const defense = Math.max(0, initial.def - hexPenalty +
            (actions.qtik === 'ice_melee' ? 2 : 0));

        const brute = live(s).find(f => f.role === 'brute');
        let target = live(s).find(f => f.id === actions.target);
        assert(target, `Target ${actions.target} is not alive`);

        if (brute && target.role !== 'brute' &&
            !enemyMiss && actions.tansy !== 'visor' &&
            actions.qtik !== 'frost_stomp') {
            target = brute;
        }

        const fire = actions.qtik === 'fire_melee'
            ? Math.max(3, Math.floor(atk / 5)) : 0;
        const crit = p === 6 || (actions.tansy === 'vitals' && p === 5);
        const vitals = actions.tansy === 'vitals' && !crit &&
            p >= 2 && p <= 4
            ? Math.min(target.def, Math.floor(c.weasels.active / 2))
            : 0;
        const exposed = p === 1 ? 0 : encounter.exposed;
        if (p !== 1) encounter.exposed = 0;

        let damage = 0;
        let hits = [];

        if (actions.qtik === 'frost_stomp') {
            // AoE has one separately calculated hit per live foe.
            for (const foe of [...live(s)]) {
                const base = Math.max(0, Math.floor((atk - foe.def) / 2));
                const amount = (p === 1 ? Math.max(1, Math.floor(base / 2)) :
                    base + p) +
                    (foe.id === target.id ? (crit ? c.luk : vitals) + exposed : 0);
                if (foe.hp > 0) {
                    const applied = Math.min(foe.hp, amount);
                    foe.hp -= applied;
                    hits.push({ id: foe.id, damage: applied, hp: foe.hp });
                    if (foe.hp === 0) {
                        kills.push({
                            id: foe.id,
                            xp: xpForKill(c.level, foe),
                            silver: 2 * enemyTier(foe.level)
                        });
                    }
                }
            }
        } else {
            const strippedDef = actions.qtik === 'stun'
                ? 4 * enemyTier(target.level) : 0;
            const effectiveTargetDef = Math.max(0, target.def - strippedDef);
            const physical = actions.tansy === 'recall'
                ? 2 * c.level + (p === 1 ? 0 : p)
                : p === 1 ? 1
                : crit
                    ? Math.max(6 + c.luk,
                        atk - effectiveTargetDef + 6 + c.luk)
                    : Math.max(1, atk - effectiveTargetDef + p + vitals);

            damage = physical + fire + exposed;
            hits = dealDamage(s, target, damage, kills);
        }

        // A slain foe cannot attack or cast later in this exchange.
        const activeBrutes = live(s).filter(f =>
            ['brute', 'elite', 'boss'].includes(f.role));
        let frontlineDamage = 0;
        let backlineDamage = 0;
        const effects = [];

        if (!enemyMiss && live(s).length) {
            if (activeBrutes.length) {
                const lead = activeBrutes[0];
                let base = Math.max(1,
                    Math.round((lead.atk - defense) / 10));
                if (actions.qtik === 'ice_melee') base = Math.max(1, base - 1);
                if (hamstring) {
                    base = Math.max(1,
                        base - Math.floor(c.weasels.active / 6));
                }
                base += enemyTier(lead.level) * (activeBrutes.length - 1);
                frontlineDamage = base +
                    (e === 6 ? 4 : e === 5 ? 2 : e >= 3 ? 1 : 0);
            }

            for (const foe of live(s)) {
                const t = enemyTier(foe.level);
                if (foe.role === 'archer') {
                    backlineDamage += 4 * t * (e === 6 ? 2 : 1);
                } else if (foe.role === 'mender') {
                    const wounded = live(s)
                        .filter(f => f.hp < mobStats(f.level, f.role).maxHp)
                        .sort((a, b) =>
                            a.hp / mobStats(a.level, a.role).maxHp -
                            b.hp / mobStats(b.level, b.role).maxHp)[0];
                    if (wounded) {
                        const amount = Math.min(10 * t,
                            mobStats(wounded.level, wounded.role).maxHp -
                            wounded.hp);
                        wounded.hp += amount;
                        effects.push(`${foe.id} healed ${wounded.id} for ${amount}`);
                    }
                } else if (foe.role === 'hexer' &&
                    !(actions.tansy === 'visor' && e <= 4)) {
                    encounter.hexStacks[foe.id] =
                        (encounter.hexStacks[foe.id] || 0) + 1;
                    effects.push(`${foe.id} added a hex stack`);
                } else if (foe.role === 'buffer') {
                    // Applied on this hit; expires when this Buffer dies.
                    encounter.bufferId = foe.id;
                    effects.push(`${foe.id} activated its buff`);
                }
            }

            const buffer = live(s).find(f => f.id === encounter.bufferId);
            if (buffer && activeBrutes.length) {
                frontlineDamage += enemyTier(buffer.level);
            }
        }

        c.qtik.hp = Math.max(0, c.qtik.hp - frontlineDamage);
        c.tansy.hp = Math.max(0, c.tansy.hp - backlineDamage);
        if (c.qtik.hp > 0) {
            c.qtik.hp = Math.min(initial.qtikMaxHp,
                c.qtik.hp + initial.regen);
        }

        if (actions.tansy === 'visor' && e === 1 && live(s).length) {
            encounter.exposed = initial.luk;
        }

        // Only an actual health potion can auto-trigger.
        if (c.qtik.hp > 0 &&
            c.qtik.hp * 4 <= initial.qtikMaxHp) {
            const item = c.belt.find(id =>
                ['basic_health_potion', 'mid_health_potion'].includes(id));
            if (item) {
                c.belt = consumeBelt({
                    belt: c.belt, items: [item]
                }).remainingBelt;
                const heal = item === 'mid_health_potion' ? 120 : 50;
                c.qtik.hp = Math.min(initial.qtikMaxHp, c.qtik.hp + heal);
                effects.push(`Auto-consumed ${item}: +${heal} HP`);
            }
        }

        logs.push({
            exchange: ex + 1,
            playerRoll: p,
            enemyRoll: e,
            target: target.id,
            crit,
            damage,
            hits,
            enemyMiss,
            frontlineDamage,
            backlineDamage,
            effects,
            qtikHp: c.qtik.hp,
            tansyHp: c.tansy.hp,
            livingFoes: live(s).map(f => ({ id: f.id, hp: f.hp }))
        });
    }

    const gainedXp = kills.reduce((sum, kill) => sum + kill.xp, 0);
    const gainedSilver = kills.reduce((sum, kill) => sum + kill.silver, 0);
    let levelUps = [];

    if (rewardMode === 'immediate') {
        levelUps = applyXp(c, gainedXp);
        c.purse += gainedSilver;
    }

    encounter.hexStacks = Object.fromEntries(
        Object.entries(encounter.hexStacks)
            .filter(([id]) => live(s).some(f => f.id === id))
    );

    return {
        ok: true,
        turn: encounter.turn,
        rolls: tape,
        exchanges: logs,
        kills,
        rewards: {
            xp: gainedXp,
            silver: gainedSilver,
            applied: rewardMode === 'immediate'
        },
        levelUps,
        packCleared: startingCount > 0 && live(s).length === 0,
        state: s,
        derived: derived(c)
    };
}

function createFoe({ id, level, role }) {
    const stats = mobStats(level, role);
    return {
        id,
        level,
        role,
        hp: stats.maxHp
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

function registerTools() {
    const context = getContext();
    if (!context?.registerFunctionTool) {
        console.warn('Aethermoor Engine: function tools unavailable');
        return;
    }

    register(
        'aethermoorResolveTurnV2',
        'Aethermoor: Resolve Turn',
        'Resolve one declared PvE turn. Supply the prior locked state. Does not choose actions or narrate.',
        {
            type: 'object',
            properties: {
                state: { type: 'object' },
                actions: {
                    type: 'object',
                    properties: {
                        qtik: {
                            type: 'string',
                            enum: [
                                'fire_melee', 'ice_melee', 'stun',
                                'ice_patch', 'frost_stomp', 'drink'
                            ]
                        },
                        tansy: {
                            type: 'string',
                            enum: [
                                'visor', 'vitals', 'hamstring',
                                'recall', 'surge'
                            ]
                        },
                        target: { type: 'string' },
                        item: { type: 'string' }
                    },
                    required: ['qtik', 'tansy', 'target']
                },
                rolls: {
                    type: 'object',
                    properties: {
                        player: {
                            type: 'array',
                            items: { type: 'integer' }
                        },
                        enemy: {
                            type: 'array',
                            items: { type: 'integer' }
                        }
                    },
                    required: ['player', 'enemy']
                },
                rewardMode: {
                    type: 'string',
                    enum: ['immediate', 'deferred']
                }
            },
            required: ['state', 'actions']
        },
        resolveTurn
    );

    register(
        'aethermoorConsumeBeltV2',
        'Aethermoor: Consume Belt',
        'Deduct explicitly named item IDs. Does not decide why or who receives them.',
        {
            type: 'object',
            properties: {
                belt: {
                    type: 'array',
                    items: { type: 'string' }
                },
                items: {
                    type: 'array',
                    items: { type: 'string' }
                }
            },
            required: ['belt', 'items']
        },
        consumeBelt
    );

    register(
        'aethermoorReferenceV2',
        'Aethermoor: Mechanics Reference',
        'Get zone vendor prices, mob stats, XP thresholds, or derived crew statistics.',
        {
            type: 'object',
            properties: {
                zone: { type: 'integer' },
                mob: { type: 'object' },
                crew: { type: 'object' }
            }
        },
        args => ({
            ok: true,
            zone: args.zone ? vendorStock(args.zone) : undefined,
            mob: args.mob
                ? mobStats(args.mob.level, args.mob.role)
                : undefined,
            crew: args.crew ? derived(args.crew) : undefined,
            nextXp: args.crew
                ? nextXp(args.crew.level)
                : undefined
        })
    );

    console.log('Aethermoor Engine function tools registered');
}

// Same startup approach as the working VrCombat prototype.
jQuery(registerTools);
