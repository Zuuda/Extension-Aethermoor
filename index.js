import { getContext } from '../../../extensions.js';

const ZONE_NAMES = {
    1: 'Thornhaven',
    2: 'Reed-Fens',
    3: 'Blighted Marsh',
    4: 'Weeping Karst',
    5: 'Highgate Pass'
};
/*
 * ARCHITECTURE / CAMPAIGN CONTEXT
 *
 * Preserve the reasoning behind cross-system changes in comments.
 * Document invariants, migration assumptions, and unfinished integration;
 * do not merely describe what an individual line does.
 *
 * World invariants:
 * - Zone numbers control progression formulas, not settlement identity.
 * - Geography flows between neighboring regions.
 * - Zones may contain multiple independent settlements.
 * - Names are presentation; stable IDs identify places and factions.
 * - Generated world records are saved and must not be regenerated later.
 * - Quests must eventually lock their actual issuer and return location.
 * - World generation must not advance combat/loot RNG.
 *
 * This foundation does not yet replace the old quest-town defaults,
 * route graph, or UI name lookups. Those are subsequent integration steps.
 */

const WORLD_SCHEMA_VERSION = 1;

/*
 * Profiles describe traversable geographic regions, not a full planet
 * simulation. The LLM may elaborate scenery but cannot replace these facts.
 *
 * Multiple consecutive zones may share a profile. A transition changes
 * the terrain gradually rather than selecting an unrelated random biome.
 */
const WORLD_GEOGRAPHY = {
    valley: {
        label: 'river valley',
        next: ['marsh_edge', 'rising_hills'],
        zoneWords: ['Vale', 'Valley', 'Basin'],
        settlementWords: ['Bridge', 'Hearth', 'Crossing']
    },
    marsh_edge: {
        label: 'marsh outskirts',
        next: ['marsh', 'valley'],
        zoneWords: ['Fens', 'Reedlands', 'Wetlands'],
        settlementWords: ['Ford', 'Landing', 'Reedhaven']
    },
    marsh: {
        label: 'deep marsh',
        next: ['karst', 'marsh_edge'],
        zoneWords: ['Mire', 'Marsh', 'Sluices'],
        settlementWords: ['Cairn', 'Pilings', 'Outpost']
    },
    karst: {
        label: 'karst caverns',
        next: ['hills'],
        zoneWords: ['Karst', 'Hollows', 'Caverns'],
        settlementWords: ['Lantern', 'Vault', 'Delve']
    },
    hills: {
        label: 'open hills',
        next: ['rising_hills', 'valley', 'coastal_uplands'],
        zoneWords: ['Downs', 'Hills', 'Heights'],
        settlementWords: ['Gate', 'Rest', 'Hillstead']
    },
    rising_hills: {
        label: 'rising uplands',
        next: ['mountain'],
        zoneWords: ['Uplands', 'Ridges', 'Fells'],
        settlementWords: ['Watch', 'Climb', 'Highstead']
    },
    mountain: {
        label: 'mountain slopes below the snowline',
        next: ['snowline'],
        zoneWords: ['Crags', 'Peaks', 'Spines'],
        settlementWords: ['Hold', 'Aerie', 'Stonehaven']
    },
    snowline: {
        label: 'mountain snowline',
        next: ['high_mountain', 'descending_mountain'],
        zoneWords: ['Snowfields', 'White Ridges', 'Frostlands'],
        settlementWords: ['Shelter', 'Frosthold', 'Winterhearth']
    },
    high_mountain: {
        label: 'high snowy mountains',
        next: ['descending_mountain'],
        zoneWords: ['Summits', 'Icefields', 'High Passes'],
        settlementWords: ['Refuge', 'Peakwatch', 'Snowhaven']
    },
    descending_mountain: {
        label: 'descending mountain valleys',
        next: ['coastal_uplands', 'valley'],
        zoneWords: ['Thawlands', 'Lower Ridges', 'Steps'],
        settlementWords: ['Thawrest', 'Lowpass', 'Springhaven']
    },
    coastal_uplands: {
        label: 'uplands overlooking the coast',
        next: ['coast'],
        zoneWords: ['Sea Heights', 'Cliff Downs', 'Headlands'],
        settlementWords: ['Beacon', 'Seawatch', 'Cliffhaven']
    },
    coast: {
        label: 'coastal shores and tidal inlets',
        next: ['ocean', 'coastal_uplands'],
        zoneWords: ['Shores', 'Tideways', 'Inlets'],
        settlementWords: ['Harbor', 'Quay', 'Port']
    },
    ocean: {
        label: 'ocean crossings and inhabited sea routes',
        next: ['floating_city', 'archipelago'],
        zoneWords: ['Reach', 'Sea Roads', 'Blue Expanse'],
        settlementWords: ['Anchorage', 'Raftstead', 'Haven']
    },
    floating_city: {
        label: 'floating-city waters',
        next: ['archipelago', 'underwater'],
        zoneWords: ['Driftwaters', 'Floating Reaches', 'Anchor Sea'],
        settlementWords: ['Drift', 'Flotilla', 'Anchorhold']
    },
    underwater: {
        label: 'inhabited underwater passages',
        next: ['archipelago'],
        zoneWords: ['Deepways', 'Coral Halls', 'Sunken Reaches'],
        settlementWords: ['Pearlhold', 'Reefhaven', 'Glass Dome']
    },
    archipelago: {
        label: 'island chains',
        next: ['far_coast', 'ocean'],
        zoneWords: ['Isles', 'Island Chain', 'Reefs'],
        settlementWords: ['Island Port', 'Reefwatch', 'Palmhaven']
    },
    far_coast: {
        label: 'shores of another landmass',
        next: ['valley', 'hills', 'marsh_edge'],
        zoneWords: ['Far Shores', 'New Coast', 'Estuaries'],
        settlementWords: ['Landfall', 'New Harbor', 'Seagate']
    }
};

/*
 * Preserve established campaign geography. These are overrides, not the
 * maximum world size. Beyond Zone 7, compatible transitions are generated.
 *
 * Settlement names not yet established in play are generated placeholders.
 * They can later be renamed without changing IDs or quest ownership.
 */
const WORLD_ZONE_OVERRIDES = {
    1: {
        profile: 'valley',
        settlementName: 'Thornhaven',
        settlementNameEstablished: true
    },
    2: { profile: 'marsh_edge' },
    3: {
        profile: 'marsh',
        settlementName: 'Peat-Cairn Outpost',
        settlementNameEstablished: true
    },
    4: { profile: 'karst' },
    5: { profile: 'hills' },
    6: { profile: 'rising_hills' },
    7: { profile: 'mountain' }
};

const WORLD_NAME_ROOTS = [
    'Ash', 'Silver', 'Amber', 'Hollow', 'Grey', 'Dawn',
    'Raven', 'Willow', 'Ember', 'Still', 'Storm', 'Moon',
    'Copper', 'Bright', 'Dusky', 'Whisper', 'Iron', 'Star'
];

function worldHash(text) {
    let hash = 2166136261;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function worldChoice(world, key, values) {
    assert(values.length > 0, 'World choice needs options');

    return values[
        worldHash(`${world.seed}:${key}`) % values.length
    ];
}

function createWorldSeed() {
    const values = new Uint32Array(1);

    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(values);
        return values[0] || 1;
    }

    return worldHash(`${Date.now()}:${Math.random()}`) || 1;
}

function ensureWorldRecords(state) {
    let changed = false;

    if (!state.world) {
        state.world = {
            version: WORLD_SCHEMA_VERSION,
            seed: createWorldSeed(),
            zones: {},
            settlements: {}
        };
        changed = true;
    }

    const world = state.world;

    assert(
        world.version === WORLD_SCHEMA_VERSION,
        'Unsupported saved world version'
    );
    assert(
        Number.isInteger(world.seed) && world.seed > 0,
        'Saved world seed is invalid'
    );

    world.zones ||= {};
    world.settlements ||= {};

    int(state.zone, 'world zone', 1);

    /*
     * Keep the current zone plus one upcoming zone available so the
     * next primary-settlement route exists before the crew reaches it.
     * The extra zone is world metadata only; it does not move the crew.
     */
    const lastZone = Math.max(5, state.zone + 1);

    for (let number = 1; number <= lastZone; number++) {
        if (world.zones[number]) continue;

        const previous = world.zones[number - 1];
        const override = WORLD_ZONE_OVERRIDES[number] || {};
        let profile = override.profile;

        if (!profile) {
            assert(previous, 'Previous zone geography is missing');

            const previousProfile = previous.geography.profile;

            /*
             * Later regions last 2–3 progression zones before moving
             * into a compatible neighboring geographic profile.
             */
            const regionLength = 2 + (
                worldHash(`${world.seed}:region:${previous.regionStart}`) % 2
            );
            const regionAge = number - previous.regionStart;

            profile = regionAge < regionLength
                ? previousProfile
                : worldChoice(
                    world,
                    `transition:${number}`,
                    WORLD_GEOGRAPHY[previousProfile].next
                );
        }

        const geography = WORLD_GEOGRAPHY[profile];
        assert(geography, `Unknown geography profile: ${profile}`);

        // Existing campaign names remain presentation labels.
        // New regions use neutral labels; the narrator may name them.
        const zoneName = ZONE_NAMES[number] || `Zone ${number}`;
        const settlementId = `settlement-z${number}-primary`;

        // Keep route IDs stable for existing saves and journeys.
        const locationId = `outpost-z${number}`;
        const settlementName =
            override.settlementName ||
            `Primary settlement, Zone ${number}`;


        world.zones[number] = {
            id: `zone-${number}`,
            number,
            name: zoneName,
            levelRange: [5 * number - 4, 5 * number],
            primarySettlementId: settlementId,
            nameSource: override.settlementNameEstablished
                ? 'established'
                : 'mechanical_label',
            regionStart:

                previous?.geography.profile === profile
                    ? previous.regionStart
                    : number,
            geography: {
                profile,
                description: geography.label,
                transitionFrom:
                    previous?.geography.profile || null,
                compatibleNext: [...geography.next]
            }
        };

        world.settlements[settlementId] = {
            id: settlementId,
            zone: number,
            locationId,
            label: settlementName,
            primary: true,
            nameEstablished:
                override.settlementNameEstablished === true,

            // Preserve existing reputation keys during migration.
            reputationKey:
                override.settlementNameEstablished === true
                    ? settlementName
                    : settlementId
        };

        changed = true;
    }

    /*
     * Preserve the known secondary settlement without inventing its
     * roads, NPC schedules, reputation, or quest history.
     */
    const campId = 'settlement-fen-trollkin-stilt-camp';

    if (!world.settlements[campId]) {
        world.settlements[campId] = {
            id: campId,
            zone: 3,
            locationId: 'settlement-fen-trollkin-stilt-camp',
            label: 'Fen-Trollkin Stilt-Camp',
            primary: false,
            nameEstablished: true,
            reputationKey: campId
        };
        changed = true;
    }
    state.reputation ||= {};

    if (!state.reputation) {
        state.reputation = {};
        changed = true;
    }

    for (const settlement of Object.values(world.settlements)) {
        if (!state.reputation[settlement.reputationKey]) {
            state.reputation[settlement.reputationKey] = {
                tier: 'Unknown',
                steps: 0
            };
            changed = true;
        }
    }

        /*
     * Connect neighboring primary settlements. These are abstract travel
     * segments, not time estimates. Existing edges are never replaced.
     */
    state.routeEdges ||= [];

    assert(
        Array.isArray(state.routeEdges),
        'state.routeEdges must be an array'
    );

    const generatedZoneNumbers =
        Object.keys(world.zones)
            .map(Number)
            .filter(Number.isInteger)
            .sort((a, b) => a - b);

    for (const number of generatedZoneNumbers) {
        const nextNumber = number + 1;

        if (!world.zones[nextNumber]) continue;

        const fromSettlement =
            world.settlements[
                world.zones[number].primarySettlementId
            ];

        const toSettlement =
            world.settlements[
                world.zones[nextNumber].primarySettlementId
            ];

        if (!fromSettlement || !toSettlement) continue;

        const exists = state.routeEdges.some(edge =>
            (
                edge.fromId === fromSettlement.locationId &&
                edge.toId === toSettlement.locationId
            ) ||
            (
                edge.fromId === toSettlement.locationId &&
                edge.toId === fromSettlement.locationId
            )
        );

        if (!exists) {
            state.routeEdges.push({
                fromId: fromSettlement.locationId,
                toId: toSettlement.locationId,
                length: 3,
                kind: 'zone_transition',
                fromZone: number,
                toZone: nextNumber
            });
            changed = true;
        }
    }

        /*
     * A known rumor destination must be reachable through the route graph,
     * otherwise World can show the rumor but cannot offer a travel command.
     * Keep this as saved route data—not a UI-side route guess—so explicit
     * travel and route previews use the same connection.
     */
    for (const lead of Object.values(state.leads || {})) {
        if (
            lead?.kind !== 'rumor' ||
            lead.status !== 'known' ||
            lead.targetType !== 'place' ||
            lead.testOnly === true
        ) {
            continue;
        }

        const place = state.places?.[lead.targetId];
        const zone = Number(place?.zone);
        const zoneRecord = world.zones[zone];

        if (
            !place ||
            !Number.isInteger(zone) ||
            !zoneRecord
        ) {
            continue;
        }

        const settlement =
            world.settlements[zoneRecord.primarySettlementId];

        if (
            !settlement?.locationId ||
            settlement.locationId === place.id
        ) {
            continue;
        }

        const alreadyConnected = state.routeEdges.some(edge =>
            edge.fromId === place.id ||
            edge.toId === place.id
        );

        if (alreadyConnected) {
            continue;
        }

        state.routeEdges.push({
            fromId: settlement.locationId,
            toId: place.id,
            length: 2,
            kind: 'rumor_site_access',
            fromZone: zone,
            toZone: zone
        });

        changed = true;
    }

    return changed;

}

function savedZoneRecord(state, zone = state.zone) {
    const record = state.world?.zones?.[zone];
    assert(record, `Zone ${zone} has no saved world record`);
    return record;
}

function savedPrimarySettlement(state, zone = state.zone) {
    const zoneRecord = savedZoneRecord(state, zone);
    const settlement =
        state.world.settlements[zoneRecord.primarySettlementId];

    assert(settlement, `Zone ${zone} has no primary settlement`);
    return settlement;
}

function questIssuerSettlement(state, test = {}) {
    const requestedId =
        test.settlementId ||
        test.originSettlementId ||
        null;

    if (requestedId) {
        const requested =
            Object.values(state.world?.settlements || {})
                .find(settlement => settlement.id === requestedId);

        assert(
            requested,
            `Unknown quest settlement: ${requestedId}`
        );

        return requested;
    }

    const currentLocation =
        state.currentLocationId &&
        Object.values(state.world?.settlements || {})
            .find(settlement =>
                settlement.locationId === state.currentLocationId
            );

    if (currentLocation) {
        return currentLocation;
    }

    return savedPrimarySettlement(state, state.zone);
}

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

function migrateEncounterPotionUsage(encounter) {
    normalizeEncounterPotionUses(encounter);
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
    migrateEncounterPotionUsage(encounter);
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

function resolveClearedPackDrop(state) {
    const encounter = state.encounter;
    const ordinaryPack =
        encounter.type === 'normal_pack' ||
        (
            encounter.type === 'declared' &&
            encounter.foes.every(foe =>
                ['brute', 'archer', 'mender', 'hexer', 'buffer']
                    .includes(foe.role)
            ) &&
            !encounter.reinforcementLog?.length
        );

    // Quest-terminal fights have their own reward path.
    if (!ordinaryPack || encounter.questTerminal) return null;

    assert(
        encounter.packDropRoll == null,
        'This pack already has a drop roll'
    );

    const value = roll(state, 10);
    encounter.packDropRoll = value;

    if (value <= 8) {
        return { roll: value, result: 'auto_salvage_only' };
    }

    if (value === 10) {
        encounter.questSeed = {
            source: 'pack_drop',
            roll: value,
            result: 'diegetic_quest_breadcrumb'
        };
        encounter.questSeedConsumed = false;
        return { roll: value, result: 'diegetic_quest_breadcrumb' };
    }

    encounter.lootSeed = {
        source: 'pack_drop',
        roll: value,
        result: 'wild_equipment_drop',
        claimed: true
    };

    const generated = rollLootFromState(
        state,
        'wild',
        encounter.zone
    );
    const item = {
        ...generated.item,
        acquiredFrom: 'pack_drop',
        acquiredAtEncounter: encounter.id,
        bound: false
    };
    state.inventory.bagReserves.push(item);

    return {
        roll: value,
        result: 'wild_equipment_drop',
        item
    };
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
    const packDrop = resolveClearedPackDrop(state);
    if (packDrop?.item) loot.push(packDrop.item);

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
        packDrop,
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

    const potionUses =
        normalizeEncounterPotionUses(encounter);

    assert(
        potionUses[recipient] < 4,
        `${recipient} has already used four potions this encounter`
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
    potionUses[recipient] += 1;
    encounter.potionsUsed =
        potionUses.qtik + potionUses.tansy;


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

        /*
     * Stacking debuffs currently affect shared Crew mechanics rather
     * than separate character status lists. Either protagonist can
     * cleanse them, spending their own potion allowance.
     *
     * Stamp immunity with the current encounter turn instead of a
     * decrementing duration. This covers all three exchanges and expires
     * automatically when resolveTurn increments encounter.turn again.
     * Repeated UI reads cannot extend the protection.
     */
    let stacksRemoved = Object.values(encounter.hexStacks || {})
        .reduce((total, stacks) => total + Number(stacks), 0);

    encounter.hexStacks = {};

    for (const foe of encounter.foes) {
        if (!['elite', 'boss'].includes(foe.role)) continue;

        stacksRemoved += Number(foe.passiveStacks || 0);
        foe.passiveStacks = 0;
    }

    encounter.debuffImmunityTurn = encounter.turn;

    return {
        item,
        recipient,
        effect: 'cleanse',
        scope: 'crew',
        stacksRemoved,
        immunityTurn: encounter.turn,
        note:
            'All Hex and Elite/Boss passive stacks cleared; ' +
            'new applications blocked for this turn.',
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

    const previous =
        foe.nextTelegraph ||
        foe.lastCancelledTelegraph ||
        null;

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

function spawnLinkedQuestEncounter(state) {
    const quest = state.activeQuest;
    const gate = quest?.currentGate;

    assert(
        quest?.status === 'in_progress' &&
        quest.structureV2?.family === 'defeat_elite' &&
        gate?.trigger === 'linked_combat',
        'There is no V2 linked-combat gate to spawn'
    );

    assert(
        typeof quest.targetId === 'string' &&
        gate.linkedTargetId === quest.targetId,
        'Linked-combat gate has no matching authored target'
    );

    assert(
        quest.terminalThreat?.resolved !== true,
        'Linked quest threat has already been defeated'
    );

    assert(
        !['active', 'spotted'].includes(state.encounter?.status),
        'Resolve or avoid the current encounter before spawning the quest threat'
    );

    const spawned = spawnEncounter({
        state,
        encounterType: 'quest_terminal',
        encounterId: `quest-terminal-${quest.id}`
    });

    const nextState = spawned.state;
    const encounter = nextState.encounter;
    const activeQuest = nextState.activeQuest;

    encounter.status = 'spotted';
    encounter.questTerminal ||= {
        questId: activeQuest.id,
        kind: encounter.type,
        zone: encounter.zone
    };
    encounter.questTerminal.targetId = activeQuest.targetId;

    activeQuest.terminalThreat.revealed = true;
    activeQuest.terminalThreat.resolved = false;
    activeQuest.terminalThreat.encounterId = encounter.id;
    activeQuest.terminalThreat.targetId = activeQuest.targetId;

    if (activeQuest.seed?.terminalThreat) {
        activeQuest.seed.terminalThreat.encounterId = encounter.id;
    }

    return {
        state: nextState,
        encounter
    };
}

function completeLinkedCombatQuestGate(state) {
    const quest = state.activeQuest;
    const encounter = state.encounter;
    const gate = quest?.currentGate;

    if (
        quest?.status !== 'in_progress' ||
        gate?.trigger !== 'linked_combat' ||
        !encounter?.questTerminal ||
        encounter.status !== 'cleared' ||
        encounter.questTerminal.questId !== quest.id ||
        encounter.questTerminal.targetId !== gate.linkedTargetId ||
        gate.linkedTargetId !== quest.targetId ||
        quest.terminalThreat?.resolved !== true
    ) {
        return null;
    }

    const evidence =
        `Defeated the linked quest target at ` +
        `${state.places?.[quest.destinationId]?.label ||
            quest.destinationId}.`;

    const progression = gate.step < quest.gates
        ? resolveQuestAction({
            state,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence: evidence
        })
        : resolveQuestAction({
            state,
            action: 'resolve_objective',
            objectiveCompleted: true,
            objectiveRoute: 'combat',
            completionEvidence: evidence
        });

    /*
     * resolveQuestAction works on a clone. Copy its quest-related changes
     * back into the combat state; otherwise the fight can clear and pay
     * rewards while the saved quest remains on its old gate.
     *
     * Keep the current encounter object in place because resolveTurn still
     * updates it after this function returns.
     */
    state.activeQuest = progression.state.activeQuest;
    state.leads = progression.state.leads;

    return {
        completed: progression.completedGate || clone(gate),
        next: progression.nextGate || null,
        objectiveSecured:
            Boolean(state.activeQuest.objectiveResolution)
    };
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
        c.qtik.hp > 0 && c.tansy.hp > 0,
        'Cannot resolve a combat turn after a crew member has fallen; resolve death or respawn first'
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

            // Keep the cancelled telegraph as the anti-repeat reference
            // when selecting this foe's next telegraph.
            stunnedEliteBoss.lastCancelledTelegraph =
                stunnedEliteBoss.nextTelegraph;
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
    /*
     * Crew-wide immunity does not stack. Reject a redundant pair before
     * either potion is consumed; the stored operation remains unchanged.
     */
    assert(
        !(
            actions.qtik === 'drink' &&
            actions.qtikItem === 'cleansing_tonic' &&
            actions.tansy === 'drink' &&
            actions.tansyItem === 'cleansing_tonic'
        ),
        'One cleansing tonic protects the whole crew for this turn; ' +
        'choose a different action or potion for the other character'
    );

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

        /*
         * Like Fire, the stance bonus scales from derived stats before
         * encounter debuffs. Debuffs still reduce the resulting DEF.
         * The separate -1 Base Bleed benefit remains unchanged.
         */
        const iceDefenseBonus = actions.qtik === 'ice_melee'
            ? Math.max(2, Math.floor(crewStats.def / 3))
            : 0;

        const effectiveDefense = Math.max(
            0,
            crewStats.def -
            hexPenalty -
            passiveDefensePenalty(encounter) +
            iceDefenseBonus
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
                    if (encounter.debuffImmunityTurn === encounter.turn) {
                        effects.push(
                            `Cleansing immunity blocked ${foe.id}'s Hex`
                        );
                        continue;
                    }

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
        if (encounter.debuffImmunityTurn === encounter.turn) {
            effects.push(
                `Cleansing immunity blocked ${foe.id}'s passive stacks`
            );
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
     * Swarm Momentum replenishes missing loose weasels after a full
     * three-exchange turn while both protagonists and a foe survive.
     * Recovery uses available loose-weasel capacity, so depletion does
     * not weaken recovery and losses from earlier turns remain eligible.
     * Active Shadows retain their occupied slots. Surge remains the
     * immediate refill before exchanges; Momentum occurs afterward.
     */

    let momentum = null;

    if (
        logs.length === 3 &&
        live(s).length > 0 &&
        c.qtik.hp > 0 &&
        c.tansy.hp > 0
    ) {
        const activeBefore = c.weasels.active;
        const looseCapacity =
            maxWeasels - shadowMechanics(c).slots;
        const missing = Math.max(0, looseCapacity - activeBefore);
        const quota = 1 + Math.floor(looseCapacity / 4);
        const restored = Math.min(missing, quota);
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

        /*
     * Resolve incapacitation automatically after the turn's exchanges.
     * If all foes were defeated, normal victory/reward resolution takes
     * precedence; otherwise the existing death penalty and respawn apply.
     */
    const fallenCrewMember =
        c.qtik.hp <= 0
            ? 'qtik'
            : c.tansy.hp <= 0
                ? 'tansy'
                : null;

    if (fallenCrewMember && live(s).length > 0) {
        const deathResult = resolveDeathPenalty({
            state: s
        });

        const deathState = deathResult.state;

        return {
            ok: true,
            turn: deathState.encounter.turn,
            rolls: tape,
            flee: fleeing ? tape.flee : null,
            itemUse,
            exchanges: logs,
            turnEffects: [
                ...turnEffects,
                `${fallenCrewMember} fell; death penalty and respawn applied`
            ],
            weaselsDestroyed,
            momentum,
            fodderBlitz,
            kills,
            rewards: {
                xp: 0,
                silver: 0,
                applied: false,
                resolved: false,
                loot: [],
                packDrop: null,
                trophies: []
            },
            levelUps: [],
            questGate: null,
            packCleared: false,
            death: {
                fallenCrewMember,
                xpLost: deathResult.xpLost,
                respawned: deathResult.respawned,
                encounterAbandoned: deathResult.encounterAbandoned
            },
            state: deathState,
            derived: derived(deathState.crew)
        };
    }

    const encounterRewards = finalizeEncounterRewards(
        s,
        kills.map(kill => kill.id)
    );

    let levelUps = [];
    let questGate = null;

    if (encounterRewards.resolved) {
        levelUps = applyXp(c, encounterRewards.xp);
        c.purse += encounterRewards.silver;
        questGate = completeLinkedCombatQuestGate(s);
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
            delete foe.lastCancelledTelegraph;
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
            packDrop: encounterRewards.packDrop || null,
            trophies: encounterRewards.trophies
        },

        levelUps,
        questGate,
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
                const result =
                    name === 'aethermoorResolveTurnV2'
                        ? await runStoredMechanic(args)
                        : await operation(args);

                return JSON.stringify(result);
            } catch (error) {
                return JSON.stringify({
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : String(error)
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
    assert(
        test.state && typeof test.state === 'object',
        'spawn requires state'
    );

    const state = clone(test.state);

    assert(state.crew, 'spawn requires state.crew');
    assert(state.crew.qtik, 'spawn requires state.crew.qtik');
    assert(state.crew.tansy, 'spawn requires state.crew.tansy');
    assert(state.crew.weasels, 'spawn requires state.crew.weasels');
    assert(state.crew.gear?.tansy, 'spawn requires state.crew.gear.tansy');
    assert(state.crew.gear?.qtik, 'spawn requires state.crew.gear.qtik');

    assert(
        state.inventory &&
        typeof state.inventory === 'object' &&
        !Array.isArray(state.inventory),
        'spawn requires top-level state.inventory; do not nest it inside state.crew'
    );

    state.inventory.bagReserves ??= [];
    state.inventory.activeTradeListings ??= [];

    assert(
        Array.isArray(state.inventory.bagReserves),
        'spawn requires state.inventory.bagReserves to be an array'
    );
    assert(
        Array.isArray(state.inventory.activeTradeListings),
        'spawn requires state.inventory.activeTradeListings to be an array'
    );

    // Spawn callers may provide the zone directly or rely on the saved state.
    const zone = test.zone ?? state.zone;

    assert(
        Number.isInteger(zone) && ZONES[zone],
        `Unknown zone: ${zone}`
    );

    test = { ...test, zone };

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
        assert(
            !activeQuest.objectiveResolution,
            'Quest objective is already secured'
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
            activeQuest.terminalThreat.resolved !== true &&
            (
                activeQuest.terminalThreat.revealed !== true ||
                (
                    ['fled', 'dead'].includes(state.encounter?.status) &&
                    state.encounter.questTerminal?.questId === activeQuest.id
                )
            ),
            'Quest terminal threat cannot be spawned again'
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
        assert(
            Number.isInteger(test.zone) &&
            ZONES[test.zone],
            `Unknown zone: ${test.zone}`
        );

        const siteAffinity =
            test.siteAffinity || 'ordinary';

        assert(
            ['ordinary', 'ruin', 'barrow', 'lair'].includes(siteAffinity),
            `Unsupported wild site affinity: ${siteAffinity}`
        );

        encounterTypeRoll =
            roll(state, 100);

        const siteBonus =
            siteAffinity === 'ordinary' ? 0 : 15;

const eliteChance =
    siteAffinity === 'ordinary'
        ? Math.min(15, 10 + test.zone)
        : Math.min(30, 10 + test.zone + siteBonus);


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
    // Ordinary spawns are discoveries first. The player chooses when
    // to engage after the discovery has been narrated.
if (!questTerminal) {
    spawned.encounter.status = 'spotted';
}

    state.zone = test.zone;
    state.encounter = spawned.encounter;
    validate(state);

    return {
        ...spawned,

        rngState: state.rngState,
        state
    };
}

const TRAVELER_RUMORS = [
    {
        id: 'old-mill',
        place: 'Old Mill',
        claim: 'A traveler says lights have been seen inside the Old Mill after dark.'
    },
    {
        id: 'stone-ford',
        place: 'Stone Ford',
        claim: 'A traveler says someone has been leaving fresh supplies at Stone Ford.'
    },
    {
        id: 'abandoned-watchtower',
        place: 'Abandoned Watchtower',
        claim: 'A traveler says the Abandoned Watchtower has been occupied recently.'
    }
];

const ROUTE_SEGMENT_EDGES = [
    ['outpost', 'stone-ford', 1],
    ['stone-ford', 'old-mill', 2],
    ['stone-ford', 'abandoned-watchtower', 3],
    ['old-mill', 'abandoned-watchtower', 2]
];

function ensureWorldLocation(state) {
    state.places ||= {};
    state.leads ||= {};

    state.currentLocationId ||= routeNodeId(state.zone, 'outpost');

    state.places[state.currentLocationId] ||= {
        id: state.currentLocationId,
        label: state.currentLocationId === routeNodeId(state.zone, 'outpost')
            ? 'Peat-Cairn Outpost'
            : state.currentLocationId,
        zone: state.zone,
        kind: 'settlement'
    };

    return state.currentLocationId;
}

function routeNodeId(zone, place) {
    return place === 'outpost'
        ? `outpost-z${zone}`
        : `place-z${zone}-${place}`;
}

function routeEdgeLength(fromId, toId, zone) {
    for (const [from, to, length] of ROUTE_SEGMENT_EDGES) {
        const a = routeNodeId(zone, from);
        const b = routeNodeId(zone, to);
        if ((a === fromId && b === toId) ||
            (a === toId && b === fromId)) return length;
    }
    return null;
}

function journeyLegs(journey, zone) {
    if (Array.isArray(journey.legs)) return journey.legs;

    // Journeys started before this change contain a node path instead.
    assert(Array.isArray(journey.route), 'Journey route is missing');
    journey.legs = journey.route.slice(1).map((toId, index) => {
        const fromId = journey.route[index];
        const length = routeEdgeLength(fromId, toId, zone);
        assert(length !== null, 'Journey uses an unknown route edge');
        return { fromId, toId, length, startOffset: 0, endOffset: length };
    });
    return journey.legs;
}

function positionAfterSegments(legs, completed) {
    let remaining = completed;
    for (const leg of legs) {
        const distance = Math.abs(leg.endOffset - leg.startOffset);
        if (remaining < distance) {
            const direction = Math.sign(leg.endOffset - leg.startOffset);
            return {
                fromId: leg.fromId,
                toId: leg.toId,
                length: leg.length,
                offset: leg.startOffset + direction * remaining
            };
        }
        remaining -= distance;
        if (remaining === 0) {
            return {
                nodeId: leg.endOffset === 0 ? leg.fromId : leg.toId
            };
        }
    }
    assert(remaining === 0, 'Journey progress exceeds its route');
    const last = legs.at(-1);
    return last ? {
        nodeId: last.endOffset === 0 ? last.fromId : last.toId
    } : null;
}

function shortestRoute(state, destinationId) {
    const zone = state.zone;
    const edges = [
        ...ROUTE_SEGMENT_EDGES.map(([from, to, length]) => ({
            fromId: routeNodeId(zone, from),
            toId: routeNodeId(zone, to),
            length
        })),
        ...(state.routeEdges || []).filter(edge =>
            Number.isInteger(edge.length) && edge.length > 0
        )
    ];

    function fromNode(originId) {
        const distances = new Map([[originId, 0]]);
        const previous = new Map();
        const visited = new Set();

        while (true) {
            let current = null;
            let best = Infinity;
            for (const [id, distance] of distances) {
                if (!visited.has(id) && distance < best) {
                    current = id;
                    best = distance;
                }
            }
            if (current === null || current === destinationId) break;
            visited.add(current);
            for (const edge of edges) {
                const neighbor = edge.fromId === current
                    ? edge.toId
                    : edge.toId === current ? edge.fromId : null;
                if (!neighbor) continue;
                const candidate = best + edge.length;
                if (candidate < (distances.get(neighbor) ?? Infinity)) {
                    distances.set(neighbor, candidate);
                    previous.set(neighbor, current);
                }
            }
        }

        if (!distances.has(destinationId)) return null;
        const path = [destinationId];
        while (path[0] !== originId) {
            const parent = previous.get(path[0]);
            if (!parent) return null;
            path.unshift(parent);
        }
        const legs = path.slice(1).map((toId, index) => {
            const fromId = path[index];
            const length = edges.find(edge =>
                (edge.fromId === fromId && edge.toId === toId) ||
                (edge.fromId === toId && edge.toId === fromId)
            )?.length;
            assert(Number.isInteger(length), 'Route edge has no length');
            return { fromId, toId, length, startOffset: 0, endOffset: length };
        });
        return { totalSegments: distances.get(destinationId), path, legs };
    }

    let position = state.currentPosition;
    if (!position && state.currentJourney) {
        position = positionAfterSegments(
            journeyLegs(state.currentJourney, zone),
            state.currentJourney.completedSegments
        );
    }
    position ||= {
        nodeId: state.currentLocationId || routeNodeId(zone, 'outpost')
    };

    // A position exactly at an edge endpoint is a node, not a partial leg.
    if (!position.nodeId && position.offset <= 0) {
        position = { nodeId: position.fromId };
    } else if (
        !position.nodeId &&
        position.offset >= position.length
    ) {
        position = { nodeId: position.toId };
    }

    if (position.nodeId) {

        const route = fromNode(position.nodeId);
        return route && {
            ...route,
            originId: position.nodeId,
            destinationId
        };
    }

    // From partway along an edge, compare continuing forward with
    // doubling back. Both options include the remaining route.
    const options = [
        {
            endpoint: position.fromId,
            partial: {
                ...position,
                startOffset: position.offset,
                endOffset: 0
            }
        },
        {
            endpoint: position.toId,
            partial: {
                ...position,
                startOffset: position.offset,
                endOffset: position.length
            }
        }
    ];
    const candidates = options.map(option => {
        const onward = fromNode(option.endpoint);
        if (!onward) return null;
        return {
            originId: position.fromId,
            destinationId,
            path: onward.path,
            legs: [option.partial, ...onward.legs],
            totalSegments:
                Math.abs(option.partial.endOffset - position.offset) +
                onward.totalSegments
        };
    }).filter(Boolean);

    return candidates.sort((a, b) =>
        a.totalSegments - b.totalSegments
    )[0] || null;
}

function recordCrewKnowledge(state, entry) {
    state.discoveries ||= {};

    assert(
        state.discoveries &&
        typeof state.discoveries === 'object' &&
        !Array.isArray(state.discoveries),
        'state.discoveries must be an object'
    );

    assert(
        typeof entry.id === 'string' &&
        entry.id.length > 0,
        'Crew knowledge record requires a stable ID'
    );

    // Arrival may be processed again after reload. Keep its original record.
    if (state.discoveries[entry.id]) {
        return state.discoveries[entry.id];
    }

    const record = {
        id: entry.id,
        kind: entry.kind,
        knowledgeType: entry.knowledgeType,
        certainty: entry.certainty,
        summary: entry.summary,
        source: clone(entry.source),
        learnedAtLocationId: entry.learnedAtLocationId,
        learnedAtZone: entry.learnedAtZone
    };

    assert(
        typeof record.kind === 'string' &&
        typeof record.knowledgeType === 'string' &&
        typeof record.certainty === 'string' &&
        typeof record.summary === 'string' &&
        record.summary.length > 0,
        'Crew knowledge record is incomplete'
    );

    assert(
        record.source &&
        typeof record.source.id === 'string' &&
        record.source.id.length > 0,
        'Crew knowledge record requires a stable source reference'
    );

    state.discoveries[record.id] = record;
    return record;
}

function resolveArrivedRumors(stateInput) {
    /*
     * Arrival establishes a rumor's opening scene, not a complete search.
     * Reuse the existing locked inquiry and quest-generation mechanics.
     * This first integration deliberately retains the existing outcome table;
     * Elite encounters and local exploration need separate outcome contracts.
     *
     * A genuine hook can be discovered while another quest occupies the slot.
     * Preserve its locked inquiry and issuer, then offer it on a later saved
     * operation while the crew is still here and the quest slot is available.
     * Never reroll the rumor merely because its offer had to wait.
     */
    let state = stateInput;
    const packets = [];
    const resolutions = [];

    if (
        state.currentJourney ||
        !state.currentLocationId ||
        ['active', 'spotted'].includes(state.encounter?.status)
    ) {
        return { state, packets, resolutions };
    }

    const leadIds = Object.values(state.leads || {})
        .filter(lead =>
            lead?.kind === 'rumor' &&
            lead.status === 'known' &&
            lead.targetType === 'place' &&
            lead.targetId === state.currentLocationId &&
            (
                lead.testOnly !== true ||
                lead.arrivalTest === true
            )

        )
        .map(lead => lead.id);

    if (leadIds.length === 0) {
        return { state, packets, resolutions };
    }

    state = clone(state);

    for (const leadId of leadIds) {
        let lead = state.leads[leadId];
        const place = state.places?.[lead.targetId];

        assert(place, 'Arrived rumor destination is missing');

        let arrival = lead.arrivalResolution;

        if (!arrival) {
            const issuer = questIssuerSettlement(state);
            const checked = resolveBatch({
                cases: [{
                    name: 'resolve_arrived_rumor_inquiry',
                    kind: 'world_seeds',
                    state,
                    inquiryId: leadId,
                    investigatedRumor: true
                }]
            });

            const inquiryResult = checked.results?.[0]?.result;

            assert(
                checked.ok === true && inquiryResult?.state,
                checked.results?.[0]?.error ||
                    'Could not resolve the arrived rumor'
            );

            state = inquiryResult.state;
            lead = state.leads[leadId];

            arrival = {
                locationId: place.id,
                zone: state.zone,
                settlementId: issuer.id,
                finding: inquiryResult.findings.rumor,
                announced: false
            };

            lead.arrivalResolution = arrival;
        }

        const isQuestHook =
            arrival.finding ===
                'genuine_unclaimed_quest_or_dungeon_hook';

        let offeredQuest = null;
        let offerDeferred = false;

               if (isQuestHook) {
            /*
             * An existing offer or accepted quest no longer defers this
             * opportunity. Quest generation saves the new offer in the
             * journal while preserving the compatibility-selected quest.
             * The locked inquiry remains the one-off creation boundary.
             */
            const offered = resolveQuestSeed({
                state,
                inquiryId: leadId,
                zone: arrival.zone,
                settlementId: arrival.settlementId
            });

            state = offered.state;
            offeredQuest = offered.created
                ? offered.quest
                : null;

            lead = state.leads[leadId];
            arrival = lead.arrivalResolution;
        }

        if (!offerDeferred) {
            lead.status = 'investigated';
            lead.finding = arrival.finding;

            recordCrewKnowledge(state, {
                id: `knowledge-rumor-arrival-${lead.id}`,
                kind: 'rumor_resolution',
                knowledgeType: 'observation',
                certainty: 'engine_established',
                summary:
                    `The crew learned that this rumor resolved as ` +
                    `${arrival.finding.replaceAll('_', ' ')}.`,
                source: {
                    id: lead.id,
                    type: 'rumor'
                },
                learnedAtLocationId: place.id,
                learnedAtZone: arrival.zone
            });
        }

        const shouldAnnounce =
            arrival.announced !== true ||
            Boolean(offeredQuest);

        if (!shouldAnnounce) continue;

        const lines = [
            'AUTHORITATIVE RUMOR ARRIVAL RESULT.',
            `Destination: ${place.label}.`
        ];

        if (offeredQuest) {
            lines.push(
                questOfferNarrationPacket(offeredQuest),
                'The offer remains unaccepted. Leave acceptance to the player.'
            );
        } else if (offerDeferred) {
            lines.push(
                'This rumor has a genuine hook, but its quest offer is pending',
                'because another quest or offer already occupies the quest slot.',
                'Do not invent the pending quest, its requirements, or rewards.',
                'Do not claim that the destination is empty or exhausted.'
            );
        } else if (
            arrival.finding === 'travelogue_flub_benign_oddity'
        ) {
            lines.push(
                'The claim resolves as a mistaken travelogue or benign oddity.',
                'Give the visit a modest, setting-appropriate explanation or',
                'point of interest. Do not add encounters, hidden loot, quest',
                'items, mechanically consequential lore, or another quest.',
                'Make it clear that this particular rumor is concluded; the',
                'crew need not keep searching to unlock an undisclosed reward.'
            );
        } else if (
            arrival.finding === 'already_cleared_by_other_immortals'
        ) {
            lines.push(
                'Other immortals have already cleared the subject of this rumor.',
                'Describe visible evidence consistent with that result.',
                'This rumor is concluded and has no remaining reward or threat.',
                'Do not imply that the crew must search harder to find its content.'
            );
        } else {
            throw new Error(
                `Unsupported arrived rumor finding: ${arrival.finding}`
            );
        }

        lines.push(
            'Arrival does not automatically search hidden areas, enter a site,',
            'start combat, acquire objects, or grant rewards.',
            'The protagonists may stay, leave, or interact through the fiction.'
        );

        arrival.announced = true;

        packets.push(lines.join('\n'));
        resolutions.push({
            leadId,
            destinationId: place.id,
            finding: arrival.finding,
            offerDeferred,
            questId: offeredQuest?.id || null
        });
    }

    return { state, packets, resolutions };
}

function resolveJourneyAction(test) {
    assert(test.state && typeof test.state === 'object',
        'Journey requires saved state');
    const state = clone(test.state);
    ensureWorldLocation(state);

    if (test.action === 'cancel') {
        assert(state.currentJourney, 'No journey to cancel');
        const journey = state.currentJourney;
        state.currentPosition = positionAfterSegments(
            journeyLegs(journey, state.zone),
            journey.completedSegments
        ) || { nodeId: state.currentLocationId };
        state.currentJourney = null;
        return { ok: true, action: 'cancel', journey, state };
    }

    assert(test.action === 'start',
        `Unsupported journey action: ${test.action}`);
    assert(!state.currentJourney,
        'Finish or cancel the current journey first');

    const lead = test.leadId
        ? state.leads?.[test.leadId]
        : null;

    if (test.leadId) {
        assert(
            lead?.status === 'known' &&
            lead.targetType === 'place',
            'Choose a known place lead'
        );
    }

    const destinationId =
        test.destinationId || lead?.targetId;

    assert(
        typeof destinationId === 'string',
        'Journey requires a known lead or settlement destination'
    );

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry => entry.locationId === destinationId);

    const place =
        state.places?.[destinationId] ||
        (settlement
            ? {
                id: settlement.locationId,
                label: settlement.label,
                zone: settlement.zone,
                settlementId: settlement.id,
                kind: 'settlement'
            }
            : null);

    assert(place, 'Journey destination is not recorded');

    state.places ||= {};
    state.places[destinationId] ||= place;

    const route = shortestRoute(state, place.id);

    assert(route, `No known route to ${place.label}`);
    assert(route.totalSegments > 0,
        `Already at ${place.label}; investigate or explore here`);

    state.currentJourney = {
        leadId: lead?.id || null,
        settlementId: settlement?.id || null,
        destinationId: place.id,
        destinationLabel: place.label,
        originId: route.originId,
        route: route.path,
        legs: route.legs,
        totalSegments: route.totalSegments,
        completedSegments: 0,
        status: 'traveling'
    };
    return {
        ok: true,
        action: 'start',
        journey: clone(state.currentJourney),
        state
    };
}

function applyArrivalLocation(state, locationId, outcome) {
    state.world ||= {};
    state.world.settlements ||= {};

    const settlement = Object.values(
        state.world.settlements
    ).find(entry => entry.locationId === locationId);

    if (!settlement) {
        return state;
    }

    const previousZone = state.zone;

    state.places ||= {};
    state.places[locationId] ||= {
        id: locationId,
        label: settlement.label,
        zone: settlement.zone,
        settlementId: settlement.id,
        kind: 'settlement',
        visited: false
    };

    state.places[locationId].visited = true;

    state.zone = settlement.zone;

    state.currentLocationId = locationId;
    state.currentPosition = { nodeId: locationId };

    if (previousZone !== settlement.zone) {
        const previousZoneRecord =
            state.world.zones?.[previousZone];

        const nextZoneRecord =
            state.world.zones?.[settlement.zone];

        outcome.zoneTransition = {
            fromZone: previousZone,
            toZone: settlement.zone,
            fromRegion:
                previousZoneRecord?.name ||
                `Zone ${previousZone}`,
            toRegion:
                nextZoneRecord?.name ||
                `Zone ${settlement.zone}`,
            fromGeography:
                previousZoneRecord?.geography?.description ||
                null,
            toGeography:
                nextZoneRecord?.geography?.description ||
                null,
            transitionFrom:
                nextZoneRecord?.geography?.transitionFrom ||
                null
        };
    }

    return state;
}

function completeQuestArrivalGate(state, outcome) {
    let nextState = state;
    let quest = nextState.activeQuest;

    // Returning to the locked issuer location makes delivery eligible.
    // It does not pay rewards until the narrator reports the handoff.
    if (
        quest?.status === 'in_progress' &&
        quest.objectiveResolution &&
        quest.turnIn &&
        nextState.currentLocationId === quest.turnIn.locationId &&
        !quest.deliveryReady
    ) {
        const cargo = quest.discoveries?.find(
            item => item.id === quest.turnIn.discoveryId
        );

        assert(
            !quest.turnIn.discoveryId ||
            cargo?.state === 'acquired',
            'Quest cargo must be acquired before delivery is ready'
        );

        quest.deliveryReady = true;
        quest.deliveryReadyAt = nextState.currentLocationId;

        outcome.deliveryReady = {
            questId: quest.id,
            title: quest.title,
            recipient: quest.turnIn.recipient,
            cargoName:
                cargo?.name ||
                quest.facts?.cargo ||
                'quest cargo'
        };

        return nextState;
    }

    quest = nextState.activeQuest;
    const gate = quest?.currentGate;

    if (
        quest?.status !== 'in_progress' ||
        nextState.currentLocationId !==
            (gate?.destinationId || quest.destinationId) ||
        ['active', 'spotted'].includes(nextState.encounter?.status)
    ) {
        return nextState;
    }

    /*
     * A short V2 Elite structure may start directly with its linked
     * combat gate. Arrival spots the engine-authored threat; the player
     * still chooses Engage or Avoid.
     */
    if (
        quest.structureV2?.family === 'defeat_elite' &&
        gate.trigger === 'linked_combat'
    ) {
        const spawned = spawnLinkedQuestEncounter(nextState);
        nextState = spawned.state;

        outcome.questEncounter = {
            id: spawned.encounter.id,
            targetId: quest.targetId,
            status: 'spotted',
            foe: spawned.encounter.foes[0]
        };

        return nextState;
    }

    const eligibleArrival =
        gate.trigger === 'arrival' ||
        gate.trigger === 'arrival_with_evidence' ||
        (
            gate.trigger === undefined &&
            gate.step === 1 &&
            [
                'missing_cargo',
                'ruin_clearance',
                'sunken_salvage'
            ].includes(quest.archetype?.id)
        );

    if (!eligibleArrival) {
        return nextState;
    }

    const place = nextState.places?.[quest.destinationId];
    assert(
        place,
        'Arrival gate needs an established destination'
    );

    const evidence =
        gate.trigger === 'arrival_with_evidence'
            ? quest.facts?.evidence
            : `Arrived at ${place.label}.`;

    assert(
        typeof evidence === 'string' &&
        evidence.length > 0,
        'Arrival gate needs established evidence'
    );

    if (gate.step < quest.gates) {
        const progression = resolveQuestAction({
            state: nextState,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence:
                gate.trigger === 'arrival_with_evidence'
                    ? `Found ${evidence} at ${place.label}.`
                    : evidence
        });

        nextState = progression.state;
        outcome.questGate = {
            completed: progression.completedGate,
            next: progression.nextGate,
            evidence: gate.trigger === 'arrival_with_evidence'
                ? evidence
                : null,
            linkedEncounter: progression.linkedEncounter || null
        };

        return nextState;
    }

    const progression = resolveQuestAction({
        state: nextState,
        action: 'resolve_objective',
        objectiveCompleted: true,
        objectiveRoute: 'other',
        completionEvidence: evidence
    });

    nextState = progression.state;
    quest = nextState.activeQuest;
    quest.completedGates ||= [];

    if (!quest.completedGates.some(
        completed => completed.step === gate.step
    )) {
        quest.completedGates.push({
            ...gate,
            completionEvidence: evidence
        });
    }

    if (quest.turnIn) {
        nextState.leads ||= {};
        const returnLeadId = `quest-return-${quest.id}`;

        nextState.leads[returnLeadId] ||= {
            id: returnLeadId,
            kind: 'quest_return',
            label: `Return cargo to ${quest.turnIn.recipient}`,
            claim: 'The recovered quest cargo is ready to return.',
            targetType: 'place',
            targetId: quest.turnIn.locationId,
            status: 'known'
        };
    }

    outcome.questObjectiveSecured = {
        questId: quest.id,
        evidence
    };

    return nextState;
}

function resolveTravelStep(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Travel step requires saved state'
    );
    assert(
        typeof test.stepId === 'string' && test.stepId.length > 0,
        'Travel step requires a stable stepId'
    );

    let state = clone(test.state);
    state.travelSteps ||= {};
    state.inquiries ||= {};
    state.socialSeeds ||= {};
    state.places ||= {};
    state.leads ||= {};

        /*
     * Explicit UI-generated movement takes precedence over automatic
     * quest-return routing. A new destination can change direction from
     * an existing journey; canceling preserves the crew's current position
     * before the replacement route is calculated.
     */
    if (test.destinationId) {
        assert(
            typeof test.destinationId === 'string' &&
            test.destinationId.length > 0,
            'Explicit movement requires destinationId'
        );

        assert(
            !['active', 'spotted'].includes(state.encounter?.status),
            'Resolve or avoid the current encounter before changing destination'
        );

        const destination =
            state.places?.[test.destinationId] ||
            Object.values(state.world?.settlements || {})
                .find(entry => entry.locationId === test.destinationId);

        assert(
            destination,
            `Unknown known destination: ${test.destinationId}`
        );

        if (
            state.currentJourney &&
            state.currentJourney.destinationId !== test.destinationId
        ) {
            const cancelled = resolveJourneyAction({
                state,
                action: 'cancel'
            });

            state = cancelled.state;
        }

        if (!state.currentJourney) {
            const started = resolveJourneyAction({
                state,
                action: 'start',
                destinationId: test.destinationId
            });

            state = started.state;
        }
    }

        /*
     * Once the field objective is secured, the next movement defaults
     * to the quest's locked turn-in location. An explicitly selected
     * journey already in progress is left untouched.
     */
    const returnQuest = state.activeQuest;

    if (
        !state.currentJourney &&
        returnQuest?.status === 'in_progress' &&
        returnQuest.objectiveResolution &&
        returnQuest.turnIn &&
        state.currentLocationId !== returnQuest.turnIn.locationId
    ) {
        const turnInPlace =
            state.places?.[returnQuest.turnIn.locationId];

        assert(
            turnInPlace,
            'Quest turn-in location is missing from the place registry'
        );

        const route = shortestRoute(state, turnInPlace.id);

        assert(
            route && route.totalSegments > 0,
            `No return route to ${turnInPlace.label}`
        );

        state.currentJourney = {
            id: `return-${returnQuest.id}`,
            type: 'quest_return',
            questId: returnQuest.id,
            leadId: `quest-return-${returnQuest.id}`,
            destinationId: turnInPlace.id,
            destinationLabel: turnInPlace.label,
            originId: route.originId,
            route: route.path,
            legs: route.legs,
            totalSegments: route.totalSegments,
            completedSegments: 0,
            status: 'traveling'
        };
    }

    const existing = state.travelSteps[test.stepId];
    if (existing) {
        return {
            ok: true,
            created: false,
            ...clone(existing),
            state
        };
    }

    assert(!['active', 'spotted'].includes(state.encounter?.status),
        'Resolve or avoid the current encounter before moving');

    let journey = state.currentJourney;
    if (journey?.status === 'paused') {
        journey.status = 'traveling';
    }

    // An interruption on the final segment delays arrival until the
    // situation is resolved; resuming does not roll an extra encounter.
    if (journey && journey.completedSegments === journey.totalSegments) {
        state.places[journey.destinationId].visited = true;
        journey.status = 'arrived';
       
        const arrival = {
            stepId: test.stepId,
            zone: state.zone,
            travelRoll: null,
            event: 'journey_arrival',
            destinationLabel: journey.destinationLabel,
            destinationId: journey.destinationId,
            movement: {
                travelStepConsumed: true,
                journeySegmentConsumed: false,
                arrivalOnly: true,
                interrupted: false,
                completedSegments: journey.completedSegments,
                totalSegments: journey.totalSegments
            },
            journey: clone(journey)
        };

        state.currentJourney = null;
        state.currentLocationId = journey.destinationId;
        state.currentPosition = { nodeId: journey.destinationId };

        state = applyArrivalLocation(
            state,
            journey.destinationId,
            arrival
        );

        state = completeQuestArrivalGate(state, arrival);

        const rumorArrival = resolveArrivedRumors(state);
        state = rumorArrival.state;

        arrival.rumorArrivals = rumorArrival.resolutions;
        arrival.rumorArrivalPackets = rumorArrival.packets;

        state.travelSteps[test.stepId] = clone(arrival);
        return { ok: true, created: true, ...arrival, state };

    }

    const travelRoll = roll(state, 100);

    let event;

    if (travelRoll <= 65) {
        event = 'quiet_travel';
    } else if (travelRoll <= 75) {
        event = 'environmental_sign';
    } else if (travelRoll <= 85) {
        event = 'point_of_interest';
    } else if (travelRoll <= 94) {
        event = 'wild_encounter';
    } else if (travelRoll <= 97) {
        event = 'social_opportunity';
    } else if (travelRoll <= 99) {
        event = 'significant_discovery';
    } else {
        event = 'rare_event';
    }

    const outcome = {
        stepId: test.stepId,
        zone: state.zone,
        travelRoll,
        event,
        movement: {
            travelStepConsumed: true,
            journeySegmentConsumed: false,
            arrivalOnly: false,
            interrupted: false
        },
        encounterId: null,
        encounter: null,
        environmentalSign: null,
        site: null,
        social: null,
        rumor: null
    };

    if (event === 'environmental_sign') {
        const signs = [
            'fresh tracks cross the route',
            'recent smoke or cooking smells drift from nearby',
            'a damaged trail marker suggests recent passage',
            'the local wildlife abruptly falls quiet'
        ];

        outcome.environmentalSign =
            signs[roll(state, signs.length) - 1];
    }

    if (event === 'point_of_interest') {
        const siteId = `site-${test.stepId}`;
        const inquiryKey = `site:${siteId}`;
        const existingSite = state.inquiries[inquiryKey];

        let siteRecord = existingSite;

        if (!siteRecord) {
            const curiosityRoll = roll(state, 10);
            const curiosity =
                curiosityRoll <= 7
                    ? 'nothing_hidden'
                    : curiosityRoll === 8
                        ? 'hidden_lore_or_shortcut'
                        : curiosityRoll === 9
                            ? 'trap_or_ambush_hazard'
                            : 'hidden_loot_stash';

            siteRecord = {
                id: siteId,
                type: 'site',
                zone: state.zone,
                roll: curiosityRoll,
                result: curiosity,
                lootSeed: curiosity === 'hidden_loot_stash'
                    ? {
                        source: 'curiosity',
                        roll: curiosityRoll,
                        result: curiosity,
                        claimed: false
                    }
                    : null,
                questSeed: null,
                questSeedConsumed: false
            };

            state.inquiries[inquiryKey] = siteRecord;
        }

        state.places[siteId] ||= {
            id: siteId,
            label: 'Uncharted point of interest',
            zone: state.zone,
            sourceStepId: test.stepId,
            inquiryId: siteId
        };

        outcome.site = {
            id: siteId,
            zone: state.zone,
            curiosityRoll: siteRecord.roll,
            curiosity: siteRecord.result
        };
    }

    if (event === 'wild_encounter') {
        assert(
            !state.encounter ||
            ['cleared', 'fled', 'dead'].includes(state.encounter.status),
            'Cannot discover a new encounter while another is unresolved'
        );

        const spawned = spawnEncounter({
            state,
            zone: state.zone,
            encounterType: 'wild',
            siteAffinity: test.siteAffinity || 'ordinary',
            encounterId: `travel-${test.stepId}`
        });

        state.rngState = spawned.state.rngState;
        state.encounter = spawned.encounter;
       
        outcome.encounterId = state.encounter.id;
        outcome.encounter = clone(state.encounter);
    }

    if (event === 'social_opportunity') {
        const socialId = `traveler-${test.stepId}`;
        const social = resolveSocialSeed({ state, socialId });

        state = social.state;
        outcome.social = clone(social.seed);

        // A traveler may have nothing useful to tell the crew.
        const hasRumor = roll(state, 2) === 1;

        if (hasRumor) {
            const template = TRAVELER_RUMORS[
                roll(state, TRAVELER_RUMORS.length) - 1
            ];
            const placeId = `place-z${state.zone}-${template.id}`;
            const leadId = `rumor-${test.stepId}`;

            state.places[placeId] ||= {
                id: placeId,
                label: template.place,
                zone: state.zone,
                knownFrom: 'rumor',
                visited: false
            };

            state.leads[leadId] = {
                id: leadId,
                kind: 'rumor',
                claim: template.claim,
                sourceId: socialId,
                targetType: 'place',
                targetId: placeId,
                status: 'known'
            };

            recordCrewKnowledge(state, {
                id: `knowledge-testimony-${leadId}`,
                kind: 'testimony',
                knowledgeType: 'testimony',
                certainty: 'unverified_claim',
                summary: template.claim,
                source: {
                    id: socialId,
                    type: 'traveler'
                },
                learnedAtLocationId: state.currentLocationId,
                learnedAtZone: state.zone
            });

            outcome.rumor = {
                id: leadId,
                claim: template.claim,
                targetId: placeId,
                targetLabel: template.place
            };
        }
    }
    
          /*
     * Event resolvers may return a cloned state, notably the traveler
     * social seed. Advance the journey belonging to the final state,
     * not a reference retained from before that clone.
     *
     * Otherwise the outcome can report a consumed segment while the
     * saved journey silently loses that progress.
     */
    journey = state.currentJourney;

    if (journey) {
        journey.completedSegments += 1;
        state.currentPosition = positionAfterSegments(
            journeyLegs(journey, state.zone),
            journey.completedSegments
        );

        if (event === 'wild_encounter') {
            journey.status = 'paused';
        } else if (journey.completedSegments === journey.totalSegments) {
            state.places[journey.destinationId].visited = true;
            state.currentLocationId = journey.destinationId;
            state.currentPosition = { nodeId: journey.destinationId };
            outcome.arrived = true;
            state.currentJourney = null;
            journey.status = 'arrived';

            state = applyArrivalLocation(
                state,
                journey.destinationId,
                outcome
            );
        }

        outcome.movement = {
            travelStepConsumed: true,
            journeySegmentConsumed: true,
            arrivalOnly: false,
            interrupted: event === 'wild_encounter',
            arrivalDeferred:
                event === 'wild_encounter' &&
                journey.completedSegments === journey.totalSegments,
            completedSegments: journey.completedSegments,
            totalSegments: journey.totalSegments,
            journeyStatus: journey.status
        };

        outcome.journey = clone(journey);
    }
    if (outcome.arrived) {
        state = completeQuestArrivalGate(state, outcome);

        const rumorArrival = resolveArrivedRumors(state);
        state = rumorArrival.state;

        outcome.rumorArrivals = rumorArrival.resolutions;
        outcome.rumorArrivalPackets = rumorArrival.packets;
    }

    state.travelSteps[test.stepId] = clone(outcome);

    return {
        ok: true,
        created: true,
        ...outcome,
        state
    };
}

const QUEST_REWARD_TABLES = new Proxy({}, {
    get(_target, key) {
        const zone = zoneNumber(key);
        if (zone === null) return undefined;

        const base = ZONES[zone].base;
        const silverUnit = 10 * zone - 4;

        function reward(
            rank,
            silverMultiplier,
            repSteps,
            rarity,
            stat
        ) {
            return {
                rank,
                silver: silverUnit * silverMultiplier,
                repSteps,
                salvageRarity: rarity,
                salvageStat: stat
            };
        }

        return {
            low: [
                reward('F', 1, 1, 'common', base),
                reward('E', 1.5, 1, 'common', base),
                reward('D', 3, 2, 'uncommon', base + 1)
            ],
            high: [
                reward('D', 3, 2, 'uncommon', base + 1),
                reward('C', 5, 2, 'uncommon', base + 1),
                reward('B', 9, 2, 'rare', base + 3)
            ]
        };
    }
});

const QUEST_PROGRESSION = {
    F: { minGates: 1, maxGates: 2, packMultiplier: 1.5 },
    E: { minGates: 2, maxGates: 3, packMultiplier: 2 },
    D: { minGates: 2, maxGates: 3, packMultiplier: 3 },
    C: { minGates: 3, maxGates: 4, packMultiplier: 4.5 },
    B: { minGates: 4, maxGates: 5, packMultiplier: 6 }
};

const EXTRA_QUEST_GATE_PACK_MULTIPLIER = 0.5;

function canonicalMixedPackXp(zone, crewLevel) {
    const zoneData = ZONES[zone];
    assert(zoneData, `Unknown quest XP zone: ${zone}`);

    const referenceLevel = zoneData.levels[1];
    const bruteXp = xpForKill(crewLevel, {
        level: referenceLevel,
        role: 'brute'
    });
    const specialistXp = xpForKill(crewLevel, {
        level: referenceLevel,
        role: 'archer'
    });

    return bruteXp + 2 * specialistXp;
}

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

/*
 * AETHERMOOR IMPLEMENTATION ROADMAP
 *
 * This is the working feature list for the current beta architecture.
 * Update the status here when a feature is completed, deliberately changed,
 * or superseded. Keep this list near the quest architecture notes so future
 * maintenance does not depend on reconstructing priorities from chat history,
 * scattered comments, or saved-state incidents.
 *
 * Status meanings:
 * - DONE: implemented and exercised in the current campaign flow.
 * - PARTIAL: the foundation exists, but important paths or integrations remain.
 * - NEXT: the next focused implementation target.
 * - PLANNED: agreed work that has not started.
 * - DEFERRED: useful work intentionally postponed while another dependency is settled.
 *
 * COMPLETED FOUNDATIONS
 *
 * DONE — Persistent per-chat state
 * - Save the complete machine state in chat metadata.
 * - Serialize concurrent operations through the Aethermoor queue.
 * - Preserve revisions, RNG state, locked results, and ordered narrator handoffs.
 *
 * DONE — Saved world foundation
 * - Persist the world seed, zones, geography profiles, settlements, reputation,
 *   primary route edges, current location, and current position.
 * - Generate missing world records deterministically without advancing combat RNG.
 * - Preserve stable IDs for places, settlements, routes, quests, and factions.
 *
 * DONE — Core campaign loop
 * - Travel one segment per [moved] event.
 * - Support journeys, arrival, interruption, encounter discovery, engage/avoid,
 *   points of interest, rumors, social opportunities, and quest return travel.
 *
 * DONE — Combat systems
 * - Resolve normal packs, declared rosters, elites, bosses, telegraphs,
 *   reinforcements, fleeing, death, XP, silver, loot, potions, and shadows.
 * - Preserve locked combat outcomes and prevent duplicate reward resolution.
 *
 * DONE — Quest delivery foundation
 * - Lock the quest issuer and return location.
 * - Separate field-objective completion from delivery and payment.
 * - Support report-only delivery for defeat objectives.
 * - Support cargo delivery for retrieval objectives.
 * - Apply quest rewards exactly once after validated delivery.
 *
 * DONE — V2 defeat-elite path
 * - Use complete V2 structures for the supported defeat-elite gate counts.
 * - Complete the arrival gate, reveal the linked threat, resolve the linked
 *   combat gate, return to the issuer, and complete report-only delivery.
 * - Keep the linked threat and the current encounter identity separate.
 * - Retain a narrowly scoped reconciliation operation for beta test saves.
 *
 * DONE — Current mechanical UI foundation
 * - Provide Combat, Quests, and World tabs.
 * - Keep UI refresh read-only.
 * - Persist panel position and size.
 * - Expose encounter, journey, quest, destination, and delivery actions.
 *
 * NEXT FOCUSED WORK
 *
 * PARTIAL — Travel interruption behavior
 * - Policy: a [moved] that rolls a travel event consumes one journey segment,
 *   including when that event discovers a wild encounter.
 * - Movement while an encounter is spotted or active does not advance travel.
 * - After an encounter on the final segment, arrival is finalized afterward
 *   without rolling or consuming another segment.
 * - Narration and Combat UI report saved journey progress at interruptions.
 *
 * NEXT — Travel interruption regression pass
 * - Test encounters on the first, middle, and final journey segments.
 * - Verify that [moved] during a spotted or active encounter does not advance.
 * - Verify that resolving the encounter resumes at the saved progress.
 * - Verify final-segment interruptions finalize arrival without an extra roll.
 * - World must retain a clipboard-only Continue/Finish journey entry after
 *   an interruption, including when shortestRoute() reports zero distance.
 * - Watchtower regression: clearing a final-segment encounter left arrival
 *   pending but hid its movement entry. Explicit journey control added;
 *   verify after reload before marking this case complete.

  * - Test quiet travel, environmental signs, points of interest, and social events.
 * - Traveler events return cloned state: refresh the journey reference before
 *   advancing progress so saved progress matches the narrated outcome.
 * - Verify a traveler on segment 1 saves 1/N, then a subsequent move saves 2/N.
 * - Regression incident: the Watchtower journey reported 1/5 after a traveler
 *   but lost that first segment in saved state. Fix added; retest pending.

 *
 * PLANNED — Out-of-combat recovery
 * - Q'tik's derived Regen should restore her HP between fights, reflecting
 *   regeneration continuing outside combat. Define the precise trigger before
 *   implementing it (for example, after a cleared encounter or when a new
 *   encounter is engaged); do not silently heal her on every UI refresh.
 * - Do not add out-of-combat healing for Tansy yet.
 * - Revisit Tansy's recovery only after she has a Mender in the fiction and
 *   mechanics; decide then whether that Mender can heal her between fights.
 * - Test that recovery does not occur during a spotted/active encounter, does
 *   not exceed maximum HP, and cannot be applied repeatedly by duplicate events.

 *
 * NEXT — V2 quest completion regression pass
 * - Test a fresh defeat-elite quest from offer through delivery without debug
 *   reconciliation.
 * - Verify that the linked encounter alone advances the quest objective.
 * - Verify that an unrelated cleared Elite cannot advance the quest.
 * - Verify duplicate combat completion, duplicate delivery, and repeated tags.
 *
 * NEXT — Quest delivery handshake regression pass
 * - Arrival at the issuer settlement only sets deliveryReady; it never starts
 *   the sponsor meeting or completes the quest.
 * - Verify the narrator waits for player direction before staging the handover.
 * - Verify report-only and cargo handovers emit the exact quest delivery tag
 *   only after the fictional handover occurs.
 * - Verify the extension applies the locked payout once and queues the
 *   authoritative reward contract for the following LLM reply.
 * - Verify duplicate tags, wrong quest IDs, wrong locations, incomplete cargo,
 *   and delivery after completion cannot grant rewards again.

 * PARTIAL SYSTEMS
 *
 * PARTIAL — V2 retrieve-item quests
 * - The retrieve_item structure exists.
 * - Missing Cargo and Sunken Salvage have partial discovery support.
 * - Author complete discovery requirements for every supported gate count.
 * - Ensure every retrieval quest locks one cargo discovery before acceptance.
 * - Test cargo acquisition, cargo preservation during travel, and cargo delivery.
 *
 * PARTIAL — Authored quest discoveries
 * - Some V2 quests have engine-authored discoveries with stable IDs,
 *   locations, hiding places, required actions, and acquisition states.
 * - Add authored discoveries for every discovery-triggered gate.
 * - Remove fallback behavior that lets a narrator imply an unrecorded discovery.
 *
 * PARTIAL — Quest family migration
 * - Missing Cargo, Sunken Salvage, Ruin Clearance, and Territorial Beast have
 *   V2-compatible foundations.
 * - Herb Foraging and Missing Person still use the older authored gate path.
 * - Convert each remaining family to a complete V2 structure or formally mark
 *   it legacy until its replacement is implemented.
 *
 * PARTIAL — World integration
 * - World records and route edges are saved.
 * - Some older quest, route, settlement, and UI paths still use legacy IDs,
 *   labels, or assumptions.
 * - Replace those paths with stable world records in one migration pass.
 *
 * PARTIAL — Migration and validation
 * - Existing saves receive world, journey, potion, and quest migrations.
 * - Formalize schema migrations for old journey shapes, old quest structures,
 *   old encounter records, settlement names, and legacy potion counters.
 * - Add validation for every migrated shape before it can be saved again.
 *
 * PLANNED WORK
 *
 * PLANNED — Test-data cleanup
 * - Mark all historical debug places, leads, quests, encounters, and routes
 *   with a consistent test-only identity.
 * - Extend cleanup so obsolete test records cannot appear as normal destinations.
 * - Preserve campaign records that were actually used for legitimate rewards.
 *
 * PLANNED — UI cleanup and consistency
 * - Remove stale debug controls from ordinary quest and world views.
 * - Deduplicate destinations and leads by stable identity.
 * - Show exact journey progress, interruption state, current gate, and delivery
 *   eligibility from saved state.
 * - Prevent action-button numbering collisions in legacy popup panels.
 *
 * PARTIAL — Narration authority
 * - Engine handoffs explicitly separate private instructions from output.
 * - Detect recognizable private-context and contract-header leakage.
 * - Warn without modifying story text, consuming RNG, or saving a revision.
 * - Reject assistant discovery/delivery events from visibly leaked replies.
 * - Do not automatically regenerate replies or undo resolved mechanics.
 * - Leak detection is narrow: it does not validate arbitrary narrative claims.
 * - Regression pending: ordinary reply, leaked packet containing an example
 *   tag, and duplicate received/rendered notifications.
 * - Build every narration packet from the authoritative saved result.
 * - Include encounter ID, journey progress, quest gate, objective resolution,
 *   delivery readiness, and reward status where relevant.
 * - Prevent prose from implying combat, discovery, arrival, or reward events
 *   that are absent from the saved result.
 *
 * PLANNED — Regression suite
 * - Maintain assertion-based cases for the complete campaign loop.
 * - Cover quest offer, acceptance, travel, interruption, arrival, discovery,
 *   linked combat, return travel, report delivery, cargo delivery, duplicate
 *   events, flee, death, and migration.
 * - Run the relevant regression group after every quest, travel, or persistence
 *   change instead of relying only on the live campaign state.
 *
 * * NEXT — Explicit movement commands and World destinations
 * - Generate stable-ID movement commands from clickable World entries.
 * - Support quest destinations, rumor destinations, settlements, and generic
 *   regional exploration.
 * - Allow an explicit destination command to change direction mid-journey.
 * - Keep legacy [moved] parsing for existing chats.
 * - Make UI clicks clipboard-only; movement resolves only when the command
 *   is submitted with the player's fiction.
 *
 * PLANNED — Local site exploration sessions
 * - Do not implement fixed room counts in this movement pass.
 * - Later represent discovered local nodes and exits as saved site-session data.
 * - Prevent repeated visits to the same local node from rerolling encounters
 *   or discoveries indefinitely.
 * - Permit newly discovered areas, such as secret cellars or upper levels,
 *   to be added when established by authored mechanics.
 * - Distinguish local exploration from campaign-route travel.
 *
 * DEFERRED — Narrator-created local map expansion
 * - The narrator must not create new mechanically rewarding nodes merely to
 *   obtain additional encounter or loot rolls.
 * - Define the validation boundary for newly revealed local exits before
 *   allowing prose to expand a saved site map.
 *
 * PARTIAL — Persistent discoveries and crew knowledge foundation
 * - A saved discoveries registry now records rumor-arrival outcomes as
 *   source-linked observations with stable IDs and explicit certainty.
 * - Reprocessing an arrival preserves the original record.
 * - Original rumor claims remain testimony; resolution does not make the
 *   claim itself true.
 * - Traveler rumors record unverified testimony when their claims are heard.
 * - Verified with a debug fixture: testimony exists before travel; arrival
 *   adds a separate observation without overwriting the original claim.
 * - World displays saved knowledge, sources, certainty, and learning locations.
 * - Knowledge display is read-only and labels identifiable test records.
 * - Crew Knowledge starts collapsed, with expandable Unverified and
 *   Established groups showing record counts.
  * - Natural traveler testimony integration still awaits live verification.
 * - Authored lore content and quest prerequisite checks remain unimplemented.
 *
 * - Let future quests explicitly recognize relevant prior knowledge.
 * - Keep discovery records separate from inventory and rewards.
 * - Do not migrate incidental historical chat prose into authoritative data.
 *
 * PARTIAL — Rumor arrival and closure contracts
 * - Automatic confirmed-arrival resolution implemented for the existing
 *   benign, already-cleared, and genuine-hook outcomes; regression pending.
 * - Preserve locked inquiries and defer offers while the quest slot is busy.
 * - World no longer requires a generic Investigate action after arrival.
 * - Elite, contact, settlement-discovery, and explorable-site outcomes remain
 *   unimplemented. Define their saved records and arrival contracts before
 *   adding them to the outcome table.
 *
 * * PARTIAL — Quest journal and multiple simultaneous opportunities
 * - Current state stores one activeQuest, which causes later genuine rumor
 *   hooks to defer or discard their offer while another quest occupies the slot.
 * - Preserve every engine-created quest offer with a stable quest ID.
 * - Support multiple offered quests without rerolling or replacing them.
 * - Separate quest selection from quest existence; an offered quest can remain
 *   available while another quest is accepted or in progress.
 * - Migrate legacy activeQuest data without duplicating or losing a quest.
 * - Update acceptance, progression, delivery, UI, narration, and duplicate
 *   protection to address an explicit quest ID.
 * - Multiple offers are stored; accepting another quest while one is in
 *   progress is explicitly blocked until concurrent progression is supported.
 * - Quest actions return the affected quest for narration even when the
 *   compatibility activeQuest pointer is cleared.
 * - Explicit unknown quest IDs must fail without falling back to another quest.
 * - Offer preparation targets the newly generated quest while preserving
 *   the selected quest. Preparation helpers still need explicit quest arguments.
 * - Quests tab renders all journal offers with ID-bound acceptance/decline.
 * - Rumor arrivals create journal offers immediately, preserving selection.
 * - Restore shared identity between activeQuest and its journal entry after
 *   JSON loading; legacy progression remains authoritative during migration.
 * - Journal delivery uses the fictional handover handshake, not a payout button.
 * - Verified in live testing: two offers survived reload; declining the
 *   Rank D test offer preserved the original Rank B offer after reload.
 * - Pending: isolated tests for unknown quest IDs, repeated decline,
 *   preserving an in-progress quest when another offer is created, and
 *   accepting one offer while another remains available.
 * - Concurrent accepted-quest progression remains unsupported.
 * - Do not implement quest abandonment or completion by relying only on a
 *   global activeQuest pointer.
 *
 * - Resolve a known rumor once on confirmed arrival, including arrival after
 *   a final-segment encounter; do not require a generic Investigate button.
 * - Separate the locked outcome from what is observable on arrival.
 * - Arrival may reveal a landmark, contact, entrance, clue, or spotted threat;
 *   it must not automatically engage combat, accept quests, or acquire items.
 * - Make remaining authored opportunities legible through established clues.
 * - Give concluded rumors clear closure so players need not search endlessly
 *   to distinguish an exhausted lead from an undiscovered hidden objective.
 * - Revisiting a resolved rumor does not reroll its outcome or rewards.
 * - Do not enable spawn-rich explorable-site outcomes until persistent local
 *   exploration can prevent repeated visits from generating unlimited rolls.
 *
 * TENTATIVE — Conditional connections between world systems
 * - Later allow authored quests and events to reference saved discoveries,
 *   contacts, routes, and world changes through stable IDs.
 * - Prefer explicit prerequisite checks over a general simulation framework.
 * - Keep conditions separate from narration and reward application; a newly
 *   eligible opportunity is not automatically completed or paid.
 * - Any triggered event needs a saved identity and duplicate-event protection.
 * - A changed condition may justify new content at an explored site; ordinary
 *   revisits alone must not refresh its encounters or discoveries.
 * - Implement only when a concrete quest or event needs this integration.
 *
 * DEFERRED — Larger rumor threads and regional mysteries
 * - Potentially connect distinct clues to an authored conclusion, such as a
 *   historical answer, newly accessible location, or boss destination.
 * - Author the conclusion and prerequisites before treating clues as pieces
 *   of a mechanically supported larger thread.
 * - Do not assume the crew will remain in one region or finish every thread.
 * - Preserve unfinished threads without blocking progression or imposing a
 *   return journey; cross-region continuations require authored connections.
 * - Avoid endless referrals from one rumor to another without a satisfying
 *   scene, discovery, or clear conclusion along the way.
 * - Defer implementation until ordinary rumor arrival, persistent knowledge,
 *   and local exploration are exercised and stable.
 *
 * DEFERRED UNTIL CORE FLOWS ARE STABLE
 *
 * DEFERRED — Additional quest families and biome-specific presentation.
 * DEFERRED — Expanded food and settlement simulation.
 * DEFERRED — Rich NPC schedules, faction systems, and detailed local roads.
 * DEFERRED — A unified HUD that replaces the current tab and popup surfaces.
 *
 * MAINTENANCE RULES
 *
 * - New mechanics must identify their saved state, stable IDs, RNG behavior,
 *   narrator handoff, migration needs, and duplicate-event behavior.
 * - A bug discovered during live testing belongs in this roadmap until it is
 *   fixed and exercised. Do not let the next incident silently replace it.
 * - When a feature changes status, update this comment in the same edit as the
 *   implementation so the roadmap and code remain synchronized.
 */

/*
 * QUEST ARCHITECTURE — AGREED DIRECTION
 *
 * The extension exists because narrator LLMs have invented mechanics,
 * ignored supplied stats, and introduced unauthorized encounters.
 * Preserve the boundary below when extending the quest system.
 *
 * ENGINE RESPONSIBILITY
 * - Decide whether a quest exists, its rank, gate count, objective family,
 *   travel segments, rewards, target IDs, and completion requirements.
 * - Select a COMPLETE, compatible quest structure for that gate count.
 * - Every structure must include its decisive objective. Never shorten
 *   a quest by slicing off its final steps: a two-gate retrieval quest
 *   must still require retrieving its target.
 * - Own all encounters, stats, abilities, telegraphs, RNG, and payouts.
 * - Spawn quest-linked encounters from engine progression, not from
 *   narrator invention.
 * - Lock quest structure and mechanical facts when generated.
 *
 * NARRATOR RESPONSIBILITY
 * - Dress the current engine-established scene using the world context:
 *   creature appearance, architecture, dialogue, atmosphere, and action.
 * - Do not author additional mandatory gates, items, NPC requirements,
 *   encounters, abilities, rewards, or success conditions.
 * - Creature appearance is not a mechanical ability grant.
 * - Receive concise instructions for the CURRENT stage rather than an
 *   invitation to design the intermediate quest.
 *
 * LIMITED NARRATIVE HANDSHAKE
 * - The narrator may interpret natural-language actions and report an
 *   eligible authored discovery or delivery using exact protocol tags.
 * - The engine validates IDs, location, prerequisites, current gate, and
 *   state transitions. Tags do not supply numbers, rewards, or objectives.
 * - This is a deliberate, limited trust boundary, not proof that the LLM
 *   adjudicated the fiction correctly.
 * - Keep existing gameplay/debug mechanics available, but avoid exposing
 *   unrestricted state-mutating tools to the ordinary narrator when a
 *   UI/controller can perform those operations directly.
 *
 * VARIETY WITHOUT AN EXHAUSTIVE BIOME MATRIX
 * - Prefer reusable objective families and compatible stage structures:
 *   arrival, discovery, linked combat, and delivery.
 * - Let the narrator supply setting-appropriate presentation without
 *   requiring a catalog of every castle, cave, church, or floating city.
 * - Authored hidden objects and discovery conditions must still exist in
 *   engine data; the narrator must not invent mandatory puzzles mid-quest.
 *
 * IMPLEMENTATION STATUS
 * - This comment records the agreed design, not a completed refactor.
 * - The catalog below still contains setting-specific scenarios.
 * - buildAuthoredQuestGates() still uses slice(0, gateCount); replace that
 *   behavior with complete structures in a subsequent implementation.
 * - Begin the refactor with retrieve-item and defeat-elite objectives,
 *   reusing the existing travel, discovery, combat, and delivery systems.
 *
 * BETA POLICY
 * Use this division for now. During beta testing, tighten specific failure
 * points based on observed behavior instead of adding speculative protocol
 * complexity or handing quest design back to the narrator.
 */

const QUEST_ARCHETYPES = [
    {
        id: 'missing_cargo',
        label: 'Missing Cargo',
        scenarios: [
            {
                pitch: 'A local trading concern reports that a promised shipment never reached its destination.',
                truth: 'The cargo was deliberately diverted and concealed.',
                facts: {
                    sponsor: 'the Peat-Cairn Excavation Co.',
                    cargo: 'a sealed payroll strongbox',
                    place: 'the old gravel weir',
                    evidence: 'the cargo tally and fresh drag marks',
                    obstacle: 'a locked storehouse guarded after dusk'
                }
            },
            {
                pitch: 'A peat-cutting crew reports that its winter tool shipment vanished between depots.',
                truth: 'A subcontractor hid the tools to force the crew into an unfavorable debt.',
                facts: {
                    sponsor: 'the North Sluice peat-cutters',
                    cargo: 'a crate of iron dredging tools',
                    place: 'the abandoned weigh-station',
                    evidence: 'a split company seal and mismatched cart tracks',
                    obstacle: 'a flooded approach watched by hired guards'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Locate {place} and inspect {evidence}.'],
            ['brain_social_heist', 'Determine who diverted {cargo} from {sponsor}.'],
            ['combat_twist_showdown', 'Recover {cargo} despite {obstacle}.'],
            ['traversal_discovery', 'Trace the diversion from {place} to its beneficiary.'],
            ['brain_social_heist', 'Present the recovered evidence to {sponsor}.']
        ]
    },
    {
        id: 'ruin_clearance',
        label: 'Ruin Clearance',
        scenarios: [
            {
                pitch: 'A nearby route has become unsafe after activity was seen inside an old structure.',
                truth: 'A territorial group has occupied the ruin while following a source of food deeper inside.',
                facts: {
                    sponsor: 'the Peat-Cairn road wardens',
                    site: 'the drowned watch-house',
                    threat: 'a band of marsh scavengers',
                    evidence: 'fresh cookfire ash and newly cut trail marks',
                    obstacle: 'a collapsed entrance and guarded upper windows'
                }
            },
            {
                pitch: 'A storage ruin thought to be empty has begun producing noises at night.',
                truth: 'An opportunistic crew is using the ruin as cover while stripping its foundations.',
                facts: {
                    sponsor: 'the local stonecutters’ guild',
                    site: 'the split-stone storehouse',
                    threat: 'a salvage crew with armed lookouts',
                    evidence: 'recent chisel marks and a hidden haul path',
                    obstacle: 'a narrow approach overlooked from the roof'
                }
            },
            {
                geographyProfiles: ['karst'],
                pitch: 'A survey party has stopped reporting from a newly opened karst passage.',
                truth: 'A cave-in separated the surveyors from their equipment, and something territorial has occupied the narrow route between them.',
                facts: {
                    sponsor: 'the Zone 4 survey office',
                    site: 'the Split Echo passage',
                    threat: 'a territorial cave-stalker',
                    evidence: 'fresh survey chalk and a dropped brass plumb weight',
                    obstacle: 'a narrow flooded fissure beneath unstable limestone'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Find a safe approach to {site} and verify {evidence}.'],
            ['combat_twist_showdown', 'Secure the first occupied section against {threat}.'],
            ['brain_social_heist', 'Determine why {threat} is using {site}.'],
            ['combat_twist_showdown', 'Stop {threat} from reaching its objective.'],
            ['traversal_discovery', 'Verify that the route past {site} is safe for {sponsor}.']
        ]
    },
    {
        id: 'herb_foraging',
        label: 'Herb Foraging',
        scenarios: [
            {
                pitch: 'A healer needs a fresh medicinal plant before the next supply sled departs.',
                truth: 'The plant grows near a hazardous spring where territorial wildlife gathers.',
                facts: {
                    sponsor: 'Daga at the Sodden Beam',
                    herb: 'silver-vein marshmallow root',
                    place: 'the warm spring beyond the reed beds',
                    need: 'a treatment for lung fever',
                    obstacle: 'unstable ground around the spring'
                }
            },
            {
                pitch: 'A camp medic has run short of a plant used to treat infected cuts.',
                truth: 'The remaining patch is in a nesting area avoided by local gatherers.',
                facts: {
                    sponsor: 'Vena’s stilt-camp',
                    herb: 'bitter blue woundleaf',
                    place: 'the shaded bank beneath the leaning cypress',
                    need: 'a remedy for infected wounds',
                    obstacle: 'a nesting animal guarding the bank'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Locate {place} using local growing signs.'],
            ['brain_social_heist', 'Identify and gather {herb} without contaminating it.'],
            ['combat_twist_showdown', 'Protect the harvest from the danger at {place}.'],
            ['traversal_discovery', 'Confirm that enough {herb} remains for {need}.'],
            ['brain_social_heist', 'Deliver the usable harvest to {sponsor}.']
        ]
    },
    {
        id: 'missing_person',
        label: 'Missing Person Search',
        scenarios: [
            {
                pitch: 'A relative has not returned from a routine trip along the marsh road.',
                truth: 'The missing traveler left the road to shelter from a sudden flood.',
                facts: {
                    sponsor: 'the missing traveler’s sister',
                    person: 'Mara Venn',
                    place: 'the old ferry landing',
                    evidence: 'a dropped satchel and a broken walking staff',
                    obstacle: 'flooded ground beyond the landing'
                }
            },
            {
                pitch: 'A local courier missed two expected check-ins while carrying sealed letters.',
                truth: 'The courier was detained by a bandit crew searching for one particular letter.',
                facts: {
                    sponsor: 'the Peat-Cairn message office',
                    person: 'Tovin Reed',
                    place: 'the north causeway marker',
                    evidence: 'a torn route docket and a fresh boot trail',
                    obstacle: 'armed watchers controlling the causeway'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Search {place} for {evidence}.'],
            ['brain_social_heist', 'Learn which route {person} took after leaving the last known marker.'],
            ['traversal_discovery', 'Follow the trail to {person} without losing it in the marsh.'],
            ['combat_twist_showdown', 'Reach {person} despite {obstacle}.'],
            ['brain_social_heist', 'Establish what {person} wants and report back to {sponsor}.']
        ]
    },
    {
        id: 'sunken_salvage',
        label: 'Sunken Salvage',
        scenarios: [
            {
                pitch: 'A claimant has identified a sunken company scow and wants its sealed cargo recovered.',
                truth: 'The cargo remains inside the wreck, concealed by silt and a collapsed section of hull.',
                facts: {
                    sponsor: 'the Peat-Cairn Excavation Co.',
                    cargo: 'the sealed pay-chest',
                    wreck: 'the scow at Sunken Channel #3',
                    evidence: 'the stamped barge-lock plate',
                    obstacle: 'root-bound iron brackets beneath the waterline'
                }
            },
            {
                pitch: 'A ferry crew wants a marked navigation case recovered before it is lost to the current.',
                truth: 'The case is wedged beneath the wreck, while scavengers have begun stripping the deck.',
                facts: {
                    sponsor: 'the third-weir ferry crew',
                    cargo: 'the brass navigation case',
                    wreck: 'the split-hull ferry below the limestone bend',
                    evidence: 'a painted ferry number on a floating plank',
                    obstacle: 'a fast undertow and active scavengers'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Locate {wreck} and confirm it using {evidence}.'],
            ['brain_social_heist', 'Find a way past {obstacle} to reach {cargo}.'],
            ['combat_twist_showdown', 'Secure the wreck against its current guardians.'],
            ['traversal_discovery', 'Extract {cargo} without losing it to the water or wreckage.'],
            ['brain_social_heist', 'Return the recovered cargo to {sponsor}.']
        ]
    },
    {
        id: 'territorial_beast',
        label: 'Territorial Beast Hunt',
        scenarios: [
            {
                pitch: 'A dangerous animal has begun driving local gatherers away from a familiar route.',
                truth: 'The animal is defending a den after nearby logging exposed its young.',
                facts: {
                    sponsor: 'the peat-cutters’ trail warden',
                    beast: 'a scar-backed mire drake',
                    place: 'the cypress ridge trail',
                    evidence: 'fresh claw marks and a trampled den approach',
                    obstacle: 'the beast’s short, defended territory'
                }
            },
            {
                pitch: 'A herd animal has stopped returning to its usual grazing ground.',
                truth: 'A predator has established a hunting path beside the herd’s watering place.',
                facts: {
                    sponsor: 'the Fen-Trollkin camp herders',
                    beast: 'a pale marsh tusker',
                    place: 'the reed-ringed watering hollow',
                    evidence: 'broken reeds and a repeated set of heavy tracks',
                    obstacle: 'the predator’s approach through deep water'
                }
            }
        ],
        gates: [
            ['traversal_discovery', 'Follow {evidence} to locate {beast} near {place}.'],
            ['traversal_discovery', 'Determine the boundaries of {beast}’s territory.'],
            ['combat_twist_showdown', 'Confront {beast} while accounting for {obstacle}.'],
            ['brain_social_heist', 'Determine whether the danger can be addressed without unnecessary killing.'],
            ['traversal_discovery', 'Verify that {place} is safe enough for {sponsor} to use again.']
        ]
    }
];

function questGeographyProfile(state, zone = state.zone) {
    const savedProfile =
        state.world?.zones?.[zone]?.geography?.profile;

    if (savedProfile) return savedProfile;

    const legacyProfiles = {
        1: 'valley',
        2: 'marsh_edge',
        3: 'marsh',
        4: 'karst',
        5: 'hills'
    };

    return legacyProfiles[zone] || null;
}

function eligibleQuestScenarios(state, archetype, zone = state.zone) {
    const profile = questGeographyProfile(state, zone);

    return (archetype.scenarios || []).filter(scenario => {
        const allowedProfiles =
            scenario.geographyProfiles ||
            ['marsh_edge', 'marsh'];

        return allowedProfiles.includes(profile);
    });
}

function eligibleQuestArchetypes(state, zone = state.zone) {
    return QUEST_ARCHETYPES
        .map(archetype => ({
            archetype,
            scenarios: eligibleQuestScenarios(
                state,
                archetype,
                zone
            )
        }))
        .filter(entry => entry.scenarios.length > 0);
}

function buildQuestFacts(state, archetype, zone = state.zone) {
    const scenarios = eligibleQuestScenarios(
        state,
        archetype,
        zone
    );

    assert(
        scenarios.length > 0,
        `Quest archetype ${archetype.id} has no scenario compatible with Zone ${zone}`
    );

    const scenarioRoll = roll(state, scenarios.length);
    const scenario = scenarios[scenarioRoll - 1];

    assert(
        scenario &&
        typeof scenario.pitch === 'string' &&
        scenario.facts &&
        typeof scenario.facts === 'object',
        `Quest archetype ${archetype.id} has an invalid scenario`
    );

    return {
        scenarioRoll,
        pitch: scenario.pitch,
        truth: scenario.truth,
        facts: clone(scenario.facts)
    };
}

/*
 * COMPLETE QUEST STRUCTURES — VERSION 2
 *
 * These structures are setting-independent mechanics, not story scripts.
 * The narrator dresses the current scene but cannot add mandatory stages.
 *
 * Each supported gate count has a complete structure ending in the
 * decisive objective. Delivery follows field completion and is not
 * counted as an additional field gate.
 *
 * Trigger contracts for the forthcoming controller integration:
 * - arrival: saved travel arrival at this gate's location.
 * - discovery: validated FOUND event for this gate's authored discovery.
 * - linked_combat: this gate's engine-created encounter is cleared.
 *
 * This builder is deliberately not connected to resolveQuestSeed yet.
 * Creation and progression must be integrated together before V2 offers
 * enter normal play. Existing quests retain their original structures.
 */

const QUEST_V2_STRUCTURES = {
    retrieve_item: {
        1: ['recover'],
        2: ['approach', 'recover'],
        3: ['approach', 'locate', 'recover'],
        4: ['approach', 'locate', 'reach_inner_site', 'recover'],
        5: [
            'approach',
            'locate',
            'reach_inner_site',
            'find_access',
            'recover'
        ]
    },

    defeat_elite: {
        1: ['defeat'],
        2: ['approach', 'defeat'],
        3: ['approach', 'track', 'defeat'],
        4: ['approach', 'track', 'reach_lair', 'defeat'],
        5: ['approach', 'track', 'reach_lair', 'find_target', 'defeat']
    }
};

const QUEST_V2_STAGES = {
    retrieve_item: {
        approach: {
            mode: 'traversal_discovery',
            trigger: 'arrival',
            objective: 'Reach the designated recovery site.'
        },
        locate: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Find the authored clue identifying where the item is held.'
        },
        reach_inner_site: {
            mode: 'traversal_discovery',
            trigger: 'arrival',
            objective: 'Follow the established lead to the item’s location.'
        },
        find_access: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Discover the authored means of accessing the item.'
        },
        recover: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Locate and recover the required item.',
            decisive: true
        }
    },

    defeat_elite: {
        approach: {
            mode: 'traversal_discovery',
            trigger: 'arrival',
            objective: 'Reach the target’s reported territory.'
        },
        track: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Find the authored evidence of the target’s route.'
        },
        reach_lair: {
            mode: 'traversal_discovery',
            trigger: 'arrival',
            objective: 'Follow the established trail to the target’s lair.'
        },
        find_target: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Locate the target using the authored signs at its lair.'
        },
        defeat: {
            mode: 'combat_twist_showdown',
            trigger: 'linked_combat',
            objective: 'Defeat the quest’s linked Elite encounter.',
            decisive: true
        }
    }
};

function validateQuestV2Structure(plan) {
    assert(plan?.version === 2, 'Expected a V2 quest structure');
    assert(
        QUEST_V2_STRUCTURES[plan.family],
        `Unsupported quest family: ${plan.family}`
    );
    int(plan.gateCount, 'quest structure gate count', 1);

    assert(
        Array.isArray(plan.gates) &&
        plan.gates.length === plan.gateCount,
        'Quest structure gate count does not match its stages'
    );

    const decisiveGates = plan.gates.filter(gate => gate.decisive);

    assert(
        decisiveGates.length === 1 &&
        plan.gates.at(-1).decisive === true,
        'Quest must end with exactly one decisive objective'
    );

    const expectedSequence =
        QUEST_V2_STRUCTURES[plan.family][plan.gateCount];

    assert(expectedSequence, 'Unsupported quest structure length');

    for (let index = 0; index < plan.gates.length; index++) {
        const gate = plan.gates[index];

        assert(
            gate.stage === expectedSequence[index] &&
            gate.step === index + 1 &&
            gate.total === plan.gateCount,
            'Quest stages do not match the selected complete structure'
        );

        assert(
            ['arrival', 'discovery', 'linked_combat']
                .includes(gate.trigger),
            `Unsupported quest stage trigger: ${gate.trigger}`
        );
    }

    return plan;
}

function buildQuestV2Structure(family, gateCount, facts) {
    int(gateCount, 'quest structure gate count', 1);
    assert(
        facts && typeof facts === 'object',
        'Quest structure requires authored facts'
    );

    const sequence = QUEST_V2_STRUCTURES[family]?.[gateCount];

    assert(
        sequence,
        `No complete ${family} structure for ${gateCount} gates`
    );

    function fact(key) {
        const value = facts[key];
        assert(
            typeof value === 'string' && value.trim().length > 0,
            `Quest family ${family} requires fact '${key}'`
        );
        return value;
    }

    const objectiveFor = {
        retrieve_item: {
            approach:
                () => `Reach ${fact('destination')} safely.`,
            locate:
                () => `Find the authored clue identifying where ${fact('item')} is held.`,
            reach_inner_site:
                () => `Follow the established clue to the location of ${fact('item')}.`,
            find_access:
                () => `Discover the authored means of accessing ${fact('item')}.`,
            recover:
                () => `Recover ${fact('item')} from ${fact('destination')}.`
        },

        defeat_elite: {
            approach:
                () => `Reach the reported territory at ${fact('territory')}.`,
            track:
                () => `Follow the authored evidence of ${fact('target')}'s route.`,
            reach_lair:
                () => `Reach ${fact('target')}'s lair at ${fact('lair')}.`,
            find_target:
                () => `Locate ${fact('target')} using the authored signs at ${fact('lair')}.`,
            defeat:
                () => `Defeat the linked Elite target: ${fact('target')}.`
        }
    }[family];

    assert(
        objectiveFor,
        `Unsupported V2 quest family: ${family}`
    );

    const gates = sequence.map((stage, index) => {
        const definition = QUEST_V2_STAGES[family]?.[stage];
        const objectiveBuilder = objectiveFor[stage];

        assert(
            definition && objectiveBuilder,
            `Missing authored definition for ${family}.${stage}`
        );

        return {
            step: index + 1,
            total: gateCount,
            stage,
            mode: definition.mode,
            trigger: definition.trigger,
            objective: objectiveBuilder(),
            decisive: definition.decisive === true
        };
    });

    return validateQuestV2Structure({
        version: 2,
        family,
        gateCount,
        gates
    });
}

function buildQuestV2PlanForOffer(state, archetype, gateCount, facts) {
    const familyByArchetype = {
        missing_cargo: 'retrieve_item',
        sunken_salvage: 'retrieve_item',
        territorial_beast: 'defeat_elite',
        ruin_clearance: 'defeat_elite'
    };

    const family = familyByArchetype[archetype.id];
    if (!family) return null;

    let v2Facts;

    if (archetype.id === 'missing_cargo') {
        v2Facts = {
            item: facts.cargo,
            destination: facts.place
        };
    } else if (archetype.id === 'sunken_salvage') {
        v2Facts = {
            item: facts.cargo,
            destination: facts.wreck
        };
    } else if (archetype.id === 'territorial_beast') {
        v2Facts = {
            target: facts.beast,
            territory: facts.place,
            lair: facts.place
        };
    } else {
        v2Facts = {
            target: facts.threat,
            territory: facts.site,
            lair: facts.site
        };
    }


    const structure = buildQuestV2Structure(
        family,
        gateCount,
        v2Facts
    );

    return {
        ...structure,
        facts: clone(v2Facts)
    };
}

function buildAuthoredQuestGates(archetype, gateCount, facts) {
    assert(
        Array.isArray(archetype.gates) &&
        archetype.gates.length >= gateCount,
        `Quest archetype ${archetype.id} lacks ${gateCount} gate templates`
    );

    return archetype.gates.slice(0, gateCount).map(
        ([mode, template], index) => ({
            step: index + 1,
            total: gateCount,
            mode,
            trigger: index === 0 && [
                'missing_cargo', 'ruin_clearance', 'sunken_salvage'
            ].includes(archetype.id)
                ? 'arrival_with_evidence'
                : null,
            objective: template.replace(

                /\{([a-zA-Z0-9_]+)\}/g,
                (_match, key) => facts[key] ?? `{${key}}`
            )
        })
    );
}

function registerQuestDestination(state, quest) {
    state.places ||= {};
    state.leads ||= {};
    state.routeEdges ||= {};

    const label =
        quest.facts?.site ||
        quest.facts?.place ||
        quest.facts?.wreck;

    const destinationLabel =
        typeof label === 'string' && label.trim().length > 0
            ? label
            : `Quest destination, Zone ${quest.seed.zone}`;

    const placeId = `quest-place-${quest.id}`;
    const leadId = `quest-lead-${quest.id}`;

    const originSettlement = quest.originSettlementId
        ? Object.values(state.world?.settlements || {})
            .find(entry => entry.id === quest.originSettlementId)
        : savedPrimarySettlement(state, quest.seed.zone);

    assert(
        originSettlement,
        'Quest origin settlement is missing'
    );

    const originId =
        quest.originLocationId ||
        originSettlement.locationId;

    state.places[placeId] ||= {
        id: placeId,
        label: destinationLabel,
        zone: quest.seed.zone,
        kind: 'quest_site',
        visited: false
    };

    state.leads[leadId] ||= {
        id: leadId,
        kind: 'quest',
        label: `${quest.title}: ${destinationLabel}`,
        claim: quest.pitch,
        targetType: 'place',
        targetId: placeId,
        status: 'known'
    };

    if (!Array.isArray(state.routeEdges)) {
        state.routeEdges = [];
    }

    if (!state.routeEdges.some(edge =>
        (
            edge.fromId === originId &&
            edge.toId === placeId
        ) ||
        (
            edge.fromId === placeId &&
            edge.toId === originId
        )
    )) {
        state.routeEdges.push({
            fromId: originId,
            toId: placeId,
            length: 2
        });
    }

    quest.destinationId = placeId;

    quest.turnIn ||= {
        locationId: originSettlement.locationId,
        settlementId: originSettlement.id,
        recipient:
            quest.facts?.sponsor ||
            originSettlement.label
    };

    return { placeId, leadId };
}

function ensureQuestJournal(state) {
    state.quests ||= {};

    assert(
        state.quests &&
        typeof state.quests === 'object' &&
        !Array.isArray(state.quests),
        'state.quests must be an object'
    );

    for (const bucket of [
        'offered',
        'accepted',
        'completed',
        'declined',
        'abandoned'
    ]) {
        state.quests[bucket] ||= [];

        assert(
            Array.isArray(state.quests[bucket]),
            `state.quests.${bucket} must be an array`
        );
    }

    function containsQuest(id) {
        return Object.values(state.quests)
            .some(bucket =>
                bucket.some(quest => quest?.id === id)
            );
    }

    const active = state.activeQuest;

    if (
        active &&
        typeof active === 'object' &&
        typeof active.id === 'string' &&
        !containsQuest(active.id)
    ) {
        const bucketByStatus = {
            offered: 'offered',
            in_progress: 'accepted',
            complete: 'completed',
            declined: 'declined',
            abandoned: 'abandoned'
        };

        const bucket = bucketByStatus[active.status];

        if (bucket) {
            state.quests[bucket].push(active);
        }
    }
    /*
     * JSON persistence does not preserve shared object references.
     * Legacy progression still updates activeQuest, so use that selected
     * record as authoritative during this migration and reconnect the
     * journal to the same object before any quest action runs.
     * Journal-only offers remain independent and are never selected here.
     */
    if (
        active &&
        typeof active.id === 'string' &&
        questJournalBucketForStatus(active.status)
    ) {
        for (const bucket of Object.values(state.quests)) {
            for (let index = bucket.length - 1; index >= 0; index--) {
                if (bucket[index]?.id === active.id) {
                    bucket.splice(index, 1);
                }
            }
        }

        state.quests[questJournalBucketForStatus(active.status)]
            .push(active);
    }

    return state.quests;
}

function questJournalBucketForStatus(status) {
    return {
        offered: 'offered',
        in_progress: 'accepted',
        complete: 'completed',
        declined: 'declined',
        abandoned: 'abandoned'
    }[status] || null;
}

function removeQuestFromJournal(state, questId) {
    ensureQuestJournal(state);

    for (const bucket of Object.values(state.quests)) {
        const index = bucket.findIndex(
            quest => quest?.id === questId
        );

        if (index >= 0) {
            bucket.splice(index, 1);
        }
    }
}

function saveQuestToJournal(state, quest) {
    assert(
        quest &&
        typeof quest.id === 'string' &&
        quest.id.length > 0,
        'Cannot save a quest without a stable ID'
    );

    const bucket = questJournalBucketForStatus(quest.status);

    assert(
        bucket,
        `Unsupported quest journal status: ${quest.status}`
    );

    removeQuestFromJournal(state, quest.id);
    state.quests[bucket].push(quest);

    return quest;
}

function findQuestById(state, questId) {
    ensureQuestJournal(state);

    if (questId === undefined || questId === null) {
        return state.activeQuest || null;
    }

    assert(
        typeof questId === 'string' &&
        questId.length > 0,
        'Quest ID must be a non-empty string'
    );

    for (const bucket of Object.values(state.quests)) {
        const quest = bucket.find(
            entry => entry?.id === questId
        );

        if (quest) return quest;
    }

    return null;
}

function setActiveQuest(state, quest) {
    assert(
        quest &&
        typeof quest.id === 'string',
        'Active quest requires a valid quest'
    );

    state.activeQuest = quest;
    saveQuestToJournal(state, quest);

    return quest;
}

function resolveQuestSeed(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'quest requires state'
    );

    const state = clone(test.state);

    state.inquiries ||= {};
    ensureQuestJournal(state);

    const zone =
        test.zone ?? state.zone;

    assert(
        Number.isInteger(zone) && ZONES[zone],
        `Unknown zone: ${zone}`
    );

    const issuerSettlement =
        questIssuerSettlement(state, test);

    assert(
        issuerSettlement.zone === zone,
        `Quest issuer ${issuerSettlement.label} is not in Zone ${zone}`
    );

    const reputationKey =
        issuerSettlement.reputationKey;

    const repRecord =
        state.reputation?.[reputationKey];

    assert(
        repRecord,
        `No reputation record exists for ${issuerSettlement.label}`
    );

    const rep =
        normalizeQuestRepTier(
            test.repTier || repRecord.tier
        );

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

    /*
     * A saved active quest no longer blocks creation of another offer.
     * The trigger itself remains the duplicate-protection boundary:
     * once its quest seed is consumed, that trigger cannot create another
     * quest. A different rumor or breadcrumb may create another offer.
     *
     * Existing in-progress state remains the compatibility-selected quest
     * for progression. New offers are stored in the journal and do not
     * silently replace it.
     */
    const existing =
        state.activeQuest;

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

    const referencePackXp = canonicalMixedPackXp(
        zone,
        state.crew.level
    );

    const questPackMultiplier =
        progression.packMultiplier +
        Math.max(0, gates - 1) *
            EXTRA_QUEST_GATE_PACK_MULTIPLIER;

    const questXp = Math.round(
        referencePackXp * questPackMultiplier
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

    const eligibleArchetypes = eligibleQuestArchetypes(
        state,
        zone
    );

    assert(
        eligibleArchetypes.length > 0,
        `No authored quest scenarios are available for Zone ${zone} (${questGeographyProfile(state, zone) || 'unknown geography'})`
    );

    const archetypeRoll = roll(state, eligibleArchetypes.length);
    const selectedArchetype =
        eligibleArchetypes[archetypeRoll - 1];
    const archetype = selectedArchetype.archetype;
    const authored = buildQuestFacts(state, archetype, zone);
    const gatesData = buildAuthoredQuestGates(
        archetype,
        gates,
        authored.facts
    );

    const structureV2 = buildQuestV2PlanForOffer(
        state,
        archetype,
        gates,
        authored.facts
    );

    const usesV2Structure =
        structureV2 &&
        [
            'missing_cargo',
            'sunken_salvage',
            'territorial_beast',
            'ruin_clearance'
        ].includes(archetype.id);

    const questGatesData =
        usesV2Structure
            ? clone(structureV2.gates)
            : gatesData;

    const seed = {
        zone,
        repTier: rep.label,
        questRoll,
        gateCountRoll,
        salvageSlotRoll,
        archetypeRoll,
        archetypeId: archetype.id,
        scenarioRoll: authored.scenarioRoll,
        source: sourceSeed.source,
        sourceRoll: sourceSeed.roll,
        sourceResult: sourceSeed.result,
        terminalThreat: {
            kind: terminalThreat.kind,
            zone: terminalThreat.zone,
            roll: terminalThreat.roll
        }
    };

    const quest = {
        id:
            `quest-${inquiryRecord
                ? `rumor-${inquiryRecord.id}`
                : state.encounter.id}-` +
            `${row.rank}-${questRoll}-${archetype.id}`,
        title:
            `Rank ${row.rank} ${archetype.label}`,
        rank: row.rank,
        archetype: {
            id: archetype.id,
            label: archetype.label
        },
        gates,
        gatesData: questGatesData,
        structureV2,
        status: 'offered',
        seed,
        pitch: authored.pitch,
        facts: authored.facts,

        // Internal truth: only use this for quest validation/resolution,
        // never include it in narrator-facing offer packets.
        coreTruth: authored.truth,

        currentGate: {
            ...questGatesData[0]
        },
        objectiveResolution: null,

        payout: {
            xp: questXp,
            silver: row.silver,
            repSteps: row.repSteps,
            xpBasis: referencePackXp,
            xpBasisType: 'canonical_mid_mixed_pack',
            packMultiplier: questPackMultiplier

        },

        salvage,

        terminalThreat: {
            kind: terminalThreat.kind,
            zone: terminalThreat.zone,
            revealed: false,
            resolved: false
        },
        town: issuerSettlement.reputationKey,
        originSettlementId: issuerSettlement.id,
        originLocationId: issuerSettlement.locationId,
        repTierAtOffer: rep.label,
    };

        if (structureV2) {
        quest.targetId = `quest-target-${quest.id}`;

        for (const gate of quest.gatesData) {
            if (gate.trigger === 'linked_combat') {
                gate.linkedTargetId = quest.targetId;
            }
        }

        if (quest.currentGate?.trigger === 'linked_combat') {
            quest.currentGate.linkedTargetId = quest.targetId;
        }

        // V2 defeat-elite structures require an Elite regardless of rank.
        if (
            structureV2.family === 'defeat_elite' &&
            quest.gatesData.at(-1)?.trigger === 'linked_combat'
        ) {
            quest.terminalThreat.kind = 'elite';
            quest.seed.terminalThreat.kind = 'elite';
        }
    }

    registerQuestDestination(state, quest);
        quest.turnIn ||= {
        locationId: issuerSettlement.locationId,
        settlementId: issuerSettlement.id,
        recipient: quest.facts?.sponsor ||
            issuerSettlement.label
    };

    /*
     * Every generated quest is durable journal data. Preserve the current
     * active quest when it is offered or in progress; a newly discovered
     * offer must not replace or disappear behind that compatibility pointer.
     *
     * If there is no selectable current quest, retain the historical
     * activeQuest behavior so existing UI and progression continue to work.
     */
    saveQuestToJournal(state, quest);

    if (
        !state.activeQuest ||
        !['offered', 'in_progress'].includes(
            state.activeQuest.status
        )
    ) {
        state.activeQuest = quest;
    }

    /*
     * Legacy preparation helpers read activeQuest. Temporarily point them
     * at this newly generated offer, then restore the selected quest.
     * The journal keeps the same quest object, including prepared discoveries.
     * V2 defeat discoveries are still prepared on acceptance as before.
     */
    const selectedQuest = state.activeQuest;

    try {
        state.activeQuest = quest;
        prepareMissingCargoDiscovery(state);
        prepareSunkenSalvageDiscovery(state);
        prepareV2QuestDiscoveries(state);
    } finally {
        state.activeQuest = selectedQuest;
    }

    trigger.questSeedConsumed = true;
    return {
        ok: true,
        created: true,
        quest,
        state
    };
}

function prepareMissingCargoDiscovery(state) {
    const quest = state.activeQuest;

    if (
        quest?.archetype?.id !== 'missing_cargo' ||
        !Array.isArray(quest.gatesData) ||
        !quest.destinationId
    ) {
        return null;
    }

    quest.discoveries ||= [];

    const docketId = `${quest.id}-diversion-docket`;
    let docket = quest.discoveries.find(
        item => item.id === docketId
    );

    if (!docket) {
        docket = {
            id: docketId,
            kind: 'evidence',
            name: 'Counter-signed diversion docket',
            locationId: quest.destinationId,
            state: 'hidden',
            acquisitionPolicy: 'auto_on_reveal',
            hidingPlace:
                'inside the weigh-station scale counterweight housing',
            significance:
                'It identifies the subcontractor who diverted the tool shipment.'
        };
        quest.discoveries.push(docket);
    }

    const docketGate = quest.gatesData[1];
    if (docketGate?.mode === 'brain_social_heist') {
        docketGate.requiredDiscoveryId = docketId;

        if (quest.currentGate?.step === 2) {
            quest.currentGate.requiredDiscoveryId = docketId;
        }
    }

    const shipmentId = `${quest.id}-tool-shipment`;
    let shipment = quest.discoveries.find(
        item => item.id === shipmentId
    );

    if (!shipment) {
        shipment = {
            id: shipmentId,
            kind: 'quest_item',
            name: quest.facts?.cargo || 'Missing shipment',
            locationId: quest.destinationId,
            state: 'hidden',
            requiredAction: 'search_crates',
            acquisitionPolicy: 'auto_on_reveal',
            hidingPlace: 'inside the abandoned freight crates',
            significance:
                'This is the missing cargo the North Sluice peat-cutters reported.'
        };
        quest.discoveries.push(shipment);
    }

    const recoveryGate = quest.gatesData[2];
    if (recoveryGate?.mode === 'combat_twist_showdown') {
        recoveryGate.requiredDiscoveryId = shipmentId;
        recoveryGate.requiredDiscoveryState = 'acquired';

        if (quest.currentGate?.step === 3) {
            quest.currentGate.requiredDiscoveryId = shipmentId;
            quest.currentGate.requiredDiscoveryState = 'acquired';
        }
    }

    return docket;
}

function prepareSunkenSalvageDiscovery(state) {
    const quest = state.activeQuest;

    if (
        quest?.archetype?.id !== 'sunken_salvage' ||
        !quest.destinationId ||
        !Array.isArray(quest.gatesData)
    ) {
        return null;
    }

    /*
     * This first implementation supports the two-gate salvage plan:
     * arrive and identify the wreck, then recover its cargo.
     *
     * Longer salvage plans retain their existing behavior until their
     * individual gates have authored recovery requirements.
     */
    if (quest.gates !== 2) return null;

    const profiles = {
        1: {
            contents: [
                'Company-stamped payroll packets inside an oilskin liner.',
                'A matching wage ledger identifying the intended workers.'
            ],
            description:
                'The packets remain bundled for company payroll. ' +
                'The ledger identifies the shipment as the missing pay-chest.',
            requiredAction:
                'Free the pay-chest from its root-bound brackets, ' +
                'bring it onto secure ground, and inspect its contents.'
        },
        2: {
            contents: [
                'Waxed navigation charts bearing the ferry crew stamp.',
                'A brass sounding instrument secured in a fitted wooden cradle.'
            ],
            description:
                'The markings identify the case as the ferry crew navigation cargo.',
            requiredAction:
                'Recover the navigation case from beneath the wreck ' +
                'and inspect its identifying contents.'
        }
    };

    const profile = profiles[quest.seed?.scenarioRoll];
    assert(profile, 'No authored contents for this salvage scenario');

    quest.discoveries ||= [];

    const id = `${quest.id}-salvage-cargo`;
    let discovery = quest.discoveries.find(item => item.id === id);

    if (!discovery) {
        discovery = {
            id,
            kind: 'quest_item',
            name: quest.facts.cargo,
            locationId: quest.destinationId,
            state: 'hidden',
            requiredAction: profile.requiredAction,
            acquisitionPolicy: 'auto_on_reveal',
            hidingPlace:
                `${quest.facts.cargo} at ${quest.facts.wreck}, ` +
                `obstructed by ${quest.facts.obstacle}`,
            significance: profile.description,
            contents: clone(profile.contents),
            questCargo: true
        };

        quest.discoveries.push(discovery);
    }

    const gate = quest.gatesData[1];
    gate.requiredDiscoveryId = id;
    gate.requiredDiscoveryState = 'acquired';

    if (quest.currentGate?.step === 2) {
        quest.currentGate.requiredDiscoveryId = id;
        quest.currentGate.requiredDiscoveryState = 'acquired';
    }

    /*
     * Destination registration may already have established the issuer
     * and turn-in location. Preserve those and attach the cargo identity;
     * ||= on the whole record would silently omit discoveryId.
     */
    const issuer = quest.originSettlementId
        ? state.world?.settlements?.[quest.originSettlementId]
        : savedPrimarySettlement(state, quest.seed.zone);

    assert(issuer, 'Salvage quest issuing settlement is missing');

    const locationId =
        quest.turnIn?.locationId ||
        quest.originLocationId ||
        issuer.locationId;

    state.places ||= {};
    state.places[locationId] ||= {
        id: locationId,
        label: issuer.label,
        zone: issuer.zone,
        settlementId: issuer.id,
        kind: 'settlement'
    };

    quest.turnIn = {
        ...quest.turnIn,
        locationId,
        settlementId: quest.turnIn?.settlementId || issuer.id,
        recipient: quest.turnIn?.recipient || quest.facts.sponsor,
        discoveryId: id
    };

    return discovery;
}

function prepareV2QuestDiscoveries(state) {
    const quest = state.activeQuest;

    if (
        quest?.status !== 'in_progress' ||
        quest.structureV2?.family !== 'defeat_elite' ||
        !quest.destinationId
    ) {
        return null;
    }

    quest.discoveries ||= [];

    const id = `${quest.id}-target-trail`;
    let discovery = quest.discoveries.find(
        item => item.id === id
    );

    if (!discovery) {
        discovery = {
            id,
            kind: 'evidence',
            name: 'Fresh signs of the target',
            locationId: quest.destinationId,
            state: 'hidden',
            acquisitionPolicy: 'auto_on_reveal',
            hidingPlace:
                quest.facts?.evidence ||
                'among the recent signs at the quest site',
            significance:
                `The signs lead toward the lair of ` +
                `${quest.structureV2.facts?.target ||
                    'the quest target'}.`
        };

        quest.discoveries.push(discovery);
    }

    const trackingGate = quest.gatesData.find(
        gate =>
            gate.stage === 'track' &&
            gate.trigger === 'discovery'
    );

    // Short V2 structures may proceed directly from approach to combat.
    if (!trackingGate) return null;

    trackingGate.requiredDiscoveryId = id;
    trackingGate.requiredDiscoveryState = 'acquired';

    if (quest.currentGate?.step === trackingGate.step) {
        quest.currentGate.requiredDiscoveryId = id;
        quest.currentGate.requiredDiscoveryState = 'acquired';
    }

    return discovery;
}

function advanceQuestFromDiscovery(state, discovery) {
    const quest = state.activeQuest;
    const gate = quest?.currentGate;

    const requiredState = gate?.requiredDiscoveryState || 'acquired';

    const satisfied =
        gate?.requiredDiscoveryId === discovery.id &&
        (
            discovery.state === requiredState ||
            (
                requiredState === 'found' &&
                discovery.state === 'acquired'
            )
        );

    if (!satisfied) {
        return { state, questGate: null };
    }

    assert(
        !['active', 'spotted'].includes(state.encounter?.status),
        'Resolve or avoid the encounter before completing this gate'
    );

    const evidence =
        `Secured ${discovery.name} at ` +
        `${state.places?.[discovery.locationId]?.label ||
            discovery.locationId}.`;

    if (gate.step < quest.gates) {
        const progression = resolveQuestAction({
            state,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence: evidence
        });

        return {
            state: progression.state,
            questGate: {
                completed: progression.completedGate,
                next: progression.nextGate
            }
        };
    }

    if (quest.objectiveResolution) {
        return { state, questGate: null };
    }

    const progression = resolveQuestAction({
        state,
        action: 'resolve_objective',
        objectiveCompleted: true,
        objectiveRoute:
            gate.mode === 'combat_twist_showdown'
                ? 'combat'
                : gate.mode === 'brain_social_heist'
                    ? 'heist'
                    : 'other',
        completionEvidence: evidence
    });

    const updatedQuest = progression.state.activeQuest;
    updatedQuest.completedGates ||= [];

    if (!updatedQuest.completedGates.some(item => item.step === gate.step)) {
        updatedQuest.completedGates.push({
            ...gate,
            completionEvidence: evidence
        });
    }

    if (updatedQuest.turnIn) {
        progression.state.leads ||= {};

        const leadId = `quest-return-${updatedQuest.id}`;

        progression.state.leads[leadId] ||= {
            id: leadId,
            kind: 'quest_return',
            label: `Return cargo to ${updatedQuest.turnIn.recipient}`,
            claim: 'The recovered quest cargo is ready to return.',
            targetType: 'place',
            targetId: updatedQuest.turnIn.locationId,
            status: 'known'
        };
    }

    return {
        state: progression.state,
        questGate: {
            completed: clone(gate),
            next: null,
            objectiveSecured: true
        }
    };
}

function reconcileQuestDiscovery(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'Quest discovery reconciliation requires state'
    );

    const state = clone(test.state);
    const quest = state.activeQuest;

    assert(
        quest?.status === 'in_progress',
        'Quest discovery reconciliation requires an in-progress quest'
    );

    const gate = quest.currentGate;
    const requiredId = gate?.requiredDiscoveryId;

    assert(
        typeof requiredId === 'string' &&
        requiredId.length > 0,
        'Current quest gate has no required discovery'
    );

    const discovery = (quest.discoveries || []).find(
        item => item.id === requiredId
    );

    assert(
        discovery,
        `Required quest discovery is missing: ${requiredId}`
    );

    assert(
        discovery.state === 'acquired' ||
        discovery.state === 'found',
        `Required discovery is not acquired: ${discovery.state}`
    );

    assert(
        state.currentLocationId === discovery.locationId,
        'Crew is not at the discovery location'
    );

    assert(
        state.encounter?.status !== 'active' &&
        state.encounter?.status !== 'spotted',
        'Resolve or avoid the current encounter first'
    );

    const progression = resolveQuestAction({
        state,
        action: 'clear_gate',
        objectiveCompleted: true,
        completionEvidence:
            `The crew had already secured ${discovery.name} at ` +
            `${state.places?.[discovery.locationId]?.label ||
                discovery.locationId}.`
    });

    return {
        ok: true,
        created: true,
        action: 'quest_discovery_reconcile',
        discovery: clone(discovery),
        questGate: {
            completed: progression.completedGate,
            next: progression.nextGate
        },
        state: progression.state
    };
}

function resolveQuestEvent(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Quest event requires state'
    );

    const state = clone(test.state);
    const quest = state.activeQuest;

    assert(
        quest?.status === 'in_progress',
        'Quest event requires an in-progress quest'
    );
    assert(
        ['searched', 'found'].includes(test.event),
        `Unsupported quest discovery event: ${test.event}`
    );

    const discovery = (quest.discoveries || []).find(
        item => item.id === test.questItemId
    );

    assert(discovery, 'Unknown authored quest discovery');
    assert(
        state.currentLocationId === discovery.locationId,
        'Quest discovery is at the wrong location'
    );

    // Repeated message/render events must not acquire or advance twice.
    if (
        discovery.state === 'acquired' ||
        (test.event === 'searched' && discovery.state === 'searched')
    ) {
        return {
            ok: true,
            created: false,
            action: 'quest_event',
            event: test.event,
            discovery: clone(discovery),
            state
        };
    }

    const gate = quest.currentGate;
    const allowedIds = [
        ...(gate?.discoveryIds || []),
        ...(gate?.requiredDiscoveryId
            ? [gate.requiredDiscoveryId]
            : [])
    ];

    assert(
        allowedIds.includes(discovery.id),
        'Discovery is not authorized for the current gate'
    );

    if (test.event === 'searched') {
        assert(discovery.requiredAction, 'No search prerequisite exists');
        assert(
            discovery.state === 'hidden',
            `Cannot search from state ${discovery.state}`
        );

        discovery.state = 'searched';

        return {
            ok: true,
            created: true,
            action: 'quest_event',
            event: 'searched',
            discovery: clone(discovery),
            state
        };
    }

    assert(
        ['hidden', 'searched', 'found'].includes(discovery.state),
        `Cannot find discovery from state ${discovery.state}`
    );
    assert(
        !discovery.requiredAction || discovery.state === 'searched',
        'The authored search/recovery action must occur first'
    );

    discovery.state = discovery.acquisitionPolicy === 'auto_on_reveal'
        ? 'acquired'
        : 'found';

        /*
     * A final authored discovery objective secures the field objective.
     * Delivery and payment remain separate, using the locked turn-in path.
     */
    if (
        gate.requiredDiscoveryId === discovery.id &&
        gate.step === quest.gates &&
        discovery.state === 'acquired'
    ) {
        const objective = resolveQuestAction({
            state,
            action: 'resolve_objective',
            objectiveCompleted: true,
            objectiveRoute:
                gate.mode === 'combat_twist_showdown'
                    ? 'combat'
                    : gate.mode === 'brain_social_heist'
                        ? 'heist'
                        : 'other',
            completionEvidence:
                `Recovered ${discovery.name} at ` +
                `${state.places?.[discovery.locationId]?.label ||
                    discovery.locationId}.`
        });

        return {
            ok: true,
            created: true,
            action: 'quest_event',
            event: 'found',
            questItemId: discovery.id,
            discovery: clone(discovery),
            questObjective: objective.objectiveResolution,
            state: objective.state
        };
    }

    const progression = advanceQuestFromDiscovery(state, discovery);

    return {
        ok: true,
        created: true,
        action: 'quest_event',
        event: 'found',
        discovery: clone(discovery),
        questGate: progression.questGate,
        state: progression.state
    };
}

/*
 * QUEST DELIVERY MODEL
 *
 * Field objective completion and quest delivery are separate:
 *
 * 1. The extension detects that the field objective and cargo are secured.
 * 2. Returning to quest.turnIn.locationId sets deliveryReady, but does not
 *    pay rewards or mark the quest complete.
 * 3. The narrator stages the fictional handoff with the quest giver.
 * 4. The assistant may emit the validated protocol event:
 *
 *    <AETHERMOOR:DELIVERED quest_id=...>
 *
 * 5. The extension validates quest ID, location, acquired cargo, and
 *    deliveryReady, then completes the quest and applies rewards exactly once.
 *
 * The LLM never supplies XP, silver, reputation, loot, or quest identity.
 * It only confirms the fictional handoff after the extension has made it
 * mechanically eligible.
 *
 * Future HUD work:
 * Mechanical state should eventually render the HUD directly from saved
 * state. Until then, completion packets provide the next narrator reply
 * with authoritative post-delivery values.
 */


function resolveQuestAction(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'quest action requires state'
    );
    const state = clone(test.state);
    ensureQuestJournal(state);

    const quest = findQuestById(state, test.questId);

    assert(
        quest && typeof quest === 'object',
        test.questId != null
            ? `Unknown quest ID: ${test.questId}`
            : 'No selected quest'
    );

    /*
     * Offers coexist in the journal. Field progression still supports
     * one in-progress quest until arrival, combat, discovery, and delivery
     * have all been migrated to explicit quest selection.
     * Never silently displace an accepted quest when accepting an offer.
     */
    if (test.action === 'accept') {
        const otherAccepted = state.quests.accepted.find(
            entry =>
                entry?.status === 'in_progress' &&
                entry.id !== quest.id
        );

        assert(
            !otherAccepted,
            'Another quest is already in progress; its progression ' +
            'must be resolved before accepting this offer. ' +
            'This offer remains saved in the journal.'
        );
    }

    if (
        ['clear_gate', 'resolve_objective', 'complete']
            .includes(test.action)
    ) {
        assert(
            state.activeQuest?.id === quest.id,
            'Progression currently requires the selected active quest'
        );
    }

    assert(
        [
            'accept',
            'decline',
            'abandon',
            'clear_gate',
            'resolve_objective',
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
        questId: quest.id,
        quest,
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
        state.activeQuest = quest;
        registerQuestDestination(state, quest);
        quest.status = 'in_progress';

        if (quest.structureV2?.family === 'defeat_elite') {
            prepareV2QuestDiscoveries(state);
        }

        saveQuestToJournal(state, quest);

        return result;

    }

    if (test.action === 'decline') {
        assert(
            quest.status === 'offered',
            `Quest cannot be declined from status ${quest.status}`
        );

        quest.status = 'declined';
        saveQuestToJournal(state, quest);

        if (state.activeQuest?.id === quest.id) {
            state.activeQuest = null;
        }

        return result;
    }

    assert(
        quest.status === 'in_progress',
        `Quest action requires an in-progress quest, got ${quest.status}`
    );

        if (test.action === 'abandon') {
        assert(
            !['active', 'spotted'].includes(
                state.encounter?.status
            ),
            'Resolve, avoid, or flee the encounter before abandoning the quest'
        );

        quest.status = 'abandoned';
        quest.abandonedAtGate = quest.currentGate?.step || null;
        quest.abandonReason = test.reason || null;
        saveQuestToJournal(state, quest);

        if (state.activeQuest?.id === quest.id) {
            state.activeQuest = null;
        }

        return result;

    }

     if (test.action === 'clear_gate') {
        assert(
            Array.isArray(quest.gatesData) &&
            quest.gatesData.length === quest.gates,
            'This legacy quest has no engine-authored gate plan'
        );
        assert(
            quest.currentGate?.step < quest.gates,
            'Final gate must use resolve_objective before complete'
        );
        assert(
            test.objectiveCompleted === true,
            'Gate clearance requires objectiveCompleted: true'
        );
        assert(
            typeof test.completionEvidence === 'string' &&
            test.completionEvidence.trim().length > 0,
            'Gate clearance requires completionEvidence'
        );
        assert(
            state.encounter?.status !== 'active',
            'Resolve or flee the active encounter first'
        );

        const completedGate = {
            ...quest.currentGate,
            completionEvidence: test.completionEvidence.trim()
        };

        quest.completedGates ||= [];
        quest.completedGates.push(completedGate);

        const nextStep = completedGate.step + 1;
        quest.currentGate = {
            ...quest.gatesData[nextStep - 1]
        };

        result.completedGate = completedGate;
        result.nextGate = { ...quest.currentGate };

        if (
            quest.currentGate.trigger === 'linked_combat' &&
            quest.structureV2?.family === 'defeat_elite'
        ) {
            const spawned = spawnEncounter({
                state,
                encounterType: 'quest_terminal',
                encounterId: `quest-terminal-${quest.id}`
            });

            state.rngState = spawned.state.rngState;
            state.encounter = spawned.encounter;

            // The target is revealed, but the player still chooses whether
            // to engage, avoid, or flee.
            state.encounter.status = 'spotted';
            state.encounter.questTerminal.targetId = quest.targetId;

            quest.terminalThreat.revealed = true;
            quest.terminalThreat.resolved = false;
            quest.terminalThreat.encounterId =
                state.encounter.id;
            quest.terminalThreat.targetId =
                quest.targetId;

            result.linkedEncounter = {
                id: state.encounter.id,
                targetId: quest.targetId,
                status: 'spotted',
                role: state.encounter.foes[0]?.role,
                level: state.encounter.foes[0]?.level,
                hp: state.encounter.foes[0]?.hp,
                maxHp: state.encounter.foes[0]?.maxHp
            };
        }

        return result;

    }


    if (test.action === 'resolve_objective') {
        assert(
            quest.currentGate?.step === quest.gates,
            'Reach the final quest gate before resolving its objective'
        );
        assert(
            !quest.objectiveResolution,
            'Quest objective has already been resolved'
        );
        assert(
            test.objectiveCompleted === true,
            'Objective resolution requires objectiveCompleted: true'
        );
        assert(
            typeof test.completionEvidence === 'string' &&
            test.completionEvidence.trim().length > 0,
            'Objective resolution requires completionEvidence'
        );
        assert(
            ['combat', 'heist', 'negotiation', 'other']
                .includes(test.objectiveRoute),
            'Objective resolution requires a supported objectiveRoute'
        );
        assert(
            state.encounter?.status !== 'active',
            'Resolve or flee the active encounter first'
        );

        if (test.objectiveRoute === 'combat') {
            assert(
                quest.terminalThreat?.resolved === true,
                'Combat route requires the linked threat to be defeated'
            );
        }

        quest.objectiveResolution = {
            route: test.objectiveRoute,
            evidence: test.completionEvidence.trim()
        };
        result.objectiveResolution = quest.objectiveResolution;
        return result;
    }

    assert(
        test.objectiveCompleted === true,
        'Quest completion requires objectiveCompleted: true'
    );

    assert(
        typeof test.completionEvidence === 'string' &&
        test.completionEvidence.trim().length > 0,
        'Quest completion requires completionEvidence'
    );
    assert(
        state.encounter?.status !== 'active',
        'Cannot complete a quest during an active encounter'
    );

    assert(
        quest.objectiveResolution &&
        typeof quest.objectiveResolution.evidence === 'string',
        'Secure the quest objective before turning it in'
    );

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

    if (quest.turnIn) {
        assert(
            state.currentLocationId === quest.turnIn.locationId,
            'Return to the quest turn-in location first'
        );

        /*
         * All quests return to their locked issuer, but only quests
         * with a locked discoveryId require physical cargo. Defeat
         * objectives turn in a report instead; never invent an item
         * merely to satisfy the delivery system.
         */
        if (quest.turnIn.discoveryId) {
            const cargo = quest.discoveries?.find(
                item => item.id === quest.turnIn.discoveryId
            );

            assert(
                cargo?.state === 'acquired',
                'The required quest cargo is not in the crew possession'
            );

            cargo.state = 'delivered';
        } else {
            assert(
                quest.structureV2?.family !== 'retrieve_item',
                'Retrieval quest is missing its locked cargo discoveryId'
            );
        }
    }

        assert(
        quest.deliveryReady === true,
        'The quest must arrive at its turn-in location before delivery'
    );

    quest.status = 'complete';
    quest.turnInEvidence = test.completionEvidence.trim();
    saveQuestToJournal(state, quest);

    if (state.activeQuest?.id === quest.id) {
        state.activeQuest = null;
    }

    for (const lead of Object.values(state.leads || {})) {
        if (
            lead.id === `quest-return-${quest.id}` ||
            lead.id === `quest-lead-${quest.id}`
        ) {
            lead.status = 'resolved';
        }
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

                case 'travel':
                    result = resolveTravelStep(test);
                    break;

                case 'cleanup_test_data': {
                    const state = clone(test.state);

                    state.leads ||= {};
                    state.places ||= {};

                    const removedLeads = [];
                    const removedPlaces = [];

                    for (const [leadId, lead] of Object.entries(state.leads)) {
                        if (lead?.testOnly === true) {
                            removedLeads.push(leadId);
                            delete state.leads[leadId];

                            if (
                                lead.targetId &&
                                state.places[lead.targetId]?.testOnly === true
                            ) {
                                removedPlaces.push(lead.targetId);
                                delete state.places[lead.targetId];
                            }
                        }
                    }
                    const retiredQuestId =
                        'quest-travel-chat-message-171-1xp31t5-D-1';
                    let retiredQuest = null;

                    if (
                        state.activeQuest?.id === retiredQuestId &&
                        !Array.isArray(state.activeQuest.gatesData)
                    ) {
                        retiredQuest = state.activeQuest.id;
                        state.activeQuest.status = 'retired_test';
                        state.activeQuest.retiredReason =
                            'Legacy test quest predating authored quest gates';
                    }

                    result = {
                        ok: true,
                        action: 'cleanup_test_data',
                        retiredQuest,
                        removedLeads,
                        removedPlaces,
                        state
                    };
                    break;
                }
                case 'quest_discovery_prepare': {
                    const state = clone(test.state);

                    const discovery =
                        prepareMissingCargoDiscovery(state) ||
                        prepareSunkenSalvageDiscovery(state) ||
                        prepareV2QuestDiscoveries(state);

                    assert(
                        discovery,
                        'This quest has no supported discovery preparation'
                    );

                    result = {
                        ok: true,
                        action: 'quest_discovery_prepare',
                        discoveryId: discovery.id,
                        state
                    };
                    break;
                }

                case 'quest_discovery_reconcile':
                    result = reconcileQuestDiscovery(test);
                    break;

                case 'quest_event':
                    result = resolveQuestEvent(test);
                    break;

                                    case 'quest_reveal_terminal': {
                    const state = clone(test.state);
                    const quest = state.activeQuest;

                    assert(
                        quest?.status === 'in_progress',
                        'Quest threat requires an in-progress quest'
                    );

                    assert(
                        quest.currentGate?.mode ===
                            'combat_twist_showdown',
                        'The current quest gate does not require a combat showdown'
                    );

                    assert(
                        quest.terminalThreat &&
                        quest.terminalThreat.resolved !== true,
                        'Quest terminal threat is already resolved'
                    );

                    assert(
                        state.currentLocationId === quest.destinationId,
                        'The crew must reach the quest destination first'
                    );

                    assert(
                        !state.encounter ||
                        ['cleared', 'fled', 'dead'].includes(
                            state.encounter.status
                        ),
                        'Resolve the current encounter before revealing the quest threat'
                    );

                    result = spawnEncounter({
                        state,
                        encounterType: 'quest_terminal',
                        encounterId:
                            `quest-terminal-${quest.id}`
                    });
                                                            result.state.encounter.status = 'spotted';
                    result.state.encounter.questTerminal.targetId =
                        quest.targetId;

                    result.action = 'quest_reveal_terminal';
                    break;
                }

                case 'quest_site_inspect': {
                    const state = test.state;
                    const quest = state?.activeQuest;

                    assert(quest?.status === 'in_progress',
                        'Accept the quest before inspecting its site');
                    assert(quest.destinationId &&
                        state.currentLocationId === quest.destinationId,
                        'Travel to the quest destination first');
                    assert(quest.currentGate?.step === 1 &&
                        quest.currentGate.step < quest.gates,
                        'The first gate is not available for inspection');
                    assert(!['active', 'spotted'].includes(
                        state.encounter?.status
                    ), 'Resolve or avoid the nearby encounter first');

                    const place = state.places[quest.destinationId];
                    const evidence = quest.facts?.evidence
                        ? `Inspected ${quest.facts.evidence} at ${place.label}.`
                        : `Reached ${place.label} and inspected the signs relevant to the first gate.`;

                    result = resolveQuestAction({
                        state,
                        action: 'clear_gate',
                        objectiveCompleted: true,
                        completionEvidence: evidence
                    });
                    result.action = 'quest_site_inspect';
                    result.evidence = evidence;
                    break;
                }

                                    case 'debug_create_rumor': {
                    const state = clone(test.state);

                    assert(
                        state && typeof state === 'object',
                        'Debug rumor requires saved state'
                    );
                    assert(
                        !['active', 'spotted'].includes(
                            state.encounter?.status
                        ),
                        'Resolve or avoid the current encounter before creating a test rumor'
                    );

                    const rumorId = test.inquiryId ||
                        `debug-rumor-${Date.now()}`;

                    const placeId = `debug-place-${rumorId}`;
                    const leadId = `debug-lead-${rumorId}`;

                    state.places ||= {};
                    state.leads ||= {};
                    state.routeEdges ||= [];

                    assert(
                        !state.places[placeId] &&
                        !state.leads[leadId],
                        `Debug rumor already exists: ${rumorId}`
                    );

                    state.places[placeId] = {
                        id: placeId,
                        label: test.reason || 'Test Rumor Site',
                        zone: state.zone,
                        kind: 'test_rumor_site',
                        knownFrom: 'debug_test',
                        visited: false,
                        testOnly: true
                    };

                    state.leads[leadId] = {
                        id: leadId,
                        kind: 'rumor',
                        label: `Debug rumor: ${state.places[placeId].label}`,
                        claim: test.completionEvidence ||
                            'A test rumor points to this destination.',
                        sourceId: 'debug_test',
                        targetType: 'place',
                        targetId: placeId,
                        status: 'known',
                        testOnly: true,
                        arrivalTest: true
                    };


                    /*
                     * The fixture establishes a test claim without inventing
                     * a traveler encounter. Record it through the same knowledge
                     * helper used by ordinary traveler rumors.
                     *
                     * Arrival records a separate observation; it must never
                     * overwrite this testimony or make the original claim true.
                     * Fixture creation consumes no RNG.
                     */
                    recordCrewKnowledge(state, {
                        id: `knowledge-testimony-${leadId}`,
                        kind: 'testimony',
                        knowledgeType: 'testimony',
                        certainty: 'unverified_claim',
                        summary: state.leads[leadId].claim,
                        source: {
                            id: leadId,
                            type: 'debug_rumor_fixture'
                        },
                        learnedAtLocationId: state.currentLocationId,
                        learnedAtZone: state.zone
                    });

                    if (!state.routeEdges.some(edge =>
                        (
                            edge.fromId === state.currentLocationId &&
                            edge.toId === placeId
                        ) ||
                        (
                            edge.fromId === placeId &&
                            edge.toId === state.currentLocationId
                        )
                    )) {

                        state.routeEdges.push({
                            fromId: state.currentLocationId,
                            toId: placeId,
                            length: 1,
                            kind: 'debug_rumor_access',
                            testOnly: true
                        });
                    }

                    result = {
                        ok: true,
                        action: 'debug_create_rumor',
                        created: true,
                        leadId,
                        placeId,
                        label: state.places[placeId].label,
                        state
                    };
                    break;
                }

                                    case 'debug_create_settlement_lead': {
                    const state = clone(test.state);
                    const settlementId = test.settlementId;

                    assert(
                        typeof settlementId === 'string',
                        'Settlement lead requires settlementId'
                    );

                    const settlement = Object.values(
                        state.world?.settlements || {}
                    ).find(item => item.id === settlementId);

                    assert(
                        settlement,
                        `Unknown settlement: ${settlementId}`
                    );

                    assert(
                        settlement.locationId !== state.currentLocationId,
                        'Crew is already at that settlement'
                    );

                    const targetZone = state.world.zones?.[settlement.zone];

                    assert(
                        targetZone,
                        `Settlement ${settlement.label} has no saved zone`
                    );

                    state.places ||= {};
                    state.leads ||= {};

                    state.places[settlement.locationId] ||= {
                        id: settlement.locationId,
                        label: settlement.label,
                        zone: settlement.zone,
                        settlementId: settlement.id,
                        kind: 'settlement',
                        visited: false
                    };

                    const leadId =
                        `debug-destination-${settlement.id}`;

                    state.leads[leadId] ||= {
                        id: leadId,
                        kind: 'destination',
                        label: `Debug route: ${settlement.label}`,
                        claim:
                            `Test route to the primary settlement of ` +
                            `${targetZone.name}.`,
                        targetType: 'place',
                        targetId: settlement.locationId,
                        status: 'known',
                        testOnly: true
                    };

                    result = {
                        ok: true,
                        action: 'debug_create_settlement_lead',
                        leadId,
                        settlementId: settlement.id,
                        settlementLabel: settlement.label,
                        zone: settlement.zone,
                        state
                    };
                    break;
                }

                case 'journey':
                    result = resolveJourneyAction(test);
                    break;
               
                case 'investigate_lead': {
                    let state = clone(test.state);
                    const lead = state.leads?.[test.leadId];

                    assert(
                        lead?.kind === 'rumor' &&
                        lead.status === 'known',
                        'Choose a known, uninvestigated rumor'
                    );
                    assert(
                        lead.targetType === 'place' &&
                        state.currentLocationId === lead.targetId,
                        'The crew must arrive at the rumor destination first'
                    );
                    assert(
                        !state.activeQuest ||
                        !['offered', 'in_progress'].includes(
                            state.activeQuest.status
                        ),
                        'Resolve the existing quest offer before investigating another rumor'
                    );

                    const issuer =
                        questIssuerSettlement(state, test);

                    const repTier =
                        state.reputation?.[issuer.reputationKey]?.tier;

                    assert(
                        repTier,
                        `No saved reputation tier for ${issuer.label}`
                    );

                    const inquiry = resolveWorldSeeds({
                        state,
                        inquiryId: lead.id,
                        investigatedRumor: true
                    });

                    state = inquiry.state;
                    const finding = inquiry.findings.rumor;
                    let quest = null;

                    if (
                        finding ===
                        'genuine_unclaimed_quest_or_dungeon_hook'
                    ) {
                        const offer = resolveQuestSeed({
                            state,
                            inquiryId: lead.id,
                            zone: lead.zone || state.zone,
                            repTier,
                            town: issuer.reputationKey,
                            settlementId: issuer.id
                        });

                        state = offer.state;
                        if (offer.created) quest = offer.quest;
                    }

                    state.leads[test.leadId].status = 'investigated';
                    state.leads[test.leadId].finding = finding;

                    result = {
                        ok: true,
                        action: 'investigate_lead',
                        created: true,
                        leadId: test.leadId,
                        finding,
                        quest,
                        state
                    };
                    break;
                }


                case 'engage': {
                    const state = clone(test.state);
                    assert(
                        state.encounter?.status === 'spotted',
                        'There is no spotted encounter to engage'
                    );
                    state.encounter.status = 'active';

                    result = {
                        ok: true,
                        action: 'engage',
                        encounterId: state.encounter.id,
                        state
                    };
                    break;
                }
                case 'avoid': {
                    const state = clone(test.state);
                    assert(
                        state.encounter?.status === 'spotted',
                        'There is no spotted encounter to avoid'
                    );

                    state.encounter.status = 'fled';
                    state.encounter.spottedDisposition = 'avoided';

                    result = {
                        ok: true,
                        action: 'avoid',
                        created: true,
                        encounterId: state.encounter.id,
                        state
                    };
                    break;
                }
                    
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

                                    case 'debug_create_quest_breadcrumb': {
                    const state = clone(test.state);
                    const encounter = state.encounter;

                    assert(
                        encounter?.status === 'cleared',
                        'Test breadcrumb requires a cleared encounter'
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
                        'Test breadcrumb requires a cleared ordinary pack'
                    );
                    assert(
                        !encounter.questSeed,
                        'This encounter already has a quest seed'
                    );
                    assert(
                        !state.activeQuest ||
                        !['offered', 'in_progress'].includes(
                            state.activeQuest.status
                        ),
                        'Resolve the existing quest offer before testing another'
                    );

                    encounter.questSeed = {
                        source: 'pack_drop',
                        roll: 10,
                        result: 'diegetic_quest_breadcrumb',
                        testOnly: true
                    };
                    encounter.questSeedConsumed = false;

                    result = {
                        ok: true,
                        action: 'debug_create_quest_breadcrumb',
                        created: true,
                        encounterId: encounter.id,
                        questSeed: clone(encounter.questSeed),
                        state
                    };
                    break;
                }

                case 'follow_breadcrumb': {
                    const state = test.state;
                    const encounter = state?.encounter;
                    const seed = encounter?.questSeed;

                    assert(
                        encounter?.status === 'cleared' &&
                        seed?.result === 'diegetic_quest_breadcrumb',
                        'No cleared-pack quest breadcrumb is available'
                    );

                    assert(
                        seed.source === 'pack_drop',
                        'Breadcrumb is not from this pack'
                    );

                    const issuer =
                        questIssuerSettlement(state, test);

                    const repTier =
                        state.reputation?.[issuer.reputationKey]?.tier;

                    assert(
                        repTier,
                        `No saved reputation tier for ` +
                        `${issuer.label}`
                    );

                    result = resolveQuestSeed({
                        state,
                        zone: encounter.zone,
                        repTier,
                        town: issuer.reputationKey,
                        settlementId: issuer.id
                    });

                    break;
                }

                                    case 'debug_reconcile_quest_terminal': {
                    const state = clone(test.state);
                    const quest = state.activeQuest;
                    const gate = quest?.currentGate;
                    const threat = quest?.terminalThreat;

                    assert(
                        quest?.status === 'in_progress' &&
                        quest.seed?.testOnly === true,
                        'Reconciliation only applies to an in-progress test quest'
                    );

                    assert(
                        quest.structureV2?.family === 'defeat_elite' &&
                        gate?.trigger === 'linked_combat' &&
                        gate.linkedTargetId === quest.targetId,
                        'Current gate is not linked to this quest target'
                    );

                    assert(
                        threat?.revealed === true &&
                        threat.resolved !== true &&
                        threat.targetId === quest.targetId &&
                        typeof threat.encounterId === 'string',
                        'Quest does not have a matching revealed, unresolved threat'
                    );

                    assert(
                        state.currentLocationId === quest.destinationId,
                        'Crew must be at the quest destination to reconcile the test'
                    );

                    assert(
                        state.encounter?.status === 'cleared' &&
                        state.encounter.id !== threat.encounterId,
                        'Expected a cleared encounter separate from the linked quest encounter'
                    );

                    assert(
                        !quest.objectiveResolution,
                        'Quest objective is already resolved'
                    );

                    assert(
                        typeof test.completionEvidence === 'string' &&
                        test.completionEvidence.trim().length > 0,
                        'Reconciliation requires completionEvidence'
                    );

                    threat.resolved = true;
                    quest.objectiveResolution = {
                        route: 'combat',
                        evidence: test.completionEvidence.trim()
                    };

                    result = {
                        ok: true,
                        action: 'debug_reconcile_quest_terminal',
                        questId: quest.id,
                        targetId: quest.targetId,
                        linkedEncounterId: threat.encounterId,
                        observedClearedEncounterId: state.encounter.id,
                        objectiveResolution: quest.objectiveResolution,
                        state
                    };
                    break;
                }

                    case 'debug_retire_test_quest': {
                    const state = clone(test.state);
                    const quest = state.activeQuest;

                    assert(
                        quest?.status === 'offered' &&
                        quest.seed?.testOnly === true,
                        'Debug retirement only applies to an offered test quest'
                    );

                    quest.status = 'retired_test';
                    quest.retiredReason =
                        'Debug quest retired before testing';
                    quest.retiredAt = Date.now();

                    result = {
                        ok: true,
                        action: 'debug_retire_test_quest',
                        questId: quest.id,
                        state
                    };
                    break;
                }

                case 'debug_create_quest_offer': {
                    const state = clone(test.state);

                    /*
                     * A debug trigger may create an additional journal offer.
                     * resolveQuestSeed preserves the selected quest, while
                     * acceptance separately enforces the current limit of
                     * one in-progress quest. Fixture creation must not require
                     * declining an existing offer merely to test coexistence.
                     */

                    const issuer =
                        questIssuerSettlement(state, test);

                    const repTier =
                        state.reputation?.[issuer.reputationKey]?.tier;

                    assert(
                        repTier,
                        `No saved reputation tier for ` +
                        `${issuer.label}`
                    );

                    state.inquiries ||= {};

                    const inquiryId = test.inquiryId ||
                        `debug-quest-${Date.now()}`;

                    const inquiryKey = `rumor:${inquiryId}`;

                    assert(
                        !state.inquiries[inquiryKey],
                        `Debug quest trigger already exists: ${inquiryId}`
                    );

                    state.inquiries[inquiryKey] = {
                        id: inquiryId,
                        type: 'rumor',
                        zone: state.zone,
                        roll: 5,
                        result: 'genuine_unclaimed_quest_or_dungeon_hook',
                        lootSeed: null,
                        questSeed: {
                            source: 'debug_test',
                            roll: 5,
                            result: 'genuine_unclaimed_quest_or_dungeon_hook',
                            testOnly: true
                        },
                        questSeedConsumed: false
                    };

                    result = resolveQuestSeed({
                        state,
                        inquiryId,
                        zone: state.zone,
                        repTier,
                        town: issuer.reputationKey,
                        settlementId: issuer.id
                    });

                    if (result.quest) {
                        result.quest.seed.testOnly = true;
                        result.quest.seed.source = 'debug_test';
                    }

                    result.action = 'debug_create_quest_offer';
                    break;
                }

                case 'quest_delivery': {
                    const state = test.state;
                    const quest = state?.activeQuest;

                    assert(
                        quest?.status === 'in_progress',
                        'No in-progress quest can be delivered'
                    );
                    assert(
                        quest.deliveryReady === true,
                        'Quest delivery is not ready'
                    );
                    assert(
                        state.currentLocationId ===
                            quest.turnIn?.locationId,
                        'The crew is not at this quest turn-in location'
                    );

                    result = resolveQuestAction({
                        state,
                        action: 'complete',
                        objectiveCompleted: true,
                        completionEvidence:
                            `Delivered ${quest.discoveries?.find(
                                item =>
                                    item.id === quest.turnIn.discoveryId
                            )?.name || quest.facts?.cargo || 'the quest cargo'} ` +
                            `to ${quest.turnIn.recipient}.`
                    });

                    result.action = 'quest_delivery';
                    break;
                }

                case 'quest':
                    if (test.action) {
                        result = resolveQuestAction(test);
                    } else {
                        result = resolveQuestSeed(test);
                    }
                    break;
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

/*
 * Serialize state operations so two simultaneous tool calls cannot
 * both read the same revision and overwrite each other's changes.
 */
let aethermoorQueue = Promise.resolve();

function queueAethermoor(task) {
    const pending = aethermoorQueue.then(task);
    aethermoorQueue = pending.catch(() => {});
    return pending;
}

const AETHERMOOR_METADATA_KEY = 'aethermoorV2';

function checkImportedState(state) {
    assert(
        state && typeof state === 'object' && !Array.isArray(state),
        'Import requires a state object'
    );
    assert(ZONES[state.zone], 'Import requires a valid state.zone');
    assert(state.crew && state.crew.gear,
        'Import requires state.crew and its gear');
    assert(state.crew.gear.tansy && state.crew.gear.qtik,
        'Import requires both gear owner containers');
    assert(
        state.crew.shadows &&
        Array.isArray(state.crew.shadows.deck) &&
        Array.isArray(state.crew.shadows.active),
        'Import requires state.crew.shadows.deck and .active'
    );
    assert(
        state.inventory &&
        Array.isArray(state.inventory.bagReserves) &&
        Array.isArray(state.inventory.activeTradeListings) &&
        Array.isArray(state.inventory.consumables),
        'Import requires complete top-level state.inventory'
    );
    assert(
        state.gearGrantIds &&
        typeof state.gearGrantIds === 'object' &&
        !Array.isArray(state.gearGrantIds),
        'Import requires top-level state.gearGrantIds'
    );
    assert(
        Number.isInteger(state.rngState) && state.rngState > 0,
        'Import requires the saved positive rngState'
    );
    assert(
        state.inquiries && state.socialSeeds && state.reputation,
        'Import requires inquiries, socialSeeds, and reputation'
    );

    state.places ||= {};
    state.leads ||= {};
    state.currentLocationId ||= routeNodeId(state.zone, 'outpost');

    state.places[state.currentLocationId] ||= {
        id: state.currentLocationId,
        label: 'Peat-Cairn Outpost',
        zone: state.zone,
        kind: 'settlement'
    };

    const stats = derived(state.crew);
    int(state.crew.xp, 'crew.xp');
    int(state.crew.purse, 'crew.purse');
    int(state.crew.qtik.hp, 'qtik.hp');
    int(state.crew.tansy.hp, 'tansy.hp');

    assert(state.crew.qtik.hp <= stats.qtikMaxHp,
        "Q'tik HP exceeds derived maximum");
    assert(state.crew.tansy.hp <= stats.tansyMaxHp,
        'Tansy HP exceeds derived maximum');

    normalizeConsumableInventory(state.inventory);

    if (state.encounter !== null) {
        validate(state);
    }

    return stats;
}

function stateSummary(state, revision) {
    const stats = derived(state.crew);

    return {
        revision,
        zone: state.zone,
        level: state.crew.level,
        xp: state.crew.xp,
        nextXp: nextXp(state.crew.level),
        purse: state.crew.purse,
        qtikHp: state.crew.qtik.hp,
        qtikMaxHp: stats.qtikMaxHp,
        tansyHp: state.crew.tansy.hp,
        tansyMaxHp: stats.tansyMaxHp,
        atk: stats.atk,
        def: stats.def,
        weasels: state.crew.weasels.active,
        encounter: state.encounter && {
            id: state.encounter.id,
            status: state.encounter.status,
        foes: state.encounter.foes.map(foe => ({
            id: foe.id,
            role: foe.role,
            level: foe.level,
            hp: foe.hp,
            maxHp: foe.maxHp,
            nextTelegraph: foe.nextTelegraph || null
        }))

        },
        bagItems: state.inventory.bagReserves.length,
        activeTradeListings:
            state.inventory.activeTradeListings.length
    };
}

function travelNarrationPacket(result) {
    const lines = [
        `One [moved] travel step was resolved in Zone ${result.zone}.`
    ];

    if (result.event === 'quiet_travel') {
        lines.push(
            'Nothing notable was discovered on this stretch.'
        );
    } else if (result.event === 'environmental_sign') {
        lines.push(
            `Environmental sign: ${result.environmentalSign}.`,
            'This is a sign only; it does not establish an encounter, NPC, or quest.'
        );
    } else if (result.event === 'point_of_interest') {
        const site = result.site;

        lines.push(
            `The crew reached a new point of interest, site ${site.id}.`,
            `The site's curiosity result is: ${site.curiosity.replaceAll('_', ' ')}.`,
            'Describe the site around this established result. Do not add an unrolled reward or quest.'
        );
    } else if (result.event === 'wild_encounter') {
        lines.push(
            `The crew spotted encounter ${result.encounterId}.`,
            'The encounter remains spotted, not engaged. Narrate signs of the group and leave the response to the protagonists.'
        );
    } else if (result.event === 'social_opportunity') {
        lines.push(
            'The crew has encountered a traveler.',
            `The traveler appears ${result.social.demeanor}.`
        );

        if (result.rumor) {
            lines.push(
                `The traveler shares this claim: ${result.rumor.claim}`,
                `The claim points to ${result.rumor.targetLabel}.`,
                'Whether the claim is true has not been established. ' +
                'The crew has not visited that place or received a quest.'
            );
        } else {
            lines.push(
                'The traveler offers no rumor or quest lead.'
            );
        }

    } else if (result.event === 'significant_discovery') {
        lines.push(
            'The travel roll produced a significant-discovery opportunity, but no specific discovery has been mechanically established yet.'
        );
    } else if (result.event === 'rare_event') {
        lines.push(
            'The travel roll produced a rare-event opportunity, but no specific event has been mechanically established yet.'
        );
    }

    if (result.movement?.arrivalOnly) {
        lines.push(
            `Arrival at ${result.destinationLabel} was finalized. ` +
            'This [moved] did not consume another route segment.'
        );
    } else if (result.journey) {
        const journey = result.journey;

        lines.push(
            `Journey toward ${journey.destinationLabel}: ` +
            `${journey.completedSegments}/${journey.totalSegments} segments.`
        );

        if (result.movement?.journeySegmentConsumed) {
            lines.push(
                `This [moved] consumed journey segment ` +
                `${journey.completedSegments}/${journey.totalSegments}.`
            );
        }

        if (journey.status === 'paused') {
            lines.push(
                `Travel is paused by the spotted encounter at ` +
                `${journey.completedSegments}/${journey.totalSegments}. ` +
                'Resolve or avoid the encounter before another journey segment can be attempted.'
            );

            if (result.movement?.arrivalDeferred) {
                lines.push(
                    'The final route segment was already consumed; ' +
                    'arrival will be finalized after the encounter is resolved, ' +
                    'without rolling or consuming an additional segment.'
                );
            }
        } else if (result.arrived) {
            lines.push(`The crew arrived at ${journey.destinationLabel}.`);
        } else {
            lines.push('The crew has not reached the destination yet.');
        }
    }

    if (result.arrived || result.event === 'journey_arrival') {
        lines.push(
            'Arrival does not establish whether any rumor about this place is true.'
        );
    }

        if (result.questGate) {
        lines.push(
            `Evidence found at the destination: ${result.questGate.evidence}.`,
            `Quest gate ${result.questGate.completed.step} completed: ` +
                result.questGate.completed.objective,
            `Next gate ${result.questGate.next.step}: ` +
                result.questGate.next.objective,
            'No later gate or final quest reward has been completed.'
        );
    }

        if (result.deliveryReady) {
        lines.push(
            `The crew returned to the turn-in location with ` +
                `${result.deliveryReady.cargoName}.`,
            `The quest is eligible for delivery to ` +
                `${result.deliveryReady.recipient}.`,
            'Do not complete the quest mechanically until the fictional handoff occurs.'
        );
    }
        if (result.zoneTransition) {
        const transition = result.zoneTransition;

        lines.push(
            `The crew entered Zone ${transition.toZone}: ` +
                `${transition.toRegion}.`,
            `The terrain changed from ${transition.fromGeography || 'the previous region'} ` +
                `toward ${transition.toGeography || 'the next region'}.`,
            'Describe the geographic transition gradually. Do not treat the zone change as a teleport.'
        );
    }

    return lines.join('\n');
}

function discoveryNarrationPacket(encounter) {

    const roleNames = {
        brute: 'Brute',
        archer: 'Archer',
        mender: 'Mender',
        hexer: 'Hexer',
        buffer: 'Buffer',
        elite: 'Elite',
        boss: 'Boss'
    };

    const counts = {};
    const foes = encounter.foes.map(foe => {
        counts[foe.role] = (counts[foe.role] || 0) + 1;

        return `${roleNames[foe.role] || foe.role} ` +
            `${counts[foe.role]} (level ${foe.level})`;
    });

    return [
        'A new encounter has been discovered.',
        `Zone: ${encounter.zone}.`,
        `Enemies present: ${foes.join('; ')}.`,
        'The enemies have been spotted, but combat has not begun.',
        'Do not narrate an attack or resolve combat yet.',
        'Narrate what the crew can hear, see, smell, or infer about the group, then leave the decision to engage, avoid, investigate, negotiate, or retreat to the protagonists.'
    ].join('\n');
}

const PUBLIC_QUEST_FACT_KEYS = {
    missing_cargo: ['sponsor', 'cargo', 'place'],
    ruin_clearance: ['sponsor', 'site'],
    herb_foraging: ['sponsor', 'herb', 'place'],
    missing_person: ['sponsor', 'person', 'place'],
    sunken_salvage: ['sponsor', 'cargo', 'wreck'],
    territorial_beast: ['sponsor', 'beast', 'place']
};

function publicQuestFactLines(quest) {
    const keys = PUBLIC_QUEST_FACT_KEYS[quest.archetype?.id] || [];
    return keys
        .filter(key => typeof quest.facts?.[key] === 'string')
        .map(key => `${key}: ${quest.facts[key]}`);
}

function questOfferNarrationPacket(quest) {
    const sourceText = quest.seed?.source === 'rumor'
        ? 'The crew followed a rumor lead.'
        : 'The crew followed a quest breadcrumb found on a cleared pack.';

    const factLines = publicQuestFactLines(quest);
    return [
        sourceText,
        `Quest offered: ${quest.title}.`,
        quest.pitch || 'A local request has been presented.',
        ...factLines,
        `It has ${quest.gates} gate(s).`,
        `Completion would award ${quest.payout.xp} XP and ` +
            `${quest.payout.silver} silver, plus ` +
            `${quest.payout.repSteps} reputation step(s).`,
        `Offered salvage: ${quest.salvage.name} ` +
            `(${quest.salvage.rarity}).`,
        `First gate: ${quest.currentGate.mode}: ` +
            `${quest.currentGate.objective}`,
        'These quest facts and objectives are mechanically established. ' +
            'Do not reveal hidden truth or replace the objective.'
    ].join('\n');
}
function questDeliveryContextPacket(quest) {
    if (
        quest?.status !== 'in_progress' ||
        quest.deliveryReady !== true ||
        !quest.turnIn ||
        !quest.objectiveResolution
    ) {
        return null;
    }

    const cargoId = quest.turnIn.discoveryId;
    const cargo = cargoId
        ? quest.discoveries?.find(item => item.id === cargoId)
        : null;

    if (cargoId && cargo?.state !== 'acquired') return null;

    return [
        'PRIVATE QUEST TURN-IN CONTEXT — do not recite these instructions.',
        `Quest: ${quest.title}.`,
        `The crew is at the turn-in settlement for ${quest.turnIn.recipient}.`,
        cargoId
            ? `The required cargo, ${cargo.name}, is acquired.`
            : 'The field objective is secured. This is a report-only turn-in; no physical cargo is required.',
        'The quest is eligible for delivery, but arrival in town is not a handover.',
        'Do not start a sponsor meeting, deliver cargo, complete the quest, or emit a delivery tag unless the user directs the protagonists to meet or speak with the sponsor and the handover actually occurs in the fiction.',
        'When the handover actually occurs, place this exact tag inside the disposable <plan> block:',
        `<AETHERMOOR:DELIVERED quest_id=${quest.id}>`,
        'The tag only confirms the fictional handover. The extension determines and applies all rewards.',
        'Do not mention software, extensions, protocol tags, or reward administration in story prose.'
    ].join('\n');
}

function questDiscoveryContextPacket(quest) {
    if (
        quest?.status !== 'in_progress' ||
        quest.objectiveResolution
    ) {
        return null;
    }

    const discovery = quest.discoveries?.find(
        item => item.id === quest.currentGate?.requiredDiscoveryId
    );

    if (!discovery || discovery.state === 'acquired') return null;

    const lines = [
        'PRIVATE SCENE CONTEXT — do not recite these instructions.',
        `Quest objective: ${quest.currentGate.objective}`,
        `Authored object: ${discovery.name}.`,
        `Object state: ${discovery.state}.`,
        `Location: ${discovery.hidingPlace}.`,
        `Required action: ${discovery.requiredAction || 'expose the object'}.`,
        `Meaning when discovered: ${discovery.significance}.`,
        'A player declaration of success alone does not establish discovery.',
        'Judge whether the described actions actually expose or recover this object.',
        'Keep the story entirely in-world. Do not mention extensions, parsers, flags, or reward administration.'
    ];

    if (discovery.contents) {
        lines.push(
            'Authored contents; reveal only when the object is opened or inspected:',
            ...discovery.contents.map(item => `- ${item}`),
            'These contents are quest cargo, not personal loot. Do not add them to the crew purse.'
        );
    }

    if (discovery.requiredAction) {
        lines.push(
            'When the required action occurs, place this exact tag inside <plan>:',
            `<AETHERMOOR:SEARCHED quest_item=${discovery.id}>`
        );
    }

    lines.push(
        'When the object is actually recovered/exposed, place this exact tag inside <plan>:',
        `<AETHERMOOR:FOUND quest_item=${discovery.id}>`,
        'SEARCHED and FOUND may occur in the same reply, in that order, if the scene supports both.',
        'Do not emit tags merely because you received these instructions.'
    );

    return lines.join('\n');
}

function questTerminalNarrationPacket(encounter, quest) {
    const foe = encounter.foes?.[0];

    return [
        `The quest threat for ${quest.title} has been spotted.`,
        `A level ${foe.level} ${foe.role} is guarding the objective.`,
        'The encounter is spotted but not engaged. Combat has not begun.',
        'Narrate the threat and its relation to the established quest objective. Leave the decision to engage, avoid, or try another approach to the protagonists.'
    ].join('\n');
}

function questDiscoveryNarrationPacket(result, quest) {
    const discovery = result.discovery;

    if (result.event === 'searched') {
        return [
            `The required action concerning ${discovery.name} was recorded.`,
            'The object has not yet been mechanically acquired.',
            'Continue naturally; do not repeat the search or announce a discovery unless it occurs.'
        ].join('\n');
    }

    const lines = [
        `Discovery validated: ${discovery.name}.`,
        `State: ${discovery.state}.`
    ];

    if (discovery.questCargo) {
        lines.push(
            'The recovered object and its contents remain quest cargo, not personal wealth.'
        );
    }

    if (result.questGate?.objectiveSecured) {
        lines.push(
            'The final field objective is secured.',
            `Return the recovered cargo to ${quest.turnIn?.recipient || quest.facts.sponsor}.`,
            'The quest payout has not been granted.'
        );
    } else if (result.questGate?.next) {
        lines.push(
            `Gate ${result.questGate.completed.step} completed.`,
            `Next objective: ${result.questGate.next.objective}`
        );
    }

    return lines.join('\n');
}

function questSiteInspectionPacket(result, quest) {
    return [
        `At ${quest.facts.site || quest.facts.place || quest.facts.wreck}, ` +
            `the crew inspected the quest site.`,
        `Evidence found: ${result.evidence}`,
        `Gate ${result.completedGate.step} completed: ` +
            result.completedGate.objective,
        `Next gate ${result.nextGate.step}/${quest.gates}: ` +
            result.nextGate.objective,
        'Do not reveal the hidden cause or claim later gates are complete.'
    ].join('\n');
}

function questDeliveryNarrationPacket(result, quest) {
    const rewards = result.rewards || {
        xp: 0,
        silver: 0,
        repSteps: 0,
        loot: []
    };

    return [
        'AUTHORITATIVE QUEST COMPLETION CONTRACT — use these values exactly.',
        `Quest completed: ${quest.title}.`,
        `Handover recipient: ${quest.turnIn?.recipient || quest.facts?.sponsor || quest.town}.`,
        `Rewards applied by the extension: ${rewards.xp} XP, ` +
            `${rewards.silver} silver, ${rewards.repSteps} reputation step(s).`,
        ...(rewards.loot || []).map(item =>
            `Salvage granted: ${item.name} (${item.rarity}), ` +
            `Stat ${item.rawStat}.`
        ),
        'In the next reply, continue from the already-described handover and report these exact rewards naturally.',
        'Do not calculate, alter, repeat, or grant any additional rewards.',
        'Do not claim the crew delivered physical cargo unless this quest has a locked turnIn.discoveryId.',
        'Do not mention software, extensions, protocol tags, or reward administration in story prose.'
    ].join('\n');
}

function questActionNarrationPacket(result, questAction) {
    const quest = result.quest;

    if (questAction === 'accept') {
        return [
            `The crew accepted the quest offer: ${quest.title}.`,
            `The quest has ${quest.gates} gate(s).`,
            `The payout is ${quest.payout.xp} XP and ` +
                `${quest.payout.silver} silver, plus ` +
                `${quest.payout.repSteps} reputation step(s).`,
            `The offered salvage is ${quest.salvage.name} ` +
                `(${quest.salvage.rarity}).`,
            quest.pitch || 'The accepted request is now active.',
            ...publicQuestFactLines(quest),
            `The current gate is ${quest.currentGate.mode}: ` +
                `${quest.currentGate.objective}`,
            'Do not reveal coreTruth or change established quest facts.'

        ].join('\n');
    }

    if (questAction === 'decline') {
        return [
            `The crew declined the quest offer: ${quest.title}.`,
            'No quest rewards were paid and no objective was completed.',
            'The crew remains free to pursue other leads or explore.'
        ].join('\n');
    }

        if (questAction === 'abandon') {
        return [
            `The crew abandoned the active quest: ${quest.title}.`,
            'No quest rewards or reputation were granted.',
            'The quest was not completed. The crew is free to pursue other plans.'
        ].join('\n');
    }

        if (questAction === 'complete') {
        const rewards = result.rewards;

        return [
            `The crew returned the quest cargo to ${quest.turnIn?.recipient || quest.facts?.sponsor || quest.town}.`,
            `Quest completed: ${quest.title}.`,
            `Rewards paid: ${rewards.xp} XP, ${rewards.silver} silver, ` +
                `${rewards.repSteps} reputation steps.`,
            ...rewards.loot.map(item =>
                `Salvage received: ${item.name} (${item.rarity}).`
            ),
            'The company cargo was delivered; its contents were not added to the crew purse.',
            'Narrate the handover naturally without mentioning software, event tags, or state management.'
        ].join('\n');
    }

    return null;
}

function avoidEncounterNarrationPacket(encounter) {
    return [
        `The crew chose to avoid spotted encounter ${encounter.id}.`,
        'Combat did not begin. No combat rewards were earned.',
        'Narrate the crew leaving or bypassing the group in a way consistent with the user’s stated approach. Do not claim the enemies were defeated.'
    ].join('\n');
}

function rumorInvestigationNarrationPacket(result) {
    const lines = [
        `The crew investigated lead ${result.leadId} at its destination.`,
        `The rumor resolves as: ${result.finding.replaceAll('_', ' ')}.`
    ];

    if (result.quest) {
        lines.push(questOfferNarrationPacket(result.quest));

    } else if (
        result.finding === 'travelogue_flub_benign_oddity' ||
        result.finding === 'already_cleared_by_other_immortals'
    ) {
        lines.push(
            'This result resolves only the specific rumor. It does not mean the location has nothing else to explore.'
        );
    }

    return lines.join('\n');
}

function combatNarrationPacket(result, actions) {
    const qtikActions = {
        fire_melee: 'Fire Melee',
        ice_melee: 'Ice Melee',
        stun: 'Stun',
        ice_patch: 'Ice Patch',
        frost_stomp: 'Frost Stomp',
        drink: 'Drink'
    };

    const tansyActions = {
        visor: 'Point: Visor',
        vitals: 'Point: Vitals',
        hamstring: 'Point: Hamstring',
        recall: 'Recall',
        surge: 'Surge',
        drink: 'Drink',
        raise_shadow: 'Raise Shadow'
    };

    const roster = result.summary?.encounter?.foes || [];
    const foeNames = new Map(
        roster.map((foe, index) => [
            foe.id,
            combatFoeLabel(foe, index)
        ])
    );
    const foeName = id => foeNames.get(id) || id;

    const lines = [
        `Aethermoor combat turn ${result.turn} has resolved.`,
        `Q'tik used ${qtikActions[actions?.qtik] || actions?.qtik || 'an action'}.`,
        `Tansy used ${tansyActions[actions?.tansy] || actions?.tansy || 'a command'}.`,
        actions?.target
            ? `The selected target was ${foeName(actions.target)}.`
            : '',
        'The mechanics results below are authoritative. Do not change actions, damage, HP, effects, kills, or rewards.'
    ].filter(Boolean);
        if (result.death) {
        lines.push(
            `${result.death.fallenCrewMember === 'qtik' ? "Q'tik" : "Tansy"} ` +
            `fell during combat. The death penalty removed ` +
            `${result.death.xpLost} XP; the crew respawned at full HP.`
        );

        if (result.death.encounterAbandoned) {
            lines.push(
                'The encounter was abandoned. No encounter rewards were paid.'
            );
        }
    }

    for (const exchange of result.exchanges || []) {
        lines.push(`Exchange ${exchange.exchange}:`);

        for (const hit of exchange.hits || []) {
            lines.push(
                `The crew dealt ${hit.damage} damage to ${foeName(hit.id)}; ` +
                `it now has ${hit.hp} HP.`
            );
        }

        if (exchange.enemyMiss === true) {
            lines.push('The enemy attack missed.');
        }

        if (exchange.frontlineDamage > 0) {
            lines.push(
                `The enemy pack dealt ${exchange.frontlineDamage} ` +
                `damage to Q'tik.`
            );
        }

        if (exchange.backlineDamage > 0) {
            lines.push(
                `Enemies dealt ${exchange.backlineDamage} damage to Tansy.`
            );
        }

        if (exchange.effectiveRegen > 0) {
            lines.push(
                `Q'tik regenerated ${exchange.effectiveRegen} HP.`
            );
        }

        for (const effect of exchange.effects || []) {
            lines.push(`Effect: ${effect}.`);
        }

        lines.push(
            `After this exchange: Q'tik ${exchange.qtikHp} HP; ` +
            `Tansy ${exchange.tansyHp} HP.`
        );
    }

    for (const kill of result.kills || []) {
        lines.push(`${foeName(kill.id)} was slain.`);
    }

    for (const effect of result.turnEffects || []) {
        lines.push(`Turn effect: ${effect}.`);
    }

    for (const levelUp of result.levelUps || []) {
        lines.push(
            `The crew reached level ${levelUp.level}. ` +
            `They have ${levelUp.xpRemaining}/${levelUp.nextXp} XP ` +
            `toward the next level.`
        );
    }

       if (result.rewards?.applied) {
        lines.push(
            `Encounter rewards: ${result.rewards.xp} XP, ` +
            `${result.rewards.silver}s.`
        );

        for (const item of result.rewards.loot || []) {
            lines.push(
                `Loot: ${item.name} (${item.rarity}).`
            );
        }

        const drop = result.rewards.packDrop;

        if (drop?.result === 'auto_salvage_only') {
            lines.push('Pack drop: no additional loot.');
        } else if (drop?.result === 'diegetic_quest_breadcrumb') {
            lines.push(
                'Pack drop: quest breadcrumb discovered.'
            );
        }
    } else if (result.packCleared) {
        lines.push(
            'The encounter was cleared, but no encounter rewards ' +
            'were applied.'
        );
    } else {
        lines.push('Encounter rewards have not been applied.');
    }
    if (result.packCleared) {
        lines.push(
            `Encounter ${result.summary?.encounter?.id || 'unknown'} is cleared.`,
            'No enemies remain alive. This combat has ended.'
        );
    }

    if (result.questGate) {
        lines.push(
            `Quest gate ${result.questGate.completed.step} completed ` +
                `through the linked combat encounter.`
        );

        if (result.questGate.objectiveSecured) {
            lines.push(
                'The quest field objective is secured.',
                'The quest payout has not been granted; the crew must return to the issuer and report the completed objective.'
            );
        } else if (result.questGate.next) {
            lines.push(
                `Next quest gate: ${result.questGate.next.step}/` +
                    `${result.questGate.next.total}; ` +
                    `${result.questGate.next.objective}`
            );
        }
    }

    if (result.summary) {
        lines.push(
            `Current crew state: level ${result.summary.level}, ` +
            `${result.summary.xp}/${result.summary.nextXp} XP; ` +
            `Q'tik ${result.summary.qtikHp}/${result.summary.qtikMaxHp} HP; ` +
            `Tansy ${result.summary.tansyHp}/${result.summary.tansyMaxHp} HP.`
        );

        const living = (result.summary.encounter?.foes || [])
            .filter(foe => foe.hp > 0);

        lines.push(
            living.length
                ? `Living foes: ${living.map((foe, index) => {
                    const originalIndex = roster.findIndex(
                        entry => entry.id === foe.id
                    );
                    return (
                        `${combatFoeLabel(foe, originalIndex)} ` +
                        `at ${foe.hp}/${foe.maxHp} HP`
                    );
                }).join('; ')}.`
                : 'No foes remain alive.'
        );
    }

    return lines.join('\n');
}

function migrateAethermoorHandoffs(stored) {
    if (Array.isArray(stored?.handoffQueue)) {
        return clone(stored.handoffQueue);
    }

    // Older saves had two slots. Their original creation order was not
    // recorded; combat before the subsequently opened quest lead is
    // the safest ordering for this workflow.
    const queue = [];

    if (stored?.pendingNarration?.packet) {
        queue.push({
            id: 'legacy-combat',
            type: 'combat',
            packet: stored.pendingNarration.packet
        });
    }

    if (stored?.pendingDiscovery?.packet) {
        queue.push({
            id: 'legacy-discovery',
            type: 'discovery',
            packet: stored.pendingDiscovery.packet
        });
    }

    return queue;
}

function appendAethermoorHandoff(queue, entry, revision) {
    queue.push({
        id: `${revision}-${queue.length + 1}`,
        type: entry.type,
        packet: entry.packet
    });
}

async function runStoredMechanic(args) {
    return queueAethermoor(async () => {
        const context = getContext();
        const metadata = context.chatMetadata;

        assert(
            metadata && typeof context.saveMetadata === 'function',
            'Open a chat with metadata saving available'
        );

        let stored = metadata[AETHERMOOR_METADATA_KEY];

        /*
         * World migration uses the same serialized save path as mechanics.
         * Preserve the full stored wrapper, including queued handoffs.
         * Never alter the original state until the save succeeds.
         */
        if (stored?.state) {
            const migratedState = clone(stored.state);

            if (ensureWorldRecords(migratedState)) {
                const previousStored = stored;

                assert(
                    getContext().chatMetadata === metadata,
                    'Chat changed during world initialization'
                );

                metadata[AETHERMOOR_METADATA_KEY] = {
                    ...stored,
                    revision: stored.revision + 1,
                    state: migratedState
                };

                try {
                    await context.saveMetadata();
                } catch (error) {
                    metadata[AETHERMOOR_METADATA_KEY] = previousStored;
                    throw error;
                }

                stored = metadata[AETHERMOOR_METADATA_KEY];
            }
        }

        /*
         * Batch cases were independent test fixtures before persistence.
         * Accept exactly one live operation per call so there is no
         * ambiguous choice of which result should become saved state.
         */
        const batch = Array.isArray(args.cases);

        if (batch) {
            assert(args.cases.length === 1,
                'Persistent mode accepts exactly one case per call');
        }

        const oneCase = batch ? args.cases[0] : null;

        if (oneCase?.kind === 'state') {
            if (oneCase.action === 'status') {
                assert(stored?.state,
                    'No saved Aethermoor state; import it first');
                return {
                    ok: true,
                    summary: stateSummary(stored.state, stored.revision)
                };
            }

            if (oneCase.action === 'export') {
                assert(stored?.state,
                    'No saved Aethermoor state; import it first');
                return {
                    ok: true,
                    revision: stored.revision,
                    state: clone(stored.state)
                };
            }

            assert(oneCase.action === 'import',
                'State action must be import, status, or export');
            assert(!stored,
                'This chat already has saved state; import will not overwrite it');
            const imported = clone(oneCase.state);
            ensureWorldRecords(imported);
            checkImportedState(imported);

            assert(getContext().chatMetadata === metadata,
                'Chat changed during import; nothing was saved');

            metadata[AETHERMOOR_METADATA_KEY] = {
                revision: 1,
                state: imported
            };

            try {
                await context.saveMetadata();
            } catch (error) {
                delete metadata[AETHERMOOR_METADATA_KEY];
                throw error;
            }

            return {
                ok: true,
                imported: true,
                summary: stateSummary(imported, 1)
            };
        }

        assert(stored?.state,
            'No saved Aethermoor state; import it first');

        assert(args.state === undefined,
            'State is stored by the extension; omit top-level state');
        assert(!batch || oneCase.state === undefined,
            'State is stored by the extension; omit case.state');

        const savedState = clone(stored.state);
        const input = batch
            ? {
                ...args,
                cases: [{
                    ...oneCase,
                    state: savedState
                }]
            }
            : {
                ...args,
                state: savedState
            };

        const output = batch
            ? resolveBatch(input)
            : resolveTurn(input);

        assert(output?.ok !== false,
            batch
                ? output.results?.[0]?.error ||
                  'Mechanics case failed; state unchanged'
                : output.error ||
                  'Mechanics operation failed; state unchanged'
        );

        const caseResult = batch
            ? output.results[0].result
            : output;

        /*
         * Reference, stock, and food-list operations do not return
         * mutated state. They are read-only.
         */
        if (!caseResult?.state) {
            return output;
        }

        // A repeated [moved] message reuses its locked result without
        // saving another revision or replacing a pending handoff.
        if (batch && oneCase.kind === 'travel' && caseResult.created === false) {
            const { state: _saved, ...visibleResult } = caseResult;
            return {
                ok: true,
                total: 1,
                passed: 1,
                failed: 0,
                results: [{
                    ...output.results[0],
                    result: visibleResult
                }],
                summary: stateSummary(stored.state, stored.revision)
            };
        }

        /*
         * Resolve known rumors only at a confirmed location: an unfinished
         * journey, including deferred final-segment arrival, blocks this.
         * Running here also allows a deferred hook to become an offer after
         * the quest slot becomes available while the crew remains at the site.
         *
         * State reads return earlier and never run this integration.
         * Rumor state and its narration packets share the operation's save,
         * so a failed save cannot leave an independently committed outcome.
         */
        const arrivedRumors = resolveArrivedRumors(caseResult.state);
        const nextState = arrivedRumors.state;
        caseResult.state = nextState;

        if (arrivedRumors.resolutions.length > 0) {
            caseResult.rumorArrivals = arrivedRumors.resolutions;
        }

        assert(getContext().chatMetadata === metadata,
            'Chat changed during operation; nothing was saved');

        const previous = metadata[AETHERMOOR_METADATA_KEY];
        const revision = previous.revision + 1;

        const isCombatTurn = batch
            ? oneCase?.kind === 'turn'
            : Boolean(args.actions);

        const narrationPacket = isCombatTurn
            ? combatNarrationPacket(
                {
                    ...caseResult,
                    summary: stateSummary(nextState, revision)
                },
                batch ? oneCase.actions : args.actions
            )
            : null;
        // Private discovery context is supplied dynamically by the
        // interceptor, not stored as a one-use historical event.
        const questDiscoveryContext = null;

        const questActionPacket =
            batch &&
            oneCase?.kind === 'quest' &&
            ['accept', 'decline', 'abandon', 'complete']
                .includes(oneCase.action)
                ? questActionNarrationPacket(
                    {
                        ...caseResult,
                        quest: caseResult.quest
                    },
                    oneCase.action
                )
                : null;

        const questDeliveryPacket =
            batch &&
            oneCase?.kind === 'quest_delivery' &&
            caseResult.created !== false
                ? questDeliveryNarrationPacket(
                    caseResult,
                    caseResult.quest
                )
                : null;

        const previousEncounter = savedState.encounter;
        const nextEncounter = nextState.encounter;
        const beganNewEncounter =
            ['active', 'spotted'].includes(nextEncounter?.status) &&
            nextEncounter.id !== previousEncounter?.id;

         const discoveryPacket =
            batch &&
            oneCase?.kind === 'quest_reveal_terminal' &&
            caseResult.created !== false
                ? questTerminalNarrationPacket(
                    nextState.encounter,
                    nextState.activeQuest
                )

            : beganNewEncounter
                ? discoveryNarrationPacket(nextEncounter) +
                  (caseResult.journey
                      ? `\n${travelNarrationPacket(caseResult)}`
                      : '')

            : batch && oneCase?.kind === 'follow_breadcrumb' &&
              caseResult.created &&
              caseResult.quest
                ? questOfferNarrationPacket(caseResult.quest)
            
             : batch &&
              oneCase?.kind === 'debug_create_quest_offer' &&
              caseResult.created &&
              caseResult.quest
                ? questOfferNarrationPacket(caseResult.quest)

            : questDeliveryPacket
                ? questDeliveryPacket

            : questActionPacket
                ? questActionPacket


            : batch &&
              oneCase?.kind === 'quest_discovery_reconcile' &&
              caseResult.created
                ? questDiscoveryNarrationPacket(
                    caseResult,
                    nextState.activeQuest
                )

            : batch &&
              oneCase?.kind === 'quest_event' &&
              caseResult.created
                ? questDiscoveryNarrationPacket(
                    caseResult,
                    nextState.activeQuest
                )

            : batch &&
              oneCase?.kind === 'quest_site_inspect'
                ? questSiteInspectionPacket(
                    caseResult,
                    nextState.activeQuest
                )

            : batch &&
              oneCase?.kind === 'investigate_lead' &&
              caseResult.created
                ? rumorInvestigationNarrationPacket(caseResult)

            : batch &&
              oneCase?.kind === 'avoid' &&
              caseResult.created
                ? avoidEncounterNarrationPacket(nextEncounter)

            : batch &&
              oneCase?.kind === 'travel' &&
              caseResult.created
                ? travelNarrationPacket(caseResult)

            : null;

        const handoffQueue = migrateAethermoorHandoffs(stored);

                if (questDiscoveryContext) {
            appendAethermoorHandoff(
                handoffQueue,
                {
                    type: 'quest_context',
                    packet: questDiscoveryContext
                },
                revision
            );
        }

        if (discoveryPacket) {
            appendAethermoorHandoff(
                handoffQueue,
                {
                    type: 'discovery',
                    packet: discoveryPacket
                },
                revision
            );
        }

        if (narrationPacket) {
            appendAethermoorHandoff(
                handoffQueue,
                {
                    type: 'combat',
                    packet: narrationPacket
                },
                revision
            );
        }
        const rumorPackets = [
            ...(caseResult.rumorArrivalPackets || []),
            ...arrivedRumors.packets
        ];

        for (const packet of rumorPackets) {
            appendAethermoorHandoff(
                handoffQueue,
                {
                    type: 'rumor_arrival',
                    packet
                },
                revision
            );
        }


        metadata[AETHERMOOR_METADATA_KEY] = {
            revision,
            state: nextState,
            handoffQueue
        };

        try {
            await context.saveMetadata();

        } catch (error) {
            metadata[AETHERMOOR_METADATA_KEY] = previous;
            throw error;
        }

        /*
         * The full machine state stays in chat metadata, rather than
         * being copied through the prompt or tool response.
         */
        const { state: _saved, ...visibleResult } = caseResult;

        if (batch) {
            return {
                ok: true,
                total: 1,
                passed: 1,
                failed: 0,
                results: [{
                    ...output.results[0],
                    result: visibleResult
                }],
                summary: stateSummary(nextState, revision)
            };
        }

        return {
            ...visibleResult,
            summary: stateSummary(nextState, revision)
        };
    });
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
            'Aethermoor mechanics using saved per-chat state.',
            'First call one case: kind state, action import, with full state.',
            'Thereafter omit state: use one case per call for spawn and',
            'other operations, or actions for a combat turn.',
            'Use kind state with action status or export to inspect storage.',
            'Do not choose actions or narrate.'
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
                                    'state',
                                    'spawn',
                                    'travel',
                                    'journey',
                                    'quest_discovery_prepare',
                                    'quest_delivery',
                                    'quest_discovery_reconcile',
                                    'quest_event',
                                    'quest_site_inspect',
                                    'quest_reveal_terminal',
                                    'investigate_lead',
                                    'engage',
                                    'avoid',
                                    'turn',
                                    'reference',
                                    'world_seeds',
                                    'social',
                                    'loot',
                                    'cleanup_test_data',
                                    'debug_create_rumor',
                                    'debug_create_settlement_lead',
                                    'debug_create_quest_offer',
                                    'debug_create_quest_breadcrumb',
                                    'debug_reconcile_quest_terminal',
                                    'debug_retire_test_quest',
                                    'follow_breadcrumb',
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

                            siteAffinity: {
                                type: 'string',
                                enum: [
                                    'ordinary',
                                    'ruin',
                                    'barrow',
                                    'lair'
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
                            
                            leadId: {
                                type: 'string'
                            },
                            destinationId: {
                                type: 'string',
                                description:
                                    'Stable known destination ID for explicit movement'
                            },

                            questItemId: {
                                type: 'string',
                                description:
                                    'Stable ID of an authored quest discovery'
                            },
                            event: {
                                type: 'string',
                                enum: ['searched', 'found']

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
                            settlementId: {
                                type: 'string',
                                description:
                                    'Stable ID of the settlement issuing the quest'
                            },
                                                        questId: {
                                type: 'string',
                                description:
                                    'Stable ID of the quest to select from the quest journal'
                            },

                            action: {
                                type: 'string',
                                enum: [
                                    'import',
                                    'status',
                                    'export',
                                    'accept',
                                    'decline',
                                    'abandon',
                                    'clear_gate',
                                    'resolve_objective',
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
                            objectiveRoute: {
                                type: 'string',
                                enum: [
                                    'combat',
                                    'heist',
                                    'negotiation',
                                    'other'
                                ]
                            },
                            socialId: {
                                type: 'string',
                                description:
                                    'Stable NPC or consequential-deal ID; choose before rolling'
                            },

                            objectiveCompleted: {
                                type: 'boolean',
                                description:
                                    'Must be true when the final quest objective has been completed in the fiction'
                            },

                            completionEvidence: {
                                type: 'string',
                                description:
                                    'Brief diegetic evidence that the final quest objective was completed'
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

function combatFoeLabel(foe, index) {
    const roleNames = {
        brute: 'Brute',
        archer: 'Archer',
        mender: 'Mender',
        hexer: 'Hexer',
        buffer: 'Buffer',
        elite: 'Elite',
        boss: 'Boss'
    };

    return `${roleNames[foe.role] || foe.role} ${index + 1}`;
}

function formatWorldStatus(state) {
    const places = new Map();

    for (const place of Object.values(state.places || {})) {
        if (place?.id) places.set(place.id, place);
    }

    // Show places discovered before the places collection was added.
    for (const step of Object.values(state.travelSteps || {})) {
        if (step?.event !== 'point_of_interest' || !step.site?.id) {
            continue;
        }

        if (!places.has(step.site.id)) {
            places.set(step.site.id, {
                id: step.site.id,
                label: 'Uncharted point of interest',
                zone: step.site.zone
            });
        }
    }

    const leads = Object.values(state.leads || {});
    const zoneRecord = state.world?.zones?.[state.zone];
    const settlement = zoneRecord
        ? state.world.settlements[zoneRecord.primarySettlementId]
        : null;

    const lines = [
        `Region: ${zoneRecord?.name || ZONES[state.zone].name} ` +
            `(Zone ${state.zone})`,
        `Geography: ${zoneRecord?.geography.description || 'not recorded'}`,
        `Approach from: ${
            zoneRecord?.geography.transitionFrom
                ? WORLD_GEOGRAPHY[
                    zoneRecord.geography.transitionFrom
                  ]?.label || zoneRecord.geography.transitionFrom
                : 'starting region'
        }`,
        `Primary settlement: ${settlement?.label || 'not recorded'}`,
        '',
        'Known places',

        places.size
            ? [...places.values()].map((place, index) =>
                `${index + 1}. ${place.label} ` +
                `(Zone ${place.zone}; reference: ${place.id})`
            ).join('\n')
            : 'None recorded.',
        '',
        'Rumors'
    ];

    const rumors = leads.filter(lead => lead?.kind === 'rumor');
    lines.push(
        rumors.length
            ? rumors.map(lead =>
                `- ${lead.claim || lead.label || lead.id}`
            ).join('\n')
            : 'None recorded.'
    );

    const otherLeads = leads.filter(lead => lead?.kind !== 'rumor');
    lines.push('', 'Other leads');
    lines.push(
        otherLeads.length
            ? otherLeads.map(lead =>
                `- ${lead.claim || lead.label || lead.id}`
            ).join('\n')
            : 'None recorded.'
    );

    return lines.join('\n');
}

async function openWorldPanel() {
    try {
        const snapshot = await readStoredCombatState();
        const state = snapshot.state;
        const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
        const journey = state.currentJourney;
        const leads = Object.values(state.leads || {})
            .filter(lead =>
                lead?.status === 'known' &&
                lead.targetType === 'place' &&
                state.places?.[lead.targetId]
            );

        const actions = [];

        if (journey) {
            actions.push({
                label: 'Cancel Journey',
                action: 'cancel_journey'
            });
        } else {
            for (const lead of leads) {
         const place = state.places[lead.targetId];
         const route = shortestRoute(state, place.id);
         if (!route || route.totalSegments === 0) continue;

         actions.push({
            label:
                 `Go: ${place.label} ` +
                 `(${route.totalSegments} segments)`,
            action: 'start_journey',
            leadId: lead.id
         });

            }
        }

                if (!journey) {
            const settlements = Object.values(
                state.world?.settlements || {}
            );

            for (const settlement of settlements) {
                if (settlement.locationId === state.currentLocationId) {
                    continue;
                }

                const route = shortestRoute(
                    state,
                    settlement.locationId
                );

                if (!route || route.totalSegments === 0) {
                    continue;
                }

                actions.push({
                    label:
                        `Travel to ${settlement.label} ` +
                        `(Zone ${settlement.zone}; ` +
                        `${route.totalSegments} segments)`,
                    action: 'start_settlement_journey',
                    destinationId: settlement.locationId
                });
            }
        }

        for (const lead of leads) {
            if (
                lead.kind === 'rumor' &&
                lead.status === 'known' &&
                state.currentLocationId === lead.targetId
            ) {
                actions.push({
                    label:
                        `Investigate: ` +
                        `${state.places[lead.targetId].label} rumor`,
                    action: 'investigate_lead',
                    leadId: lead.id
                });
            }
        }

        const buttons = actions.map((entry, index) => ({
            text: entry.label,
            result: POPUP_RESULT[`CUSTOM${index + 1}`]
        })).filter(button => button.result !== undefined);

        const journeyText = journey
            ? `\n\nCurrent journey: ${journey.destinationLabel} ` +
              `(${journey.completedSegments}/${journey.totalSegments}; ` +
              `${journey.status}).`
            : '';

        const currentLocationId =
            state.currentLocationId ||
            routeNodeId(state.zone, 'outpost');

        const locationText = state.places?.[currentLocationId]
            ? `\nCurrent location: ${state.places[currentLocationId].label}.`
            : `\nCurrent location: ${currentLocationId}.`;

        const betweenText = state.currentPosition?.fromId &&
            state.currentPosition?.toId
            ? `\nBetween ${
                state.places?.[state.currentPosition.fromId]?.label ||
                state.currentPosition.fromId
              } and ${
                state.places?.[state.currentPosition.toId]?.label ||
                state.currentPosition.toId
              }; ${state.currentPosition.offset}/` +
              `${state.currentPosition.length} segments along that edge.`
            : '';

        const popup = new Popup(
            formatWorldStatus(state) + locationText + betweenText + journeyText,

            POPUP_TYPE.TEXT,
            '',
            {
                customButtons: buttons,
                okButton: 'Close'
            }
        );

        const choice = await popup.show();
        const selectedIndex = actions.findIndex(
            (_entry, index) =>
                choice === POPUP_RESULT[`CUSTOM${index + 1}`]
        );

        if (selectedIndex < 0) return;

        const selected = actions[selectedIndex];
                if (selected.action === 'cleanup_test_data') {
            await runStoredMechanic({
                cases: [{
                    name: 'cleanup_test_data',
                    kind: 'cleanup_test_data'
                }]
            });

            toastr.info(
                'Temporary test leads and places removed.',
                'Aethermoor'
            );
            return;
        }

        if (selected.action === 'cancel_journey') {
            await runStoredMechanic({
                cases: [{
                    name: 'cancel_journey',
                    kind: 'journey',
                    action: 'cancel'
                }]
            });
            return;
        }

        if (
            selected.action === 'start_journey' ||
            selected.action === 'start_settlement_journey'
        ) {
            const journeyCase = {
                name: 'start_journey',
                kind: 'journey',
                action: 'start'
            };

            if (selected.action === 'start_journey') {
                journeyCase.leadId = selected.leadId;
            } else {
                journeyCase.destinationId = selected.destinationId;
            }

            const output = await runStoredMechanic({
                cases: [journeyCase]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not start journey'
            );


            toastr.info(
                `Journey started toward ${
                    selected.action === 'start_journey'
                        ? state.places[
                            state.leads[selected.leadId].targetId
                          ].label
                        : state.world.settlements[
                            Object.values(state.world.settlements)
                                .find(entry =>
                                    entry.locationId ===
                                    selected.destinationId
                                ).id
                          ].label
                }. Each [moved] advances one segment.`,
                'Aethermoor'
            );
            return;
        }

        if (selected.action === 'investigate_lead') {
            const output = await runStoredMechanic({
                cases: [{
                    name: 'investigate_rumor_lead',
                    kind: 'investigate_lead',
                    leadId: selected.leadId
                }]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not investigate rumor'
            );

            toastr.info(
                'Rumor investigated. Generate the next scene to narrate what they learn.',
                'Aethermoor'
            );
        }
    } catch (error) {
        toastr.error(
            error instanceof Error ? error.message : String(error),
            'Aethermoor'
        );
    }
}

function formatQuestStatus(quest) {
    if (!quest) {
        return 'No active quest offer.';
    }

    const lines = [
        `Quest: ${quest.title}`,
        `Status: ${quest.status}`,
        `Rank: ${quest.rank}`,
        `Gates: ${quest.gates}`,
        `Payout: ${quest.payout.xp} XP, ` +
            `${quest.payout.silver} silver, ` +
            `${quest.payout.repSteps} reputation step(s)`,
        `Salvage: ${quest.salvage.name} ` +
            `(${quest.salvage.rarity})`,
        ''
    ];

    if (quest.status === 'offered') {
        lines.push(
            'This quest has been offered but not accepted.',
            'Accepting it does not invent its objective; the objective must be established later.'
        );
    } else if (quest.status === 'in_progress') {
        lines.push(
            `Current gate: ${quest.currentGate?.step || 1}/` +
            `${quest.currentGate?.total || quest.gates}`,
            `Mode: ${quest.currentGate?.mode || 'not established'}`,
            `Objective: ${quest.currentGate?.objective || 'not established'}`,
            `Terminal threat: ${
                quest.terminalThreat?.revealed
                    ? quest.terminalThreat.resolved
                        ? 'resolved'
                        : 'revealed'
                    : 'not revealed'
            }`

        );
            } else if (quest.status === 'abandoned') {
        lines.push(
            `Abandoned at gate ${quest.abandonedAtGate || 'unknown'}.`,
            'No quest rewards or reputation were granted.'
        );

    } else if (quest.status === 'declined') {
        lines.push('This quest was declined.');
    } else if (quest.status === 'complete') {
        lines.push('This quest has been completed.');
    } else if (quest.status === 'retired_test') {
        lines.push(
            `This test quest was retired: ${
                quest.retiredReason || 'no reason recorded'
            }.`,
            'No rewards were granted.'
        );
    }

        if (quest.deliveryReady && quest.turnIn) {
        lines.push(
            `Delivery is eligible to ${quest.turnIn.recipient}.`,
            'When the protagonists actually hand over the cargo in the fiction, place this exact tag inside the disposable <plan> block:',
            `<AETHERMOOR:DELIVERED quest_id=${quest.id}>`,
            'Do not emit the delivery tag before the fictional handoff.'
        );
    }

    return lines.join('\n');
}


async function openQuestPanel() {
    try {
        const snapshot = await readStoredCombatState();
        const state = snapshot.state;
        const quest = state.activeQuest;
            markCampaignViewRendered(snapshot);
        const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();

        const questIsTerminal =
            !quest ||
            ['abandoned', 'declined', 'complete', 'retired_test']
                .includes(quest.status);

        if (questIsTerminal) {
            const previousQuestText = quest
                ? `Previous quest: ${formatQuestStatus(quest)}\n\n`
                : '';

            const popup = new Popup(
                `${previousQuestText}No offered or in-progress quest.`,
                POPUP_TYPE.TEXT,
                '',
                {
                    customButtons: [{
                        text: 'Debug: Create Quest Offer',
                        result: POPUP_RESULT.CUSTOM1
                    }],
                    okButton: 'Close'
                }
            );
                    if (
            quest?.status === 'offered' &&
            quest.seed?.testOnly === true
        ) {
            section.appendChild(
                makeAethermoorAction(
                    'Debug: Retire Test Quest',
                    'quest',
                    () => runAethermoorPanelCase(
                        host,
                        'quests',
                        {
                            name: 'debug_retire_test_quest',
                            kind: 'debug_retire_test_quest'
                        },
                        'Test quest retired without rewards.'
                    )
                )
            );
        }

            const choice = await popup.show();
            if (choice !== POPUP_RESULT.CUSTOM1) return;

            const output = await runStoredMechanic({
                cases: [{
                    name: 'debug_create_authored_quest_offer',
                    kind: 'debug_create_quest_offer'
                }]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not create debug quest offer'
            );

            toastr.info(
                'Debug quest offer created. Generate a reply to narrate it.',
                'Aethermoor Debug'
            );
            return;
        }

        const buttons = [];

        const canTurnIn =
            quest.status === 'in_progress' &&
            Boolean(quest.objectiveResolution) &&
            quest.turnIn?.locationId === state.currentLocationId;
        
        if (canTurnIn) {
            host.appendChild(
                makeAethermoorSection(
                    'TURN-IN ELIGIBLE',
                    `The field objective is secured. The crew is at the turn-in settlement for ${quest.turnIn.recipient}. The quest remains active until the protagonists choose to meet the sponsor and the handover occurs in the fiction.`,
                    'quest'
                )
            );
        }

        const canRevealTerminal =
            quest.status === 'in_progress' &&
            quest.structureV2?.version !== 2 &&
            quest.currentGate?.mode === 'combat_twist_showdown' &&
            quest.terminalThreat?.resolved !== true &&
            quest.destinationId === state.currentLocationId &&
            !['active', 'spotted'].includes(
                state.encounter?.status
            );

        if (canRevealTerminal) {
            buttons.push({
                text: 'Reveal Quest Threat',
                result: POPUP_RESULT.CUSTOM1
            });
        }

        if (quest.status === 'offered') {
            buttons.push(
                {
                    text: 'Accept Quest',
                    result: POPUP_RESULT.CUSTOM1
                },
                {
                    text: 'Decline Quest',
                    result: POPUP_RESULT.CUSTOM2
                }
            );
        }

        if (quest.status === 'in_progress') {
            buttons.push({
                text: 'Abandon Quest',
                result: POPUP_RESULT.CUSTOM3
            });
        }

        const popup = new Popup(
            formatQuestStatus(quest),
            POPUP_TYPE.TEXT,
            '',
            {
                customButtons: buttons,
                okButton: 'Close'
            }
        );

        const choice = await popup.show();

        if (canRevealTerminal && choice === POPUP_RESULT.CUSTOM1) {
            const output = await runStoredMechanic({
                cases: [{
                    name: 'reveal_quest_terminal',
                    kind: 'quest_reveal_terminal'
                }]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not reveal quest threat'
            );

            toastr.info(
                'Quest threat revealed. Open Combat to resolve it.',
                'Aethermoor'
            );
            return;
        }

                if (canTurnIn && choice === POPUP_RESULT.CUSTOM2) {
            const output = await runStoredMechanic({
                cases: [{
                    name: 'turn_in_recovered_cargo',
                    kind: 'quest',
                    action: 'complete',
                    objectiveCompleted: true,
                    completionEvidence:
                        `Returned the recovered cargo to ${quest.turnIn.recipient}.`
                }]
            });

            assert(output?.ok === true, 'Quest turn-in failed');

            const updated = await readStoredCombatState();
            const rewards = output.results?.[0]?.result?.rewards;

            await Popup.show.text(
                'Quest Complete',
                formatQuestStatus(updated.state.activeQuest) +
                `\n\nPaid: ${rewards.xp} XP, ${rewards.silver} silver, ` +
                `${rewards.repSteps} reputation steps.\n` +
                rewards.loot.map(item =>
                    `Salvage: ${item.name} (${item.rarity})`
                ).join('\n')
            );
            return;
        }

        let action = null;

        if (
            quest.status === 'offered' &&
            choice === POPUP_RESULT.CUSTOM1
        ) {
            action = 'accept';
        } else if (
            quest.status === 'offered' &&
            choice === POPUP_RESULT.CUSTOM2
        ) {
            action = 'decline';
        } else if (
            quest.status === 'in_progress' &&
            choice === POPUP_RESULT.CUSTOM3
        ) {
            action = 'abandon';
        }

        if (!action) return;

        await runStoredMechanic({
            cases: [{
                name: `quest_${action}`,
                kind: 'quest',
                action
            }]
        });

        toastr.info(
            action === 'accept'
                ? 'Quest accepted. Generate the next scene to narrate the acceptance.'
                : action === 'abandon'
                    ? 'Quest abandoned. No rewards or reputation were granted.'
                    : 'Quest declined.',
            'Aethermoor'
        );
    } catch (error) {
        toastr.error(
            error instanceof Error ? error.message : String(error),
            'Aethermoor'
        );
    }
}

function createQuestController() {
    if (document.getElementById('aethermoor_quest_button')) return;

    const composer = document.querySelector('#send_form');

    if (!composer) {
        console.warn(
            'Aethermoor: chat composer not found; Quest button not added'
        );
        return;
    }

    const button = document.createElement('button');
    button.id = 'aethermoor_quest_button';
    button.type = 'button';
    button.className = 'menu_button';
    button.textContent = 'Quests';
    button.title = 'View the active Aethermoor quest';
    button.addEventListener('click', openQuestPanel);

    composer.insertBefore(button, composer.firstChild);
}

function createWorldController() {
    if (document.getElementById('aethermoor_world_button')) return;

    const composer = document.querySelector('#send_form');
    if (!composer) {
        console.warn(
            'Aethermoor: chat composer not found; World button not added'
        );
        return;
    }

    const button = document.createElement('button');
    button.id = 'aethermoor_world_button';
    button.type = 'button';
    button.className = 'menu_button';
    button.textContent = 'World';
    button.title = 'View known places and leads';
    button.addEventListener('click', openWorldPanel);

    composer.insertBefore(button, composer.firstChild);
}

/*
 * AETHERMOOR UI DESIGN TEMPLATE
 *
 * The future unified panel should preserve this visual language:
 *
 * <section class="aethermoor-panel">
 *   <header class="aethermoor-panel-header">
 *     <b>AETHERMOOR</b>
 *     <button title="Close">×</button>
 *   </header>
 *
 *   <nav class="aethermoor-tabs">
 *     <button class="active">Combat</button>
 *     <button>Quests</button>
 *     <button>World</button>
 *   </nav>
 *
 *   <main class="aethermoor-panel-content">
 *     <section class="aethermoor-section">
 *       <header class="aethermoor-section-header">
 *         <b>System Log // Combat Telemetry</b>
 *       </header>
 *       <div class="aethermoor-section-body"></div>
 *     </section>
 *   </main>
 * </section>
 *
 * Palette:
 * - Panel background: #12161c
 * - Panel border: #2b3542
 * - Inner divider: #1f2730
 * - Primary text: #d0d7de
 * - Muted text: #9caab8
 * - Combat: #ef4444
 * - Quest: #d99b26
 * - Discovery / World: #4da6ff
 * - Success: #4ade80
 * - Rare / diagnostics: #c084fc
 * - Attention / telegraph: #ffd166
 *
 * Keep page surfaces unframed. Use framed sections only for the actual
 * tool surface, repeated logs, and modal-like interaction areas.
 */

let aethermoorPanelElement = null;
let aethermoorPanelOpen = false;
let aethermoorActiveTab = 'combat';

function addAethermoorPanelStyles() {
    if (document.getElementById('aethermoor_panel_styles')) return;

    const style = document.createElement('style');
    style.id = 'aethermoor_panel_styles';

    style.textContent = `
        .aethermoor-panel {
            position: fixed;
            left: auto;
            top: auto;
            right: 16px;
            bottom: 82px;
            z-index: 10001;
            width: 520px;
            height: 560px;
            min-width: 320px;
            min-height: 240px;
            max-width: calc(100vw - 24px);
            max-height: calc(100vh - 24px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            resize: both;
            color: #d0d7de;
            background: #12161c;
            border: 1px solid #2b3542;
            border-radius: 3px;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
        }

        .aethermoor-panel[hidden] {
            display: none;
        }

        .aethermoor-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 9px 12px;
            border-bottom: 1px solid #1f2730;
            background: #101419;
            cursor: move;
            user-select: none;
            touch-action: none;
        }

        .aethermoor-panel-title {
            color: #4da6ff;
            font-family: Consolas, monospace;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 1px;
        }

        .aethermoor-panel-close {
            min-width: 28px;
            padding: 3px 8px;
            color: #9caab8;
            background: transparent;
            border: 1px solid #2b3542;
            cursor: pointer;
        }

        .aethermoor-tabs {
            display: flex;
            gap: 4px;
            padding: 7px 8px 0;
            background: #101419;
            border-bottom: 1px solid #1f2730;
        }

        .aethermoor-tab {
            flex: 1 1 0;
            min-width: 0;
            padding: 7px 8px;
            color: #9caab8;
            background: #181d23;
            border: 1px solid #2b3542;
            border-bottom: 0;
            cursor: pointer;
            font-size: 11px;
            font-weight: 700;
        }

        .aethermoor-tab[data-tab="combat"].active {
            color: #ffffff;
            border-top: 2px solid #ef4444;
        }

        .aethermoor-tab[data-tab="quests"].active {
            color: #ffffff;
            border-top: 2px solid #d99b26;
        }

        .aethermoor-tab[data-tab="world"].active {
            color: #ffffff;
            border-top: 2px solid #4da6ff;
        }

        .aethermoor-panel-content {
            min-height: 150px;
            overflow: auto;
            padding: 12px;
        }

        .aethermoor-tab-content {
            display: grid;
            gap: 10px;
        }

        .aethermoor-panel-card {
            padding: 12px;
            color: #d0d7de;
            background: #12161c;
            border: 1px solid #2b3542;
            border-left: 3px solid #4da6ff;
        }

        .aethermoor-panel-card[data-accent="combat"] {
            border-left-color: #ef4444;
        }

        .aethermoor-panel-card[data-accent="quest"] {
            border-left-color: #d99b26;
        }

        .aethermoor-panel-card[data-accent="world"] {
            border-left-color: #4da6ff;
        }

        .aethermoor-panel-card-title {
            margin-bottom: 6px;
            color: #ffffff;
            font-family: Consolas, monospace;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.6px;
        }

        .aethermoor-panel-card-text {
            color: #9caab8;
            font-size: 12px;
            line-height: 1.45;
        }

        .aethermoor-panel-action {
            width: 100%;
            padding: 8px 10px;
            color: #d0d7de;
            background: #181d23;
            border: 1px solid #2b3542;
            cursor: pointer;
            text-align: left;
        }

        .aethermoor-panel-action:hover,
        .aethermoor-panel-action:focus-visible {
            border-color: #4da6ff;
            color: #ffffff;
        }

        #aethermoor_main_button {
            border-left: 2px solid #4da6ff;
        }
                .aethermoor-tab-view {
            display: grid;
            align-content: start;
            gap: 10px;
        }

        .aethermoor-tab-view[hidden] {
            display: none;
        }

        .aethermoor-ui-section {
            display: grid;
            gap: 7px;
            padding: 10px;
            background: #12161c;
            border: 1px solid #2b3542;
            border-left: 3px solid #4da6ff;
        }

        .aethermoor-ui-section[data-accent="combat"] {
            border-left-color: #ef4444;
        }

        .aethermoor-ui-section[data-accent="quest"] {
            border-left-color: #d99b26;
        }

        .aethermoor-ui-section[data-accent="world"] {
            border-left-color: #4da6ff;
        }

        .aethermoor-ui-heading {
            color: #ffffff;
            font-family: Consolas, monospace;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.6px;
        }

        .aethermoor-ui-text {
            color: #9caab8;
            font-size: 12px;
            line-height: 1.45;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .aethermoor-knowledge {
            padding: 10px;
            background: #12161c;
            border: 1px solid #2b3542;
            border-left: 3px solid #4da6ff;
        }

        .aethermoor-knowledge > summary,
        .aethermoor-knowledge-group > summary {
            cursor: pointer;
            padding: 4px 0;
        }

        .aethermoor-knowledge-group {
            margin-top: 8px;
            padding-left: 8px;
            border-left: 1px solid #2b3542;
        }

        .aethermoor-knowledge-group > summary {
            color: #d0d7de;
            font-size: 12px;
            font-weight: 700;
        }

        .aethermoor-knowledge-group > .aethermoor-ui-section,
        .aethermoor-knowledge-group > .aethermoor-ui-text {
            margin-top: 8px;
        }

        .aethermoor-knowledge summary:focus-visible {
            outline: 2px solid #4da6ff;
            outline-offset: 3px;
        }

        .aethermoor-ui-actions {
            display: grid;
            gap: 6px;
        }

        .aethermoor-ui-action {
            width: 100%;
            padding: 8px 10px;
            color: #d0d7de;
            background: #181d23;
            border: 1px solid #2b3542;
            cursor: pointer;
            text-align: left;
        }

        .aethermoor-ui-action:hover,
        .aethermoor-ui-action:focus-visible {
            color: #ffffff;
            border-color: #4da6ff;
        }

        .aethermoor-ui-action[data-accent="quest"]:hover,
        .aethermoor-ui-action[data-accent="quest"]:focus-visible {
            border-color: #d99b26;
        }

        @media (max-width: 600px) {
            .aethermoor-panel {
                right: 8px;
                bottom: 72px;
                width: calc(100vw - 16px);
                height: min(70vh, 560px);
                min-width: 0;
                resize: both;
            }

            .aethermoor-tab {
                padding-inline: 4px;
            }
        }
    `;

     style.textContent += `
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-group {
            width: 100%;
            max-width: 100%;
            min-width: 0 !important;
            box-sizing: border-box;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choices {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            align-items: stretch;
            gap: 6px;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            box-sizing: border-box;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choices > button.aethermoor-combat-choice {
            display: flex !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            box-sizing: border-box;
            align-items: center;
            justify-content: center;
            text-align: center;
            white-space: normal;
            overflow-wrap: anywhere;
        }


        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choices > button.aethermoor-combat-choice {
            display: inline-flex !important;
            visibility: visible !important;
            flex: 0 0 auto !important;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: auto !important;
            min-width: 82px;
            max-width: 100%;
            height: auto !important;
            min-height: 42px;
            padding: 7px 10px;
            opacity: 1;
            white-space: normal;
            text-align: center;
            line-height: 1.25;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-title,
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-detail,
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-telegraph {
            display: block;
            width: 100%;
            text-align: center;
            white-space: normal;
            overflow-wrap: anywhere;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice[aria-pressed="true"] {
            outline: 2px solid #4ade80;
            outline-offset: 1px;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice:disabled {
            opacity: 0.35 !important;
            cursor: not-allowed;
        }
    `;

    document.head.appendChild(style);
}

function makeAethermoorTabCard(accent, title, text, actionLabel, action) {
    const card = document.createElement('section');
    card.className = 'aethermoor-panel-card';
    card.dataset.accent = accent;

    const heading = document.createElement('div');
    heading.className = 'aethermoor-panel-card-title';
    heading.textContent = title;

    const description = document.createElement('div');
    description.className = 'aethermoor-panel-card-text';
    description.textContent = text;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aethermoor-panel-action';
    button.textContent = actionLabel;
    button.addEventListener('click', action);

    card.append(heading, description, button);
    return card;
}

let aethermoorTabViews = null;

function ensureAethermoorTabViews() {
    if (aethermoorTabViews) return aethermoorTabViews;

    const content =
        aethermoorPanelElement.querySelector('.aethermoor-panel-content');

    content.replaceChildren();

    aethermoorTabViews = {};

    for (const tab of ['combat', 'quests', 'world']) {
        const view = document.createElement('section');
        view.className = 'aethermoor-tab-view';
        view.dataset.tab = tab;
        view.hidden = true;
        content.appendChild(view);
        aethermoorTabViews[tab] = view;
    }

    return aethermoorTabViews;
}

function makeAethermoorSection(title, text, accent = 'world') {
    const section = document.createElement('section');
    section.className = 'aethermoor-ui-section';
    section.dataset.accent = accent;

    const heading = document.createElement('div');
    heading.className = 'aethermoor-ui-heading';
    heading.textContent = title;

    const body = document.createElement('div');
    body.className = 'aethermoor-ui-text';
    body.textContent = text;

    section.append(heading, body);
    return section;
}

function makeAethermoorAction(label, accent, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aethermoor-ui-action';
    button.dataset.accent = accent;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
}

async function runAethermoorPanelCase(host, tab, caseData, successText) {
    try {
        const output = await runStoredMechanic({
            cases: [caseData]
        });

        assert(
            output?.ok === true &&
            output.results?.[0]?.ok !== false,
            output?.results?.[0]?.error ||
                'Aethermoor operation failed'
        );

        if (successText) {
            toastr.info(successText, 'Aethermoor');
        }

        if (tab === 'quests') {
            await renderQuestTab(host);
        } else {
            await renderWorldTab(host);
        }

        return output;
    } catch (error) {
        toastr.error(
            error instanceof Error ? error.message : String(error),
            'Aethermoor'
        );
        return null;
    }
}
async function renderQuestTab(host) {
    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        host.replaceChildren(
            makeAethermoorSection(
                'QUESTS',
                error instanceof Error ? error.message : String(error),
                'quest'
            )
        );
        return;
    }

    const state = snapshot.state;

    /*
     * This snapshot is a detached export. Normalize legacy journal data
     * for display without saving or advancing mechanics during UI refresh.
     * Actions always address a stable quest ID, never a card's position.
     */
    const journal = ensureQuestJournal(state);
    const accepted = journal.accepted.filter(
        quest => quest.status === 'in_progress'
    );
    const offered = journal.offered.filter(
        quest => quest.status === 'offered'
    );

    host.replaceChildren();
    markCampaignViewRendered(snapshot);

    host.appendChild(
        makeAethermoorSection(
            'QUEST JOURNAL',
            `${accepted.length} in progress · ${offered.length} offered\n` +
                'Offers remain available while another quest is in progress. ' +
                'Currently, only one quest can be accepted at a time.',
            'quest'
        )
    );

    function addQuestAction(section, quest, label, action) {
        const button = makeAethermoorAction(
            label,
            'quest',
            async () => {
                button.disabled = true;

                try {
                    await runAethermoorPanelCase(
                        host,
                        'quests',
                        {
                            name: `journal_quest_${action}`,
                            kind: 'quest',
                            action,
                            questId: quest.id
                        },
                        action === 'accept'
                            ? 'Quest accepted.'
                            : action === 'decline'
                                ? 'Quest declined.'
                                : 'Quest abandoned. No rewards were granted.'
                    );
                } finally {
                    button.disabled = false;
                }
            }
        );

        if (action === 'accept' && accepted.length > 0) {
            button.disabled = true;
            button.title =
                'Finish or abandon the in-progress quest before accepting another. ' +
                'This offer remains saved.';
        }

        section.appendChild(button);
    }

    for (const quest of accepted) {
        const section = makeAethermoorSection(
            'IN PROGRESS',
            formatQuestStatus(quest),
            'quest'
        );

        const canRevealTerminal =
            quest.structureV2?.version !== 2 &&
            quest.currentGate?.mode === 'combat_twist_showdown' &&
            quest.terminalThreat?.resolved !== true &&
            quest.destinationId === state.currentLocationId &&
            state.activeQuest?.id === quest.id &&
            !['active', 'spotted'].includes(state.encounter?.status);

        if (canRevealTerminal) {
            section.appendChild(
                makeAethermoorAction(
                    'Reveal Quest Threat',
                    'combat',
                    () => runAethermoorPanelCase(
                        host,
                        'quests',
                        {
                            name: 'reveal_quest_terminal',
                            kind: 'quest_reveal_terminal'
                        },
                        'Quest threat revealed. Open Combat to resolve it.'
                    )
                )
            );
        }

        /*
         * Arrival makes delivery eligible. The fictional handover and
         * validated delivery tag still authorize payment; viewing the
         * journal must not substitute for that handshake.
         */
        if (
            quest.objectiveResolution &&
            quest.deliveryReady === true &&
            quest.turnIn?.locationId === state.currentLocationId
        ) {
            section.appendChild(
                makeAethermoorSection(
                    'TURN-IN ELIGIBLE',
                    `The crew can meet ${quest.turnIn.recipient} to ` +
                        'hand over the cargo or report the completed objective. ' +
                        'Rewards follow the handover in the fiction.',
                    'quest'
                )
            );
        }

        addQuestAction(section, quest, 'Abandon Quest', 'abandon');
        host.appendChild(section);
    }

    for (const quest of offered) {
        const section = makeAethermoorSection(
            'QUEST OFFER',
            formatQuestStatus(quest) + '\n\n' + (quest.pitch || ''),
            'quest'
        );

        addQuestAction(section, quest, 'Accept Quest', 'accept');
        addQuestAction(section, quest, 'Decline Quest', 'decline');
        host.appendChild(section);
    }

    if (accepted.length === 0 && offered.length === 0) {
        host.appendChild(
            makeAethermoorSection(
                'NO CURRENT QUESTS',
                'No offered or in-progress quests. Explore or follow rumors ' +
                    'to discover new opportunities.',
                'quest'
            )
        );
    }

    const historyCounts = [
        ['Completed', journal.completed.length],
        ['Declined', journal.declined.length],
        ['Abandoned', journal.abandoned.length]
    ];

    host.appendChild(
        makeAethermoorSection(
            'QUEST HISTORY',
            historyCounts.map(([label, count]) => `${label}: ${count}`)
                .join(' · '),
            'quest'
        )
    );
}

async function copyAethermoorCommand(command) {
    assert(
        typeof command === 'string' && command.length > 0,
        'Clipboard command is empty'
    );

    try {
        await navigator.clipboard.writeText(command);
    } catch (_error) {
        const input = document.createElement('textarea');
        input.value = command;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand('copy');
        input.remove();
    }

    toastr.info(
        'Movement command copied. Add your fiction, paste the command, and send the message.',
        'Aethermoor'
    );
}
function renderCrewKnowledge(state) {
    /*
     * Display only acquired crew knowledge. Never read quest coreTruth,
     * hidden quest discoveries, or private social seeds for this view.
     * Rendering must not create, normalize, or save knowledge records.
     */
    const entries = Object.values(state.discoveries || {})
        .filter(entry =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.summary === 'string'
        );

    /*
     * Knowledge can grow throughout the campaign. Native details elements
     * keep the World view compact without changing saved knowledge or
     * introducing mechanics operations when a group is opened.
     */
    const section = document.createElement('details');
    section.className = 'aethermoor-knowledge';

    const heading = document.createElement('summary');
    heading.className = 'aethermoor-ui-heading';
    heading.textContent = `CREW KNOWLEDGE · ${entries.length}`;
    section.appendChild(heading);

    const groups = {};

    for (const [key, label] of [
        ['unverified', 'Unverified'],
        ['established', 'Established']
    ]) {
        const count = entries.filter(entry =>
            (entry.certainty === 'engine_established'
                ? 'established'
                : 'unverified') === key
        ).length;

        const group = document.createElement('details');
        group.className = 'aethermoor-knowledge-group';

        const summary = document.createElement('summary');
        summary.textContent = `${label} · ${count}`;
        group.appendChild(summary);

        if (count === 0) {
            const empty = document.createElement('div');
            empty.className = 'aethermoor-ui-text';
            empty.textContent = 'No records yet.';
            group.appendChild(empty);
        }

        groups[key] = group;
        section.appendChild(group);
    }


    function locationLabel(locationId) {
        if (!locationId) return 'Location not recorded';

        const place = state.places?.[locationId];
        if (place?.label) return place.label;

        const settlement = Object.values(
            state.world?.settlements || {}
        ).find(entry => entry.locationId === locationId);

        return settlement?.label || locationId;
    }

    const rumorSummaries = {
        travelogue_flub_benign_oddity:
            'This rumor concluded as a mistaken claim or benign oddity.',
        already_cleared_by_other_immortals:
            'Others had already cleared the subject of this rumor.',
        genuine_unclaimed_quest_or_dungeon_hook:
            'Following this rumor revealed a genuine opportunity.'
    };

    for (const entry of entries) {
        const sourceId = entry.source?.id;
        const sourceLead = state.leads?.[sourceId];

        const testRecord =
            sourceLead?.testOnly === true ||
            entry.source?.type === 'debug_rumor_fixture' ||
            state.places?.[
                entry.learnedAtLocationId
            ]?.testOnly === true;

        const typeLabel = {
            testimony: 'Testimony',
            observation: 'Observation',
            confirmed_fact: 'Confirmed fact'
        }[entry.knowledgeType] || 'Recorded knowledge';

        const certaintyLabel = {
            unverified_claim: 'Unverified claim',
            engine_established: 'Established result'
        }[entry.certainty] || 'Certainty not classified';

        const finding =
            sourceLead?.arrivalResolution?.finding ||
            sourceLead?.finding;

        const summary =
            entry.kind === 'rumor_resolution' &&
            rumorSummaries[finding]
                ? rumorSummaries[finding]
                : entry.summary;

        const sourceLabel =
            entry.source?.type === 'debug_rumor_fixture'
                ? 'Debug rumor fixture'
                : entry.source?.type === 'traveler'
                    ? 'Traveler'
                    : sourceLead?.label ||
                      sourceLead?.claim ||
                      sourceId ||
                      'Source not recorded';

        const lines = [
            summary,
            '',
            certaintyLabel,
            `Source: ${sourceLabel}`,
            `Learned at: ${locationLabel(
                entry.learnedAtLocationId
            )}` +
                (
                    Number.isInteger(entry.learnedAtZone)
                        ? ` · Zone ${entry.learnedAtZone}`
                        : ''
                )
        ];

        if (entry.knowledgeType === 'testimony') {
            lines.push(
                'This records what was said; the claim itself is not confirmed.'
            );
        }

        const card = makeAethermoorSection(
            `${testRecord ? 'TEST · ' : ''}${typeLabel}`,
            lines.join('\n'),
            'world'
        );

        // Stable references remain inspectable without filling the card
        // with implementation identifiers.
        card.title =
            `Knowledge: ${entry.id}\nSource: ${sourceId || 'unknown'}`;

        const groupKey = entry.certainty === 'engine_established'
            ? 'established'
            : 'unverified';

        groups[groupKey].appendChild(card);
    }

    return section;
}

async function renderWorldTab(host) {
    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        host.replaceChildren();
        host.appendChild(
            makeAethermoorSection(
                'WORLD',
                error instanceof Error ? error.message : String(error),
                'world'
            )
        );
        return;
    }

    host.replaceChildren();

    const state = snapshot.state;
    markCampaignViewRendered(snapshot);

    const world = state.world || {};
    const currentLocationId =
        state.currentLocationId ||
        routeNodeId(state.zone, 'outpost');

    const movementBlocked = [
        'active',
        'spotted'
    ].includes(state.encounter?.status);

    function distanceLabel(destinationId) {
        const route = shortestRoute(state, destinationId);

        if (!route || route.totalSegments <= 0) {
            return null;
        }

        if (route.totalSegments <= 1) return 'Nearby';
        if (route.totalSegments <= 2) return 'Near';
        if (route.totalSegments <= 4) return 'Moderate';
        if (route.totalSegments <= 6) return 'Far';

        return 'Distant';
    }

    function addTravelAction(container, label, destinationId) {
        if (
            movementBlocked ||
            destinationId === currentLocationId
        ) {
            return;
        }

        const distance = distanceLabel(destinationId);

        if (!distance) return;

        const button = makeAethermoorAction(
            `${label} · ${distance}`,
            'world',
            () => copyAethermoorCommand(
                destinationCommand(destinationId)
            )
        );

        container.appendChild(button);
    }

    if (movementBlocked) {
        host.appendChild(
            makeAethermoorSection(
                'TRAVEL PAUSED',
                'Resolve or avoid the spotted encounter before starting or changing a journey.',
                'world'
            )
        );
    }

    const journey = state.currentJourney;

    if (journey) {
        /*
         * A final-segment encounter consumes the last route segment but
         * defers arrival. shortestRoute() then reports zero distance,
         * so ordinary destination entries cannot provide the resume action.
         *
         * Keep an explicit journey control independent of route distance.
         * Clicking only copies a command. Submitting it lets the existing
         * travel resolver finalize arrival without another segment or roll.
         */
        const arrivalPending =
            journey.completedSegments === journey.totalSegments;

        const section = makeAethermoorSection(
            'CURRENT JOURNEY',
            `Destination: ${journey.destinationLabel}\n` +
                (
                    arrivalPending
                        ? 'Route completed; arrival awaiting confirmation.'
                        : 'Journey underway.'
                ) +
                (
                    movementBlocked
                        ? '\nResolve or avoid the encounter before continuing.'
                        : '\nChoose this destination to continue, or another destination to change direction.'
                ),
            'world'
        );

        const continueButton = makeAethermoorAction(
            arrivalPending
                ? `Finish journey to ${journey.destinationLabel}`
                : `Continue to ${journey.destinationLabel}`,
            'world',
            () => copyAethermoorCommand(
                destinationCommand(journey.destinationId)
            )
        );

        continueButton.disabled = movementBlocked;

        section.appendChild(continueButton);
        host.appendChild(section);
    }

    const quest = state.activeQuest;

    if (quest?.status === 'in_progress') {
        const questDestinationId =
            quest.objectiveResolution && quest.turnIn
                ? quest.turnIn.locationId
                : quest.destinationId;

        const questDestination =
            state.places?.[questDestinationId] ||
            Object.values(world.settlements || {})
                .find(item =>
                    item.locationId === questDestinationId
                );

        if (questDestination) {
            const section = makeAethermoorSection(
                quest.objectiveResolution
                    ? 'QUEST RETURN'
                    : 'ACTIVE QUEST DESTINATION',
                questDestination.label || questDestinationId,
                'quest'
            );

            if (questDestinationId === currentLocationId) {
                const atDestination = document.createElement('div');
                atDestination.className = 'aethermoor-ui-text';
                atDestination.textContent =
                    'The crew is at this location.';
                section.appendChild(atDestination);
            } else {
                addTravelAction(
                    section,
                    `Travel to ${questDestination.label || questDestinationId}`,
                    questDestinationId
                );
            }

            host.appendChild(section);
        }
    }

    const leads = Object.values(state.leads || {})
        .filter(lead =>
            lead &&
            lead.status === 'known' &&
            lead.targetType === 'place' &&
            (!lead.testOnly || lead.arrivalTest === true) &&
            !lead.id?.startsWith('debug-destination-') &&
            state.places?.[lead.targetId]
        );

    const rumors = leads.filter(lead => lead.kind === 'rumor');

    const rumorSection = makeAethermoorSection(
        'RUMORS',
        rumors.length
            ? 'Known rumors and their destinations.'
            : 'No known rumors.',
        'world'
    );

    for (const lead of rumors) {
        const place = state.places[lead.targetId];
        const entry = document.createElement('div');
        entry.className = 'aethermoor-ui-text';
        entry.textContent =
            `${place.label}\n${lead.claim || lead.label || lead.id}`;
        rumorSection.appendChild(entry);

        if (lead.targetId === currentLocationId) {
            const status = document.createElement('div');
            status.className = 'aethermoor-ui-text';
            status.textContent = lead.arrivalResolution
                ? 'A genuine lead is established here. Its quest offer is ' +
                  'waiting for the current quest or offer to be resolved.'
                : 'Arrival resolution is pending.';
            rumorSection.appendChild(status);
        } else {
            addTravelAction(
                rumorSection,
                `Travel to ${place.label}`,
                lead.targetId
            );
        }
    }

    host.appendChild(rumorSection);
        /*
     * Beta-only fixture control. This creates test data but does not resolve
     * the rumor; arrival still uses the ordinary saved rumor resolver.
     * Keep it beside Rumors so regression setup does not require raw tool calls.
     */
    host.appendChild(
        makeAethermoorAction(
            'Debug: Create Test Rumor',
            'world',
            () => runAethermoorPanelCase(
                host,
                'world',
                {
                    name: 'debug_create_rumor',
                    kind: 'debug_create_rumor',
                    inquiryId: `watchtower-test-${Date.now()}`,
                    reason: 'Test Rumor Site',
                    completionEvidence:
                        'A debug rumor points to a test destination.'
                },
                'Test rumor created.'
            )
        )
    );


    const settlements = Object.values(world.settlements || {})
        .filter(settlement => {
            if (!settlement?.locationId) return false;
            if (settlement.locationId === currentLocationId) return false;

            const hasKnownPlace =
                Boolean(state.places?.[settlement.locationId]);

            const hasKnownLead = leads.some(
                lead => lead.targetId === settlement.locationId
            );

            /*
             * A generated settlement is not automatically character-known.
             * It appears here only after the fiction or a known lead establishes it.
             */
            return hasKnownPlace || hasKnownLead;
        });

    const settlementSection = makeAethermoorSection(
        'KNOWN SETTLEMENTS',
        settlements.length
            ? 'Settlements the crew knows about.'
            : 'No other known settlements.',
        'world'
    );

    for (const settlement of settlements) {
        const place = state.places?.[settlement.locationId];
        const label = place?.label || settlement.label;

        addTravelAction(
            settlementSection,
            `Travel to ${label}`,
            settlement.locationId
        );
    }

    host.appendChild(settlementSection);
    host.appendChild(renderCrewKnowledge(state));

    if (!journey) {
        const exploreSection = makeAethermoorSection(
            'EXPLORE',
            'Travel without choosing a destination.',
            'world'
        );

        const exploreButton = makeAethermoorAction(
            'Explore the surrounding region',
            'world',
            () => copyAethermoorCommand(
                exploreRegionCommand()
            )
        );

        exploreButton.disabled = movementBlocked;
        exploreSection.appendChild(exploreButton);
        host.appendChild(exploreSection);
    }
}

function renderAethermoorTab(tab) {
    const views = ensureAethermoorTabViews();

    for (const [name, view] of Object.entries(views)) {
        view.hidden = name !== tab;
    }

    for (const button of aethermoorPanelElement
        .querySelectorAll('.aethermoor-tab')) {
        button.classList.toggle(
            'active',
            button.dataset.tab === tab
        );
    }

    if (tab === 'combat') {
        openCombatPanel(views.combat);
    } else if (tab === 'quests') {
        renderQuestTab(views.quests);
    } else if (tab === 'world') {
        renderWorldTab(views.world);
    }
}


const AETHERMOOR_PANEL_GEOMETRY_KEY =
    'aethermoorMainPanelGeometry';

function restoreAethermoorPanelGeometry(panel) {
    try {
        const saved = JSON.parse(
            localStorage.getItem(
                AETHERMOOR_PANEL_GEOMETRY_KEY
            ) || 'null'
        );

        if (
            !saved ||
            !Number.isFinite(saved.left) ||
            !Number.isFinite(saved.top) ||
            !Number.isFinite(saved.width) ||
            !Number.isFinite(saved.height)
        ) {
            return;
        }

        const width = Math.max(
            320,
            Math.min(saved.width, window.innerWidth - 24)
        );

        const height = Math.max(
            240,
            Math.min(saved.height, window.innerHeight - 24)
        );

        panel.style.left = `${Math.max(
            0,
            Math.min(saved.left, window.innerWidth - width)
        )}px`;

        panel.style.top = `${Math.max(
            0,
            Math.min(saved.top, window.innerHeight - height)
        )}px`;

        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
    } catch (error) {
        console.warn(
            'Aethermoor: Could not restore main panel geometry',
            error
        );
    }
}

function saveAethermoorPanelGeometry(panel) {
    const rect = panel.getBoundingClientRect();

    try {
        localStorage.setItem(
            AETHERMOOR_PANEL_GEOMETRY_KEY,
            JSON.stringify({
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            })
        );
    } catch (error) {
        console.warn(
            'Aethermoor: Could not save main panel geometry',
            error
        );
    }
}

function enableAethermoorPanelDragging(header, panel) {
    header.addEventListener('pointerdown', event => {
        if (
            event.button !== 0 ||
            event.target.closest('button')
        ) {
            return;
        }

        event.preventDefault();

        const rect = panel.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const pointerId = event.pointerId;

        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        header.setPointerCapture(pointerId);

        function movePanel(moveEvent) {
            if (moveEvent.pointerId !== pointerId) return;

            const maxLeft = Math.max(
                0,
                window.innerWidth - panel.offsetWidth
            );

            const maxTop = Math.max(
                0,
                window.innerHeight - panel.offsetHeight
            );

            panel.style.left = `${Math.max(
                0,
                Math.min(
                    maxLeft,
                    moveEvent.clientX - offsetX
                )
            )}px`;

            panel.style.top = `${Math.max(
                0,
                Math.min(
                    maxTop,
                    moveEvent.clientY - offsetY
                )
            )}px`;
        }

        function stopMoving(stopEvent) {
            if (stopEvent.pointerId !== pointerId) return;

            header.removeEventListener(
                'pointermove',
                movePanel
            );
            header.removeEventListener(
                'pointerup',
                stopMoving
            );
            header.removeEventListener(
                'pointercancel',
                stopMoving
            );
            header.removeEventListener(
                'lostpointercapture',
                stopMoving
            );

            if (header.hasPointerCapture(pointerId)) {
                header.releasePointerCapture(pointerId);
            }

            saveAethermoorPanelGeometry(panel);
        }

        header.addEventListener(
            'pointermove',
            movePanel
        );
        header.addEventListener(
            'pointerup',
            stopMoving
        );
        header.addEventListener(
            'pointercancel',
            stopMoving
        );
        header.addEventListener(
            'lostpointercapture',
            stopMoving
        );
    });
}

function openAethermoorPanel() {
    addAethermoorPanelStyles();

    if (aethermoorPanelElement && aethermoorPanelOpen) {
        aethermoorPanelElement.hidden = true;
        aethermoorPanelOpen = false;
        return;
    }

    if (!aethermoorPanelElement) {
        const panel = document.createElement('section');
        panel.className = 'aethermoor-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Aethermoor');

        const header = document.createElement('header');
        header.className = 'aethermoor-panel-header';

        const title = document.createElement('div');
        title.className = 'aethermoor-panel-title';
        title.textContent = 'AETHERMOOR';

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'aethermoor-panel-close';
        close.textContent = 'Close';
        close.addEventListener('click', () => {
            panel.hidden = true;
            aethermoorPanelOpen = false;
        });

        header.append(title, close);

        const tabs = document.createElement('nav');
        tabs.className = 'aethermoor-tabs';

        for (const [tab, label] of [
            ['combat', 'Combat'],
            ['quests', 'Quests'],
            ['world', 'World']
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'aethermoor-tab';
            button.dataset.tab = tab;
            button.textContent = label;
            button.addEventListener('click', () => {
                aethermoorActiveTab = tab;
                renderAethermoorTab(tab);
            });
            tabs.appendChild(button);
        }

        const content = document.createElement('main');
        content.className = 'aethermoor-panel-content';
        panel.append(header, tabs, content);
        document.body.appendChild(panel);

        restoreAethermoorPanelGeometry(panel);
        enableAethermoorPanelDragging(header, panel);

        panel.addEventListener('pointerup', () => {
            setTimeout(
                () => saveAethermoorPanelGeometry(panel),
                0
            );
        });

        aethermoorPanelElement = panel;

    }

    aethermoorPanelElement.hidden = false;
    aethermoorPanelOpen = true;
    renderAethermoorTab(aethermoorActiveTab);
}

function createAethermoorController() {
    if (document.getElementById('aethermoor_main_button')) return;
    const composer = document.querySelector('#send_form');
    if (!composer) {
        console.warn(
            'Aethermoor: chat composer not found; main button not added'
        );
        return;
    }

    const button = document.createElement('button');
    button.id = 'aethermoor_main_button';
    button.type = 'button';
    button.className = 'menu_button';
    button.textContent = 'Aethermoor';
    button.title = 'Open Aethermoor controls';
    button.addEventListener('click', openAethermoorPanel);
    composer.insertBefore(button, composer.firstChild);
}

   function createCombatController() {
    const button = document.createElement('button');
    button.id = 'aethermoor_combat_button';
    button.type = 'button';
    button.className = 'menu_button';
    button.textContent = 'Combat';
    button.title = 'View or resolve the saved Aethermoor encounter';
    button.addEventListener('click', openCombatPanel);

    const composer = document.querySelector('#send_form');

    if (composer) {
        composer.insertBefore(button, composer.firstChild);
    } else {
        console.warn(
            'Aethermoor: chat composer not found; Combat button not added'
        );
    }
}

async function readStoredCombatState() {
    const result = await runStoredMechanic({
        cases: [{
            kind: 'state',
            action: 'export',
            name: 'combat_ui_state'
        }]
    });

    assert(
        result?.ok === true && result.state,
        'Could not read saved Aethermoor state'
    );

    return result;
}

function combatStatusText(state) {
    const encounter = state.encounter;

    if (!encounter) return 'No encounter.';

    const lines = [
        `Turn ${encounter.turn} · ${encounter.status}`,
        `Weasels: ${state.crew.weasels.active}/${state.crew.weasels.max}`
    ];

    const journey = state.currentJourney;

    if (journey) {
        lines.push(
            `Journey paused toward ${journey.destinationLabel}: ` +
            `${journey.completedSegments}/${journey.totalSegments} segments.`
        );
    }

    return lines.join('   •   ');
}

let combatPanelElement = null;
let combatPanelOpen = false;

const combatSelections = {
    qtik: 'fire_melee',
    tansy: 'visor',
    target: null
};

/*
 * UI refresh must never resolve a turn. It only reads saved metadata.
 * Pause refresh while a user-triggered operation is running, and retain
 * the latest log when a state change rebuilds the Combat tab.
 */
let aethermoorCombatBusy = false;
let aethermoorCombatRefreshTimer = null;
let aethermoorCampaignRefreshTimer = null;
let aethermoorCampaignRefreshBusy = false;
let aethermoorCampaignViewKey = null;
let aethermoorCombatViewKey = null;
let aethermoorLastCombatLog = '';
let aethermoorLastCombatLogKey = null;

function combatLogKey(state) {
    return `${state.encounter?.id || 'none'}:${state.encounter?.turn || 0}`;
}

function markCombatViewRendered(snapshot) {
    aethermoorCombatViewKey = {
        metadata: getContext().chatMetadata,
        revision: snapshot.revision
    };
}

function markCampaignViewRendered(snapshot) {
    aethermoorCampaignViewKey = {
        metadata: getContext().chatMetadata,
        revision: snapshot.revision
    };
}

function normalizeEncounterPotionUses(encounter) {
    if (!encounter.potionUsesByCharacter) {
        const legacyTotal = Number(encounter.potionsUsed || 0);
        int(legacyTotal, 'encounter.potionsUsed');
        assert(
            legacyTotal <= 4,
            'Legacy shared potion-use count exceeds its old limit'
        );

        // Existing saves used one shared limit of four. Preserve that
        // expenditure conservatively by assigning it to Q'tik.
        encounter.potionUsesByCharacter = {
            qtik: legacyTotal,
            tansy: 0
        };
    }

    const uses = encounter.potionUsesByCharacter;

    assert(
        uses && typeof uses === 'object' && !Array.isArray(uses),
        'Potion-use counts must be an object'
    );

    uses.qtik = Number(uses.qtik || 0);
    uses.tansy = Number(uses.tansy || 0);

    int(uses.qtik, 'Q\'tik potion uses');
    int(uses.tansy, 'Tansy potion uses');

    assert(uses.qtik <= 4, "Q'tik has exceeded four potion uses");
    assert(uses.tansy <= 4, 'Tansy has exceeded four potion uses');

    // Keep the old total as a read-compatible summary.
    encounter.potionsUsed = uses.qtik + uses.tansy;

    return uses;
}

function potionOptionsFor(state) {
    return (state.inventory?.consumables || [])
        .filter(entry =>
            entry &&
            entry.quantity > 0 &&
            CONSUMABLE_CATALOG[entry.id]
        )
        .map(entry => ({
            value: entry.id,
            label:
                CONSUMABLE_CATALOG[entry.id].name ||
                entry.name ||
                entry.id,
            detail: `${entry.quantity} in stock`
        }));
}

function ensurePotionSelection(owner, state) {
    const key = owner === 'qtik' ? 'qtikItem' : 'tansyItem';
    const options = potionOptionsFor(state);

    if (!options.some(option => option.value === combatSelections[key])) {
        combatSelections[key] = options[0]?.value || null;
    }

    return options;
}

function makePotionChoiceGroup(owner, state) {
    const isQtik = owner === 'qtik';
    const key = isQtik ? 'qtikItem' : 'tansyItem';
    const uses = normalizeEncounterPotionUses(state.encounter);
    const options = ensurePotionSelection(owner, state);

    const group = makeChoiceGroup(
        `${isQtik ? "Q'tik" : 'Tansy'} potion ` +
            `(${4 - uses[owner]} uses left)`,
        key,
        options,
        combatSelections[key],
        value => {
            combatSelections[key] = value;
        }
    );

    if (options.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'aethermoor-combat-choice-detail';
        empty.textContent = 'No potions available.';
        group.appendChild(empty);
    }

    return group;
}

function updateCombatAbilityButtons(panel, state) {
    const used = state.encounter?.used || {};
    const potionUses =
        normalizeEncounterPotionUses(state.encounter);

    if (used.stun && combatSelections.qtik === 'stun') {
        combatSelections.qtik = 'fire_melee';
    }

    if (used.icePatch && combatSelections.qtik === 'ice_patch') {
        combatSelections.qtik = 'fire_melee';
    }

    if (used.surge && combatSelections.tansy === 'surge') {
        combatSelections.tansy = 'visor';
    }

    if (
        potionUses.qtik >= 4 &&
        combatSelections.qtik === 'drink'
    ) {
        combatSelections.qtik = 'fire_melee';
    }

    if (
        potionUses.tansy >= 4 &&
        combatSelections.tansy === 'drink'
    ) {
        combatSelections.tansy = 'visor';
    }

    for (const button of panel.querySelectorAll(
        '.aethermoor-combat-choice[data-group="qtik"], ' +
        '.aethermoor-combat-choice[data-group="tansy"]'
    )) {
        const group = button.dataset.group;
        const value = button.dataset.value;

        const exhausted =
            (group === 'qtik' && value === 'stun' && used.stun) ||
            (group === 'qtik' && value === 'ice_patch' && used.icePatch) ||
            (group === 'tansy' && value === 'surge' && used.surge) ||
            (group === 'qtik' && value === 'drink' &&
                potionUses.qtik >= 4) ||
            (group === 'tansy' && value === 'drink' &&
                potionUses.tansy >= 4);

        button.disabled = Boolean(exhausted);
        button.title = exhausted
            ? value === 'drink'
                ? 'This character has used four potions this encounter'
                : 'Already used in this encounter'
            : '';

        button.setAttribute(
            'aria-pressed',
            String(
                !exhausted &&
                combatSelections[group] === value
            )
        );
    }
}

function registerAethermoorCombatAutoRefresh() {
    if (aethermoorCombatRefreshTimer !== null) return;

    aethermoorCombatRefreshTimer = setInterval(() => {
        if (
            !aethermoorPanelOpen ||
            aethermoorPanelElement?.hidden ||
            aethermoorActiveTab !== 'combat' ||
            aethermoorCombatBusy ||
            !aethermoorTabViews?.combat
        ) {
            return;
        }

        const metadata = getContext().chatMetadata;
        const stored = metadata?.[AETHERMOOR_METADATA_KEY];

        if (!stored?.state) return;

        if (
            aethermoorCombatViewKey?.metadata === metadata &&
            aethermoorCombatViewKey?.revision === stored.revision
        ) {
            return;
        }

        /*
         * Polling only renders saved state. Share the busy flag with
         * user-triggered combat operations so controls cannot be rebuilt
         * while a turn is being resolved.
         */
        aethermoorCombatBusy = true;

        Promise.resolve(openCombatPanel(aethermoorTabViews.combat))
            .catch(error => {
                console.error(
                    '[Aethermoor] Combat tab refresh failed',
                    error
                );
            })
            .finally(() => {
                aethermoorCombatBusy = false;
            });
    }, 500);
}

function registerAethermoorCampaignAutoRefresh() {

    if (aethermoorCampaignRefreshTimer !== null) return;

    aethermoorCampaignRefreshTimer = setInterval(() => {
        if (
            !aethermoorPanelOpen ||
            aethermoorPanelElement?.hidden ||
            !['quests', 'world'].includes(aethermoorActiveTab) ||
            aethermoorCampaignRefreshBusy ||
            !aethermoorTabViews
        ) {
            return;
        }

        const metadata = getContext().chatMetadata;
        const stored = metadata?.[AETHERMOOR_METADATA_KEY];

        if (!stored?.state) return;

        if (
            aethermoorCampaignViewKey?.metadata === metadata &&
            aethermoorCampaignViewKey?.revision === stored.revision
        ) {
            return;
        }

        aethermoorCampaignRefreshBusy = true;

        const host =
            aethermoorTabViews[aethermoorActiveTab];

        const refresh =
            aethermoorActiveTab === 'quests'
                ? renderQuestTab(host)
                : renderWorldTab(host);

        Promise.resolve(refresh)
            .catch(error => {
                console.error(
                    '[Aethermoor] Campaign tab refresh failed',
                    error
                );
            })
            .finally(() => {
                aethermoorCampaignRefreshBusy = false;
            });
    }, 500);
}

function makeChoiceGroup(
    label,
    groupName,
    options,
    selectedValue,
    onSelect
) {
    const wrapper = document.createElement('fieldset');
    wrapper.className = 'aethermoor-combat-choice-group';

    const legend = document.createElement('legend');
    legend.textContent = label;
    wrapper.appendChild(legend);

    const choices = document.createElement('div');
    choices.className = 'aethermoor-combat-choices';

    for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'aethermoor-combat-choice';
        button.dataset.group = groupName;
        button.dataset.value = option.value;
        button.setAttribute(
            'aria-pressed',
            String(option.value === selectedValue)
        );

        const title = document.createElement('span');
        title.className = 'aethermoor-combat-choice-title';
        title.textContent = option.label;
        button.appendChild(title);

        if (option.detail) {
            const detail = document.createElement('span');
            detail.className =
                'aethermoor-combat-choice-detail';
            detail.textContent = option.detail;
            button.appendChild(detail);
        }

        if (option.telegraph) {
            const telegraph = document.createElement('span');
            telegraph.className =
                'aethermoor-combat-choice-telegraph';
            telegraph.textContent =
                `[${option.telegraph}]`;
            button.appendChild(telegraph);
        }

        button.addEventListener('click', () => {
            onSelect(option.value);

            for (const sibling of choices.querySelectorAll(
                'button'
            )) {
                sibling.setAttribute(
                    'aria-pressed',
                    String(sibling === button)
                );
            }
        });

        choices.appendChild(button);
    }

    wrapper.appendChild(choices);
    return wrapper;
}

function decorateAethermoorCombatControls(host, state) {
    const crew = state.crew;
    const encounter = state.encounter;
    const stats = derived(crew);
    const shadows = shadowMechanics(crew);
    const summons = crew.weasels.active + shadows.slots;
    const fire = Math.max(3, Math.floor(stats.atk / 5));
    const hamstringReduction = Math.floor(summons / 6);
    const vitalsPierce = Math.floor(summons / 2);

    const descriptions = {
        qtik: {
            fire_melee:
                `Adds ${fire} Fire damage per exchange ` +
                `(max(3, floor(current derived ATK / 5))). ` +
                `Recalculated if summons change. ATK debuffs do not ` +
                `reduce this Fire bonus. Carapace can reflect it.`,
           
            ice_melee:
                `Adds +${Math.max(2, Math.floor(stats.def / 3))} ` +
                'frontline DEF this turn ' +
                '(max(2, floor(derived DEF / 3))). ' +
                'The bonus is calculated before encounter debuffs. ' +
                'Also reduces Base Bleed by 1, minimum Base Bleed 1.',

            stun:
                'Once per encounter. The stunned foe loses its first ' +
                'exchange response and has DEF reduced by 4 × its Tier ' +
                'for the turn. Cancels its current Elite/Boss telegraph. ' +
                'A guarding Brute may intercept.',

            ice_patch:
                'Once per encounter. Enemies miss on rolls 1–3, or 1–4 ' +
                'with Hamstring, for all three exchanges. Suppresses ' +
                'Vitals summon-damage amplification.',

            frost_stomp:
                'Hits all living enemies each exchange. Base damage ' +
                'is floor((effective Crew ATK − target DEF) / 2), ' +
                'plus the player roll on successful rolls. Excess ' +
                'damage spills forward. Interrupts ordinary specialists ' +
                'in exchange 1 and bypasses Brute Guard.',

            drink:
                'Choose a stocked potion below. Four potions per ' +
                'character per encounter, including cleansing tonics. ' +
                'Healing/cleansing occurs before exchanges. Ordinary ' +
                'attack rolls continue, but Fire/Ice action bonuses do not.'
        },

        tansy: {
            visor:
                'Bypasses Brute Guard. On enemy rolls 2–4, disrupts ' +
                'the selected specialist action or Elite/Boss passive ' +
                'stack application. It does not cancel the telegraph. ' +
                `Enemy roll 1 grants Exposed: +${stats.luk} damage ` +
                'on the next successful physical hit.',

            vitals:
                'Doubles loose-weasel and Shadow-Archer attack ' +
                'contributions unless Ice Patch is used. Criticals on ' +
                'player rolls 5–6. On rolls 2–4, adds damage up to ' +
                `${vitalsPierce} target DEF, based on current summons.`,

            hamstring:
                'Enemies miss on rolls 1–2, or 1–4 with Ice Patch. ' +
                `Currently reduces Base Bleed by ${hamstringReduction} ` +
                '(floor(occupied summon slots / 6)), minimum 1. ' +
                'Does not by itself bypass Guard on successful enemy rolls.',

            recall:
                'Removes loose-weasel attack participation and protects ' +
                'them from Carapace/Cleave destruction. Shadow-Archer ' +
                'attack remains; Hexer/Warder attack does not contribute. ' +
                'Q’tik still attacks and can take reflected damage.',
            
            surge:
                'Once per encounter. Immediately refills all available ' +
                'loose-weasel slots before exchanges, preserving Shadows. ' +
                `Separately, Swarm Momentum restores up to ${
                    1 + Math.floor(
                        (3 + Math.floor(crew.level / 2) - shadows.slots) / 4
                    )
                } missing loose weasels after each full three-exchange ` +
                'turn while both protagonists and a foe survive.',

            drink:
                'Choose a stocked potion below. Four potions per ' +
                'character per encounter, including cleansing tonics. ' +
                'Uses this command instead of Visor/Vitals/Hamstring.'
        }
    };

    for (const button of host.querySelectorAll(
        '.aethermoor-combat-choice[data-group="qtik"], ' +
        '.aethermoor-combat-choice[data-group="tansy"]'
    )) {
        const description =
            descriptions[button.dataset.group]?.[button.dataset.value];

        if (description) {
            button.title =
                (button.disabled ? 'Unavailable: already used to its limit.\n\n' : '') +
                description;
        }
    }

    for (const button of host.querySelectorAll(
        '.aethermoor-combat-choice[data-group="qtikItem"], ' +
        '.aethermoor-combat-choice[data-group="tansyItem"]'
    )) {
        const item = CONSUMABLE_CATALOG[button.dataset.value];
        if (!item) continue;

        button.title = item.heal
            ? `Restores up to ${item.heal} HP, capped at maximum HP.`
            : 'Clears all Crew Hex and Elite/Boss passive stacks. ' +
              'Prevents new stacks throughout this turn’s three exchanges. ' +
              'Does not prevent attacks or telegraph effects. ' +
              'Counts against the drinker’s four-potion allowance. ' +
              'One tonic protects both protagonists; two cannot stack. ' +
              'Can be used preventively even with no current stacks.';
    }

    const effects = [
        {
            key: 'armor_sunder',
            label: 'Armor Sunder',
            describe: stacks =>
                `−${2 * stacks} frontline DEF (−2 per stack).`
        },
        {
            key: 'grave_chill',
            label: 'Grave Chill',
            describe: stacks =>
                `−${2 * stacks} regeneration per exchange. ` +
                'Negative regeneration deals internal damage.'
        },
        {
            key: 'withering_lethargy',
            label: 'Withering Lethargy',
            describe: stacks =>
                `−${2 * stacks} Crew ATK (−2 per stack). ` +
                'Effective attack is clamped to zero. Fire bonus is unaffected.'
        },
        {
            key: 'serrated_bleed',
            label: 'Serrated Bleed',
            describe: stacks =>
                `+${stacks} damage on successful frontline responses.`
        }
    ];

    const status = document.createElement('div');
    status.className = 'aethermoor-ui-text';
    status.textContent = 'Active debuffs — Q’tik / Crew: ';

    let found = false;

    function appendCounter(label, stacks, description) {
        if (found) status.append(' · ');

        const counter = document.createElement('span');
        counter.textContent = `${label} ×${stacks}`;
        counter.title = description +
            '\nApplied on eligible successful enemy responses: ' +
            'normally 1 stack, 2 on enemy roll 6, plus any Wind-Up bonus. ' +
            'Source-linked effects cease when their source dies.';
        counter.style.color = '#ffd166';

        status.appendChild(counter);
        found = true;
    }

    for (const foe of encounter.foes.filter(foe => foe.hp > 0)) {
        const definition = effects.find(
            effect => effect.key === foe.passive
        );
        const stacks = Number(foe.passiveStacks || 0);

        if (definition && stacks > 0) {
            appendCounter(
                definition.label,
                stacks,
                definition.describe(stacks)
            );
        }

        const hexStacks = Number(encounter.hexStacks?.[foe.id] || 0);

        if (foe.role === 'hexer' && hexStacks > 0) {
            const penalty = 2 * enemyTier(foe.level) * hexStacks;

            appendCounter(
                'Hex',
                hexStacks,
                `−${penalty} Crew ATK and frontline DEF from this Hexer.`
            );
        }
    }

    if (!found) status.append('None.');

    const qtikGroup = host.querySelector(
        '[data-group="qtik"]'
    )?.closest('fieldset');

    if (qtikGroup) {
        qtikGroup.insertAdjacentElement('afterend', status);
    }
}

function ensureAethermoorCombatChoiceStyles() {
    if (document.getElementById('aethermoor_combat_choice_styles')) {
        return;
    }

    /*
     * These buttons belong to our tab, not SillyTavern's menu_button
     * layout. Keep the selector scoped so other ST controls are untouched.
     * This is the authoritative combat-choice style; do not append
     * another competing combat-choice block elsewhere.
     */
    const style = document.createElement('style');
    style.id = 'aethermoor_combat_choice_styles';
    style.textContent = `
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-group {
            min-width: 0;
            margin: 10px 0;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choices {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            align-items: stretch;
            gap: 6px;
            min-width: 0;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice {
            display: inline-flex;
            flex: 0 0 auto;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 82px;
            max-width: 100%;
            min-height: 42px;
            padding: 7px 10px;
            color: #d0d7de;
            background: #181d23;
            border: 1px solid #2b3542;
            border-radius: 2px;
            cursor: pointer;
            font: inherit;
            text-align: center;
            line-height: 1.25;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice:hover,
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice:focus-visible {
            color: #ffffff;
            border-color: #4da6ff;
            background: #202b36;
            transform: none;
            animation: none;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice[aria-pressed="true"] {
            border-color: #4ade80;
            outline: 2px solid #4ade80;
            outline-offset: 1px;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            transform: none;
            animation: none;
        }
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-controls {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            box-sizing: border-box;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-status {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            box-sizing: border-box;
            white-space: pre-wrap !important;
            overflow-wrap: anywhere;
        }


        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-title,
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-detail,
        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-telegraph {
            display: block;
            width: 100%;
            text-align: center;
            overflow-wrap: anywhere;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-telegraph {
            color: #ffd166;
            font-size: 11px;
        }

        .aethermoor-tab-view[data-tab="combat"]
        .aethermoor-combat-choice-group[hidden] {
            display: none;
        }

        /*
         * Our combat controls must remain stationary and clickable.
         * Override theme animations on both the base and hover states.
         */
        .aethermoor-tab-view[data-tab="combat"] button,
        .aethermoor-tab-view[data-tab="combat"] button:hover,
        .aethermoor-tab-view[data-tab="combat"] button:focus,
        .aethermoor-tab-view[data-tab="combat"] button:active {
            animation: none !important;
            transition: none !important;
            transform: none !important;
        }
    `;

    document.head.appendChild(style);
}

async function openCombatPanel(inlineHost) {
    ensureAethermoorCombatChoiceStyles();

    assert(

        inlineHost instanceof HTMLElement,
        'Combat must render inside the Aethermoor Combat tab'
    );

    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        inlineHost.replaceChildren();

        inlineHost.appendChild(
            makeAethermoorSection(
                'COMBAT',
                error instanceof Error
                    ? error.message
                    : String(error),
                'combat'
            )
        );

        return;
    }

    const state = snapshot.state;
    const encounter = state.encounter;

    /*
     * Record the revision actually rendered. Without this, the polling
     * refresher rebuilds the controls continuously and can replace a
     * button between pointer-down and click.
     */
    markCombatViewRendered(snapshot);

    inlineHost.replaceChildren();

        if (encounter?.status === 'spotted') {
        const foes = encounter.foes
            .map((foe, index) => ({
                foe,
                index
            }))
            .filter(({ foe }) => foe.hp > 0);

        const roster = foes.length
            ? foes.map(({ foe, index }) =>
                `${combatFoeLabel(foe, index)} ` +
                `(${foe.hp}/${foe.maxHp} HP)`
            ).join('\n')
            : 'No living foes recorded.';
        const journey = state.currentJourney;
        const journeyText = journey
            ? `\n\nJourney paused toward ${journey.destinationLabel}: ` +
              `${journey.completedSegments}/${journey.totalSegments} segments. ` +
              'Resolve or avoid this encounter before attempting another move.'
            : '';

        const section = makeAethermoorSection(
            'ENCOUNTER SPOTTED',
            `${encounter.id}\n${roster}\n\n` +
            'The enemies have been spotted. Combat has not begun.' +
            journeyText,
            'combat'
        );

        const actions = document.createElement('div');
        actions.className = 'aethermoor-ui-actions';

        const decide = async disposition => {
            const buttons = actions.querySelectorAll('button');
            buttons.forEach(button => {
                button.disabled = true;
            });

            try {
                const output = await runStoredMechanic({
                    cases: [{
                        name: `${disposition}_spotted_encounter`,
                        kind: disposition
                    }]
                });

                assert(
                    output?.ok === true &&
                    output.results?.[0]?.ok !== false,
                    output?.results?.[0]?.error ||
                        `Could not ${disposition} encounter`
                );

                await renderAethermoorTab('combat');
            } catch (error) {
                toastr.error(
                    error instanceof Error
                        ? error.message
                        : String(error),
                    'Aethermoor'
                );

                buttons.forEach(button => {
                    button.disabled = false;
                });
            }
        };

        actions.append(
            makeAethermoorAction(
                'Engage',
                'combat',
                () => decide('engage')
            ),
            makeAethermoorAction(
                'Avoid',
                'world',
                () => decide('avoid')
            )
        );

        section.appendChild(actions);
        inlineHost.appendChild(section);
        return;
    }

    if (
        !encounter ||
        encounter.status !== 'active' ||
        state.crew.qtik.hp <= 0 ||
        state.crew.tansy.hp <= 0
    ) {
        const message =
            state.crew.qtik.hp <= 0 ||
            state.crew.tansy.hp <= 0
                ? 'A crew member has fallen. Resolve death or respawn before continuing.'
                : encounter?.status === 'cleared'
                    ? 'This encounter is cleared.'
                    : encounter?.status === 'spotted'
                        ? 'Encounter spotted. Engage or avoid it first.'
                        : 'There is no active encounter.';

        inlineHost.appendChild(
            makeAethermoorSection(
                'COMBAT',
                combatStatusText(state) +
                    `\n\n${message}`,
                'combat'
            )
        );

        return;
    }

    const status = document.createElement('pre');
    status.className = 'aethermoor-combat-status';
    status.textContent = combatStatusText(state);

    const controls = document.createElement('div');
    controls.className = 'aethermoor-combat-controls';

    const currentStats = derived(state.crew);

    const qtikGroup = makeChoiceGroup(
        `Q'tik (${state.crew.qtik.hp}/` +
            `${currentStats.qtikMaxHp} HP)`,
        'qtik',
        [
            { value: 'fire_melee', label: 'Fire Melee' },
            { value: 'ice_melee', label: 'Ice Melee' },
            { value: 'stun', label: 'Stun' },
            { value: 'ice_patch', label: 'Ice Patch' },
            { value: 'frost_stomp', label: 'Frost Stomp' },
            { value: 'drink', label: 'Drink Potion' }
        ],
        combatSelections.qtik,
        value => {
            combatSelections.qtik = value;
            showSelectedPotionGroups();
        }
    );

    const tansyGroup = makeChoiceGroup(
        `Tansy (${state.crew.tansy.hp}/` +
            `${currentStats.tansyMaxHp} HP)`,
        'tansy',
        [
            { value: 'visor', label: 'Visor' },
            { value: 'vitals', label: 'Vitals' },
            { value: 'hamstring', label: 'Hamstring' },
            { value: 'recall', label: 'Recall' },
            { value: 'surge', label: 'Surge' },
            { value: 'drink', label: 'Drink Potion' }
        ],
        combatSelections.tansy,
        value => {
            combatSelections.tansy = value;
            showSelectedPotionGroups();
        }
    );

    const target = encounter.foes.find(
        foe => foe.id === combatSelections.target &&
            foe.hp > 0
    );

    if (!target) {
        combatSelections.target =
            encounter.foes.find(foe => foe.hp > 0)?.id ||
            null;
    }

    const targetGroup = makeChoiceGroup(
        'Target',
        'target',
        encounter.foes
            .map((foe, index) => ({
                foe,
                index
            }))
            .filter(({ foe }) => foe.hp > 0)
            .map(({ foe, index }) => ({
                value: foe.id,
                label: combatFoeLabel(foe, index),
                detail: `(${foe.hp}/${foe.maxHp} HP)`,
                telegraph: foe.nextTelegraph
                    ? telegraphLabel(foe.nextTelegraph)
                    : null
            })),
        combatSelections.target,
        value => {
            combatSelections.target = value;
        }
    );

    const qtikPotions = makePotionChoiceGroup('qtik', state);
    const tansyPotions = makePotionChoiceGroup('tansy', state);

    function showSelectedPotionGroups() {
        qtikPotions.hidden = combatSelections.qtik !== 'drink';
        tansyPotions.hidden = combatSelections.tansy !== 'drink';
    }

    showSelectedPotionGroups();
    const actions = document.createElement('div');
    actions.className = 'aethermoor-combat-actions';

    const resolveButton = document.createElement('button');
    resolveButton.type = 'button';
    resolveButton.className = 'aethermoor-ui-action';
    resolveButton.dataset.accent = 'combat';
    resolveButton.textContent = 'Resolve Turn';

    const resultBox = document.createElement('pre');
    resultBox.className = 'aethermoor-combat-result';

    if (aethermoorLastCombatLog) {
        resultBox.textContent = aethermoorLastCombatLog;
    } else {
        resultBox.hidden = true;
    }

    resolveButton.addEventListener('click', async () => {
        if (aethermoorCombatBusy) return;

        aethermoorCombatBusy = true;
        resolveButton.disabled = true;
        resolveButton.textContent = 'Resolving...';
        resultBox.hidden = false;
        resultBox.textContent = 'Resolving combat turn...';

        try {
            const actionsInput = {
                qtik: combatSelections.qtik,
                tansy: combatSelections.tansy,
                target: combatSelections.target
            };

            if (actionsInput.qtik === 'drink') {
                actionsInput.qtikItem =
                    combatSelections.qtikItem;
            }

            if (actionsInput.tansy === 'drink') {
                actionsInput.tansyItem =
                    combatSelections.tansyItem;
            }

            const result = await runStoredMechanic({
                actions: actionsInput
            });

            assert(
                result?.ok === true,
                result?.error || 'Combat turn failed'
            );

            aethermoorLastCombatLog =
                formatCombatTurnResult(result);

            aethermoorLastCombatLogKey =
                `${result.summary.encounter.id}:${result.turn}`;

            resultBox.textContent =
                aethermoorLastCombatLog;
            resultBox.scrollTop = 0;

            await renderAethermoorTab('combat');
        } catch (error) {
            resultBox.hidden = false;
            resultBox.textContent =
                `Turn was not resolved: ${
                    error instanceof Error
                        ? error.message
                        : String(error)
                }`;
        } finally {
            aethermoorCombatBusy = false;
            resolveButton.disabled = false;
            resolveButton.textContent = 'Resolve Turn';
        }
    });

    actions.appendChild(resolveButton);

    controls.append(
        status,
        qtikGroup,
        qtikPotions,
        tansyGroup,
        tansyPotions,
        targetGroup,
        actions,
        resultBox
    );
    inlineHost.appendChild(controls);

    updateCombatAbilityButtons(
        inlineHost,
        state
    );

    // Tooltips and debuff display are auxiliary UI. They must never prevent
    // the actual combat controls from rendering.
    try {
        decorateAethermoorCombatControls(inlineHost, state);
    } catch (error) {
        console.warn(
            '[Aethermoor] Combat tooltip decoration failed',
            error
        );
    }
}

const AETHERMOOR_HANDOFF_MARKER =
    '<aethermoor-mechanics-handoff>';

let aethermoorInjectedHandoff = null;
let aethermoorGenerationReceived = false;

function getPendingAethermoorHandoffs() {
    const context = getContext();
    const metadata = context.chatMetadata;
    const stored = metadata?.[AETHERMOOR_METADATA_KEY];

    if (!stored) {
        return {
            metadata,
            entries: []
        };
    }

    return {
        metadata,
        entries: migrateAethermoorHandoffs(stored)
    };
}

function makeAethermoorHandoffMessage(entries) {
    const packets = entries.map((entry, index) =>
        `${index + 1}. [${entry.type.toUpperCase()}]\n` +
        entry.packet
    );

    return {
        is_user: false,
        is_system: true,
        name: 'Aethermoor Mechanics',
        send_date: Date.now(),
        mes:
            `${AETHERMOOR_HANDOFF_MARKER}\n` +
            'PRIVATE ENGINE CONTEXT — instructions and reference data, ' +
            'not text to reproduce in the assistant reply.\n\n' +
            'OUTPUT RULES:\n' +
            '- Write the scene or answer the player’s question using the ' +
            'established results below.\n' +
            '- Never quote or reproduce this message, its packet headings, ' +
            'instruction lists, private context, or handoff markers.\n' +
            '- Do not expose hidden facts or internal truth merely because ' +
            'they appear in engine context.\n' +
            '- Do not invent attacks, encounters, discoveries, travel events, ' +
            'quest acceptance, item acquisition, or rewards.\n' +
            '- An offered quest is not accepted. A spotted encounter is not ' +
            'engaged. Arrival is not a search or a delivery.\n' +
            '- A concluded rumor has no further objective attached to that ' +
            'lead unless the engine explicitly establishes one.\n' +
            '- You may report player-facing mechanical values, such as HP, ' +
            'journey progress, quest status, and rewards, accurately and ' +
            'concisely. Do not reproduce the surrounding instructions.\n' +
            '- Emit protocol tags only when the corresponding private scene ' +
            'instructions authorize them and the event actually occurs in ' +
            'the fiction. Put those tags inside the disposable <plan> block.\n\n' +
            'The following mechanics events occurred in this order. ' +
            'Do not alter established actions, damage, HP, kills, rewards, ' +
            'or discovery outcomes.\n\n' +
            packets.join('\n\n') +
            `\n${AETHERMOOR_HANDOFF_MARKER}`

    };
}

function getAssistantMessageText(data) {
    const candidates = [
        data?.message,
        data
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            return {
                text: candidate,
                messageId: null
            };
        }

        if (
            candidate &&
            typeof candidate === 'object' &&
            typeof candidate.mes === 'string' &&
            candidate.is_user !== true
        ) {
            return {
                text: candidate.mes,
                messageId: candidate.messageId ??
                    candidate.id ??
                    null
            };
        }
    }

    const chat = getContext().chat;
    if (!Array.isArray(chat)) return null;

    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];

        if (
            message?.is_user !== true &&
            message?.is_system !== true &&
            typeof message?.mes === 'string'
        ) {
            return {
                text: message.mes,
                messageId: index
            };
        }
    }

    return null;
}

function extractAethermoorQuestEvents(text) {
    if (typeof text !== 'string') return [];

    const events = [];

    const foundPattern =
        /<AETHERMOOR:(SEARCHED|FOUND)\s+quest_item=([A-Za-z0-9._:-]+)\s*>/g;

    for (const match of text.matchAll(foundPattern)) {
        events.push({
            event: match[1].toLowerCase(),
            questItemId: match[2]
        });
    }

    const deliveredPattern =
        /<AETHERMOOR:DELIVERED\s+quest_id=([A-Za-z0-9._:-]+)\s*>/g;

    for (const match of text.matchAll(deliveredPattern)) {
        events.push({
            event: 'delivered',
            questId: match[1],
            index: match.index
        });
    }

    const searchedFoundPositions = events
        .filter(event => event.event !== 'delivered')
        .map(event => event.index);

    const deliveryEvents = events
        .filter(event => event.event === 'delivered')
        .map(event => ({
            ...event,
            index: Number.MAX_SAFE_INTEGER
        }));

    const itemEvents = events.filter(
        event => event.event !== 'delivered'
    );

    return [...itemEvents, ...deliveryEvents].map(
        ({ index: _index, ...event }) => event
    );
}

/*
 * Narration validation is separate from mechanics resolution.
 * Detect recognizable private packet leakage without attempting to
 * judge all prose or silently rewriting the assistant's message.
 *
 * This is a narrow safeguard, not proof of narrative correctness.
 * An LLM can still invent unsupported content without copying a header.
 */
const aethermoorNarrationWarnings = new WeakMap();

function leakedAethermoorContext(text) {
    if (typeof text !== 'string') return [];

    const signatures = [
        {
            label: 'engine handoff marker',
            pattern: /<\/?aethermoor-mechanics-handoff>/i
        },
        {
            label: 'private engine context',
            pattern: /^\s*PRIVATE ENGINE CONTEXT\b/im
        },
        {
            label: 'private scene context',
            pattern: /^\s*PRIVATE SCENE CONTEXT\b/im
        },
        {
            label: 'private delivery context',
            pattern: /^\s*PRIVATE QUEST TURN-IN CONTEXT\b/im
        },
        {
            label: 'internal rumor contract',
            pattern: /^\s*AUTHORITATIVE RUMOR ARRIVAL RESULT\b/im
        },
        {
            label: 'internal completion contract',
            pattern: /^\s*AUTHORITATIVE QUEST COMPLETION CONTRACT\b/im
        }
    ];

    return signatures
        .filter(signature => signature.pattern.test(text))
        .map(signature => signature.label);
}

function warnAethermoorNarrationLeak(message, leaks) {
    const metadata = getContext().chatMetadata;

    /*
     * SillyTavern may report the same reply through both received and
     * rendered events. Deduplicate warnings in memory, never by saving
     * a mechanics revision or consuming RNG.
     */
    if (metadata && typeof metadata === 'object') {
        let warned = aethermoorNarrationWarnings.get(metadata);

        if (!warned) {
            warned = new Set();
            aethermoorNarrationWarnings.set(metadata, warned);
        }

        const signature =
            `${message.messageId ?? 'unknown'}:` +
            worldHash(message.text);

        if (warned.has(signature)) return;

        warned.add(signature);

        if (warned.size > 100) {
            warned.delete(warned.values().next().value);
        }
    }

    console.warn(
        '[Aethermoor] Private engine context leaked into assistant reply',
        {
            messageId: message.messageId,
            detected: leaks,
            questEventsRejected: true
        }
    );

    toastr.warning(
        'The reply exposed private engine instructions. ' +
        'Discovery and delivery tags from this reply were ignored. ' +
        'Existing saved mechanics were not undone or rerolled.',
        'Aethermoor: Narration warning'
    );
}

async function processAethermoorAssistantEvents(data) {
    const message = getAssistantMessageText(data);
    if (!message) return;

    /*
     * Check before extracting protocol events. A copied instruction
     * packet can contain example delivery/discovery tags; those must
     * not become gameplay events merely because the narrator echoed it.
     *
     * Already-resolved travel, combat, and rewards remain authoritative.
     * This only rejects new assistant-reported events from this reply.
     */
    const leaks = leakedAethermoorContext(message.text);

    if (leaks.length > 0) {
        warnAethermoorNarrationLeak(message, leaks);
        return;
    }

    const events = extractAethermoorQuestEvents(message.text);
    if (events.length === 0) return;

        for (const event of events) {
        try {
            let result;

            if (event.event === 'delivered') {
                const stateResult = await readStoredCombatState();
                const activeQuest = stateResult.state.activeQuest;

                assert(
                    activeQuest?.id === event.questId,
                    'Delivery tag does not match the active quest'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_quest_delivery',
                        kind: 'quest_delivery'
                    }]
                });
            } else {
                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_quest_event',
                        kind: 'quest_event',
                        event: event.event,
                        questItemId: event.questItemId
                    }]
                });
            }

            console.log(
                '[Aethermoor] Accepted assistant quest event',
                { messageId: message.messageId, event, result }
            );
        } catch (error) {
            console.warn(
                '[Aethermoor] Ignored assistant quest event',
                {
                    messageId: message.messageId,
                    event,
                    reason: error instanceof Error
                        ? error.message
                        : String(error)
                }
            );
        }
    }
}
function findLastUserMessage(chat) {
    for (let index = chat.length - 1; index >= 0; index--) {
        if (chat[index]?.is_user) return index;
    }

    return -1;
}

function removeAethermoorHandoffFromChat(chat, message) {
    if (!Array.isArray(chat) || !message) return;

    const index = chat.indexOf(message);
    if (index >= 0) {
        chat.splice(index, 1);
    }
}

const AETHERMOOR_MOVE_COMMAND =
    /\[\s*AETHERMOOR:MOVE\s+destination="([^"]+)"\s*\]/i;

const AETHERMOOR_EXPLORE_COMMAND =
    /\[\s*AETHERMOOR:EXPLORE_REGION\s*\]/i;

function findLatestUserMovement(chat) {
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];

        if (message?.is_user !== true) continue;

        if (typeof message.mes !== 'string') {
            return null;
        }

        const prose = message.mes
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]*`/g, '');

        const explicitMove =
            prose.match(AETHERMOOR_MOVE_COMMAND);

        if (explicitMove) {
            return {
                index,
                text: prose,
                destinationId: explicitMove[1],
                explicit: true
            };
        }

        if (AETHERMOOR_EXPLORE_COMMAND.test(prose)) {
            return {
                index,
                text: prose,
                destinationId: null,
                explicit: true
            };
        }

        // Preserve old chats using [moved].
        if (/\[\s*moved\s*\]/i.test(prose)) {
            return {
                index,
                text: prose,
                destinationId: null,
                explicit: false
            };
        }

        return null;
    }

    return null;
}

function destinationCommand(destinationId) {
    assert(
        typeof destinationId === 'string' &&
        destinationId.length > 0,
        'Movement command requires a destination ID'
    );

    return `[AETHERMOOR:MOVE destination="${destinationId}"]`;
}

function exploreRegionCommand() {
    return '[AETHERMOOR:EXPLORE_REGION]';
}

function travelStepId(message) {
    let hash = 2166136261;

    for (let index = 0; index < message.text.length; index++) {
        hash ^= message.text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `chat-message-${message.index}-${(hash >>> 0).toString(36)}`;
}

globalThis.aethermoorMechanicsInterceptor =
    async function (chat) {
        if (!Array.isArray(chat)) return;

        const movement = findLatestUserMovement(chat);
        if (movement) {
            try {
                await runStoredMechanic({
                    cases: [{
                        name: 'resolve_movement_command',
                        kind: 'travel',
                        stepId: travelStepId(movement),
                        destinationId: movement.destinationId || undefined
                    }]
                });
            } catch (error) {
                console.error(
                    '[Aethermoor] [moved] travel check failed',
                    error
                );
            }
        }

        const pending = getPendingAethermoorHandoffs();
        const metadata = pending.metadata;

        // Remove obsolete queued copies of private scene instructions.
        const entries = pending.entries.filter(
            entry =>
                entry.type !== 'quest_context' &&
                entry.type !== 'quest_delivery_context'
        );

        const state = metadata?.[AETHERMOOR_METADATA_KEY]?.state;
        const quest = state?.activeQuest;

        if (
            quest &&
            !['active', 'spotted'].includes(
                state.encounter?.status
            )
        ) {
            const deliveryPacket =
                questDeliveryContextPacket(quest);

            if (deliveryPacket) {
                entries.push({
                    id: `delivery-context-${quest.id}`,
                    type: 'quest_delivery_context',
                    packet: deliveryPacket
                });
            } else if (
                state.currentLocationId === quest.destinationId
            ) {
                const discoveryPacket =
                    questDiscoveryContextPacket(quest);

                if (discoveryPacket) {
                    entries.push({
                        id:
                            `scene-context-${quest.id}-` +
                            `${quest.currentGate?.step || 1}`,
                        type: 'quest_context',
                        packet: discoveryPacket
                    });
                }
            }
        }


        if (!metadata || entries.length === 0) {
            console.log('[Aethermoor] No handoff queued');
            return;
        }

        // The handoff is inserted for generation. Retain its exact object
        // and metadata reference so cleanup cannot affect another chat.
        const message = makeAethermoorHandoffMessage(entries);
        const lastUserIndex = findLastUserMessage(chat);

        chat.splice(
            lastUserIndex >= 0
                ? lastUserIndex + 1
                : chat.length,
            0,
            message
        );

        aethermoorGenerationReceived = false;

        aethermoorInjectedHandoff = {
            chat,
            message,
            metadata,
            ids: entries.map(entry => entry.id)
        };


        console.log(
            '[Aethermoor] Injected ordered mechanics handoff',
            {
                count: entries.length,
                ids: entries.map(entry => entry.id),
                packet: message.mes
            }
        );
    };

async function consumeAethermoorHandoff(injected) {
    if (!injected || injected.consumed) return;

    if (injected.consumePromise) {
        await injected.consumePromise;
        return;
    }

    injected.consumePromise = (async () => {
        const stored =
            injected.metadata?.[AETHERMOOR_METADATA_KEY];

        if (!stored) {
            injected.consumed = true;
            return;
        }

        const consumedIds = new Set(injected.ids);
        const queue = migrateAethermoorHandoffs(stored);

        stored.handoffQueue = queue.filter(
            entry => !consumedIds.has(entry.id)
        );

        if (consumedIds.has('legacy-combat')) {
            delete stored.pendingNarration;
        }

        if (consumedIds.has('legacy-discovery')) {
            delete stored.pendingDiscovery;
        }

        if (getContext().chatMetadata === injected.metadata) {
            await getContext().saveMetadata();
        }

        injected.consumed = true;

        console.log(
            '[Aethermoor] Consumed ordered mechanics handoff',
            { ids: injected.ids }
        );

        if (
            injected.generationEnded &&
            aethermoorInjectedHandoff === injected
        ) {
            aethermoorInjectedHandoff = null;
        }
    })();

    try {
        await injected.consumePromise;
    } catch (error) {
        injected.consumePromise = null;
        console.error(
            '[Aethermoor] Could not consume mechanics handoff',
            error
        );
    }
}

function registerAethermoorGenerationCleanup() {
    const { eventSource, event_types } = getContext();

    if (!eventSource || !event_types) {
        console.warn(
            'Aethermoor: SillyTavern event API unavailable; ' +
            'handoff cleanup disabled'
        );
        return;
    }

    const successEvents = [
        event_types.MESSAGE_RECEIVED,
        event_types.CHARACTER_MESSAGE_RENDERED
    ].filter(Boolean);

    const endedEvent = event_types.GENERATION_ENDED;

    if (successEvents.length === 0 || !endedEvent) {
        console.warn(
            'Aethermoor: Required generation events unavailable; ' +
            'handoff cleanup disabled'
        );
        return;
    }

    async function tryConsumeInjectedHandoff() {
        const injected = aethermoorInjectedHandoff;

        if (!injected) {
            return;
        }

        if (!injected.generationEnded) {
            console.log(
                '[Aethermoor] Reply event received; waiting for ' +
                'GENERATION_ENDED before consuming'
            );
            return;
        }

        if (injected.consumed) {
            return;
        }

        console.log(
            '[Aethermoor] Consuming completed mechanics handoff',
            { ids: injected.ids }
        );

        await consumeAethermoorHandoff(injected);

        if (
            injected.consumed &&
            aethermoorInjectedHandoff === injected
        ) {
            aethermoorInjectedHandoff = null;
            aethermoorGenerationReceived = false;
        }
    }

    for (const eventType of new Set(successEvents)) {
        eventSource.on(eventType, data => {
            void processAethermoorAssistantEvents(data);

            const injected = aethermoorInjectedHandoff;

            if (!injected) {
                return;
            }

            aethermoorGenerationReceived = true;
            injected.replyReceived = true;

            console.log(
                '[Aethermoor] Assistant reply event received',
                {
                    eventType,
                    generationEnded: injected.generationEnded
                }
            );

            void tryConsumeInjectedHandoff();
        });
    }

    eventSource.on(endedEvent, () => {
        const injected = aethermoorInjectedHandoff;

        if (!injected) {
            return;
        }

        removeAethermoorHandoffFromChat(
            injected.chat,
            injected.message
        );

        injected.generationEnded = true;

        console.log(
            '[Aethermoor] Generation ended',
            {
                replyReceived: Boolean(injected.replyReceived)
            }
        );

        if (!injected.replyReceived) {
            /*
             * Do not consume yet. Some SillyTavern versions emit
             * MESSAGE_RECEIVED after GENERATION_ENDED.
             */
            console.warn(
                '[Aethermoor] No reply event yet; waiting briefly for ' +
                'late MESSAGE_RECEIVED or CHARACTER_MESSAGE_RENDERED'
            );

            setTimeout(() => {
                const current = aethermoorInjectedHandoff;

                if (
                    current === injected &&
                    !current.replyReceived &&
                    !current.consumed
                ) {
                    console.warn(
                        '[Aethermoor] No assistant reply event arrived; ' +
                        'handoff preserved'
                    );

                    aethermoorInjectedHandoff = null;
                    aethermoorGenerationReceived = false;
                }
            }, 1000);

            return;
        }

        void tryConsumeInjectedHandoff();
    });
}

jQuery(function () {
    try {
        registerAethermoorTools();
    } catch (error) {
        console.error(
            'Aethermoor: Function-tool registration failed',
            error
        );
    }

    try {
        registerAethermoorGenerationCleanup();
    } catch (error) {
        console.error(
            'Aethermoor: Generation cleanup registration failed',
            error
        );
    }

    try {
        createAethermoorController();
        registerAethermoorCombatAutoRefresh();
        registerAethermoorCampaignAutoRefresh();

    } catch (error) {
        console.error(
            'Aethermoor: Main controller initialization failed',
            error
        );
    }


});

