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
    assert(
        Array.isArray(c.qtik.belt) && c.qtik.belt.length <= 4,
        "Q'tik's belt must contain at most four item IDs"
    );
    assert(
        Array.isArray(c.tansy.belt) && c.tansy.belt.length <= 4,
        "Tansy's belt must contain at most four item IDs"
    );

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
                xp: xpForKill(state.crew.level, current),
                silver: 2 * enemyTier(current.level)
            });
        }

        /*
         * Excess damage always transfers to the living foe with the
         * lowest current HP. Array order does not determine spillover.
         * Ties are resolved by stable encounter-array order.
         */
        if (remaining > 0) {
            const nextTargets = live(state)
                .filter(foe => foe.id !== current.id)
                .sort((a, b) => {
                    if (a.hp !== b.hp) {
                        return a.hp - b.hp;
                    }

                    const aIndex = state.encounter.foes
                        .findIndex(foe => foe.id === a.id);

                    const bIndex = state.encounter.foes
                        .findIndex(foe => foe.id === b.id);

                    return aIndex - bIndex;
                });

            current = nextTargets[0] ?? null;
        } else {
            current = null;
        }
    }

    return hits;
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
        const maxHp = recipient === 'qtik'
            ? derived(crew).qtikMaxHp
            : derived(crew).tansyMaxHp;

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

    const stackEntry = Object.entries(
        encounter.hexStacks || {}
    ).find(([, stacks]) => stacks > 0);

    if (!stackEntry) {
        return {
            item,
            recipient,
            effect: 'cleanse',
            stacksRemoved: 0,
            note: 'No active Hexer debuff to remove'
        };
    }

    const [hexerId, stacks] = stackEntry;

    if (stacks === 1) {
        delete encounter.hexStacks[hexerId];
    } else {
        encounter.hexStacks[hexerId] = stacks - 1;
    }

    return {
        item,
        recipient,
        effect: 'cleanse',
        stacksRemoved: 1,
        source: hexerId
    };
}

function resolveTurn({
    state,
    actions,
    rolls,
    rewardMode = 'immediate'
}) {
    const s = clone(state);
    const initial = validate(s);
    const c = s.crew;
    const encounter = s.encounter;

    assert(
        ['immediate', 'deferred'].includes(rewardMode),
        'rewardMode must be immediate or deferred'
    );

    assert(
        [
            'fire_melee',
            'ice_melee',
            'stun',
            'ice_patch',
            'frost_stomp',
            'drink'
        ].includes(actions.qtik),
        `Unsupported Q'tik action: ${actions.qtik}`
    );

    assert(
        [
            'visor',
            'vitals',
            'hamstring',
            'recall',
            'surge',
            'drink'
        ].includes(actions.tansy),
        `Unsupported Tansy action: ${actions.tansy}`
    );

    assert(live(s).length > 0, 'No living foes');

    /*
     * All derived combat values come from validate().
     * Do not read duplicated values such as crew.luk or crew.atk,
     * because those fields may be absent or stale in the locked state.
     */
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

    encounter.used ||= {
        stun: false,
        icePatch: false
    };

    encounter.hexStacks ||= {};
    encounter.exposed ||= 0;
    encounter.turn = (encounter.turn || 0) + 1;

    if (actions.qtik === 'stun') {
        assert(
            !encounter.used.stun,
            'Stun has already been used this fight'
        );
        encounter.used.stun = true;
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
        itemUse.qtik = applyBeltItem(s, actions.qtikItem, 'qtik');
    }

    if (actions.tansy === 'drink') {
        assert(
            typeof actions.tansyItem === 'string',
            "Tansy drink action requires actions.tansyItem"
        );
        itemUse.tansy = applyBeltItem(s, actions.tansyItem, 'tansy');
    }

if (actions.tansy === 'surge') {
    c.weasels.active =
        2 + 2 * Math.floor(c.level / 2);
}


    const tape = checkTape(s, rolls);
    const logs = [];
    const kills = [];
    const startingCount = live(s).length;

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

        const patchActive = actions.qtik === 'ice_patch';
        const hamstringActive = actions.tansy === 'hamstring';

        /*
         * Enemy miss ranges:
         * Normal: E1
         * Hamstring: E1-E2
         * Ice Patch: E1-E3
         * Ice Patch + Hamstring: E1-E4
         */
        const missLimit = patchActive
            ? hamstringActive ? 4 : 3
            : hamstringActive ? 2 : 1;

        const enemyMiss =
            e <= missLimit ||
            (actions.qtik === 'stun' && ex === 0);

        /*
         * Recalculate active Hexer penalties from living Hexers only.
         */
        const hexPenalty = Object.entries(encounter.hexStacks)
            .reduce((total, [id, stacks]) => {
                const hexer = live(s).find(
                    foe => foe.id === id && foe.role === 'hexer'
                );

                if (!hexer) return total;

                return total +
                    2 *
                    enemyTier(hexer.level) *
                    Number(stacks);
            }, 0);

        assert(
            Number.isFinite(hexPenalty),
            'Hex penalty is not finite'
        );

        const directed =
            actions.tansy === 'visor' ||
            actions.tansy === 'vitals' ||
            actions.tansy === 'hamstring';

const weaselAttack =
    actions.tansy === 'recall'
        ? 0
        : c.weasels.active *
            (
                directed && !patchActive
                    ? 2
                    : 1
            );

        /*
         * Crew ATK consists of base/gear ATK plus current summon ATK.
         * Remove the old summon contribution from the derived value before
         * adding the action-specific current summon contribution.
         */
        const initialWeaselAttack =
            Number(state.crew.weasels.active);

        assert(
            Number.isFinite(initialWeaselAttack),
            'Initial weasel count is not finite'
        );

        const baseAndGearAttack =
            crewStats.atk -
            2 * initialWeaselAttack;

        const effectiveAttack = Math.max(
            0,
            baseAndGearAttack +
            weaselAttack -
            hexPenalty
        );

        const effectiveDefense = Math.max(
            0,
            crewStats.def -
            hexPenalty +
            (
                actions.qtik === 'ice_melee'
                    ? 2
                    : 0
            )
        );

        const brute = live(s).find(
            foe => foe.role === 'brute'
        );

        let target = live(s).find(
            foe => foe.id === actions.target
        );

        assert(
            target,
            `Target ${actions.target} is not alive`
        );

        /*
         * A living Brute guards single-target attacks against backliners
         * unless Visor bypasses Guard or the attack is Frost Stomp.
         */
        if (
            brute &&
            target.role !== 'brute' &&
            !enemyMiss &&
            actions.tansy !== 'visor' &&
            actions.qtik !== 'frost_stomp'
        ) {
            target = brute;
        }

const fireDamage =
    actions.qtik === 'fire_melee'
        ? Math.max(
            3,
            Math.floor(crewStats.atk / 5)
        )
        : 0;

        const isCritical =
            p === 6 ||
            (
                actions.tansy === 'vitals' &&
                p === 5
            );

        const vitalsBonus =
            actions.tansy === 'vitals' &&
            !isCritical &&
            p >= 2 &&
            p <= 4
                ? Math.min(
                    target.def,
                    Math.floor(c.weasels.active / 2)
                )
                : 0;

        const exposedBonus =
            p === 1
                ? 0
                : Number(encounter.exposed || 0);

        if (p !== 1) {
            encounter.exposed = 0;
        }

        let damage = 0;
        let hits = [];
        let playerEffects = [];

        /*
         * STUN strips four times enemy tier from the target's DEF
         * for this turn.
         */
        const strippedDefense =
            actions.qtik === 'stun'
                ? 4 * enemyTier(target.level)
                : 0;

        const effectiveTargetDefense = Math.max(
            0,
            target.def - strippedDefense
        );

        if (actions.qtik === 'frost_stomp') {
            /*
             * Frost Stomp hits every living foe.
             */
            const liveTargets = [...live(s)];

            for (const foe of liveTargets) {
                const baseStomp = Math.max(
                    0,
                    Math.floor(
                        (
                            effectiveAttack -
                            foe.def
                        ) / 2
                    )
                );

                let stompDamage;

                if (p === 1) {
                    stompDamage = Math.max(
                        1,
                        Math.floor(baseStomp / 2)
                    );
                } else {
                    stompDamage = baseStomp + p;
                }

                if (foe.id === target.id) {
                    stompDamage += isCritical
                        ? crewStats.luk
                        : vitalsBonus;

                    stompDamage += exposedBonus;
                }

                stompDamage = Math.max(
                    1,
                    Number(stompDamage)
                );

                assert(
                    Number.isFinite(stompDamage),
                    `Frost Stomp damage is not finite against ${foe.id}`
                );

                const applied = Math.min(
                    foe.hp,
                    stompDamage
                );

                foe.hp -= applied;

                hits.push({
                    id: foe.id,
                    damage: applied,
                    hp: foe.hp
                });

                if (foe.hp === 0) {
                    kills.push({
                        id: foe.id,
                        xp: xpForKill(c.level, foe),
                        silver: 2 * enemyTier(foe.level)
                    });
                }
            }

            damage = hits.reduce(
                (sum, hit) => sum + hit.damage,
                0
            );
        } else {
            let physicalDamage;

            if (actions.qtik === 'drink') {
                /*
                 * Drinking still performs the crew's basic physical attack
                 * without Fire or Ice bonus.
                 */
                physicalDamage = p === 1
                    ? 1
                    : Math.max(
                        1,
                        effectiveAttack -
                        effectiveTargetDefense +
                        p +
                        vitalsBonus
                    );
            } else if (actions.tansy === 'recall') {
                physicalDamage = p === 1
                    ? 1
                    : Math.max(
                        1,
                        2 * c.level +
                        p
                    );
            } else if (p === 1) {
                physicalDamage = 1;
            } else if (isCritical) {
                physicalDamage = Math.max(
                    6 + crewStats.luk,
                    effectiveAttack -
                    effectiveTargetDefense +
                    6 +
                    crewStats.luk
                );
            } else {
                physicalDamage = Math.max(
                    1,
                    effectiveAttack -
                    effectiveTargetDefense +
                    p +
                    vitalsBonus
                );
            }

            damage =
                Number(physicalDamage) +
                Number(fireDamage) +
                Number(exposedBonus);

            assert(
                Number.isFinite(damage),
                [
                    'Player damage is not finite',
                    `physical=${physicalDamage}`,
                    `fire=${fireDamage}`,
                    `exposed=${exposedBonus}`,
                    `attack=${effectiveAttack}`,
                    `targetDef=${effectiveTargetDefense}`,
                    `luk=${crewStats.luk}`
                ].join(' | ')
            );

            hits = dealDamage(
                s,
                target,
                damage,
                kills
            );
        }

        /*
         * Critical correction:
         * If player damage killed the final foe, the enemy does not retaliate
         * and the turn ends immediately. This also prevents later exchanges
         * from being processed against an already-cleared encounter.
         */
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
                    ...playerEffects,
                    'Final foe slain before enemy response'
                ],
                qtikHp: c.qtik.hp,
                tansyHp: c.tansy.hp,
                livingFoes: []
            });

            break;
        }

        /*
         * Only living frontline foes deal frontline damage.
         */
        const activeFrontliners = live(s).filter(
            foe => [
                'brute',
                'elite',
                'boss'
            ].includes(foe.role)
        );

        let frontlineDamage = 0;
        let backlineDamage = 0;
        const effects = [...playerEffects];

        if (!enemyMiss && live(s).length > 0) {
            if (activeFrontliners.length > 0) {
                const lead = activeFrontliners[0];

                let baseBleed = Math.max(
                    1,
                    Math.round(
                        (
                            lead.atk -
                            effectiveDefense
                        ) / 10
                    )
                );

                if (actions.qtik === 'ice_melee') {
                    baseBleed = Math.max(
                        1,
                        baseBleed - 1
                    );
                }

                if (hamstringActive) {
                    baseBleed = Math.max(
                        1,
                        baseBleed -
                        Math.floor(
                            c.weasels.active / 6
                        )
                    );
                }

                baseBleed +=
                    enemyTier(lead.level) *
                    Math.max(
                        0,
                        activeFrontliners.length - 1
                    );

                const rollDamage =
                    e === 6
                        ? 4
                        : e === 5
                            ? 2
                            : e >= 3
                                ? 1
                                : 0;

                frontlineDamage =
                    baseBleed +
                    rollDamage;
            }

            for (const foe of live(s)) {
                const foeTier = enemyTier(foe.level);

                if (foe.role === 'archer') {
                    const amount =
                        4 *
                        foeTier *
                        (
                            e === 6
                                ? 2
                                : 1
                        );

                    backlineDamage += amount;

                    effects.push(
                        `${foe.id} dealt ${amount} damage to Tansy`
                    );
                }

                if (foe.role === 'mender') {
                    const wounded = live(s)
                        .filter(ally => {
                            const stats = mobStats(
                                ally.level,
                                ally.role
                            );

                            return ally.hp < stats.maxHp;
                        })
                        .sort((a, b) => {
                            const aStats = mobStats(
                                a.level,
                                a.role
                            );
                            const bStats = mobStats(
                                b.level,
                                b.role
                            );

                            return (
                                a.hp / aStats.maxHp
                            ) - (
                                b.hp / bStats.maxHp
                            );
                        })[0];

                    if (wounded) {
                        const woundedStats = mobStats(
                            wounded.level,
                            wounded.role
                        );

                        const amount = Math.min(
                            10 * foeTier,
                            woundedStats.maxHp -
                            wounded.hp
                        );

                        wounded.hp += amount;

                        effects.push(
                            `${foe.id} healed ` +
                            `${wounded.id} for ${amount}`
                        );
                    }
                }

                if (
                    foe.role === 'hexer' &&
                    !(
                        actions.tansy === 'visor' &&
                        e >= 2 &&
                        e <= 4
                    )
                ) {
                    encounter.hexStacks[foe.id] =
                        (
                            encounter.hexStacks[foe.id] || 0
                        ) + 1;

                    effects.push(
                        `${foe.id} added one hex stack`
                    );
                }

                if (foe.role === 'buffer') {
                    encounter.bufferId = foe.id;

                    effects.push(
                        `${foe.id} activated its buffer`
                    );
                }
            }

            const livingBuffer = live(s).find(
                foe => foe.id === encounter.bufferId
            );

            if (
                livingBuffer &&
                activeFrontliners.length > 0
            ) {
                frontlineDamage += enemyTier(
                    livingBuffer.level
                );
            }
        }

        c.qtik.hp = Math.max(
            0,
            c.qtik.hp - frontlineDamage
        );

        c.tansy.hp = Math.max(
            0,
            c.tansy.hp - backlineDamage
        );

        if (c.qtik.hp > 0) {
            c.qtik.hp = Math.min(
                crewStats.qtikMaxHp,
                c.qtik.hp + crewStats.regen
            );
        }

        /*
         * Visor Ex1 fumble exposes the enemy to the next crew hit.
         */
        if (
            actions.tansy === 'visor' &&
            e === 1 &&
            live(s).length > 0
        ) {
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
            effects,
            qtikHp: c.qtik.hp,
            tansyHp: c.tansy.hp,
            livingFoes: live(s).map(
                foe => ({
                    id: foe.id,
                    hp: foe.hp
                })
            )
        });
    }

    const gainedXp = kills.reduce(
        (sum, kill) => sum + kill.xp,
        0
    );

    const gainedSilver = kills.reduce(
        (sum, kill) => sum + kill.silver,
        0
    );

    let levelUps = [];

    if (rewardMode === 'immediate') {
        levelUps = applyXp(
            c,
            gainedXp
        );

        c.purse += gainedSilver;
    }

    /*
     * Remove status entries belonging to slain Hexers.
     */
    encounter.hexStacks = Object.fromEntries(
        Object.entries(encounter.hexStacks)
            .filter(([id]) =>
                live(s).some(foe => foe.id === id)
            )
    );

    if (live(s).length === 0) {
        encounter.status = 'cleared';
    }

    const result = {
        ok: true,
        turn: encounter.turn,
        rolls: tape,
        itemUse,
        exchanges: logs,
        kills,
        rewards: {
            xp: gainedXp,
            silver: gainedSilver,
            applied: rewardMode === 'immediate'
        },
        levelUps,
        packCleared:
            startingCount > 0 &&
            live(s).length === 0,
        state: s,
        derived: derived(c)
    };
// Reject NaN and Infinity, but allow intentional null values.
const assertNoNonFinite = (value, path = 'result') => {
    if (typeof value === 'number') {
        assert(
            Number.isFinite(value),
            `${path} contains a non-finite number`
        );
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            assertNoNonFinite(item, `${path}[${index}]`);
        });
        return;
    }

    if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            assertNoNonFinite(child, `${path}.${key}`);
        }
    }
};

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
        Number.isInteger(zone) && ZONES[zone],
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
        `Pack composition must be an integer from 1 to 6`
    );

    const zoneData = ZONES[zone];
    const bracketData = NORMAL_BRACKETS[zone][bracket];
    const roles = PACK_COMPOSITIONS[composition];

    const foes = roles.map((role, index) =>
        createFoe({
            id: `${encounterId}-${role}-${index + 1}`,
            level: bracketData.level,
            role
        })
    );

    const mixed = composition !== 1;
    const xp = mixed
        ? bracketData.xpMixed
        : bracketData.xpSwarm;

    const autoSalvage =
        foes.length * (2 * zoneData.tier);

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
            compositionName: mixed
                ? 'Mixed Tactical Squad'
                : 'Pure Fodder Swarm',
            enemyTier: zoneData.tier,
            foes,
            used: {
                stun: false,
                icePatch: false
            },
            hexStacks: {},
            exposed: 0
        },
        rewards: {
            listedPackXp: xp,
            autoSalvage: autoSalvage,
            foeCount: foes.length
        }
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
    const kind = test.encounterType || 'normal_pack';

    if (kind === 'normal_pack') {
        return spawnNormalPack({
            zone: test.zone,
            bracket: test.bracket || 'mid',
            composition: test.composition || 2,
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
        kind === 'elite' || kind === 'boss',
        `Unsupported encounter type: ${kind}`
    );

    assert(
        Number.isInteger(test.passiveRoll) &&
        PASSIVES[test.passiveRoll],
        'Elite/boss spawn requires passiveRoll from 1 to 4'
    );

    let level;

    if (kind === 'elite') {
        const bracket = test.bracket || 'mid';

        assert(
            bracket === 'mid' || bracket === 'high',
            'Elite bracket must be mid or high'
        );

        level = ELITE_LEVELS[test.zone][bracket];
    } else {
        level = BOSS_LEVELS[test.zone];
    }

    const id =
        test.encounterId ||
        `${kind}-z${test.zone}`;

    const foe = createFoe({
        id: `${id}-${kind}`,
        level,
        role: kind
    });

    const rawStat =
        ZONES[test.zone].base +
        (kind === 'elite' ? 1 : 5);

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
            passive: PASSIVES[test.passiveRoll],
            passiveStacks: 0,
            nextTelegraph: null,
            used: {
                stun: false,
                icePatch: false
            },
            hexStacks: {},
            exposed: 0
        },

        rewards: {
            baseKillXp: mobStats(level, kind).xpBase,
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
            bossTrophy: kind === 'boss'
        }
    };
}

function resolveBatch(args) {
    function resolveWorldSeeds(test) {
    const result = {
        ok: true,
        applicable: {},
        findings: {}
    };

    /*
     * These inputs describe whether the relevant game situation happened.
     * The resolver does not invent that situation.
     */
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

        result.applicable.curiosity = newWildernessSite;

        if (!newWildernessSite) {
            result.findings.curiosity = 'not_applicable';
        } else if (curiosityRoll <= 7) {
            result.findings.curiosity = 'nothing_hidden';
        } else if (curiosityRoll === 8) {
            result.findings.curiosity = 'hidden_lore_or_shortcut';
        } else if (curiosityRoll === 9) {
            result.findings.curiosity = 'trap_or_ambush_hazard';
        } else {
            result.findings.curiosity = 'hidden_loot_stash';
        }
    }

    if (rumorRoll !== undefined) {
        assert(
            Number.isInteger(rumorRoll) &&
            rumorRoll >= 1 &&
            rumorRoll <= 5,
            'rumorRoll must be 1-5'
        );

        result.applicable.rumor = investigatedRumor;

        if (!investigatedRumor) {
            result.findings.rumor = 'not_applicable';
        } else if (rumorRoll <= 3) {
            result.findings.rumor =
                'travelogue_flub_benign_oddity';
        } else if (rumorRoll === 4) {
            result.findings.rumor =
                'already_cleared_by_other_immortals';
        } else {
            result.findings.rumor =
                'genuine_unclaimed_quest_or_dungeon_hook';
        }
    }

    if (packDropRoll !== undefined) {
        assert(
            Number.isInteger(packDropRoll) &&
            packDropRoll >= 1 &&
            packDropRoll <= 10,
            'packDropRoll must be 1-10'
        );

        result.applicable.packDrop = packLooted;

        if (!packLooted) {
            result.findings.packDrop = 'not_applicable';
        } else if (packDropRoll <= 8) {
            result.findings.packDrop = 'auto_salvage_only';
        } else if (packDropRoll === 9) {
            result.findings.packDrop = 'wild_equipment_drop';
        } else {
            result.findings.packDrop =
                'diegetic_quest_breadcrumb';
        }
    }

    result.unlocks = {
        loot:
            result.findings.curiosity === 'hidden_loot_stash' ||
            result.findings.packDrop === 'wild_equipment_drop',

        quest:
            result.findings.rumor ===
                'genuine_unclaimed_quest_or_dungeon_hook' ||
            result.findings.packDrop ===
                'diegetic_quest_breadcrumb'
    };

    return result;
}

    assert(
        Array.isArray(args.cases) && args.cases.length > 0,
        'Batch mode requires a non-empty cases array'
    );

    const results = [];

    for (let index = 0; index < args.cases.length; index++) {
        const test = args.cases[index];
        const name = test.name || `case_${index + 1}`;

        try {
            let result;

            switch (test.kind) {
                                    case 'spawn':
                    result = spawnEncounter(test);
                    break;

                case 'turn':
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

                default:
                    throw new Error(
                        `Unknown batch case kind: ${test.kind}`
                    );
            }

            results.push({
                name,
                ok: result.ok !== false,
                result
            });
        } catch (error) {
            results.push({
                name,
                ok: false,
                error: error instanceof Error
                    ? error.message
                    : String(error)
            });
        }
    }

    const passed = results.filter(item => item.ok).length;

    return {
        ok: passed === results.length,
        total: results.length,
        passed,
        failed: results.length - passed,
        results
    };
}

function registerTools() {
    const context = getContext();
    if (!context?.registerFunctionTool) {
        console.warn('Aethermoor Engine: function tools unavailable');
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
                        items: { type: 'integer' }
                    },
                    enemy: {
                        type: 'array',
                        items: { type: 'integer' }
                    }
                }
            },

            rewardMode: {
                type: 'string',
                enum: ['immediate', 'deferred']
            },

            cases: {
                type: 'array',
                description:
                    'Independent cases for batch mode',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },

                        kind: {
                            type: 'string',
                            enum: [
                                'spawn',
                                'turn',
                                'consume_belt',
                                'reference',
                                'world_seeds'
                            ]
                        },

                        state: { type: 'object' },
                        actions: { type: 'object' },
                        rolls: { type: 'object' },
                        rewardMode: {
                            type: 'string',
                            enum: ['immediate', 'deferred']
                        },

                        belt: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        items: {
                            type: 'array',
                            items: { type: 'string' }
                        },

                                               zone: { type: 'integer' },

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

                        mob: { type: 'object' },
                        crew: { type: 'object' },

                        curiosityRoll: { type: 'integer' },
                        rumorRoll: { type: 'integer' },
                        packDropRoll: { type: 'integer' },
                        newWildernessSite: {
                            type: 'boolean'
                        },
                        investigatedRumor: {
                            type: 'boolean'
                        },
                        packLooted: {
                            type: 'boolean'
                        }
                    },
                    required: ['name', 'kind']

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
            rewardMode: args.rewardMode || 'immediate'
        });
    }
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
