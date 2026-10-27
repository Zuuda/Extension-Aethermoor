import { getContext } from '../../../extensions.js';

const integer = (value, name, min = 0) => {
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`${name} must be an integer >= ${min}`);
    }
    return value;
};

const copy = value => JSON.parse(JSON.stringify(value));
const die = () => Math.floor(Math.random() * 6) + 1;
const alive = foes => foes.filter(foe => foe.hp > 0);
const tier = level => 1 + Math.floor(level / 10);
const cap = (value, max) => Math.min(max, Math.max(0, value));

function validate(state) {
    const c = state?.crew;
    if (!c || !Array.isArray(state.foes)) throw new Error('Expected crew and foes');
    for (const name of ['level', 'xp', 'purse', 'atk', 'luk']) {
        integer(c[name], `crew.${name}`);
    }
    for (const name of ['qtik', 'tansy']) {
        integer(c[name]?.hp, `${name}.hp`);
        integer(c[name]?.maxHp, `${name}.maxHp`, 1);
        if (c[name].hp > c[name].maxHp) throw new Error(`${name} HP exceeds maxHP`);
    }
    integer(c.qtik.def, 'qtik.def');
    integer(c.qtik.regen, 'qtik.regen');
    integer(c.weasels?.active, 'weasels.active');
    integer(c.weasels?.max, 'weasels.max');
    if (c.weasels.active > c.weasels.max) throw new Error('Too many weasels');
    if (!Array.isArray(c.belt) || c.belt.length > 4) {
        throw new Error('belt must be an array of at most four item IDs');
    }
    if (new Set(state.foes.map(foe => foe.id)).size !== state.foes.length) {
        throw new Error('Foe IDs must be unique');
    }
    for (const foe of state.foes) {
        if (!['brute', 'archer', 'hexer', 'mender'].includes(foe.role)) {
            throw new Error(`Unsupported foe role: ${foe.role}`);
        }
        for (const name of ['level', 'hp', 'maxHp', 'atk', 'def']) {
            integer(foe[name], `${foe.id}.${name}`);
        }
        if (foe.hp > foe.maxHp) throw new Error(`${foe.id} HP exceeds maxHP`);
    }
}

function resolveTurn({ state, actions, rolls, rewardMode = 'immediate' }) {
    const s = copy(state);
    validate(s);
    if (!['fire_melee', 'ice_melee'].includes(actions?.qtik) ||
        !['visor', 'vitals', 'hamstring'].includes(actions?.tansy)) {
        throw new Error('This first version supports Fire/Ice Melee and Visor/Vitals/Hamstring');
    }
    if (!['immediate', 'deferred'].includes(rewardMode)) {
        throw new Error('rewardMode must be immediate or deferred');
    }
    if (!alive(s.foes).length) throw new Error('No living foes');

    const tape = rolls ?? {
        player: [die(), die(), die()],
        enemy: [die(), die(), die()]
    };
    for (const side of ['player', 'enemy']) {
        if (!Array.isArray(tape[side]) || tape[side].length !== 3 ||
            tape[side].some(n => !Number.isInteger(n) || n < 1 || n > 6)) {
            throw new Error(`${side} rolls must be three integers from 1 to 6`);
        }
    }

    const c = s.crew;
    const log = [];
    const kills = [];
    let exposed = integer(s.exposed ?? 0, 'exposed');
    let hexStacks = integer(s.hexStacks ?? 0, 'hexStacks');
    let earnedXp = 0;
    let earnedSilver = 0;

    function award(foe) {
        const base = (foe.role === 'brute' ? 4 : 2) * foe.level;
        const multiplier = foe.level >= c.level + 2 ? 1.25 :
            foe.level <= c.level - 10 ? 0 :
            foe.level <= c.level - 5 ? 0.5 : 1;
        const xp = Math.floor(base * multiplier);
        const silver = 2 * tier(foe.level);
        earnedXp += xp;
        earnedSilver += silver;
        kills.push({ id: foe.id, xp, silver });
        if (foe.role === 'hexer' && !alive(s.foes).some(f => f.role === 'hexer')) {
            hexStacks = 0;
        }
    }

    for (let i = 0; i < 3 && alive(s.foes).length && c.qtik.hp > 0; i++) {
        const p = tape.player[i];
        const e = tape.enemy[i];
        const enemyMiss = e === 1 || (actions.tansy === 'hamstring' && e === 2);
        const brute = alive(s.foes).find(f => f.role === 'brute');
        let target = alive(s.foes).find(f => f.id === actions.target) ?? alive(s.foes)[0];

        // A hitting Brute guards backliners unless Visor bypasses it.
        if (brute && target.role !== 'brute' && !enemyMiss &&
            actions.tansy !== 'visor') target = brute;

        const atk = c.atk - 2 * tier(14) * hexStacks;
        const effectiveDef = c.qtik.def +
            (actions.qtik === 'ice_melee' ? 2 : 0) -
            2 * tier(14) * hexStacks;
        const fire = actions.qtik === 'fire_melee'
            ? Math.max(3, Math.floor(c.atk / 5)) : 0;
        const crit = p === 6 || (actions.tansy === 'vitals' && p === 5);
        const exposedBonus = exposed;
        exposed = 0;

        let damage = p === 1 ? 1 :
            crit ? Math.max(6 + c.luk, atk - target.def + 6 + c.luk) :
            Math.max(1, atk - target.def + p +
                (actions.tansy === 'vitals'
                    ? Math.min(target.def, Math.floor(c.weasels.active / 2)) : 0));
        damage += fire + exposedBonus;

        const hits = [];
        let remaining = damage;
        let current = target;
        while (remaining > 0 && current) {
            const dealt = Math.min(current.hp, remaining);
            current.hp -= dealt;
            remaining -= dealt;
            hits.push({ id: current.id, damage: dealt, hp: current.hp });
            if (current.hp === 0) award(current);
            current = current.hp === 0 ? alive(s.foes)[0] : null;
        }

        let frontlineDamage = 0;
        let backlineDamage = 0;
        const effects = [];

        if (!enemyMiss && alive(s.foes).length) {
            const brutes = alive(s.foes).filter(f => f.role === 'brute');
            if (brutes.length) {
                const lead = brutes[0];
                let base = Math.max(1, Math.round((lead.atk - effectiveDef) / 10));
                if (actions.qtik === 'ice_melee') base = Math.max(1, base - 1);
                base += tier(lead.level) * (brutes.length - 1);
                frontlineDamage = base + (e === 6 ? 4 : e === 5 ? 2 :
                    e >= 3 ? 1 : 0);
            }
            for (const foe of [...alive(s.foes)]) {
                if (foe.role === 'archer') {
                    const hit = 4 * tier(foe.level) * (e === 6 ? 2 : 1);
                    backlineDamage += hit;
                    effects.push(`${foe.id} shoots Tansy for ${hit}`);
                }
                if (foe.role === 'mender') {
                    const wounded = alive(s.foes)
                        .filter(f => f.hp < f.maxHp)
                        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
                    if (wounded) {
                        const healed = Math.min(10 * tier(foe.level),
                            wounded.maxHp - wounded.hp);
                        wounded.hp += healed;
                        effects.push(`${foe.id} heals ${wounded.id} for ${healed}`);
                    }
                }
                if (foe.role === 'hexer' &&
                    !(actions.tansy === 'visor' && e <= 4)) {
                    hexStacks++;
                    effects.push(`${foe.id} adds one hex stack`);
                }
            }
        }

        c.qtik.hp = cap(c.qtik.hp - frontlineDamage, c.qtik.maxHp);
        c.tansy.hp = cap(c.tansy.hp - backlineDamage, c.tansy.maxHp);
        if (c.qtik.hp > 0) {
            c.qtik.hp = cap(c.qtik.hp + c.qtik.regen, c.qtik.maxHp);
        }
        if (actions.tansy === 'visor' && e === 1 && alive(s.foes).length) {
            exposed = c.luk;
        }
        log.push({
            exchange: i + 1, p, e, crit, target: target.id,
            damage, hits, enemyMiss, frontlineDamage, backlineDamage,
            effects, qtikHp: c.qtik.hp, tansyHp: c.tansy.hp
        });
    }

    if (rewardMode === 'immediate') {
        c.xp += earnedXp;
        c.purse += earnedSilver;
        while (c.xp >= 250 * c.level && c.level < 10) {
            c.xp -= 250 * c.level;
            c.level++;
            // Level-up stat growth is intentionally not applied until gear-derived
            // MaxHP/ATK/DEF can be rebuilt from an authoritative gear ledger.
        }
    }
    s.exposed = exposed;
    s.hexStacks = hexStacks;
    return {
        ok: true, rolls: tape, log, kills,
        rewards: { xp: earnedXp, silver: earnedSilver,
            applied: rewardMode === 'immediate' },
        state: s
    };
}

function consumeBelt({ belt, items }) {
    if (!Array.isArray(belt) || !Array.isArray(items) || !items.length) {
        throw new Error('Provide belt and a nonempty list of item IDs');
    }
    const remaining = [...belt];
    for (const item of items) {
        const index = remaining.indexOf(item);
        if (index === -1) throw new Error(`Belt does not contain: ${item}`);
        remaining.splice(index, 1);
    }
    return { ok: true, consumed: items, remainingBelt: remaining };
}

function registerTools() {
    const context = getContext();
    if (!context?.registerFunctionTool) {
        console.warn('Aethermoor Resolver: function tools unavailable');
        return;
    }
    context.registerFunctionTool({
        name: 'aethermoorResolveTurn',
        displayName: 'Aethermoor: Resolve Turn',
        description: 'Resolve exactly one declared three-exchange PvE turn. Supply state from the previous locked ledger. Use rewardMode deferred for an event whose payouts are settled later. Never use this tool to choose character actions.',
        parameters: {
            type: 'object',
            properties: {
                state: { type: 'object', description: 'Previous locked state: crew and foes.' },
                actions: {
                    type: 'object',
                    properties: {
                        qtik: { type: 'string', enum: ['fire_melee', 'ice_melee'] },
                        tansy: { type: 'string', enum: ['visor', 'vitals', 'hamstring'] },
                        target: { type: 'string' }
                    },
                    required: ['qtik', 'tansy', 'target']
                },
                rolls: {
                    type: 'object',
                    properties: {
                        player: { type: 'array', items: { type: 'integer' } },
                        enemy: { type: 'array', items: { type: 'integer' } }
                    },
                    required: ['player', 'enemy']
                },
                rewardMode: { type: 'string', enum: ['immediate', 'deferred'] }
            },
            required: ['state', 'actions']
        },
        action: async args => {
            try { return JSON.stringify(resolveTurn(args)); }
            catch (error) { return JSON.stringify({ ok: false, error: error.message }); }
        },
        formatMessage: () => 'Resolving Aethermoor turn...',
        stealth: false
    });

    context.registerFunctionTool({
        name: 'aethermoorConsumeBelt',
        displayName: 'Aethermoor: Consume Belt Items',
        description: 'Deduct specified item IDs from a four-slot belt. This does not decide who receives them or narrate what happens.',
        parameters: {
            type: 'object',
            properties: {
                belt: { type: 'array', items: { type: 'string' } },
                items: { type: 'array', items: { type: 'string' } }
            },
            required: ['belt', 'items']
        },
        action: async args => {
            try { return JSON.stringify(consumeBelt(args)); }
            catch (error) { return JSON.stringify({ ok: false, error: error.message }); }
        },
        formatMessage: () => 'Checking belt inventory...',
        stealth: false
    });
    console.log('Aethermoor Resolver tools registered');
}

jQuery(registerTools);
