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
 * Unestablished settlement names are deterministic, geography-compatible
 * presentation placeholders. They can later be renamed without changing
 * saved place IDs, routes, reputation keys, or quest ownership.
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

        /*
         * Preserve established names. Later zones and unnamed primary
         * settlements receive deterministic presentation placeholders
         * based on the saved world seed and geographic profile.
         * worldChoice() does not consume campaign combat/loot RNG.
         */
        const zoneName =
            ZONE_NAMES[number] ||
            `${worldChoice(
                world,
                `zone-root:${number}`,
                WORLD_NAME_ROOTS
            )} ${worldChoice(
                world,
                `zone-word:${number}`,
                geography.zoneWords
            )}`;

        const settlementId = `settlement-z${number}-primary`;

        // Place and route identity never depends on presentation names.
        const locationId = `outpost-z${number}`;
        const settlementName =
            override.settlementName ||
            `${worldChoice(
                world,
                `settlement-root:${number}`,
                WORLD_NAME_ROOTS
            )} ${worldChoice(
                world,
                `settlement-word:${number}`,
                geography.settlementWords
            )}`;

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

    if (ensureKnownInstance(state)) {
        changed = true;
    }

    return changed;
}

/*
 * Create only the CURRENT zone's known instance. Its finite layout is
 * saved once; worldHash chooses its size without advancing combat RNG.
 * Existing instances are never regenerated or expanded by this helper.
 *
 * This is a linear small-site template, not a physical floor plan:
 * entrance, three or four guarded chambers, optionally one quiet
 * chamber, and an Elite chamber. A forward passage past a guarded room
 * requires that room's threat to be cleared. Backtracking does not.
 *
 * Enemy rosters are still locked on FIRST ENTRY to their room by
 * ensureInstanceRoomEncounter(), not at site creation. Do not describe
 * them as pre-rolled until that separate contract is implemented.
 */
function ensureKnownInstance(state) {
    state.instances ||= {};
    state.places ||= {};
    state.routeEdges ||= [];

    const zone = state.zone;
    const id = `instance-z${zone}-known`;
    const entranceId = `${id}-entrance`;
    const anchor = savedPrimarySettlement(state, zone);
    const label = `Known local site, Zone ${zone}`;
    let changed = false;

    if (!state.instances[id]) {
        const roomCount = 5 + (
            worldHash(
                `${state.world.seed}:known-instance-size:${zone}`
            ) % 3
        );

        const packCount = roomCount >= 6 ? 4 : 3;
        const quietCount = roomCount - packCount - 2;
        const sequence = ['entrance'];

        for (let number = 1; number <= packCount; number++) {
            sequence.push(`chamber_${number}`);

            // The seven-room version gets one place to pause between
            // guarded chambers. It has no reward or search roll.
            if (number === 2 && quietCount > 0) {
                sequence.push('quiet_chamber');
            }
        }

        sequence.push('inner_chamber');

        assert(
            sequence.length === roomCount,
            'Generated instance room count does not match its plan'
        );

        const rooms = {};

        for (const [index, roomId] of sequence.entries()) {
            const previousId = sequence[index - 1] || null;
            const nextId = sequence[index + 1] || null;
            const isPack = roomId.startsWith('chamber_');
            const isElite = roomId === 'inner_chamber';
            const guarded = isPack || isElite;

            rooms[roomId] = {
                id: roomId,
                label:
                    roomId === 'entrance'
                        ? 'Entrance'
                        : roomId === 'quiet_chamber'
                            ? 'Quiet Chamber'
                            : isElite
                                ? 'Inner Chamber'
                                : `Chamber ${roomId.split('_')[1]}`,
                exits: [previousId, nextId].filter(Boolean),
                requiresCleared: previousId &&
                    (
                        previousId.startsWith('chamber_') ||
                        previousId === 'inner_chamber'
                    )
                    ? [previousId]
                    : [],
                visited: false,
                ...(guarded
                    ? {
                        threat: isElite
                            ? { type: 'elite' }
                            : {
                                type: 'normal_pack',
                                bracket: 'mid',
                                composition: 2
                            },
                        threatStatus: 'unresolved',
                        encounterId: null,
                        encounterBlueprint: null
                    }
                    : { threatStatus: 'none' })
            };
        }

        state.instances[id] = {
            id,
            zone,
            label,
            entranceId,
            size: 'small',
            roomCount,
            status: 'open',
            currentRoomId: null,
            rooms
        };
        changed = true;
    }

    if (!state.places[entranceId]) {
        state.places[entranceId] = {
            id: entranceId,
            label,
            zone,
            kind: 'instance_entrance',
            instanceId: id,
            visited: false
        };
        changed = true;
    }

    if (!state.routeEdges.some(edge =>
        (edge.fromId === anchor.locationId &&
            edge.toId === entranceId) ||
        (edge.fromId === entranceId &&
            edge.toId === anchor.locationId)
    )) {
        state.routeEdges.push({
            fromId: anchor.locationId,
            toId: entranceId,
            length: 2,
            kind: 'known_instance_access',
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

/* Reporting must never change campaign state or prevent a later retry. */
const aethermoorReportedErrors = new WeakMap();

function reportAethermoorError(error, context, eventKey = null) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Aethermoor] ${context}: ${message}`, error);

    const metadata = getContext().chatMetadata;
    if (metadata && typeof metadata === 'object') {
        let reported = aethermoorReportedErrors.get(metadata);
        if (!reported) {
            reported = new Set();
            aethermoorReportedErrors.set(metadata, reported);
        }

        const key = eventKey ||
            `${context}:${metadata.aethermoorV2?.revision ?? 'none'}:${message}`;
        if (reported.has(key)) return;
        reported.add(key);
        if (reported.size > 100) {
            reported.delete(reported.values().next().value);
        }
    }

    globalThis.toastr?.error(
        `${context}: ${message.slice(0, 300)}`,
        'Aethermoor'
    );
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
            'spotted',
            'active',
            'cleared',
            'fled',
            'dead'
        ].includes(encounter.status),
        `Unsupported encounter status: ${encounter.status}`
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
        const breadcrumbId = `breadcrumb-${encounter.id}`;
        const issuer = questIssuerSettlement(state);

        state.breadcrumbs ||= {};

        assert(
            !state.breadcrumbs[breadcrumbId],
            `Breadcrumb ${breadcrumbId} already exists`
        );

        state.breadcrumbs[breadcrumbId] = {
            id: breadcrumbId,
            encounterId: encounter.id,
            zone: encounter.zone,
            settlementId: issuer.id,
            locationId: state.currentLocationId,
            position: clone(
                state.currentPosition ||
                { nodeId: state.currentLocationId }
            ),
            questSeed: {
                source: 'pack_drop',
                roll: value,
                result: 'diegetic_quest_breadcrumb'
            },
            questSeedConsumed: false,
            questId: null
        };

        // Preserve the encounter's existing drop metadata, but the
        // independent breadcrumb is now the offer's authority.
        encounter.questSeed = clone(
            state.breadcrumbs[breadcrumbId].questSeed
        );
        encounter.questSeedConsumed = false;

        return {
            roll: value,
            result: 'diegetic_quest_breadcrumb',
            breadcrumbId
        };
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
        const linkedQuest = findQuestById(
            state,
            encounter.questTerminal.questId
        );

        assert(
            linkedQuest?.status === 'in_progress' &&
            linkedQuest.targetId ===
                encounter.questTerminal.targetId,
            'Quest-terminal encounter has no matching in-progress quest'
        );

        assert(
            linkedQuest.terminalThreat?.encounterId === encounter.id,
            'Linked quest threat does not match this encounter'
        );

        linkedQuest.terminalThreat.resolved = true;
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
    const definition = consumableDefinition(item);
    assert(
        definition,
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


    if (definition.type === 'potion') {
        const amount = definition.heal;
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
function spawnLinkedQuestEncounter(state, questId) {
    assert(
        typeof questId === 'string' && questId.length > 0,
        'Linked-threat spawn requires an explicit questId'
    );

    const quest = findQuestById(state, questId);
    const gate = quest?.currentGate;

    assert(
        quest?.status === 'in_progress' &&
        ['defeat_elite', 'rescue_person']
            .includes(quest.structureV2?.family) &&
        gate?.trigger === 'linked_combat',
        `Quest ${questId} has no V2 linked-combat gate to spawn`
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
        questId: quest.id,
        encounterType: 'quest_terminal',
        encounterId: `quest-terminal-${quest.id}`
    });

    const nextState = spawned.state;
    const encounter = nextState.encounter;
    const activeQuest = findQuestById(nextState, quest.id);

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
    const encounter = state.encounter;

    if (
        !encounter?.questTerminal ||
        encounter.status !== 'cleared'
    ) {
        return null;
    }

    const questId = encounter.questTerminal.questId;
    const quest = findQuestById(state, questId);
    const gate = quest?.currentGate;

    assert(
        quest?.status === 'in_progress' &&
        gate?.trigger === 'linked_combat' &&
        encounter.questTerminal.targetId === gate.linkedTargetId &&
        gate.linkedTargetId === quest.targetId &&
        quest.terminalThreat?.resolved === true,
        'Cleared linked encounter does not match its quest gate'
    );

    const previousSelectionId = state.activeQuest?.id || null;
    const evidence =
        `Defeated the linked quest target at ` +
        `${state.places?.[quest.destinationId]?.label ||
            quest.destinationId}.`;

       /*
     * The encounter's locked quest ID owns progression. Do not change
     * activeQuest merely to complete its combat gate. Keep the encounter
     * in place for resolveTurn.
     */
    const progression = gate.step < quest.gates

        ? resolveQuestAction({
            state,
            questId,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence: evidence
        })
        : resolveQuestAction({
            state,
            questId,
            action: 'resolve_objective',
            objectiveCompleted: true,
            objectiveRoute: 'combat',
            completionEvidence: evidence
        });

    /*
     * Read the progressed quest from the returned state first. Looking it
     * up in state while activeQuest still points to the pre-fight object
     * would let ensureQuestJournal overwrite the new journal entry.
     */
    const updatedQuest = findQuestById(
        progression.state,
        questId
    );

    assert(
        updatedQuest,
        `Linked combat lost quest ${questId}`
    );

    state.quests = progression.state.quests;
    state.leads = progression.state.leads;

    // Remove the stale selection before consulting the copied journal.
    state.activeQuest = null;
    state.activeQuest = previousSelectionId
        ? findQuestById(state, previousSelectionId)
        : null;

    return {
        questId,
        completed: progression.completedGate || clone(gate),
        next: progression.nextGate || null,
        objectiveSecured:
            Boolean(updatedQuest.objectiveResolution)
    };
}

/*
 * Preserve story-useful combat facts without damage, HP, regeneration,
 * or roll values. The GM can dramatize these beats later, but cannot
 * change which actions landed or which foes were defeated.
 */
function combatNarrativeTurn(encounter, actions, exchanges, kills) {
    const labels = new Map(
        encounter.foes.map((foe, index) => [
            foe.id,
            combatFoeLabel(foe, index)
        ])
    );

    const actionLabels = {
        fire_melee: 'Fire Melee',
        ice_melee: 'Ice Melee',
        stun: 'Stun',
        ice_patch: 'Ice Patch',
        frost_stomp: 'Frost Stomp',
        drink: 'Drink',
        visor: 'Visor',
        vitals: 'Vitals',
        hamstring: 'Hamstring',
        recall: 'Recall',
        surge: 'Surge',
        raise_shadow: 'Raise Shadow'
    };

    const slain = new Set(kills.map(kill => kill.id));

    return {
        turn: encounter.turn,
        actions: {
            qtik: actionLabels[actions.qtik] || actions.qtik,
            tansy: actionLabels[actions.tansy] || actions.tansy,
            target: labels.get(actions.target) || null
        },
        exchanges: exchanges.map(exchange => {
            const events = [];
            const hitTargets = [
                ...new Set(
                    (exchange.hits || [])
                        .map(hit => labels.get(hit.id))
                        .filter(Boolean)
                )
            ];

            if (hitTargets.length) {
                events.push(`The crew struck ${hitTargets.join(', ')}.`);
            }

            const defeated = [
                ...new Set(
                    (exchange.hits || [])
                        .filter(hit =>
                            hit.hp === 0 && slain.has(hit.id)
                        )
                        .map(hit => labels.get(hit.id))
                        .filter(Boolean)
                )
            ];

            for (const foe of defeated) {
                events.push(`${foe} was defeated.`);
            }

            if (exchange.enemyMiss === true) {
                events.push('An enemy attack missed.');
            }
            if (exchange.frontlineDamage > 0) {
                events.push("Q'tik was struck by the enemy.");
            }
            if (exchange.backlineDamage > 0) {
                events.push('Tansy was struck by the enemy.');
            }

            for (const effect of exchange.effects || []) {
                if (effect.includes('intercepted')) {
                    events.push('A Brute intercepted an attack with Guard.');
                } else if (
                    effect.includes('interrupted') ||
                    effect.includes('disrupted')
                ) {
                    events.push('An enemy action was disrupted.');
                } else if (effect.includes('reflected')) {
                    events.push('Spiked Carapace reflected an attack.');
                } else if (effect.includes('destroyed')) {
                    events.push('A melee summon was destroyed.');
                } else if (effect.includes('reinforcements')) {
                    events.push('Enemy reinforcements arrived.');
                }
            }

            return {
                exchange: exchange.exchange,
                events
            };
        })
    };
}

/*
 * Death and respawn are different transitions. Record the first death
 * immediately, including one shared XP penalty, but leave the fallen
 * protagonist at 0 HP until combat ends. A second death in this
 * encounter never charges XP again.
 */
function recordEncounterCasualties(state) {
    const encounter = state.encounter;
    const fallen = ['qtik', 'tansy'].filter(
        owner => state.crew[owner].hp === 0
    );

    if (!fallen.length) return null;

    if (!encounter.casualties) {
        const threshold = nextXp(state.crew.level);
        const requestedPenalty = Math.floor(threshold / 10);
        const xpLost = Math.min(state.crew.xp, requestedPenalty);

        state.crew.xp -= xpLost;
        encounter.casualties = {
            fallen: [],
            requestedPenalty,
            xpLost,
            respawned: false
        };
    }

    for (const owner of fallen) {
        if (!encounter.casualties.fallen.includes(owner)) {
            encounter.casualties.fallen.push(owner);
        }
    }

    return encounter.casualties;
}

function finishEncounterRespawns(state, totalDefeat = false) {
    const casualties = state.encounter.casualties;
    if (!casualties || casualties.respawned) return null;

    const stats = derived(state.crew);

    for (const owner of casualties.fallen) {
        state.crew[owner].hp = owner === 'qtik'
            ? stats.qtikMaxHp
            : stats.tansyMaxHp;
    }

    casualties.respawned = true;

    if (totalDefeat) {
        const settlement = savedPrimarySettlement(
            state,
            state.zone
        );

        state.currentJourney = null;
        state.activeInstanceId = null;

        for (const instance of Object.values(
            state.instances || {}
        )) {
            if (instance.currentRoomId !== null) {
                instance.currentRoomId = null;
            }
        }

        state.currentLocationId = settlement.locationId;
        state.currentPosition = {
            nodeId: settlement.locationId
        };

        state.encounter.status = 'dead';
        state.encounter.deathResolved = true;
        state.encounter.rewards.resolved = true;
    }

    return {
        fallen: [...casualties.fallen],
        xpLost: casualties.xpLost,
        respawned: true,
        totalDefeat,
        respawnSettlementId: totalDefeat
            ? savedPrimarySettlement(state, state.zone).id
            : null
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

    /*
     * The UI normally exposes turn controls only after Engage, but this
     * assertion is the actual mechanics boundary. A spotted encounter is
     * discovered, not combat; fled, cleared, and dead encounters are over.
     */
    assert(
        encounter.status === 'active',
        `Combat turn requires an active encounter; current status is ` +
            `${encounter.status}`
    );

    assert(
        actions && typeof actions === 'object',
        'Turn actions are required'
    );

    const fleeing = actions.flee === true;
    const fallenAtStart = ['qtik', 'tansy'].filter(
        owner => c[owner].hp === 0
    );

    assert(
        fallenAtStart.length < 2,
        'Both protagonists have fallen; combat must end'
    );

    assert(
        fallenAtStart.length === 0 || fleeing,
        'A surviving protagonist can only attempt Flee'
    );

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

            const death = finishEncounterRespawns(s);

            return {
                ok: true,
                turn: encounter.turn,
                action: 'flee',
                death,
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
        ex < (fleeing ? 1 : 3) &&
        live(s).length > 0 &&
        (
            fleeing
                ? c.qtik.hp > 0 || c.tansy.hp > 0
                : c.qtik.hp > 0 && c.tansy.hp > 0
        );
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

        let target = fleeing
            ? lowestHpFoe()
            : live(s).find(
                foe => foe.id === actions.target
            );

        // Once a declared target dies, continue against lowest HP.
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
        /*
         * During a survivor's failed escape, enemies threaten the one
         * still standing. Never absorb another hit with the companion
         * already at 0 HP.
         */
        if (fleeing && c.qtik.hp === 0) {
            backlineDamage += frontlineDamage;
            frontlineDamage = 0;
        } else if (fleeing && c.tansy.hp === 0) {
            frontlineDamage += backlineDamage;
            backlineDamage = 0;
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

        encounter.narrativeTurns ||= [];
    encounter.narrativeTurns.push(
        combatNarrativeTurn(
            encounter,
            actions,
            logs,
            kills
        )
    );

    const casualties = recordEncounterCasualties(s);

    if (casualties && live(s).length > 0) {
        const totalDefeat =
            c.qtik.hp === 0 && c.tansy.hp === 0;

        const death = totalDefeat
            ? finishEncounterRespawns(s, true)
            : {
                fallen: [...casualties.fallen],
                xpLost: casualties.xpLost,
                respawned: false,
                totalDefeat: false
            };

        return {
            ok: true,
            turn: encounter.turn,
            rolls: tape,
            flee: fleeing ? tape.flee : null,
            itemUse,
            exchanges: logs,
            turnEffects: [
                ...turnEffects,
                totalDefeat
                    ? 'Both protagonists fell; the encounter ended'
                    : 'One protagonist fell; only Flee remains available'
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
            death,
            state: s,
            derived: derived(s.crew)
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
        markInstanceRoomThreatCleared(s);
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

    // The last foe may fall in the same exchange as a protagonist.
    // Keep the victory and its rewards, but respawn the fallen member.
    const victoryDeath = encounterRewards.resolved
        ? finishEncounterRespawns(s)
        : null;

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
        death: victoryDeath,
        packCleared:
            startingCount > 0 && live(s).length === 0,
        state: s,
        derived: finalStats
    };

    /*
     * Rewards were already applied by finalizeEncounterRewards() and the
     * XP/silver updates above. This is a read-only receipt attached to the
     * cleared encounter, not another claimable drop or payout operation.
     * It survives panel refresh and reload; a later encounter has its own
     * record instead of inheriting this receipt.
     */
    if (encounterRewards.resolved) {
        encounter.victoryReceipt = {
            encounterId: encounter.id,
            xp: encounterRewards.xp,
            silver: encounterRewards.silver,
            loot: clone(encounterRewards.loot),
            packDrop: encounterRewards.packDrop
                ? clone(encounterRewards.packDrop)
                : null,
            levelUps: clone(levelUps),
            death: victoryDeath ? clone(victoryDeath) : null,
            narrativeTurns: clone(encounter.narrativeTurns || [])
        };
    }

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
        assert(
            typeof test.questId === 'string' &&
            test.questId.length > 0,
            'Quest-terminal spawn requires a questId'
        );

        const activeQuest = findQuestById(
            state,
            test.questId
        );

        assert(
            activeQuest?.status === 'in_progress',
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
        /*
         * Ordinary packs retain their random bracket and composition.
         * An instance room may instead supply an engine-saved plan.
         * In either case, the created roster is saved on first spawn.
         */
        assert(
            test.bracket === undefined ||
            bracketNames.includes(test.bracket),
            'Invalid locked normal-pack bracket'
        );

        assert(
            test.composition === undefined ||
            PACK_COMPOSITIONS[test.composition],
            'Invalid locked normal-pack composition'
        );

        const bracketRoll = test.bracket === undefined
            ? roll(state, bracketNames.length)
            : bracketNames.indexOf(test.bracket) + 1;

        const compositionRoll = test.composition === undefined
            ? roll(state, 6)
            : test.composition;

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
        const linkedQuest = findQuestById(
            state,
            questTerminal.questId
        );

        assert(
            linkedQuest?.status === 'in_progress',
            'Spawn lost its linked quest'
        );

        const encounterId =
            spawned.encounter.id;

        linkedQuest.terminalThreat.revealed = true;
        linkedQuest.terminalThreat.resolved = false;
        linkedQuest.terminalThreat.encounterId =
            encounterId;

        linkedQuest.seed.terminalThreat.encounterId =
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

/*
 * Rumor templates establish a local claim and destination, not a fixed
 * landmark repeated across every zone. The saved zone geography guides
 * how the narrator describes the place. Arrival still resolves the
 * claim through the locked rumor inquiry; this catalog grants no quest,
 * encounter, loot, or guaranteed point of interest.
 */
const TRAVELER_RUMORS = [
    {
        id: 'unused-site',
        place: 'Disused site',
        claim:
            'A traveler says there have been signs of activity at a ' +
            'disused local site.'
    },
    {
        id: 'route-marker',
        place: 'Isolated route marker',
        claim:
            'A traveler says supplies have appeared beside an isolated ' +
            'route marker.'
    },
    {
        id: 'old-structure',
        place: 'Old structure',
        claim:
            'A traveler says lights have been seen at an old local ' +
            'structure after dark.'
    }
];

function ensureWorldLocation(state) {
    state.places ||= {};
    state.leads ||= {};

    state.currentLocationId ||= routeNodeId(state.zone, 'outpost');

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId
    );

    state.places[state.currentLocationId] ||= {
        id: state.currentLocationId,
        label: settlement?.label || state.currentLocationId,
        zone: settlement?.zone || state.zone,
        ...(settlement ? { settlementId: settlement.id } : {}),
        kind: settlement ? 'settlement' : 'place'
    };

    return state.currentLocationId;
}

function routeNodeId(zone, place) {
    return place === 'outpost'
        ? `outpost-z${zone}`
        : `place-z${zone}-${place}`;
}

function journeyLegs(journey) {
    if (Array.isArray(journey.legs)) return journey.legs;

    // Beta starts from reset state. Legacy path-only journeys cannot be
    // safely reconstructed without their originally saved route edges.
    assert(
        Array.isArray(journey.legs),
        'Journey is missing its saved route legs'
    );
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
    /*
     * Routes are saved world facts. Do not synthesize retired local
     * landmarks in every zone; generated settlements, quest sites, and
     * rumor sites add their own stable route edges.
     */
    const edges = (state.routeEdges || []).filter(edge =>
        Number.isInteger(edge.length) && edge.length > 0
    );

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
            journeyLegs(state.currentJourney),
            state.currentJourney.completedSegments
        );
    }
    position ||= {
        nodeId:
            state.currentLocationId ||
            routeNodeId(state.zone, 'outpost')
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

/*
 * The narrator supplies presentation only after the crew reaches a
 * saved instance. The engine supplies the ID and owns its topology,
 * encounters, clearance, and rewards. A theme cannot rewrite those facts.
 */
function resolveInstanceTheme(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Instance theme requires saved state'
    );

    const state = clone(test.state);
    const instance = state.instances?.[test.instanceId];

    assert(instance, 'Unknown instance theme target');

    const crewIsHere =
        state.zone === instance.zone &&
        state.currentLocationId === instance.entranceId &&
        !state.currentJourney &&
        (
            state.activeInstanceId === instance.id ||
            !state.activeInstanceId
        );

    assert(
        crewIsHere,
        'Reach this instance entrance before naming it'
    );

    if (instance.presentation?.established === true) {
        return {
            ok: true,
            created: false,
            action: 'theme',
            instanceId: instance.id,
            presentation: clone(instance.presentation),
            state
        };
    }

    const names = test.names;

    assert(
        names && typeof names === 'object' &&
        !Array.isArray(names) &&
        Object.keys(names).sort().join(',') ===
            'atmosphere,kind,name',
        'Instance theme requires exactly name, kind, and atmosphere'
    );

    const themeLimits = {
        name: 80,
        kind: 80,
        atmosphere: 240
    };

    for (const key of ['name', 'kind', 'atmosphere']) {
        assert(
            typeof names[key] === 'string' &&
            names[key].trim().length >= 3 &&
            names[key].trim().length <= themeLimits[key] &&
            !/[<>\r\n]/.test(names[key]),
            `Invalid instance ${key}`
        );
    }

    instance.presentation = {
        established: true,
        name: names.name.trim(),
        kind: names.kind.trim(),
        atmosphere: names.atmosphere.trim()
    };

    // Keep the entrance's saved place label consistent with the map.
    const entrance = state.places?.[instance.entranceId];
    assert(
        entrance?.instanceId === instance.id,
        'Instance entrance place is missing'
    );

    instance.label = instance.presentation.name;
    entrance.label = instance.presentation.name;

    return {
        ok: true,
        created: true,
        action: 'theme',
        instanceId: instance.id,
        presentation: clone(instance.presentation),
        state
    };
}

function refreshInstanceStatus(instance) {
    const requiredRooms = Object.values(instance.rooms)
        .filter(room => room.threat);

    instance.status = requiredRooms.every(room =>
        room.threatStatus === 'cleared'
    )
        ? 'exhausted'
        : 'open';

    return instance.status;
}

/*
 * A room encounter is created once and then owned by the room. The global
 * state.encounter is only the currently active presentation of that saved
 * room threat. Re-entry restores the original locked encounter instead of
 * rolling a new one.
 */
function ensureInstanceRoomEncounter(state, instance, room) {
    if (!room.threat || room.threatStatus === 'cleared') {
        return null;
    }

    if (room.encounterBlueprint) {
        state.encounter = clone(room.encounterBlueprint);
        state.encounter.status = 'spotted';
        state.encounter.instanceId = instance.id;
        state.encounter.instanceRoomId = room.id;

        return state.encounter;
    }

    const threat = room.threat;
    const spawned = spawnEncounter({
        state,
        zone: instance.zone,
        encounterType: threat.type,
        bracket: threat.bracket,
        composition: threat.composition,
        encounterId:
            `${instance.id}-${room.id}-threat`
    });

    state.rngState = spawned.state.rngState;
    state.encounter = spawned.encounter;
    state.encounter.status = 'spotted';
    state.encounter.instanceId = instance.id;
    state.encounter.instanceRoomId = room.id;

    room.encounterId = state.encounter.id;
    room.encounterBlueprint = clone(state.encounter);
    room.threatStatus = 'unresolved';

    return state.encounter;
}

function markInstanceRoomThreatCleared(state) {
    const encounter = state.encounter;

    if (
        encounter?.status !== 'cleared' ||
        !encounter.instanceId ||
        !encounter.instanceRoomId
    ) {
        return null;
    }

    const instance = state.instances?.[encounter.instanceId];
    const room = instance?.rooms?.[encounter.instanceRoomId];

    if (!instance || !room || !room.threat) {
        return null;
    }

    assert(
        room.encounterId === encounter.id,
        'Cleared instance encounter does not match its room threat'
    );

    room.threatStatus = 'cleared';
    room.clearedEncounterId = encounter.id;
    refreshInstanceStatus(instance);

    return {
        instanceId: instance.id,
        roomId: room.id,
        status: room.threatStatus,
        instanceStatus: instance.status
    };
}

/*
 * Instance commands identify one saved user-message event. Their replay
 * returns its locked result before checking the crew's current room.
 * Local movement uses no overland segment or random travel-event roll.
 */
function resolveInstanceAction(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Instance movement requires saved state'
    );
    assert(
        typeof test.stepId === 'string' && test.stepId.length > 0,
        'Instance movement requires a stable message stepId'
    );

    const state = clone(test.state);
    state.instanceSteps ||= {};

    const prior = state.instanceSteps[test.stepId];

    if (prior) {
        assert(
            prior.instanceId === test.instanceId &&
            prior.action === test.action &&
            prior.requestedRoomId === (test.roomId || null),
            'Instance message ID was reused for another action'
        );

        return {
            ok: true,
            created: false,
            ...clone(prior),
            state
        };
    }

    const instance = state.instances?.[test.instanceId];

    assert(instance, 'Unknown saved instance');
    assert(
        instance.zone === state.zone &&
        state.currentLocationId === instance.entranceId &&
        state.currentPosition?.nodeId === instance.entranceId &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'Reach the instance entrance and resolve travel or combat first'
    );

    let room = null;
    let encounter = null;

    if (test.action === 'enter') {
        assert(
            !state.activeInstanceId &&
            instance.currentRoomId === null,
            'Already inside an instance'
        );

        state.activeInstanceId = instance.id;
        instance.currentRoomId = 'entrance';
        room = instance.rooms.entrance;
    } else if (test.action === 'move') {
        assert(
            state.activeInstanceId === instance.id &&
            instance.currentRoomId,
            'Enter this instance before moving between rooms'
        );

        const from = instance.rooms[instance.currentRoomId];

        assert(
            from?.exits.includes(test.roomId),
            'That room is not an exit from the current room'
        );

        room = instance.rooms[test.roomId];

        assert(
            room,
            'The selected instance room is missing'
        );

        for (const requiredId of room.requiresCleared || []) {
            assert(
                instance.rooms[requiredId]?.threatStatus === 'cleared',
                `Clear ${instance.rooms[requiredId]?.label || requiredId} ` +
                    `before entering ${room.label}`
            );
        }

        instance.currentRoomId = room.id;
    } else if (test.action === 'exit') {
        assert(
            state.activeInstanceId === instance.id &&
            instance.currentRoomId === 'entrance',
            'Return to the entrance before leaving the instance'
        );

        instance.currentRoomId = null;
        state.activeInstanceId = null;
    } else {
        throw new Error(
            `Unsupported instance action: ${test.action}`
        );
    }

    const firstVisit = Boolean(room && !room.visited);

    if (room) {
        room.visited = true;
        encounter = ensureInstanceRoomEncounter(
            state,
            instance,
            room
        );
    }

    refreshInstanceStatus(instance);

    const outcome = {
        stepId: test.stepId,
        instanceId: instance.id,
        action: test.action,
        requestedRoomId: test.roomId || null,
        roomId: room?.id || null,
        roomLabel: room?.label || null,
        firstVisit,
        status: instance.status,
        roomThreatStatus: room?.threatStatus || 'none',
        encounter: encounter
            ? {
                id: encounter.id,
                type: encounter.type,
                status: encounter.status,
                roomId: room.id
            }
            : null,
        knownExits: room
            ? room.exits.map(id => ({
                id,
                label: instance.rooms[id].label,
                blocked: (
                    instance.rooms[id].requiresCleared || []
                ).some(requiredId =>
                    instance.rooms[requiredId]?.threatStatus !== 'cleared'
                )
            }))
            : []
    };

    state.instanceSteps[test.stepId] = clone(outcome);

    return {
        ok: true,
        created: true,
        ...outcome,
        state
    };
}

function resolveJourneyAction(test) {
    assert(test.state && typeof test.state === 'object',
        'Journey requires saved state');
    const state = clone(test.state);
    ensureWorldLocation(state);

    assert(
        !state.activeInstanceId,
        'Leave the instance before starting overland travel'
    );

    if (test.action === 'cancel') {
        assert(state.currentJourney, 'No journey to cancel');
        const journey = state.currentJourney;
        state.currentPosition = positionAfterSegments(
            journeyLegs(journey),
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
    state.places ||= {};

    const settlement = Object.values(
        state.world.settlements
    ).find(entry => entry.locationId === locationId);

    const place = state.places[locationId];

    assert(
        place || settlement,
        `Arrival location is not recorded: ${locationId}`
    );

    const destinationZone = settlement?.zone ?? place.zone;

    assert(
        Number.isInteger(destinationZone) &&
        ZONES[destinationZone],
        `Arrival location has an invalid zone: ${destinationZone}`
    );

    const previousZone = state.zone;

    if (settlement) {
        state.places[locationId] ||= {
            id: locationId,
            label: settlement.label,
            zone: settlement.zone,
            settlementId: settlement.id,
            kind: 'settlement',
            visited: false
        };
    }

    state.places[locationId].visited = true;
    state.zone = destinationZone;
    state.currentLocationId = locationId;
    state.currentPosition = { nodeId: locationId };

    // The new zone's known instance becomes available on arrival.
    ensureKnownInstance(state);

    if (state.places[locationId].kind === 'point_of_interest') {
        outcome.poiArrival = {
            placeId: locationId,
            label: state.places[locationId].label
        };

        recordCrewKnowledge(state, {
            id: `knowledge-poi-visit-${locationId}`,
            kind: 'place_visit',
            knowledgeType: 'observation',
            certainty: 'engine_established',
            summary: `The crew visited ${state.places[locationId].label}.`,
            source: {
                id: locationId,
                type: 'place'
            },
            learnedAtLocationId: locationId,
            learnedAtZone: destinationZone
        });
    }

    if (previousZone !== destinationZone) {

        const previousZoneRecord =
            state.world.zones?.[previousZone];

        const nextZoneRecord =
            state.world.zones?.[destinationZone];

        outcome.zoneTransition = {
            fromZone: previousZone,
            toZone: destinationZone,
            fromRegion:
                previousZoneRecord?.name ||
                `Zone ${previousZone}`,
            toRegion:
                nextZoneRecord?.name ||
                `Zone ${destinationZone}`,
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

function questsForArrival(state, locationId) {
    const journal = ensureQuestJournal(state);

    /*
     * An unfinished field objective belongs to its destination.
     * Only a secured objective makes the issuer location eligible for
     * return processing. Merely passing through the issuer's settlement
     * must not attempt to advance an unrelated unfinished quest.
     */
    return journal.accepted.filter(quest => {
        if (quest?.status !== 'in_progress') return false;

        const arrivalLocationId =
            quest.objectiveResolution && quest.turnIn
                ? quest.turnIn.locationId
                : quest.destinationId;

        return arrivalLocationId === locationId;
    });
}

function completeQuestArrivalGate(state, outcome, questId) {
    assert(
        typeof questId === 'string' && questId.length > 0,
        'Quest arrival requires an explicit quest ID'
    );

    ensureQuestJournal(state);

    const quest = findQuestById(state, questId);

    assert(
        quest?.status === 'in_progress',
        `Arrival requires an in-progress quest: ${questId}`
    );

    const nextState = completeSelectedQuestArrivalGate(
        state,
        outcome,
        questId
    );

    const updatedQuest = findQuestById(nextState, questId);

    assert(
        updatedQuest,
        `Arrival lost its quest record: ${questId}`
    );

    saveQuestToJournal(nextState, updatedQuest);
    return nextState;
}

function completeSelectedQuestArrivalGate(state, outcome, questId) {
    let nextState = state;
    ensureQuestJournal(nextState);

    let quest = findQuestById(nextState, questId);
    assert(
        quest?.status === 'in_progress',
        `Arrival requires an in-progress quest: ${questId}`
    );

    outcome.questGates ||= [];
    outcome.questEncounters ||= [];
    outcome.questObjectiveSecuredList ||= [];
    outcome.deliveryReadyList ||= [];

    assert(
        nextState.currentLocationId ===
            (
                quest.objectiveResolution && quest.turnIn
                    ? quest.turnIn.locationId
                    : quest.destinationId
            ),
        `Quest ${quest.id} is not associated with this arrival location`
    );

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

        const deliveryReady = {
            questId: quest.id,
            title: quest.title,
            recipient: quest.turnIn.recipient,
            deliveryType: quest.turnIn.discoveryId
                ? 'cargo'
                : 'report',
            deliveryName: quest.turnIn.discoveryId
                ? (
                    cargo?.name ||
                    quest.facts?.cargo ||
                    'quest cargo'
                )
                : null
        };

        outcome.deliveryReadyList.push(deliveryReady);

        /*
         * Preserve the old singular field for existing narration/UI code
         * while the migration is in progress. It is valid only as a
         * compatibility convenience; the list is authoritative.
         */
        outcome.deliveryReady =
            outcome.deliveryReady || deliveryReady;

        return nextState;
    }

    const gate = quest.currentGate;
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
        ['defeat_elite', 'rescue_person']
            .includes(quest.structureV2?.family) &&
        gate.trigger === 'linked_combat'
    ) {
        const spawned = spawnLinkedQuestEncounter(
            nextState,
            quest.id
        );
        nextState = spawned.state;

        const questEncounter = {
            questId: quest.id,
            id: spawned.encounter.id,
            targetId: quest.targetId,
            status: 'spotted',
            foe: spawned.encounter.foes[0]
        };

        outcome.questEncounters.push(questEncounter);

        /*
         * Keep the compatibility field for current narration consumers.
         * Do not use it for new multi-quest logic.
         */
        outcome.questEncounter =
            outcome.questEncounter || questEncounter;

        return nextState;
    }

    const eligibleArrival =
        gate.trigger === 'arrival' ||
        gate.trigger === 'arrival_with_evidence' ||
        (
            gate.trigger === undefined &&
            gate.step === 1 &&
            quest.archetype?.id === 'ruin_clearance'
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
            questId: quest.id,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence:
                gate.trigger === 'arrival_with_evidence'
                    ? `Found ${evidence} at ${place.label}.`
                    : evidence
        });

        nextState = progression.state;
        const questGate = {
            questId: quest.id,
            completed: progression.completedGate,
            next: progression.nextGate,
            evidence: gate.trigger === 'arrival_with_evidence'
                ? evidence
                : null,
            linkedEncounter: progression.linkedEncounter || null
        };

        outcome.questGates.push(questGate);

        /*
         * Compatibility alias for existing one-quest narration.
         * New code should read questGates.
         */
        outcome.questGate =
            outcome.questGate || questGate;

        return nextState;
    }

    const progression = resolveQuestAction({
        state: nextState,
        questId: quest.id,
        action: 'resolve_objective',
        objectiveCompleted: true,
        objectiveRoute: 'other',
        completionEvidence: evidence
    });

    nextState = progression.state;
    quest = findQuestById(nextState, questId);

    assert(
        quest,
        `Arrival lost its quest record: ${questId}`
    );

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
            label: quest.turnIn.discoveryId
                ? `Return cargo to ${quest.turnIn.recipient}`
                : `Report to ${quest.turnIn.recipient}`,
            claim: quest.turnIn.discoveryId
                ? 'The recovered quest cargo is ready to return.'
                : 'The completed field objective is ready to report.',
            targetType: 'place',
            targetId: quest.turnIn.locationId,
            status: 'known'
        };
    }

    const questObjectiveSecured = {
        questId: quest.id,
        evidence
    };

    outcome.questObjectiveSecuredList.push(
        questObjectiveSecured
    );

    /*
     * Compatibility alias for existing one-quest consumers.
     */
    outcome.questObjectiveSecured =
        outcome.questObjectiveSecured ||
        questObjectiveSecured;

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
    assert(
        !state.activeInstanceId,
        'Leave the instance before using overland movement'
    );

    state.travelSteps ||= {};
    state.inquiries ||= {};
    state.socialSeeds ||= {};
    state.places ||= {};
    state.leads ||= {};

    /*
     * A message ID identifies one movement operation. Replay its saved
     * result before changing direction, starting an automatic return,
     * or checking whether the crew is already at the destination.
     */
    const existing = state.travelSteps[test.stepId];

    if (existing) {
        return {
            ok: true,
            created: false,
            ...clone(existing),
            state
        };
    }

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
     * Explicit movement and an existing journey take precedence.
     * With no chosen destination, auto-return only when exactly one
     * accepted quest has a secured objective awaiting its issuer.
     * Multiple possible returns require a player choice in World.
     */
    if (!state.currentJourney && !test.destinationId) {
        const returnCandidates = ensureQuestJournal(state)
            .accepted.filter(quest =>
                quest.status === 'in_progress' &&
                Boolean(quest.objectiveResolution) &&
                Boolean(quest.turnIn?.locationId) &&
                state.currentLocationId !== quest.turnIn.locationId
            );

        if (returnCandidates.length === 1) {
            const returnQuest = returnCandidates[0];
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
    }

    assert(!['active', 'spotted'].includes(state.encounter?.status),
        'Resolve or avoid the current encounter before moving');

    let journey = state.currentJourney;
    if (journey?.status === 'paused') {
        journey.status = 'traveling';
    }
    /*
     * Destination content supplies the arrival scene. Consume the final
     * route segment here, before the random travel-event roll below.
     * Quest and rumor arrival resolution still run in this branch.
     *
     * Older saves may already have consumed the final segment during an
     * encounter. Preserve that progress and finalize their arrival without
     * consuming another segment. The encounter guard above still applies.
     */
    if (
        journey &&
        journey.completedSegments >= journey.totalSegments - 1
    ) {
        int(journey.totalSegments, 'journey.totalSegments', 1);
        int(journey.completedSegments, 'journey.completedSegments');

        assert(
            journey.completedSegments <= journey.totalSegments,
            'Journey progress exceeds its route'
        );

        const finalSegmentConsumed =
            journey.completedSegments < journey.totalSegments;

        if (finalSegmentConsumed) {
            journey.completedSegments += 1;
        }

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
                journeySegmentConsumed: finalSegmentConsumed,
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

                const arrivalQuests =
            questsForArrival(state, arrival.destinationId);

        for (const arrivalQuest of arrivalQuests) {
            state = completeQuestArrivalGate(
                state,
                arrival,
                arrivalQuest.id
            );
        }

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
    } else {
        // Rolls 98–100 have no authored event contract yet.
        // Treat them as quiet travel rather than invite an invented result.
        event = 'quiet_travel';
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

     /*
     * A POI is noticed directly during travel, unlike a rumor, which is
     * an unverified claim heard from someone. Ordinary POIs are scenic
     * places only: this travel event creates no hidden loot, hazard,
     * lore, encounter, or quest result. Visiting is not searching.
     */
    if (event === 'point_of_interest') {
        const siteId = `site-${test.stepId}`;

        state.places[siteId] ||= {
            id: siteId,
            label: 'Uncharted point of interest',
            zone: state.zone,
            kind: 'point_of_interest',
            knownFrom: 'direct_observation',
            visited: false,
            sourceStepId: test.stepId
        };

        state.routeEdges ||= [];

        const anchor = savedPrimarySettlement(
            state,
            state.zone
        );

        if (!state.routeEdges.some(edge =>
            (edge.fromId === anchor.locationId &&
                edge.toId === siteId) ||
            (edge.fromId === siteId &&
                edge.toId === anchor.locationId)
        )) {
            state.routeEdges.push({
                fromId: anchor.locationId,
                toId: siteId,
                length: 2,
                kind: 'poi_access',
                fromZone: state.zone,
                toZone: state.zone
            });
        }

        outcome.site = {
            id: siteId,
            zone: state.zone,
            label: state.places[siteId].label
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
            const leadId = `rumor-${test.stepId}`;

            // The template describes a kind of place, not one shared
            // landmark for every traveler who mentions that kind.
            // The saved travel-step ID gives this rumor its own stable site.
            const placeId =
                `place-z${state.zone}-${template.id}-${test.stepId}`;

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

            // World generation consumes no combat RNG. Save the route
            // alongside the lead, so World can offer movement to this
            // particular site as soon as the rumor is established.
            ensureWorldRecords(state);

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
            journeyLegs(journey),
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
        const arrivalQuests =
            questsForArrival(state, outcome.destinationId);

        for (const arrivalQuest of arrivalQuests) {
            state = completeQuestArrivalGate(
                state,
                outcome,
                arrivalQuest.id
            );
        }

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
            F: reward('F', 1, 1, 'common', base),
            E: reward('E', 1.5, 1, 'common', base),
            D: reward('D', 3, 2, 'uncommon', base + 1),
            C: reward('C', 5, 2, 'uncommon', base + 1),
            B: reward('B', 9, 2, 'rare', base + 3)
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

const QUEST_OFFER_RANKS_BY_REPUTATION = {
    Unknown: ['F', 'E'],
    'Slightly Known': ['F', 'E', 'D'],
    Known: ['E', 'D', 'C'],
    'Well Respected': ['D', 'C', 'B'],
    Renowned: ['C', 'B']
};

const QUEST_REPUTATION_STEPS_PER_TIER = 3;

function normalizeQuestRepTier(value) {
    assert(
        typeof value === 'string',
        'repTier must be a string'
    );

    const tier = value
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
        .toLowerCase();

    const label = Object.keys(QUEST_OFFER_RANKS_BY_REPUTATION)
        .find(entry => entry.toLowerCase() === tier);

    assert(label, `Unsupported reputation tier: ${value}`);

    return {
        label,
        ranks: QUEST_OFFER_RANKS_BY_REPUTATION[label]
    };
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
/*
 * Rank-linked threat rule: F/E quests use a normal pack; D/C roll between
 * a normal pack and an Elite; B quests use an Elite.
 *
 * Gate count controls quest length, not difficulty. This combat rule is
 * explicit and engine-owned; do not infer that non-combat objectives are
 * mechanically harder merely because their rank, reward, or gate count is
 * higher. Family-specific non-combat challenge remains unresolved.
 */
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
 * - IMPLEMENTED — BETA PENDING: code path is connected; campaign-flow
 *   verification is deliberately deferred to beta, not unfinished coding.
 * - PARTIAL: important implementation paths or integrations remain.
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
 *
 * - IMPLEMENTED — BETA PENDING: resolveTurn() requires
 *   encounter.status === 'active'. Spotted encounters must be engaged
 *   first, and cleared/fled/dead encounters cannot receive another turn.
 *   The UI remains a convenience layer; the mechanics assertion is the
 *   authoritative boundary.
 *
 * - IMPLEMENTED — BETA PENDING: a cleared encounter retains a read-only
 *   victory receipt and a concise, number-free log of established combat
 *   beats. The receipt displays applied XP, silver, loot, breadcrumbs,
 *   and level-ups. Players may copy a recap prompt for optional GM
 *   dramatization; copying does not rerun combat or grant rewards.
 *
 * - IMPLEMENTED — BETA PENDING: World and Instance show spotted-encounter
 *   decisions in context. Engage opens the one Combat UI; a finished turn
 *   returns to the originating tab, where victory shows that saved receipt.
 *   No second combat resolver or reward claim path was added.
 *
 * - IMPLEMENTED — BETA PENDING: healing potions have fixed purchase-zone
 *   grades. Basic heals 50 × zone HP for 10 × zone silver; Mid-Tier heals
 *   120 × zone HP for 20 × zone silver. An old bottle never scales up.
 *   Cleansing Tonic retains its fixed effect. Verify use in combat and
 *   outside combat before expanding the catalog.
 *
 * DONE — Quest delivery foundation
 * - Lock the quest issuer and return location.
 * - Separate field-objective completion from delivery and payment.
 * - Support report-only delivery for defeat objectives.
 * - Support cargo delivery for retrieval objectives.
 * - Apply quest rewards exactly once after validated delivery.
 *
 * IMPLEMENTED — BETA PENDING: V2 linked-threat quest path
 * - Use complete V2 structures for supported linked-threat gate counts.
 * - Longer structures use authored local discoveries for tracking, reaching
 *   the lair, and locating the target; they do not require repeat arrival.
 * - Complete the arrival gate, reveal the linked threat, resolve the linked
 *   combat gate, return to the issuer, and complete report-only delivery.
 * - Verify the longer discovery paths during beta.
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
 * IMPLEMENTED — BETA PENDING: Fresh-campaign initialization
 * - A reset chat can create its level-1 crew and Zone 1 saved world from
 *   the World tab without a manual state import.
 * - Initialization creates no quest, rumor, NPC, encounter, or handoff.
 * - It cannot overwrite an existing campaign. Verify from a fresh chat
 *   during beta.
 *
 * PARTIAL — Travel interruption behavior
 * - Destination journeys roll random travel events only before the final
 *   segment. An event consumes one segment, including wild encounters.
 * - The final segment consumes distance and confirms arrival without a
 *   random travel-event roll. One-segment journeys arrive directly.
 * - Quest and rumor arrival mechanics still run and may reveal their own
 *   opportunities or spotted threats, without automatically engaging combat.
 * - Regional exploration without a destination retains normal event rolls.
 * - Movement while an encounter is spotted or active does not advance travel.
 * - Older final-segment interruptions remain supported: after resolution or
 *   avoidance, finalize arrival without another segment or travel-event roll.
 * - Narration and Combat UI report saved journey progress at interruptions.
 * - Final-segment policy implemented; fresh one-segment and multi-segment
 *   arrival verification pending. Earlier test arrivals still rolled events.
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
 * - Travel-step replay now checks its stable message ID before changing or
 *   starting a journey. Verify duplicate commands after arrival and after
 *   interrupted travel do not move the crew or save another revision.
 * - Traveler events return cloned state: refresh the journey reference before
 *   advancing progress so saved progress matches the narrated outcome.
 * - Verify a traveler on segment 1 saves 1/N, then a subsequent move saves 2/N.
 * - Regression incident: the Watchtower journey reported 1/5 after a traveler
 *   but lost that first segment in saved state. Fix added; retest pending.
 *
 * DONE — Out-of-combat Q'tik recovery
 * - When a previously active encounter ends, restore Q'tik to derived maximum
 *   HP if no active or spotted encounter remains in the resulting state.
 * - Do not tie recovery to travel steps, elapsed time, or UI refreshes.
 * - A successor encounter revealed by the same operation suppresses recovery.
 * - Death already restores the crew and is not an additional recovery event.
 *
 * PLANNED — Tansy out-of-combat recovery
 * - Do not heal Tansy between fights yet.
 * - Revisit after she reaches level 20 and completes the authored Mender quest.
 * - At that point decide whether established Mender care warrants full
 *   between-fight recovery; do not track time or invent a cast-rate formula.
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
 * - Cancelling or abandoning a quest stops its field-destination journey
 *   while preserving route position. Shared destinations and independent
 *   settlement return travel are preserved. Live verification pending.
 *
 * PARTIAL SYSTEMS
 *
 * PARTIAL — V2 retrieve-item quests
 * - IMPLEMENTED — BETA PENDING: new Recover Cargo offers use the
 *   Abandoned Transport, Diverted Shipment, and Stolen Shipment variants.
 * - Their authored discoveries cover supported retrieval gate counts and
 *   require the final recovered cargo to match the locked turn-in item.
 * - New cargo eligibility and discovery preparation do not depend on biome.
 *   Saved world geography remains narration context.
 * - Retired Missing Cargo and Sunken Salvage fixed-site catalogs, gate
 *   templates, and discovery helpers have been removed for the beta reset.
 * - Full gameplay verification is deferred to beta.
 *
 * IMPLEMENTED — BETA PENDING: Authored quest discoveries
 * - Every current V2 discovery-triggered gate receives a stable,
 *   engine-authored discovery with a locked location and acquisition state.
 * - Acceptance validates its discovery ID, location, acquisition policy,
 *   hiding place, and significance before saving the accepted quest.
 * - FOUND events validate the current gate and record acquired discoveries
 *   as source-linked Crew Knowledge; hidden preparations are not knowledge.
 * - Verify each quest family from acceptance through discovery during beta.
 *
 * PARTIAL — Quest family migration
 * - Recover Cargo, Ruin Clearance, and Territorial Beast use V2 foundations.
 *
 * - IMPLEMENTED — BETA PENDING: Herb Foraging uses rank-appropriate,
 *   geography-agnostic requests and V2 authored discoveries for every
 *   supported gate count; the harvest remains locked turn-in cargo.
 * - Saved zone geography informs presentation, not Herb Foraging eligibility.
 *
 * - IMPLEMENTED — BETA PENDING: Missing Person Search uses geography-neutral
 *   Lost-at-D and Abducted-at-C/B variants. Lost ends when the person is
 *   found; Abducted ends when the linked threat is defeated. Returning the
 *   person is diegetic; turn-in is report-only.
 * - Four- and five-gate Missing Person offers use Abducted, because the
 *   current Lost scenario supports only two or three field gates.
 *
 * - IMPLEMENTED — BETA PENDING: Ruin Clearance and Territorial Beast Hunt
 *   use setting-neutral premises and saved V2 linked-threat structures.
 * - New-offer scenario eligibility no longer reads geography profiles.
 *   Saved world geography still guides narration and zone transitions.
 * - Full gameplay verification remains for beta.
 *
 * PARTIAL — Quest ranks and settlement reputation
 * - Rank reflects stakes, trust, and consequences, not gate count alone.
 * - F: routine, low-stakes, menial help. A common-plant errand is now
 *   authored for any saved geography; other F objectives remain future work.
 * - Offer generation rolls only among reputation-permitted ranks with
 *   an eligible authored scenario. Geography does not filter new offers.
 * - E: useful work needing judgment or travel, with limited consequences.
 * - D: consequential local problems entrusted to a capable crew.
 * - C: serious threats to a community, essential service, or trade route.
 * - B: major local or regional problems entrusted to proven crews.
 * - A/S: reserved for specially authored quests and distinctive rewards.
 * - Archetypes may appear at different ranks only when their authored
 *   scenario and stakes fit; more gates alone do not raise a quest’s rank.
 * - Reputation and rank offers are settlement-specific. Offers should move
 *   upward with trust; reaching a higher band should not erase the option to
 *   undertake lower-ranked work.
 * - Reputation should encourage regional momentum, not require clearing a
 *   fixed number of quests before the crew can move on.
 * - New offer bands: Unknown F/E; Slightly Known F/E/D; Known E/D/C;
 *   Well Respected D/C/B; Renowned C/B.
 * - Three reputation steps per tier. F/E grant one; D/C/B grant two.
 *   Keep earned tiers and banked steps. Tune pacing during beta.
 * - Missing Person: Lost at D; Abducted at C/B.
 * - Herb Foraging has explicit F, E/D, and C/B stakes; Missing Person has
 *   Lost at D and Abducted at C/B; F nuisance variants are explicitly authored
 *   for Ruin Clearance and Territorial Beast Hunt.
 *
 * - IMPLEMENTED — BETA PENDING: every current quest scenario has explicit
 *   rank eligibility; offers roll only from scenarios authored for the
 *   selected rank. Verify rank pools and stakes during beta.
 * - Keep A/S offer generation disabled until their special objectives and
 *   rewards are authored.
 *
 * - IMPLEMENTED — BETA PENDING: linked-threat type follows rank: F/E normal
 *   pack, D/C pack-or-Elite roll, B Elite.
 * - Gate count means quest length, not difficulty. Mechanical challenge for
 *   non-combat objectives remains unresolved; do not imply otherwise.
 *
 * PARTIAL — World integration
 * - World records and route edges are saved.
 * - IMPLEMENTED — BETA PENDING: newly generated zones beyond the named
 *   campaign start and unnamed primary settlements receive deterministic,
 *   geography-compatible placeholder names. Saved records are not renamed;
 *   IDs and reputation keys remain independent of presentation.
 * - IMPLEMENTED — BETA PENDING: World exposes the saved route to the next
 *   zone's primary settlement even before a local lead names it. This
 *   enables forward progression without revealing NPCs or quest content.
 *
 * - IMPLEMENTED — BETA PENDING: traveler rumors use setting-neutral
 *   templates. Each new rumor owns a stable, zone-local destination;
 *   rolling the same template again does not reuse another rumor's site.
 * - The new site's route is saved with its lead, without advancing combat RNG.
 * - Missing current-place records use the saved settlement identity rather
 *   than labelling every zone's outpost Peat-Cairn Outpost.
 * - Existing saved places keep their established names and IDs.
 *
 * - IMPLEMENTED — BETA PENDING: route search uses saved world edges only;
 *   retired Stone Ford, Old Mill, and Watchtower edges are not synthesized
 *   in every zone. Generated settlements and authored destinations save
 *   their own stable route edges.
 * - Beta starts from reset state; path-only legacy journeys without saved
 *   route legs are not reconstructed.
 *
 * PARTIAL — Shared cosmetic stock naming
 *
 * - IMPLEMENTED — BETA PENDING: at a saved settlement, the extension
 *   requests one geography-aware naming batch for the current zone and
 *   validates engine-issued gear-variant and potion-grade keys.
 * - The batch is saved once per zone and can be extended only for newly
 *   added stock keys; existing names cannot be silently renamed.
 *   Missing or malformed replies leave generic names and never block play.
 *
 * - IMPLEMENTED — BETA PENDING: saved labels now flow through gear and
 *   herbalist shop windows, purchase receipts, Bag Reserves, Inventory,
 *   and combat potion choices.
 *
 * - Generic labels remain fallbacks when a naming batch is absent.
 * - On confirmed arrival in a new zone, the extension supplies the GM
 *   with saved geography and engine-issued keys for the zone's gear and
 *   herbalist stock. The GM returns cosmetic names inside <plan>.
 * - The extension validates and saves one naming batch per zone. All
 *   settlements in that zone reuse it, including stackable potion grades.
 * - Names change presentation only: never item IDs, slots, variants,
 *   healing, stats, prices, ownership, or rewards.
 * - Shops, purchase receipts, Inventory, and Combat should display the
 *   same saved name. Missing or invalid names retain generic labels and
 *   never block arrival or trade.
 * - The extension initiates the request in the arrival handoff; it must
 *   not rely on the GM remembering a standing instruction. SillyTavern's
 *   configured regex handles hiding <plan> from the player.
 * - Implement this as one shared naming path after inn services, not
 *   separate GM-naming handshakes for each shop.
 *
 * IMPLEMENTED — BETA PENDING: Diegetic inn services
 * - Flat-price meals (1/3/5s), rooms (1/2/5s), and hot water (2s)
 *   establish ordinary living costs without zone scaling.
 * - ASK_INN opens a movable services window. Selection stages a quote;
 *   only fictional agreement and INN_AGREED deduct silver once.
 * - Inn purchases currently grant no buffs, healing, inventory items,
 *   or automatic passage of time. Verify staging, payment, and replay.
 *
 * IMPLEMENTED — BETA PENDING: Variable expense quote handshake
 * - For diegetic fares, bribes, and similar unscripted costs, the GM may
 *   propose an amount in fiction and report it privately as EXPENSE_QUOTE.
 * - The extension saves the quote without charging. Only explicit player
 *   agreement to the same amount/purpose commits it; the extension deducts
 *   the saved amount once and supplies a receipt.
 * - Negotiation or refusal is not payment. A changed amount requires a
 *   new quote. Test insufficient funds and duplicate agreement events.
 *
 * IMPLEMENTED — BETA PENDING: Diegetic vendor trade
 * - ASK_WARES opens the extension-rendered, two-sided trade window.
 * - Clicks select stock variants, Bag Reserves, or worn gear. Close stages
 *   a quote; Discard clears it. Neither action transfers possessions.
 * - After fictional agreement, TRADE_AGREED revalidates the complete
 *   basket and commits sales and purchases atomically. Sale proceeds may
 *   fund purchases; the final purse cannot be negative.
 * - Sold worn gear is removed and derived stats/HP are updated by the
 *   engine. Purchased gear enters Bag Reserves unbound; equipping remains
 *   a separate engine action.
 * - A saved receipt prevents duplicate assistant notifications from
 *   repeating the trade. Verify staging, stale-basket rejection, mixed
 *   purchases and sales, worn-gear HP changes, and replay during beta.
 *
 * IMPLEMENTED — BETA PENDING: Diegetic herbalist trade
 *
 * IMPLEMENTED — BETA PENDING: Inventory readout and basic item actions
 * - Inventory displays saved potions, Bag Reserves, and worn gear.
 * - Potion labels carry their authoritative healing value; redundant
 *   explanatory text is omitted.
 * - Eligible Bag Reserve gear can be equipped through the existing engine
 *   action. Healing potions can be used outside combat on a selected
 *   protagonist. Cleansing Tonic remains combat-only for now.
 * - Equip and outside-combat healing now queue the saved result for the
 *   next GM reply; UI actions do not require an assistant protocol tag.
 * - Verify equip replacement, HP/stat changes, potion use, and duplicate
 *   button events during beta.
 *
 * PLANNED — Currency presentation
 * - Centralize silver formatting before introducing denominations such as
 *   100 silver = 1 gold. Keep saved currency in integer silver internally.
 * - Decide the next denomination and conversion display before adding it to
 *   vendor, herbalist, quest, and expense packets.
 *
 * DEFERRED — Aether-Trade window
 * - Reuse the independent window pattern for Trade-Stream listings:
 *   pending sales, sold/unsold receipts, returned items, proceeds, and
 *   eventually purchases.
 * - Keep listing settlement and NPC/vendor purchases as separate saved
 *   mechanics until their handshake contracts are authored.
 * - Owned bottles, including older grades, may be sold. Quantities show
 *   projected silver; closing stages but does not exchange anything.
 * - Fictional agreement commits the revalidated buy/sell basket once.
 *   Purchased bottles retain their saved healing grade. Test the full
 *   handshake, affordability, mixed exchange, and duplicate receipt in beta.
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
 * - Debug rumor fixtures connect to a stable settlement anchor and backfill
 *   existing test sites, preventing repeated fixtures from forming long
 *   accidental route chains. Existing interrupted journeys retain their
 *   saved route until cancelled and restarted.
 * 
 * PLANNED — UI cleanup and consistency
 * - IMPLEMENTED — BETA PENDING: test-rumor creation lives in Narration Debug,
 *   not the ordinary World view; cancelled quests appear in history.
 *
 * - IMPLEMENTED — BETA PENDING: the Quests and World buttons open their
 *   saved-state tabs. Clicking either button while the panel is open
 *   switches tabs instead of closing it.
 *
 * - IMPLEMENTED — BETA PENDING: removed the unused legacy quest and World
 *   popups. Ordinary UI uses the saved-state tabs; the old popup's direct
 *   quest-payout path is no longer present.
 *
 * - Deduplicate destinations and leads by stable identity.
 * - Show exact journey progress, interruption state, current gate, and delivery
 *   eligibility from saved state.
 * - Legacy World movement now copies the same explicit movement command as
 *   the main World tab; mechanics resolve only after the player submits it.
 * - Ordinary legacy settlement choices and leads exclude earlier zones;
 *   earlier destinations remain available only when tied to an accepted quest.
 * - Prevent action-button numbering collisions in legacy popup panels.
 *
 * PARTIAL — Narration authority
 * - Engine handoffs explicitly separate private instructions from output.
 * - Detect recognizable engine-instruction headings outside Markdown code.
 * - A match is diagnostic evidence, not proof that hidden facts were exposed.
 * - Ignore fenced and inline code examples in both instruction detection
 *   and protocol-event extraction so beta explanations cannot submit tags.
 * - Warn without modifying story text, consuming RNG, or saving a revision.
 * - Reject assistant discovery/delivery events from replies matching the
 *   instruction detector outside code. Technical prose can still match;
 *   inspect the observed reply before diagnosing a narration failure.
 * - Code-example exclusion implemented; live verification pending.
 * - Do not automatically regenerate replies or undo resolved mechanics.
 * - Leak detection is narrow: it does not validate arbitrary narrative claims.
 * - Optional per-chat narration recorder retains the last 30 diagnostic events
 *   outside machine state and gameplay revisions; recording starts disabled.
 * - Capture engine handoffs, assistant notification text, leakage rejection,
 *   generation end, and handoff consumption. Viewer uses plain text only.
 * - Diagnostics may contain hidden quest context. Disabling preserves records;
 *   clearing removes them. Recording consumes no RNG and uses the save queue.
 * - Recorder regression pending: enable, capture a normal generation, reload,
 *   inspect retained records, disable, and verify further replies add none.
 * - Regression pending: ordinary reply, leaked packet containing an example
 *   tag, and duplicate received/rendered notifications.
 * - Build every narration packet from the authoritative saved result.
 * - Travel rolls 98–100 resolve as quiet travel until significant discoveries
 *   and rare events have authored saved outcomes and narration contracts.
 *   Do not present an undefined roll as an invitation to invent an event.
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
 * IMPLEMENTED — BETA PENDING: Explicit movement commands and World destinations
 * - World entries copy stable-ID movement commands; movement resolves only
 *   when the player submits the command with their fiction.
 * - Supports known destinations and regional exploration.
 * - Explicit destination commands can change direction mid-journey.
 * - Legacy [moved] parsing remains supported.
 * - Beta verification remains part of the travel interruption regression pass.
 *
 * PLANNED — Local site exploration sessions
 * - IMPLEMENTED — BETA PENDING: travel establishes a directly noticed,
 *   scenic-only POI with a stable place ID and saved route; World offers
 *   Travel to it.
 * - Confirmed arrival records one source-linked visit observation and
 *   authorizes description of visible features. Ordinary POIs have no
 *   hidden curiosity roll, loot, hazard, lore, encounter, or quest result.
 * - A POI is not a rumor and need not contain a reward. Do not add an
 *   Inspect button.
 * - Add consequential site content only through a separately authored,
 *   saved player-interaction contract.
 *
 * - IMPLEMENTED — BETA PENDING: each entered zone has one known instance
 *   with a saved entrance route and finite local room graph. Older
 *   three-room instances retain their saved topology.
 *
 * - IMPLEMENTED — BETA PENDING: newly created small instances have 5–7
 *   rooms: three or four guarded normal-pack chambers, optionally one
 *   quiet chamber, and a final Elite chamber. The layout is saved once;
 *   room rosters are locked on first entry and reused on revisits.
 * - IMPLEMENTED — BETA PENDING: on reaching the entrance, the extension
 *   requests a locally fitting cosmetic instance name, kind, and atmosphere.
 *   It saves a valid identity once, shows the name in the Instance tab,
 *   and resends the identity while exploring. Missing names never block
 *   entry. The GM cannot change rooms, encounters, or rewards through it.
 * - Forward passages past guarded chambers require actual clearance.
 *   Backtracking remains possible; visiting alone never clears a threat.
 * - Entering a threat room spots its saved encounter without engaging it.
 *   Avoiding, fleeing, or dying leaves the room unresolved; returning
 *   restores the same encounter rather than rolling another.
 * - The Inner Chamber exit is blocked until the Work Chamber threat is
 *   actually cleared. Room clearance is owned by the room, not by the
 *   replaceable global encounter record.
 * - Enter, move, and exit require submitted instance commands. The Instance
 *   tab shows visited rooms, known exits, threats, and the entrance command.
 * - Quest destination commands live on their Quests cards; World retains
 *   rumors, POIs, settlements, onward travel, exploration, and a compact
 *   pointer to available quest and instance destinations.
 * - Every movement button remains clipboard-only. Submitted commands use
 *   the existing saved overland or instance resolver, never a tab-specific
 *   movement mechanic.
 * - Revisits retain room state and cannot reroll content. The instance is
 *   exhausted only after all required room threats are cleared.
 * - This first combat slice contains no chest, puzzle, or boss. The Inner
 *   Chamber Elite is the initial deeper-room payoff; later instance modules
 *   may add bosses, loot, puzzles, alternate routes, and larger layouts.
 *
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
 * - Validated FOUND quest events also record source-linked observations.
 *   Hidden preparations and SEARCHED prerequisites are not crew knowledge.
 * - Stable discovery IDs prevent repeated notifications from duplicating
 *   those observations; existing acquired discoveries are not backfilled.
 * - Verified with a debug fixture: testimony exists before travel; arrival
 *   adds a separate observation without overwriting the original claim.
 * - World displays saved knowledge, sources, certainty, and learning locations.
 * - Live verification of quest-discovery knowledge remains for beta.
 * - Knowledge display is read-only and labels identifiable test records.
 * - Crew Knowledge starts collapsed, with expandable Unverified and
 *   Established groups showing record counts.
 * - Natural traveler testimony integration still awaits live verification.
 * - Authored lore content and quest prerequisite checks remain unimplemented.
 * - Let future quests explicitly recognize relevant prior knowledge.
 * - Keep discovery records separate from inventory and rewards.
 * - Do not migrate incidental historical chat prose into authoritative data.
 *
 * PARTIAL — Rumor arrival and closure contracts
 * - Automatic confirmed-arrival resolution implemented for the existing
 *   benign, already-cleared, and genuine-hook outcomes; regression pending.
 * - Preserve locked inquiries and defer offers while the quest slot is busy.
 * - IMPLEMENTED — BETA PENDING: rumor resolution is arrival-driven; the
 *   obsolete manual investigate_lead operation and narration path are removed.
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
 * - Multiple offers are stored and survive reload.
 * - Multiple quests may be accepted; accepting another offer preserves an
 *   already in-progress activeQuest selection. Journal records remain
 *   authoritative and new mechanics use stable quest IDs.
 * - Quest actions and FOUND discovery progression address stable quest IDs;
 *   discovery events do not temporarily change the activeQuest selection.
 *   Beta verification remains pending.
 * - Cancelled quests remain in history and receive no rewards.
 * - Arrival selects quest identity from the destination and progresses it
 *   by stable quest ID without changing the activeQuest selection.
 * - Arrival result arrays preserve independently affected quests.
 * - Cleared linked combat selects its quest by the encounter's locked quest
 *   and target IDs, then restores the previous compatibility selection.
 * - Automatic return travel uses a unique eligible journal quest; multiple
 *   possible returns require an explicit destination choice.
 * - Scene context includes every relevant accepted quest at the location.
 * - Quest-site inspection and discovery reconciliation now address explicit
 *   quest IDs instead of advancing the compatibility-selected quest.
 * - Reconciliation and site-inspection narration resolve their quest by the
 *   result's stable quest ID. Remaining activeQuest-dependent narration still
 *   needs migration.
 * - Arrival integration implemented; live verification pending.
 * - The next integration pass must select quest identity from destination,
 *   authored discovery, encounter linkage, or delivery quest ID.
 * - Offer preparation targets the newly generated quest directly; retrieval
 *   and V2 discovery preparation helpers take explicit quest arguments.
 * - Quests tab renders all journal offers with ID-bound acceptance/decline.
 * - Rumor arrivals create journal offers immediately, preserving selection.
 * - The journal is authoritative after JSON loading. Reconnect activeQuest
 *   to its journal record; never overwrite journal progress with a stale
 *   compatibility selection. Import genuinely journal-less legacy quests once.
 * - Linked-combat completion progresses the encounter's locked quest ID
 *   without temporarily changing the selected quest.
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
 * IMPLEMENTED — BETA PENDING: Cleared-pack quest breadcrumbs
 * - A qualifying pack's existing breadcrumb roll creates a durable,
 *   engine-ID'd clue at the saved fight position, independent of the
 *   replaceable current encounter.
 * - The player may pursue it there through ordinary fiction; the GM
 *   reports the engine-issued ID, and the extension generates one offer.
 * - Finding, pursuing, offering, and accepting remain separate events.
 *   No Inspect button or extra journey is required.
 * - Lore, hazards, and chests are separate outcomes to design later;
 *   this breadcrumb currently means a possible quest offer only.
 *
 * TENTATIVE — Diegetic opportunities and conditional connections
 * - Aspirational vision: quests are relatively rare discoveries, not a
 *   settlement quest board or an exclamation mark over every NPC. Wandering,
 *   combat breadcrumbs, rumors, local discoveries, conversation, and prior
 *   help can each reveal opportunities. Several small chances may combine
 *   into a lively world without making every conversation yield a quest.
 * - The crew's actions can change what a local person is willing to share:
 *   helping a worker might reveal a friend's concern; discovering a ruin
 *   might make a local scholar interested in speaking. Carry such facts as
 *   saved knowledge or stable events, not as assumed LLM memory.
 * - Do not require players to exhaust endless NPC dialogue or guess an exact
 *   keyword. Meaningful engagement may reveal an eligible opening; an NPC
 *   without one can still be worth talking to.
 * - The engine decides whether an opportunity exists, its prerequisites,
 *   objective, rank, rewards, and one-time identity. The narrator handles
 * conversation and local presentation, not quest generation.
 *
 * - IMPLEMENTED — BETA PENDING: while at a settlement, the narrator
 *   receives the private ASK_WORK reporting rule even without a queued
 *   event. Previously checked contacts and their saved results are
 *   supplied again for relevant resumed conversations.
 * - Beta-sized first step: implement one or two authored local connections
 *   with explicit saved prerequisites and one-time reveal. Do not build a
 *   settlement-wide relationship simulation or weighted variable web.
 * - Keep routine F work discoverable by asking around if play needs a
 *   fallback, without making a quest board mandatory. A multi-step social
 *   unlock should not automatically spend its payoff on a random F errand.
 *
 * - IMPLEMENTED — BETA PENDING: successful ASK_WORK checks lock a quest
 *   under the contact without exposing it in the journal. The GM receives
 *   that saved result on a relevant later reply; after describing the
 *   request, REVEAL_WORK publishes the same offer without another roll.
 * - Publishing an offer is not accepting a quest, completing an objective,
 *   or paying a reward. Repeated reports do not reroll or republish it.
 *
 * - IMPLEMENTED — BETA PENDING: ASK_WORK reports an interaction without
 *   a GM-chosen ID. The extension derives the inquiry ID from the saved
 *   assistant message and scopes its result to the current settlement.
 * - Inquiry identity excludes temporary system handoffs from the saved
 *   assistant-message position, so received/rendered notifications cannot
 *   change its ID merely because the handoff was removed. Verify both
 *   notification orders during beta.
 * - Message identity does not identify a fictional NPC across different
 *   conversations. Reusing an engine-issued contact ID for a recurring
 *   person remains a GM reporting obligation until NPC continuity has
 *   its own identity contract.
 * - No predetermined roster, interaction button, or guaranteed quest.
 * - Delayed handshake: player acts; the GM narrates only what is already
 *   known and privately reports an eligible interaction; the extension
 *   resolves and saves it after that reply; the NEXT relevant GM reply
 *   receives the result. Never promise an unrolled job in the first reply.
 * - This timing boundary also applies to future vendor stock, consequential
 *   site interactions, and other results the engine cannot supply midway
 *   through a reply. Saved state, not a <template> note or one-use packet,
 *   remains authoritative if the conversation resumes later.
 * - Beta starting odds for social job inquiries: first checked contact at
 *   a settlement 1-in-2; later contacts 1-in-10; at most two offers from
 *   this channel per settlement. A successful first check weights F work
 *   three times as strongly as E for an Unknown crew; it guarantees neither.
 * - Social offer packets identify a contact as a possible referral to the
 *   locked sponsor, not necessarily the quest giver. Tune scarcity and
 *   introductory rank weighting during beta.
 * - Do not transmit or score every line of NPC dialogue yet. Add narrowly
 *   defined interaction events only when a concrete mechanic needs them.
 * - Tune opportunity frequency and the need for an F fallback during beta;
 *   quest scarcity is intentional, but an empty-feeling world is not.
 *
 * - Do not transmit or score every line of NPC dialogue yet. Add narrowly
 *   defined interaction events only when a concrete mechanic needs them.
 * - Tune opportunity frequency and the need for an F fallback during beta;
 *   quest scarcity is intentional, but an empty-feeling world is not.
 *
 * DEFERRED — Fictional continuity and relevant-context retrieval
 * - Chat metadata could retain concise, source-linked facts established in
 *   play: recurring NPC details, settlement events, relationships, and
 *   relevant clues. Do not save every NPC or every line of dialogue.
 * - Keep GM-reported fictional continuity separate from engine-authoritative
 *   mechanics and from unverified NPC claims.
 * - Supply a compact settlement recap on a relevant return, or a specific
 *   old clue when a new opportunity explicitly references it. Do not inject
 *   the entire history into every prompt or depend solely on name matching.
 * - Establish stable NPC identity, fact-update rules, source links, and
 *   retrieval limits before accepting GM-written continuity records.
 * - This is not part of the current social-work ID repair or beta-start
 *   requirement.
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
 * DEFERRED — Forward-moving zones and portable discoveries
 * - Each zone is its own level-band ecosystem: Zone 1 covers levels 1–5,
 *   Zone 2 covers 6–10, and so on. Local quests, rumors, NPCs, and dungeon
 *   entrances stay in the zone where they were established.
 * - The intended pace is a few quests, levels, and selected rumors before
 *   moving forward—not exhausting every opportunity in a zone.
 * - Leaving an opportunity behind does not move it to the next zone,
 *   scale up its old encounters, or impose a return trip.
 * - World foregrounds open rumors in the current zone and shows older-zone
 *   rumors in collapsed, read-only history. This is a display rule only:
 *   departure does not cancel quests or delete unresolved records.
 * - Earlier-zone rumors remain read-only history, and earlier settlements
 *   are not ordinary World travel targets. Accepted quests may still expose
 *   their own earlier-zone destination or issuer return; the player chooses
 *   whether to pursue or cancel that quest.
 * - A later-zone continuation should create a new local opportunity informed
 *   by portable Crew Knowledge, not require travel back to old content.
 * - Portable Crew Knowledge can give later, locally playable opportunities
 *   continuity. Carry forward what the crew learned, not an unfinished
 *   destination or a requirement to remember its NPCs.
 * - A later-zone continuation needs its own local site, appropriate
 *   difficulty, and satisfying objective. Earlier clues may enrich it
 *   but must not be required homework for players who missed them.
 * - Travel roll 97 remains social opportunity; 98–100 currently resolve
 *   as quiet travel. A possible future roll-100 result is a saved,
 *   exceptional current-zone location, such as a one-time dungeon.
 * - Do not enable that result until its destination and arrival contracts
 *   exist. Do not impose a per-zone cap before play shows one is needed.
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
 * - New offers require complete V2 structures; legacy template slicing
 *   is not a fallback for newly generated quests.
 * - New-offer scenarios are geography-neutral premises; saved zone geography
 *   is presentation context. Mechanical special requirements belong in the
 *   authored V2 structure, not dormant legacy gate templates.
 * - Quest family defines the job; rank defines its stakes and reward;
 *   gate count defines its length. More gates alone do not mean harder work.
 * - Gate variants must fit the family and preserve its objective. A
 *   non-combat quest remains non-combat; do not add fights to simulate rank.
 * - Narration may invent names, scenery, and local dressing, but the engine
 *   owns rank, objective, gates, threats, encounters, and rewards.
 * - Non-combat mechanical difficulty is intentionally unresolved. Do not
 *   treat extra narration or a dramatic name as mechanical challenge.
 * - Existing saved quests retain their locked gates and progress.
 * - Discovery, linked-combat, and delivery paths use the V2 structures;
 *   full campaign-flow verification remains for beta.
 *
 * BETA POLICY
 * Use this division for now. During beta testing, tighten specific failure
 * points based on observed behavior instead of adding speculative protocol
 * complexity or handing quest design back to the narrator.
 */

const QUEST_ARCHETYPES = [
     /*
     * New cargo offers use causal variants, not prewritten local geography.
     * The selected premise and mechanical requirements are locked here.
     * The narrator may name and dress the consignment, transport, and site
     * to fit saved zone geography, but may not add a required encounter,
     * gate, item, reward, or change the locked destination.
     */
    {
        id: 'recover_cargo',
        label: 'Recover Cargo',
        scenarios: [
            {
                variantId: 'abandoned_transport',
                pitch:
                    'A shipment was left behind when its transport failed. ' +
                    'The issuer wants the consignment recovered.',
                truth:
                    'The transport failed and its crew left the cargo at the ' +
                    'last known stopping place.',
                facts: {
                    sponsor: 'the local shipping office',
                    cargo: 'the missing consignment',
                    place: 'the abandoned transport site',
                    evidence: 'signs of the failed transport',
                    obstacle: 'an obstructed route to the cargo'
                }
            },
            {
                variantId: 'diverted_shipment',
                pitch:
                    'A shipment was diverted from its intended route. ' +
                    'The issuer wants the consignment recovered.',
                truth:
                    'The cargo was deliberately moved away from its ' +
                    'scheduled transfer point.',
                facts: {
                    sponsor: 'the local shipping office',
                    cargo: 'the missing consignment',
                    place: 'the diversion site',
                    evidence: 'a discrepancy in the shipment record',
                    obstacle: 'the cargo is concealed from ordinary view'
                }
            },
            {
                variantId: 'stolen_shipment',
                pitch:
                    'A shipment was stolen in transit. The issuer wants ' +
                    'the consignment recovered.',
                truth:
                    'The thieves concealed the cargo at a separate site.',
                facts: {
                    sponsor: 'the local shipping office',
                    cargo: 'the missing consignment',
                    place: 'the suspected hiding place',
                    evidence: 'signs of the cargo’s removal',
                    obstacle: 'the cargo is hidden within the site'
                }
            }
        ]
    },

    {
        id: 'ruin_clearance',
        label: 'Ruin Clearance',
         /*
         * Premises identify why the site needs clearing. The engine locks
         * the linked encounter; local architecture and appearance come
         * from the saved zone context, not a biome-specific quest table.
         */
        scenarios: [
            {
                ranks: ['D', 'C', 'B'],
                pitch:
                    'A disused structure beside a working route has become ' +
                    'unsafe. The route keepers need the threat removed.',
                truth:
                    'A hostile group has occupied the structure and is ' +
                    'using it to control the nearby route.',
                facts: {
                    sponsor: 'the local route keepers',
                    site: 'the disused route structure',
                    threat: 'the occupying hostile group',
                    evidence: 'fresh signs of occupation and repeated passage',
                    obstacle: 'an approach watched from within the site'
                }
            },
            {
                ranks: ['E', 'D'],
                pitch:
                    'Workers can no longer use an old work site. Their ' +
                    'sponsor needs its dangerous occupants cleared.',
                truth:
                    'A hostile group has made the site its shelter.',
                facts: {
                    sponsor: 'the local work crew',
                    site: 'the disused work site',
                    threat: 'the occupying hostile group',
                    evidence: 'recent activity at the old entrance',
                    obstacle: 'an approach exposed to the occupants'
                }
            },
             {
                ranks: ['F'],
                pitch:
                    'Small nuisance creatures have settled in an unused ' +
                    'work area. The local crew wants the space cleared.',
                truth:
                    'A small group of nuisance creatures is occupying the area.',
                facts: {
                    sponsor: 'the local work crew',
                    site: 'the unused work area',
                    threat: 'the nuisance creatures',
                    evidence: 'signs of a small group nesting there',
                    obstacle: 'the creatures must be cleared from the work area'
                }
            },
            {
                ranks: ['C', 'B'],
                pitch:
                    'An essential passage through an old structure has ' +
                    'become unsafe. The passage must be cleared.',
                truth:
                    'A territorial threat is holding the passage.',
                facts: {
                    sponsor: 'the local passage wardens',
                    site: 'the old passage structure',
                    threat: 'the territorial threat',
                    evidence: 'fresh tracks through the passage',
                    obstacle: 'a confined approach to the occupied section'
                }
            }
        ]
    },
      /*
     * Herb requests are selected by stakes, not biome. These are generic
     * mechanical identities; the narrator may give the plant and site
     * setting-appropriate names without changing the locked harvest or
     * inventing a threat. Delivery remains outside the field gate count.
     */
    {
        id: 'herb_foraging',
        label: 'Herb Foraging',
        scenarios: [
            {
                ranks: ['F'],
                pitch: 'A supplier needs a small, ordinary plant harvest.',
                truth: 'The requested plants are available at the identified gathering area.',
                facts: {
                    sponsor: 'the local supplier',
                    herb: 'a bundle of common gathering plants',
                    place: 'the nearby gathering area',
                    need: 'routine supplies',
                    stakes: 'common plants for ordinary stock',
                    obstacle: 'ordinary care is needed to gather them intact'
                }

            },
            {
                ranks: ['E', 'D'],
                pitch: 'A healer needs a medicinal plant for a patient.',
                truth: 'A usable patch remains at the identified gathering area.',
                facts: {
                    sponsor: 'the local healer',
                    herb: 'a usable medicinal plant harvest',
                    place: 'the identified gathering area',
                    need: 'treatment for a patient',
                    stakes: 'a scarce remedy needed for a patient',
                    obstacle: 'the usable plants must be identified and gathered intact'
                }
            },
            {
                ranks: ['C', 'B'],
                pitch: 'A settlement healer needs an essential medicinal harvest before existing supplies run out.',
                truth: 'The needed plants can be found at the identified gathering area, but the usable harvest requires careful collection.',
                facts: {
                    sponsor: 'the settlement healer',
                    herb: 'the essential medicinal harvest',
                    place: 'the identified gathering area',
                    need: 'an essential local treatment',
                    stakes: 'an urgent harvest for an essential local treatment',
                    obstacle: 'the usable harvest must be gathered without spoiling it'
                }
            }
        ]
    },

    /*
     * Missing Person variants lock the situation and objective structure,
     * not a particular road, landscape, or local culture. The narrator may
     * supply names and setting details using the current zone context.
     */
    {
        id: 'missing_person',
        label: 'Missing Person Search',
        scenarios: [
            {
                variantId: 'lost',
                ranks: ['D'],
                pitch:
                    'A person failed to return from a routine journey, and ' +
                    'their sponsor wants the crew to find them.',
                truth:
                    'The traveler lost the route and is waiting at a nearby ' +
                    'sheltered place.',
                facts: {
                    sponsor: 'the missing person’s concerned relative',
                    person: 'the missing traveler',
                    place: 'the last known location',
                    evidence: 'signs left along the traveler’s route',
                    obstacle: 'the traveler’s trail becomes difficult to follow'
                }
            },
            {
                variantId: 'abducted',
                ranks: ['C', 'B'],
                pitch:
                    'A person was taken from a known route. Their sponsor ' +
                    'wants the crew to find and recover them.',
                truth:
                    'A hostile group is holding the person at a nearby site.',
                facts: {
                    sponsor: 'the missing person’s local sponsor',
                    person: 'the abducted person',
                    place: 'the last known location',
                    evidence: 'signs showing where the person was taken',
                    obstacle: 'the group holding the person'
                }
            }
        ],
        gates: []
    },

      {
        id: 'territorial_beast',
        label: 'Territorial Beast Hunt',
        /*
         * These variants establish animal behavior and a linked threat,
         * not a species or landscape. The narrator may describe the
         * engine-created Elite to fit the zone without changing its stats.
         */
               scenarios: [
            {
                ranks: ['F'],
                pitch:
                    'A small nuisance animal has been disrupting a ' +
                    'local work area.',
                truth:
                    'The animal has repeatedly returned to the work area.',
                facts: {
                    sponsor: 'the local work crew',
                    beast: 'the nuisance animal',
                    place: 'the affected work area',
                    evidence: 'repeated signs of the animal’s visits',
                    obstacle: 'the animal keeps returning to the work area'
                }
            },
            {
                ranks: ['D', 'C', 'B'],
                pitch:
                    'A territorial animal has driven people from a ' +
                    'regularly used route.',
                truth:
                    'The animal has established a defended territory ' +
                    'around a nearby shelter.',
                facts: {
                    sponsor: 'the local route warden',
                    beast: 'the territorial animal',
                    place: 'the affected route',
                    evidence: 'repeated territorial signs along the route',
                    obstacle: 'the animal’s defended approach'
                }
            },
            {
                ranks: ['E', 'D', 'C'],
                pitch:
                    'An animal is threatening a place local workers ' +
                    'depend on.',
                truth:
                    'The animal has begun treating the area as its ' +
                    'regular hunting ground.',
                facts: {
                    sponsor: 'the affected local workers',
                    beast: 'the dangerous animal',
                    place: 'the affected work area',
                    evidence: 'fresh signs of repeated animal activity',
                    obstacle: 'the animal’s established hunting path'
                }
            }
        ],
   }
];

/*
 * Sunken Salvage and its fixed-site discoveries are retired from new
 * offers. Beta will start from reset state; remove their dormant catalog
 * and helper code after the remaining archetypes have been converted.
 */

/*
 * Quest eligibility depends on stakes and supported mechanics, not biome.
 * Saved zone geography remains available to the narrator for scenery,
 * names, and gradual transitions; it does not exclude an objective.
 */
function eligibleQuestScenarios(_state, archetype, _zone, rank) {
    return (archetype.scenarios || []).filter(scenario => {
        if (
            Array.isArray(scenario.ranks) &&
            !scenario.ranks.includes(rank)
        ) {
            return false;
        }

        // F offers are limited to explicitly authored menial scenarios.
        if (rank === 'F') {
            return [
                'herb_foraging',
                'ruin_clearance',
                'territorial_beast'
            ].includes(archetype.id) &&
                scenario.ranks?.includes('F') === true;
        }

        if (archetype.id !== 'missing_person') return true;

        if (scenario.variantId === 'lost') return rank === 'D';
        if (scenario.variantId === 'abducted') {
            return rank === 'C' || rank === 'B';
        }

        return false;
    });
}

function eligibleQuestArchetypes(state, zone, rank) {
    return QUEST_ARCHETYPES
        .map(archetype => ({
            archetype,
            scenarios: eligibleQuestScenarios(
                state,
                archetype,
                zone,
                rank
            )
        }))
        .filter(entry => entry.scenarios.length > 0);
}

function buildQuestFacts(
    state,
    archetype,
    zone,
    eligibleScenarios,
    rank
) {

    assert(
        eligibleScenarios.length > 0,
        `Quest archetype ${archetype.id} has no scenario compatible with Zone ${zone}`
    );

    let variantRoll = null;
    let variantId =
        archetype.variantId ||
        eligibleScenarios[0].variantId ||
        null;

    let scenarios = eligibleScenarios;

    if (
        archetype.id === 'recover_cargo' ||
        archetype.id === 'missing_person'
    ) {
        const variants = [
            ...new Set(
                eligibleScenarios.map(scenario => scenario.variantId)
            )
        ];

        assert(
            variants.every(id => typeof id === 'string' && id.length > 0),
            `${archetype.label} scenarios need authored variantId values`
        );

        variantRoll = roll(state, variants.length);
        variantId = variants[variantRoll - 1];

        scenarios = eligibleScenarios.filter(
            scenario => scenario.variantId === variantId
        );
    }

    const scenarioRoll = roll(state, scenarios.length);
    const scenario = scenarios[scenarioRoll - 1];

    assert(
        scenario &&
        typeof scenario.pitch === 'string' &&
        scenario.facts &&
        typeof scenario.facts === 'object',
        `Quest archetype ${archetype.id} has an invalid scenario`
    );

    const facts = clone(scenario.facts);
    const stakesByArchetype = {
        recover_cargo: {
            E: 'ordinary supplies needed for routine local work',
            D: 'valuable property whose loss harms its local owner',
            C: 'essential supplies needed by the community',
            B: 'region-critical cargo whose loss disrupts several communities'
        },
        ruin_clearance: {
            F: 'a nuisance disrupting one ordinary work area',
            E: 'a limited danger disrupting one local worksite',
            D: 'a threat preventing important local work or travel',
            C: 'a danger disrupting an essential community route or service',
            B: 'a major threat affecting routes or work across the region'
        },
        territorial_beast: {
            F: 'a nuisance animal disrupting routine local work',
            E: 'an animal nuisance affecting a limited local area',
            D: 'a dangerous animal threatening regular local travel or work',
            C: 'a threat disrupting an essential route or community activity',
            B: 'a territorial threat affecting travel or work across the region'
        },
        missing_person: {
            D: 'one lost person whose safe return matters to their local sponsor',
            C: 'one abducted person held by a hostile group',
            B: 'an abducted person whose loss has serious consequences beyond one household'
        }
    };

    const rankStakes = stakesByArchetype[archetype.id]?.[rank];

    if (rankStakes) {
        facts.stakes = rankStakes;
    }

    if (archetype.id === 'recover_cargo') {
        assert(
            rankStakes,
            `Recover Cargo has no authored stakes for rank ${rank}`
        );
    }

    return {
        variantRoll,
        variantId: scenario.variantId || variantId,
        scenarioRoll,
        pitch: scenario.pitch,
        truth: scenario.truth,
        facts
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
 * New offers are created from these complete structures, and their
 * progression resolves through arrival, discovery, and linked-combat
 * events. Existing saves are reset before beta, so retired catalog
 * archetypes and their fixed-site preparation code are not retained.
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

    rescue_person: {
        lost: {
            2: ['approach', 'find_person'],
            3: ['approach', 'track', 'find_person']
        },
        abducted: {
            3: ['approach', 'track', 'defeat'],
            4: ['approach', 'track', 'reach_lair', 'defeat'],
            5: ['approach', 'track', 'reach_lair', 'find_person', 'defeat']
        }
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
            trigger: 'discovery',
            objective: 'Find the authored way into the inner recovery area.'
        },
        find_access: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Find the authored means of accessing the item.'
        },
        recover: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Locate and recover the required item.',
            decisive: true
        }
    },
        rescue_person: {
        approach: {
            mode: 'traversal_discovery',
            trigger: 'arrival',
            objective: 'Reach the person’s last known location.'
        },
        track: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Follow the authored evidence of the missing person’s route.'
        },
        reach_lair: {
            mode: 'traversal_discovery',
            trigger: 'discovery',
            objective: 'Find the authored way to the abductors’ location.'
        },
        find_person: {
            mode: 'brain_social_heist',
            trigger: 'discovery',
            objective: 'Find the missing person and establish their situation.'
        },
        defeat: {
            mode: 'combat_twist_showdown',
            trigger: 'linked_combat',
            objective: 'Defeat the threat holding the missing person.',
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
            trigger: 'discovery',
            objective: 'Find the authored route to the target’s lair.'
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
        plan.family === 'rescue_person'
            ? QUEST_V2_STRUCTURES.rescue_person[
                plan.variantId
              ]?.[plan.gateCount]
            : QUEST_V2_STRUCTURES[plan.family][plan.gateCount];

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
    const variantId =
        family === 'rescue_person'
            ? facts.rescueVariant
            : null;

    const sequence =
        family === 'rescue_person'
            ? QUEST_V2_STRUCTURES.rescue_person[
                variantId
              ]?.[gateCount]
            : QUEST_V2_STRUCTURES[family]?.[gateCount];

    assert(
        sequence,
        `No complete ${family} structure for ${gateCount} gates` +
            (variantId ? ` (${variantId})` : '')
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
        rescue_person: {
            approach:
                () => `Reach ${fact('place')} safely.`,
            track:
                () => `Follow the established signs of ${fact('person')}'s route.`,
            reach_lair:
                () => `Find the way to where ${fact('person')} is held.`,
            find_person:
                () => `Find ${fact('person')} and establish their situation.`,
            defeat:
                () => `Defeat the threat holding ${fact('person')}.`
        },
        defeat_elite: {
            approach:
                () => `Reach ${fact('territory')} safely.`,
            track:
                () => `Follow the authored evidence of ${fact('target')}'s route.`,
            reach_lair:
                () => `Reach ${fact('target')}'s lair at ${fact('lair')}.`,
            find_target:
                () => `Locate ${fact('target')} using the authored signs.`,
            defeat:
                () => `Defeat the engine-linked threat: ${fact('target')}.`
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
            decisive:
                definition.decisive === true ||
                (
                    family === 'rescue_person' &&
                    variantId === 'lost' &&
                    stage === 'find_person'
                )
        };
    });

    return validateQuestV2Structure({
        version: 2,
        family,
        variantId,
        gateCount,
        gates
    });
}

function buildQuestV2PlanForOffer(
    state,
    archetype,
    gateCount,
    facts,
    variantId = null
) {
    /*
     * Recover Cargo is the canonical V2 family. Keep the legacy IDs as
     * compatibility aliases until existing saved quests are migrated.
     * Variant identity remains separate from the mechanical family.
     */
    const familyByArchetype = {
        recover_cargo: 'retrieve_item',
        territorial_beast: 'defeat_elite',
        ruin_clearance: 'defeat_elite'
    };

    const family =
        archetype.id === 'herb_foraging'
            ? 'retrieve_item'
            : archetype.id === 'missing_person'
                ? 'rescue_person'
                : familyByArchetype[archetype.id];

    if (!family) return null;
    let v2Facts;

    if (archetype.id === 'recover_cargo') {
        v2Facts = {
            item: facts.cargo,
            destination: facts.place
        };
    } else if (archetype.id === 'herb_foraging') {

        v2Facts = {
            item: facts.herb,
            destination: facts.place
        };
    } else if (archetype.id === 'missing_person') {
        v2Facts = {
            person: facts.person,
            place: facts.place,
            evidence: facts.evidence,
            variantId
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

    const structureFacts =
        family === 'rescue_person'
            ? {
                ...v2Facts,
                rescueVariant: variantId
            }
            : v2Facts;

    if (family === 'rescue_person') {
        const validGateCounts =
            variantId === 'lost' ? [2, 3] :
            variantId === 'abducted' ? [3, 4, 5] :
            [];

        assert(
            validGateCounts.includes(gateCount),
            `Missing Person variant ${variantId} does not support ${gateCount} gates`
        );
    }

    const structure = buildQuestV2Structure(
        family,
        gateCount,
        structureFacts
    );

    return {
        ...structure,
        facts: clone(v2Facts)
    };
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
        'abandoned',
        'cancelled'
    ]) {
        state.quests[bucket] ||= [];

        assert(
            Array.isArray(state.quests[bucket]),
            `state.quests.${bucket} must be an array`
        );
    }

    const active = state.activeQuest;

    if (
        active &&
        typeof active === 'object' &&
        typeof active.id === 'string'
    ) {
        const journalQuest = Object.values(state.quests)
            .flatMap(bucket => bucket)
            .find(quest => quest?.id === active.id);

        if (journalQuest) {
            /*
             * JSON reload may separate these objects. The journal owns
             * quest progress; reconnect the selected compatibility pointer
             * to its record rather than overwriting the record with a
             * potentially stale selection.
             */
            state.activeQuest = journalQuest;
        } else {
            /*
             * Import a genuinely journal-less legacy selected quest once.
             * Do not recreate an unsupported/retired quest as an offer.
             */
            const bucket = questJournalBucketForStatus(
                active.status
            );

            if (bucket) {
                state.quests[bucket].push(active);
            }
        }
    }

    return state.quests;
}

function questJournalBucketForStatus(status) {
    return {
        offered: 'offered',
        in_progress: 'accepted',
        complete: 'completed',
        declined: 'declined',
        abandoned: 'abandoned',
        cancelled: 'cancelled'
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

    if (state.activeQuest?.id === quest.id) {
        state.activeQuest = quest;
    }

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

    const inquiryRecord = test.inquiryId !== undefined
        ? state.inquiries?.[`rumor:${test.inquiryId}`]
        : test.socialId !== undefined
            ? state.socialOpportunities?.contacts?.[
                `${issuerSettlement.id}:${test.socialId}`
              ]
            : null;

    const breadcrumb = test.breadcrumbId !== undefined
        ? state.breadcrumbs?.[test.breadcrumbId]
        : null;

    assert(
        [
            test.inquiryId,
            test.socialId,
            test.breadcrumbId
        ].filter(value => value !== undefined).length <= 1,
        'Quest offer requires only one named trigger'
    );

    assert(
        (test.inquiryId === undefined &&
            test.socialId === undefined) ||
            inquiryRecord,
        'Unknown locked quest trigger'
    );

    assert(
        test.breadcrumbId === undefined || breadcrumb,
        'Unknown saved breadcrumb'
    );

    const namedTrigger = inquiryRecord || breadcrumb;

    if (namedTrigger) {
        assert(
            zone === namedTrigger.zone,
            'Quest zone does not match its locked trigger'
        );
    }

    if (breadcrumb) {
        assert(
            breadcrumb.settlementId === issuerSettlement.id,
            'Breadcrumb issuer does not match its saved settlement'
        );
    }

    const trigger = namedTrigger || state.encounter;

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
    /*
     * Reputation defines the permitted ranks; geography and authored
     * scenarios determine which of those ranks can actually be offered.
     * Never consume a quest trigger by rolling an impossible rank.
     */
    const availableRanks = rep.ranks
        .map(rank => ({
            rank,
            archetypes: eligibleQuestArchetypes(state, zone, rank)
        }))
        .filter(entry => entry.archetypes.length > 0);

    assert(
        availableRanks.length > 0,
        `No authored quest offers are available for Zone ${zone} ` +
            `at ${rep.label} reputation`
    );

    /*
     * A settlement's first successful conversational work inquiry gives
     * routine F work extra weight, not a guarantee. Other triggers and
     * later contacts use the ordinary reputation-permitted rank pool.
     * Repeat entries affect this rank roll only; archetype and scenario
     * selection still use their existing eligible pools.
     */
    const firstSocialCheck =
        test.socialId !== undefined &&
        state.socialOpportunities?.settlements?.[
            issuerSettlement.id
        ]?.checks === 1;

    const rankPool =
        firstSocialCheck &&
        availableRanks.some(entry => entry.rank === 'F')
            ? [
                ...availableRanks,
                ...Array(2).fill(
                    availableRanks.find(entry => entry.rank === 'F')
                )
            ]
            : availableRanks;

    const questRoll =
        roll(state, rankPool.length);

    const selectedRank =
        rankPool[questRoll - 1];

    const gateCountRoll =
        roll(state, 2);

    const salvageSlotRoll =
        roll(state, QUEST_SALVAGE_SLOTS.length);

    const rank = selectedRank.rank;

    const row =
        QUEST_REWARD_TABLES[zone][rank];

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

    // Use the exact eligible pool that made this rank selectable.
    const eligibleArchetypes = selectedRank.archetypes;
    const archetypeRoll = roll(state, eligibleArchetypes.length);
    const selectedArchetype =
        eligibleArchetypes[archetypeRoll - 1];
    const archetype = selectedArchetype.archetype;
    const authored = buildQuestFacts(
        state,
        archetype,
        zone,
        selectedArchetype.scenarios,
        rank
    );

    const structureV2 = buildQuestV2PlanForOffer(
        state,
        archetype,
        gates,
        authored.facts,
        authored.variantId
    );

    /*
     * Every archetype eligible for a new offer must supply a complete V2
     * structure. Never fall back to slicing legacy templates: doing so
     * could omit the decisive objective from a newly generated quest.
     * Existing saved quests retain their already-locked gate records.
     */
    assert(
        structureV2?.version === 2 &&
        Array.isArray(structureV2.gates) &&
        structureV2.gates.length === gates,
        `New quest archetype ${archetype.id} lacks a complete V2 plan`
    );

    const questGatesData = clone(structureV2.gates);
    const seed = {
        zone,
        repTier: rep.label,
        questRoll,
        gateCountRoll,
        salvageSlotRoll,
        archetypeRoll,
        archetypeId: archetype.id,
        variantRoll: authored.variantRoll,
        variantId: authored.variantId,
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
            `quest-${
                breadcrumb
                    ? breadcrumb.id
                    : inquiryRecord
                        ? test.socialId !== undefined
                            ? `social-${issuerSettlement.id}-${inquiryRecord.id}`
                            : `rumor-${inquiryRecord.id}`
                        : state.encounter.id
            }-${row.rank}-${questRoll}-${archetype.id}`,
        title:
            `Rank ${row.rank} ${archetype.label}`,
        rank: row.rank,
        archetype: {
            id: archetype.id,
            label: archetype.label
        },
        variant: authored.variantId
            ? { id: authored.variantId }
            : null,
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

        /*
         * Keep the rank-selected threat. V2 links the encounter to the
         * objective, but does not require every linked threat to be an
         * Elite; F/E use normal packs, D/C may roll a pack or Elite, and
         * B uses an Elite as established by rollQuestTerminalThreat().
         */

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
     * Preparation targets this newly created quest directly. It must not
     * change the compatibility selection or depend on activeQuest identity.
     * Defeat-elite discoveries are prepared after acceptance.
     */
    prepareRecoverCargoDiscovery(quest);
    prepareHerbForagingDiscovery(quest);
    prepareV2QuestDiscoveries(quest);
    validateRetrievalQuestDiscoveries(quest);

    trigger.questSeedConsumed = true;

    if (breadcrumb) {
        breadcrumb.questId = quest.id;

        if (state.encounter?.id === breadcrumb.encounterId) {
            state.encounter.questSeedConsumed = true;
        }
    }

    return {
        ok: true,
        created: true,
        quest,
        state
    };
  }
}

/*
 * Retrieval offers must be complete when created. Validate their authored
 * requirements before consuming the trigger or saving the offer.
 *
 * This validates new offers only. Existing saved quests retain their locked
 * records and are not rewritten or rerolled by this check.
 */
function validateRetrievalQuestDiscoveries(quest) {
    if (quest.structureV2?.family !== 'retrieve_item') {
        return;
    }

    const discoveries = quest.discoveries || [];

    for (const gate of quest.gatesData) {
        if (gate.trigger !== 'discovery') continue;

        const discovery = discoveries.find(
            item => item.id === gate.requiredDiscoveryId
        );

        assert(
            discovery,
            `Retrieval gate ${gate.step} has no authored discovery`
        );

        assert(
            discovery.locationId === quest.destinationId &&
            typeof discovery.hidingPlace === 'string' &&
            discovery.hidingPlace.trim().length > 0 &&
            typeof discovery.significance === 'string' &&
            discovery.significance.trim().length > 0,
            `Retrieval gate ${gate.step} has incomplete discovery details`
        );

        assert(
            gate.requiredDiscoveryState === 'acquired' &&
            discovery.acquisitionPolicy === 'auto_on_reveal',
            `Retrieval gate ${gate.step} has incompatible acquisition rules`
        );
    }

    const finalGate = quest.gatesData.at(-1);
    const cargo = discoveries.find(
        item => item.id === quest.turnIn?.discoveryId
    );

    assert(
        finalGate?.stage === 'recover' &&
        finalGate.decisive === true &&
        cargo?.kind === 'quest_item' &&
        finalGate.requiredDiscoveryId === cargo.id,
        'Retrieval quest must recover and deliver the same authored cargo'
    );
}

function prepareRecoverCargoDiscovery(quest) {
    if (
        quest?.archetype?.id !== 'recover_cargo' ||
        quest.structureV2?.family !== 'retrieve_item' ||
        !quest.destinationId
    ) {
        return null;
    }

    const variants = {
        abandoned_transport: {
            clue: 'Signs of the failed transport',
            inner: 'Way through the transport obstruction',
            access: 'Access to the abandoned load'
        },
        diverted_shipment: {
            clue: 'Shipment-route discrepancy',
            inner: 'Way to the diverted consignment',
            access: 'Access to the concealed load'
        },
        stolen_shipment: {
            clue: 'Signs of the cargo’s removal',
            inner: 'Way into the suspected hiding place',
            access: 'Access to the hidden consignment'
        }
    };

    const variant = variants[quest.variant?.id];

    assert(
        variant,
        `Recover Cargo has no authored variant: ${quest.variant?.id}`
    );
    assert(
        quest.turnIn && typeof quest.turnIn === 'object',
        'Recover Cargo has no locked turn-in'
    );

    quest.discoveries ||= [];

    const definitions = {
        locate: {
            suffix: 'cargo-clue',
            kind: 'evidence',
            name: variant.clue,
            hidingPlace:
                `${quest.facts.evidence} at ${quest.facts.place}`,
            significance:
                `The clue identifies where ${quest.facts.cargo} can be found.`
        },
        reach_inner_site: {
            suffix: 'inner-route',
            kind: 'evidence',
            name: variant.inner,
            hidingPlace: `within ${quest.facts.place}`,
            significance:
                `The route gets past ${quest.facts.obstacle}.`
        },
        find_access: {
            suffix: 'cargo-access',
            kind: 'evidence',
            name: variant.access,
            hidingPlace:
                `near the consignment at ${quest.facts.place}`,
            significance:
                `This gives access to ${quest.facts.cargo}.`
        },
        recover: {
            suffix: 'recovered-cargo',
            kind: 'quest_item',
            name: quest.facts.cargo,
            hidingPlace:
                `at ${quest.facts.place}, beyond ${quest.facts.obstacle}`,
            significance:
                `This is the consignment owed to ${quest.turnIn.recipient}.`,
            requiredAction: 'recover_cargo',
            questCargo: true
        }
    };

    for (const gate of quest.gatesData) {
        if (gate.trigger !== 'discovery') continue;

        const definition = definitions[gate.stage];
        assert(
            definition,
            `Recover Cargo has no discovery for ${gate.stage}`
        );

        const id = `${quest.id}-${definition.suffix}`;
        let discovery = quest.discoveries.find(
            item => item.id === id
        );

        if (!discovery) {
            discovery = {
                id,
                kind: definition.kind,
                name: definition.name,
                locationId: quest.destinationId,
                state: 'hidden',
                acquisitionPolicy: 'auto_on_reveal',
                hidingPlace: definition.hidingPlace,
                significance: definition.significance,
                ...(definition.requiredAction
                    ? { requiredAction: definition.requiredAction }
                    : {}),
                ...(definition.questCargo
                    ? { questCargo: true }
                    : {})
            };
            quest.discoveries.push(discovery);
        }

        gate.requiredDiscoveryId = id;
        gate.requiredDiscoveryState = 'acquired';

        if (quest.currentGate?.step === gate.step) {
            quest.currentGate.requiredDiscoveryId = id;
            quest.currentGate.requiredDiscoveryState = 'acquired';
        }
    }

    const cargoId = `${quest.id}-recovered-cargo`;
    assert(
        !quest.turnIn.discoveryId ||
        quest.turnIn.discoveryId === cargoId,
        'Recover Cargo turn-in points to another discovery'
    );

    quest.turnIn.discoveryId = cargoId;

    return quest.discoveries.find(
        item => item.id === cargoId
    );
}

function prepareHerbForagingDiscovery(quest) {
    if (
        quest?.archetype?.id !== 'herb_foraging' ||
        quest.structureV2?.family !== 'retrieve_item' ||
        !quest.destinationId
    ) {
        return null;
    }

    assert(
        quest.turnIn && typeof quest.turnIn === 'object',
        'Herb Foraging has no locked turn-in record'
    );

    quest.discoveries ||= [];

    const herbName = quest.facts.herb;
    const place = quest.facts.place;
    const obstacle = quest.facts.obstacle;

    const definitions = {
        locate: {
            suffix: 'growing-signs',
            kind: 'evidence',
            name: `Growing signs of ${herbName}`,
            hidingPlace: `among the growing signs at ${place}`,
            significance:
                `These signs identify where ${herbName} can be gathered.`
        },
        reach_inner_site: {
            suffix: 'safe-approach',
            kind: 'evidence',
            name: 'Way to the usable plants',
            hidingPlace: `within ${place}`,
            significance:
                `The approach accounts for ${obstacle} and reaches the harvest.`
        },
        find_access: {
            suffix: 'harvest-method',
            kind: 'evidence',
            name: `Usable way to harvest ${herbName}`,
            hidingPlace: `at the harvest within ${place}`,
            significance:
                `The plants can be gathered without ruining the harvest.`
        },

        recover: {
            suffix: 'harvested-herb',
            kind: 'quest_item',
            name: herbName,
            hidingPlace: place,
            significance:
                `The gathered herb is required by ${quest.turnIn.recipient}.`,
            requiredAction: 'gather_herb',
            questCargo: true
        }
    };

    for (const gate of quest.gatesData) {
        const definition = definitions[gate.stage];
        if (!definition || gate.trigger !== 'discovery') continue;

        const id = `${quest.id}-${definition.suffix}`;
        let discovery = quest.discoveries.find(
            item => item.id === id
        );

        if (!discovery) {
            discovery = {
                id,
                kind: definition.kind,
                name: definition.name,
                locationId: quest.destinationId,
                state: 'hidden',
                acquisitionPolicy: 'auto_on_reveal',
                hidingPlace: definition.hidingPlace,
                significance: definition.significance,
                ...(definition.requiredAction
                    ? { requiredAction: definition.requiredAction }
                    : {}),
                ...(definition.questCargo
                    ? { questCargo: true }
                    : {})
            };
            quest.discoveries.push(discovery);
        }

        gate.requiredDiscoveryId = id;
        gate.requiredDiscoveryState = 'acquired';

        if (quest.currentGate?.step === gate.step) {
            quest.currentGate.requiredDiscoveryId = id;
            quest.currentGate.requiredDiscoveryState = 'acquired';
        }
    }

    const herbId = `${quest.id}-harvested-herb`;
    assert(
        quest.discoveries.some(item => item.id === herbId),
        'Herb Foraging has no final harvest discovery'
    );

    assert(
        !quest.turnIn.discoveryId ||
        quest.turnIn.discoveryId === herbId,
        'Herb Foraging turn-in points to a different discovery'
    );

    quest.turnIn.discoveryId = herbId;
    return quest.discoveries.find(item => item.id === herbId);
}

 function prepareV2QuestDiscoveries(quest) {
    const family = quest?.structureV2?.family;

    if (
        quest?.status !== 'in_progress' ||
        !['defeat_elite', 'rescue_person'].includes(family) ||
        !quest.destinationId
    ) {
        return null;
    }

    quest.discoveries ||= [];

    function bind(stage, definition) {
        const gate = quest.gatesData.find(
            entry =>
                entry.stage === stage &&
                entry.trigger === 'discovery'
        );

        if (!gate) return null;

        const id = `${quest.id}-${definition.suffix}`;
        let discovery = quest.discoveries.find(
            item => item.id === id
        );

        if (!discovery) {
            discovery = {
                id,
                kind: 'evidence',
                name: definition.name,
                locationId: quest.destinationId,
                state: 'hidden',
                acquisitionPolicy: 'auto_on_reveal',
                hidingPlace: definition.hidingPlace,
                significance: definition.significance
            };
            quest.discoveries.push(discovery);
        }

        gate.requiredDiscoveryId = id;
        gate.requiredDiscoveryState = 'acquired';

        if (quest.currentGate?.step === gate.step) {
            quest.currentGate.requiredDiscoveryId = id;
            quest.currentGate.requiredDiscoveryState = 'acquired';
        }

        return discovery;
    }

    const target =
        family === 'rescue_person'
            ? quest.facts.person
            : quest.structureV2.facts.target;

    const trail = bind('track', {
        suffix: 'target-trail',
        name: `Fresh signs of ${target}`,
        hidingPlace:
            quest.facts?.evidence ||
            'among the recent signs at the quest site',
        significance:
            `The signs show the route taken by ${target}.`
    });
    if (family === 'defeat_elite') {
        /*
         * Longer structures stay at the established quest destination.
         * These are local discoveries, not repeat arrivals or new map nodes.
         * Finding the target reveals the linked fight through clear_gate;
         * it does not engage or defeat that encounter.
         */
        const targetName = quest.structureV2.facts.target;

        const lair = bind('reach_lair', {
            suffix: 'lair-route',
            name: `Route to ${targetName}'s lair`,
            hidingPlace:
                quest.facts?.evidence ||
                'among the signs at the quest site',
            significance:
                `The signs establish a route through ${quest.facts?.obstacle || 'the site'} toward ${targetName}.`
        });

        const foundTarget = bind('find_target', {
            suffix: 'target-location',
            name: `Location of ${targetName}`,
            hidingPlace:
                `at ${quest.structureV2.facts.lair}`,
            significance:
                `The signs establish where ${targetName} can be confronted.`
        });

        return trail || lair || foundTarget;
    }

    const variantId = quest.variant?.id;

    assert(
        variantId === 'lost' || variantId === 'abducted',
        'Missing Person requires a saved lost or abducted variant'
    );

    const lair = bind('reach_lair', {
        suffix: 'holding-place',
        name: `Way to ${target}'s holding place`,
        hidingPlace: `along the trail beyond ${quest.facts.place}`,
        significance:
            `The signs establish a way past ${quest.facts.obstacle}.`
    });

    const person = bind('find_person', {
        suffix: 'missing-person',
        name: `Found ${target}`,
        hidingPlace:
            variantId === 'lost'
                ? `beyond ${quest.facts.evidence}`
                : `at the established holding place beyond ${quest.facts.place}`,
        significance:
            variantId === 'lost'
                ? `${target} is alive and can return to ${quest.turnIn.recipient}.`
                : `${target} is alive, but the linked threat still holds them.`
    });

    return person || trail || lair;
}


function advanceQuestFromDiscovery(state, discovery, questId) {
    assert(
        typeof questId === 'string' &&
        questId.length > 0,
        'Discovery progression requires an explicit questId'
    );

    const quest = findQuestById(state, questId);
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
            questId,
            action: 'clear_gate',
            objectiveCompleted: true,
            completionEvidence: evidence
        });

                return {
            state: progression.state,
            questGate: {
                questId: quest.id,
                completed: progression.completedGate,
                next: progression.nextGate,
                linkedEncounter: progression.linkedEncounter || null
            }
        };
    }

    if (quest.objectiveResolution) {
        return { state, questGate: null };
    }

    const progression = resolveQuestAction({
        state,
        questId,
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

    const updatedQuest = findQuestById(
        progression.state,
        questId
    );
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
            label: updatedQuest.turnIn.discoveryId
                ? `Return cargo to ${updatedQuest.turnIn.recipient}`
                : `Report to ${updatedQuest.turnIn.recipient}`,
            claim: updatedQuest.turnIn.discoveryId
                ? 'The recovered quest cargo is ready to return.'
                : 'The completed field objective is ready to report.',
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
    ensureQuestJournal(state);

    assert(
        typeof test.questId === 'string' &&
        test.questId.length > 0,
        'Quest discovery reconciliation requires a questId'
    );

    const quest = findQuestById(
        state,
        test.questId
    );

    assert(
        quest?.status === 'in_progress',
        `Quest ${test.questId} is not in progress`
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
        questId: quest.id,
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
        questId: quest.id,
        questGate: {
            completed: progression.completedGate,
            next: progression.nextGate
        },

        state: progression.state
    };
}

function findQuestByDiscoveryId(state, discoveryId) {
    assert(
        typeof discoveryId === 'string' &&
        discoveryId.length > 0,
        'Quest discovery requires a stable discovery ID'
    );

    const journal = ensureQuestJournal(state);
    const matches = journal.accepted.filter(
        quest =>
            quest?.status === 'in_progress' &&
            quest.discoveries?.some(
                discovery => discovery.id === discoveryId
            )
    );

    assert(
        matches.length <= 1,
        `Discovery ${discoveryId} belongs to multiple quests`
    );

    return matches[0] || null;
}

function resolveQuestEvent(test) {
    assert(
        test.state &&
        typeof test.state === 'object',
        'Quest event requires state'
    );

    const state = clone(test.state);
    ensureQuestJournal(state);

    const quest =
        test.questId !== undefined
            ? findQuestById(state, test.questId)
            : findQuestByDiscoveryId(state, test.questItemId);

    assert(
        quest?.status === 'in_progress',
        test.questId !== undefined
            ? `Quest ${test.questId} is not in progress`
            : `No in-progress quest owns discovery ${test.questItemId}`
    );

    return resolveSelectedQuestEvent({
        ...test,
        questId: quest.id,
        state
    });
}


function resolveSelectedQuestEvent(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Quest event requires state'
    );

    const state = clone(test.state);
    ensureQuestJournal(state);

    assert(
        typeof test.questId === 'string' &&
        test.questId.length > 0,
        'Quest event requires an explicit questId'
    );

    const quest = findQuestById(state, test.questId);

    assert(
        quest?.status === 'in_progress',
        `Quest ${test.questId} is not in progress`
    );

    assert(
        ['searched', 'found'].includes(test.event),
        `Unsupported quest discovery event: ${test.event}`
    );

    /*
     * Older saved Missing Cargo quests may reach the recovery gate
     * without its authored cargo ID copied onto currentGate. Re-run the
     * idempotent preparation after selecting the owning quest so the
     * search action can be authorized and validated.
     */
    if (quest.archetype?.id === 'recover_cargo') {
        prepareRecoverCargoDiscovery(quest);
    }

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
            questId: quest.id,
            questItemId: discovery.id,
            quest: clone(quest),
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

    const progression = advanceQuestFromDiscovery(
        state,
        discovery,
        quest.id
    );

    const updatedQuest = findQuestById(
        progression.state,
        quest.id
    );

    const updatedDiscovery = updatedQuest?.discoveries?.find(
        item => item.id === discovery.id
    );

    assert(
        updatedQuest && updatedDiscovery,
        `Discovery progression lost quest ${quest.id} or item ${discovery.id}`
    );

    /*
     * Crew Knowledge records what was actually exposed, not hidden quest
     * preparation or a SEARCHED prerequisite. The discovery ID makes this
     * observation stable across duplicate notifications and reloads.
     */
    recordCrewKnowledge(progression.state, {
        id: `knowledge-quest-discovery-${updatedDiscovery.id}`,
        kind: 'quest_discovery',
        knowledgeType: 'observation',
        certainty: 'engine_established',
        summary:
            `Found ${updatedDiscovery.name}. ${updatedDiscovery.significance}`,
        source: {
            id: quest.id,
            type: 'quest'
        },
        learnedAtLocationId: updatedDiscovery.locationId,
        learnedAtZone:
            progression.state.places?.[updatedDiscovery.locationId]?.zone ??
            progression.state.zone
    });

    return {
        ok: true,
        created: true,
        action: 'quest_event',
        event: 'found',
        questId: quest.id,
        quest: clone(updatedQuest),
        discovery: clone(updatedDiscovery),
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
    /*
     * Multiple accepted quests are part of the campaign model. The journal
     * owns their independent identity and state. activeQuest remains only
     * as a compatibility selection while arrival, discovery, combat, and
     * delivery are migrated to explicit quest lookup.
     */
    if (test.action === 'accept') {
        assert(
            quest.status === 'offered',
            `Quest cannot be accepted from status ${quest.status}`
        );
    }

    /*
     * Progression is authorized by the journal quest ID above.
     * activeQuest remains a UI/compatibility selection, not ownership
     * of a discovery or encounter event.
     */

    assert(
        [
            'accept',
            'decline',
            'abandon',
            'cancel',
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
        const selectedQuestIsInProgress =
            state.activeQuest?.status === 'in_progress';

        registerQuestDestination(state, quest);
        quest.status = 'in_progress';

        /*
         * Accepting another offer must not change the compatibility
         * selection away from an already in-progress quest. The journal
         * remains authoritative; new mechanics use quest IDs.
         */
        if (!selectedQuestIsInProgress) {
            state.activeQuest = quest;
        }
        if (quest.structureV2?.version === 2) {
            prepareRecoverCargoDiscovery(quest);
            prepareHerbForagingDiscovery(quest);
            prepareV2QuestDiscoveries(quest);

            for (const gate of quest.gatesData) {
                if (gate.trigger !== 'discovery') continue;

                const discovery = quest.discoveries?.find(
                    item => item.id === gate.requiredDiscoveryId
                );

                assert(
                    discovery &&
                    gate.requiredDiscoveryState === 'acquired' &&
                    discovery.locationId === quest.destinationId &&
                    discovery.acquisitionPolicy === 'auto_on_reveal' &&
                    typeof discovery.hidingPlace === 'string' &&
                    discovery.hidingPlace.trim().length > 0 &&
                    typeof discovery.significance === 'string' &&
                    discovery.significance.trim().length > 0,
                    `Quest ${quest.id} has no complete authored discovery for gate ${gate.step}`
                );
            }
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

     if (
        test.action === 'abandon' ||
        test.action === 'cancel'
    ) {
        assert(
            !['active', 'spotted'].includes(
                state.encounter?.status
            ),
            'Resolve, avoid, or flee the encounter before cancelling the quest'
        );

        quest.status =
            test.action === 'cancel'
                ? 'cancelled'
                : 'abandoned';

        quest.cancelledAtGate =
            test.action === 'cancel'
                ? quest.currentGate?.step || null
                : undefined;

        quest.abandonedAtGate =
            test.action === 'abandon'
                ? quest.currentGate?.step || null
                : undefined;

        quest.abandonReason =
            test.action === 'abandon'
                ? test.reason || null
                : undefined;

        quest.cancelReason =
            test.action === 'cancel'
                ? test.reason || null
                : undefined;

        /*
         * Dropping a quest also stops travel undertaken for its field
         * objective. Preserve the actual position along the saved route.
         * Shared settlement return travel remains independent, and another
         * accepted quest at the same destination may still justify the trip.
         */
        const journey = state.currentJourney;
        const anotherQuestUsesDestination =
            state.quests.accepted.some(entry =>
                entry.id !== quest.id &&
                entry.status === 'in_progress' &&
                !entry.objectiveResolution &&
                entry.destinationId === journey?.destinationId
            );

        if (
            journey &&
            (
                journey.questId === quest.id ||
                (
                    !journey.questId &&
                    journey.destinationId === quest.destinationId &&
                    !anotherQuestUsesDestination
                )
            )
        ) {
            state.currentPosition = positionAfterSegments(
                journeyLegs(journey),
                journey.completedSegments
            ) || state.currentPosition || {
                nodeId: state.currentLocationId
            };

            state.currentJourney = null;
        }

        saveQuestToJournal(state, quest);

        for (const lead of Object.values(state.leads || {})) {
            if (
                lead.id === `quest-return-${quest.id}` ||
                lead.id === `quest-lead-${quest.id}`
            ) {
                lead.status = 'resolved';
            }
        }

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
            ['defeat_elite', 'rescue_person']
                .includes(quest.structureV2?.family)
        ) {

            const spawned = spawnEncounter({
                state,
                questId: quest.id,
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
        const stepsPerTier = QUEST_REPUTATION_STEPS_PER_TIER;

        int(rep.steps, `${town} reputation steps`);
        assert(
            rep.steps < stepsPerTier ||
                rung === tierOrder.length - 1,
            `${town} reputation steps must be below ${stepsPerTier}`
        );

        let steps = rep.steps + payout.repSteps;

        while (
            steps >= stepsPerTier &&
            rung < tierOrder.length - 1
        ) {
            steps -= stepsPerTier;
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

/*
 * The GM reports that the crew asked to see wares. The engine identifies
 * that report by its saved assistant message and opens a read-only catalog
 * for the settlement the crew actually occupies. Repeated notifications
 * for the same message do not create another mechanics revision.
 *
 * Opening stock is not a purchase, item grant, or equipment change.
 */
function resolveVendorMenuOpen(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Showing wares requires saved state'
    );

    const state = clone(test.state);

    assert(
        typeof test.socialId === 'string' &&
        /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
        'Showing wares requires an engine-issued message reference'
    );

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'The crew must be free to speak at a saved settlement'
    );

    if (state.vendorMenu?.settlementId === settlement.id) {
        // Another request to view this shop must not erase a staged quote.
        return {
            ok: true,
            created: false,
            action: 'open',
            settlementId: settlement.id,
            state
        };
    }

    state.vendorMenu = {
        settlementId: settlement.id,
        inquiryId: test.socialId,
        pendingBasket: null
    };

    return {
        ok: true,
        created: true,
        action: 'open',
        settlementId: settlement.id,
        state
    };
}

/*
 * A staged trade is a quote, not a transaction. Preserve exactly which
 * stock options and owned items were selected, along with a snapshot of
 * the owned items. A later commit must revalidate everything against
 * current state; a saved quote is never authority to grant an item.
 */
function resolveVendorSelection(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Vendor selection requires saved state'
    );

    const state = clone(test.state);
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.id === state.vendorMenu?.settlementId &&
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'Trade selection requires presence at the open shop'
    );

    if (test.action === 'discard') {
        state.vendorMenu.pendingBasket = null;

        return {
            ok: true,
            action: 'discard',
            state
        };
    }

    assert(
        test.action === 'stage',
        `Unsupported vendor selection action: ${test.action}`
    );

    const basket = test.basket;

    assert(
        basket &&
        Array.isArray(basket.buy) &&
        Array.isArray(basket.sell) &&
        basket.buy.length + basket.sell.length > 0,
        'Select at least one item to stage a trade'
    );

    const stock = resolveVendorAction({
        action: 'stock',
        zone: state.zone,
        state
    });

    const seenBuys = new Set();
    const seenSales = new Set();

    const buy = basket.buy.map(choice => {
        const entry = stock.catalog.find(
            item => item.number === choice.number
        );

        assert(entry, `Unknown shop row ${choice.number}`);
        assert(
            entry.variants.some(option =>
                option.variant === choice.variant
            ),
            `Invalid tuning for shop row ${choice.number}`
        );

        const key = `${entry.owner}:${entry.slot}`;

        assert(
            !seenBuys.has(key),
            `Select only one replacement for ${key}`
        );

        seenBuys.add(key);

        return {
            number: entry.number,
            owner: entry.owner,
            slot: entry.slot,
            variant: choice.variant,
            price: entry.price
        };
    });

    const sell = basket.sell.map(choice => {
        const key = choice.location === 'worn'
            ? `worn:${choice.owner}:${choice.slot}`
            : `bag:${choice.index}`;

        assert(!seenSales.has(key), `Duplicate sale: ${key}`);
        seenSales.add(key);

        const item = choice.location === 'worn'
            ? state.crew.gear?.[choice.owner]?.[choice.slot]
            : choice.location === 'bag'
                ? state.inventory?.bagReserves?.[choice.index]
                : null;

        assert(
            item &&
            Number.isInteger(item.rawStat ?? item.stat) &&
            (item.rawStat ?? item.stat) > 0,
            `Selected item is unavailable: ${key}`
        );

        return {
            location: choice.location,
            ...(choice.location === 'worn'
                ? { owner: choice.owner, slot: choice.slot }
                : { index: choice.index }),
            item: clone(item),
            proceeds: 2 * (item.rawStat ?? item.stat)
        };
    });

    const cost = buy.reduce(
        (total, item) => total + item.price,
        0
    );
    const proceeds = sell.reduce(
        (total, item) => total + item.proceeds,
        0
    );
    const purseAfter = state.crew.purse + proceeds - cost;

    assert(
        purseAfter >= 0,
        `Trade would leave the crew ${-purseAfter}s short`
    );

    /*
     * Buying an equal-or-worse item remains forbidden unless the
     * currently worn item in that slot is part of this exchange.
     */
    for (const choice of buy) {
        const wornStat = Number(
            state.crew.gear?.[choice.owner]?.[choice.slot]?.stat || 0
        );
        const sellingWorn = sell.some(item =>
            item.location === 'worn' &&
            item.owner === choice.owner &&
            item.slot === choice.slot
        );

        assert(
            sellingWorn || wornStat < stock.stat,
            `${choice.owner} ${choice.slot} already meets the vendor floor`
        );
    }

    state.vendorMenu.pendingBasket = {
        id: `${state.vendorMenu.inquiryId}-trade`,
        settlementId: settlement.id,
        zone: state.zone,
        buy,
        sell,
        cost,
        proceeds,
        purseBefore: state.crew.purse,
        purseAfter
    };

    return {
        ok: true,
        action: 'stage',
        basket: clone(state.vendorMenu.pendingBasket),
        state
    };
}

/*
 * A trade is committed only after the fictional agreement is reported.
 * Re-stage the saved choices against CURRENT state: the staged quote is
 * never authority for prices, possession, equipment, or available silver.
 * All changes happen on one clone and are saved as one operation.
 *
 * The assistant-message ID identifies the agreement event. Repeated
 * received/rendered notifications return its saved receipt without
 * transferring items or silver twice.
 */
function resolveVendorTradeCommit(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Trade agreement requires saved state'
    );

    const state = clone(test.state);

    assert(
        typeof test.socialId === 'string' &&
        /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
        'Trade agreement requires an engine-issued message reference'
    );

    state.vendorTradeReceipts ||= {};

    const previousReceipt =
        state.vendorTradeReceipts[test.socialId];

    if (previousReceipt) {
        return {
            ok: true,
            created: false,
            action: 'commit',
            receipt: clone(previousReceipt),
            state
        };
    }

    const pending = state.vendorMenu?.pendingBasket;

    assert(
        pending &&
        Array.isArray(pending.buy) &&
        Array.isArray(pending.sell),
        'No staged trade awaits agreement'
    );

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.id === pending.settlementId &&
        entry.id === state.vendorMenu.settlementId &&
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone &&
        pending.zone === state.zone
    );

    assert(
        settlement &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'The crew must still be at the shop to complete this trade'
    );

    /*
     * Use the existing staging validator to re-price and re-identify
     * the basket. Compare its complete quote, including item snapshots,
     * before changing any possession or silver.
     */
    const checked = resolveVendorSelection({
        state,
        action: 'stage',
        basket: {
            buy: pending.buy.map(item => ({
                number: item.number,
                variant: item.variant
            })),
            sell: pending.sell.map(item =>
                item.location === 'worn'
                    ? {
                        location: 'worn',
                        owner: item.owner,
                        slot: item.slot
                    }
                    : {
                        location: 'bag',
                        index: item.index
                    }
            )
        }
    });

    assert(
        JSON.stringify(checked.basket) === JSON.stringify(pending),
        'Trade selection changed; reopen the shop and stage it again'
    );

    let working = checked.state;
    const beforeStats = derived(working.crew);
    const purseBefore = working.crew.purse;
    const sold = pending.sell.map(choice => ({
        name: choice.item.name || 'Unnamed gear',
        location: choice.location,
        owner: choice.owner || null,
        slot: choice.slot || null,
        proceeds: choice.proceeds
    }));

    for (const choice of pending.sell.filter(
        item => item.location === 'worn'
    )) {
        delete working.crew.gear[choice.owner][choice.slot];
    }

    for (const choice of pending.sell
        .filter(item => item.location === 'bag')
        .sort((a, b) => b.index - a.index)) {
        working.inventory.bagReserves.splice(choice.index, 1);
    }

    /*
     * Sale proceeds can fund purchases in the same exchange. Purchases
     * still go through the existing authoritative vendor item builder.
     * None of these intermediate clones is saved separately.
     */
    working.crew.purse += pending.proceeds;

    const bought = [];

    for (const choice of pending.buy) {
        const purchase = resolveVendorAction({
            state: working,
            action: 'buy',
            zone: pending.zone,
            owner: choice.owner,
            slot: choice.slot,
            variant: choice.variant
        });

        working = purchase.state;
        bought.push(clone(purchase.item));
    }

    assert(
        working.crew.purse === pending.purseAfter,
        'Trade purse does not match the validated quote'
    );

    const afterStats = derived(working.crew);

    /*
     * Selling worn gear changes derived stats immediately on commit.
     * Preserve the existing equip rule: adjust current HP by the change
     * in maximum HP, then clamp. Purchases stay in Bag Reserves.
     */
    working.crew.qtik.hp = Math.max(
        0,
        Math.min(
            afterStats.qtikMaxHp,
            working.crew.qtik.hp +
                afterStats.qtikMaxHp - beforeStats.qtikMaxHp
        )
    );

    working.crew.tansy.hp = Math.max(
        0,
        Math.min(
            afterStats.tansyMaxHp,
            working.crew.tansy.hp +
                afterStats.tansyMaxHp - beforeStats.tansyMaxHp
        )
    );

    working.crew.qtik.maxHp = afterStats.qtikMaxHp;
    working.crew.qtik.def = afterStats.def;
    working.crew.qtik.regen = afterStats.regen;
    working.crew.tansy.maxHp = afterStats.tansyMaxHp;

    const receipt = {
        id: test.socialId,
        settlementId: settlement.id,
        bought,
        sold,
        cost: pending.cost,
        proceeds: pending.proceeds,
        purseBefore,
        purseAfter: working.crew.purse,
        derivedBefore: beforeStats,
        derivedAfter: afterStats
    };

    working.vendorMenu.pendingBasket = null;
    working.vendorTradeReceipts[test.socialId] = clone(receipt);

    return {
        ok: true,
        created: true,
        action: 'commit',
        receipt,
        state: working
    };
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
                        variant => {
                            const fallback =
                                `${definition.owner === 'qtik'
                                    ? "Q'tik"
                                    : 'Tansy'} ` +
                                `${ZONE_LOOT_MATERIALS[zone]} ` +
                                `${variantTitle(variant) || ''} ` +
                                `${slotNames[definition.slot]}`
                                    .replace(/\s+/g, ' ')
                                    .trim();

                            return {
                                variant,
                                label: variantTitle(variant),
                                displayName:
                                    cosmeticStockName(
                                        state,
                                        gearCosmeticStockKey(
                                            definition.owner,
                                            definition.slot,
                                            variant
                                        ),
                                        fallback
                                    ),
                                bonus: lootBonus(
                                    definition.owner,
                                    definition.slot,
                                    variant,
                                    stat
                                )
                            };
                        }
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

    const fallbackName = nameParts.join(' ');

    const item = {
        name: cosmeticStockName(
            state,
            gearCosmeticStockKey(
                test.owner,
                test.slot,
                variant
            ),
            fallbackName
        ),

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
/*
 * A healing bottle's ID includes its PURCHASE zone. Its healing and price
 * are fixed from that ID, never recalculated from the crew's current zone
 * or maximum HP. The GM may give it a local cosmetic name, but cannot
 * change its mechanical grade or effect.
 *
 * Ungraded IDs remain readable as Zone 1 bottles for the current chat.
 * Cleansing Tonic retains its existing fixed utility effect and price.
 */
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
        heal: 0,
        buyPrice: 14,
        sellPrice: 3
    }
};

function consumableDefinition(id) {
    if (CONSUMABLE_CATALOG[id]) {
        return CONSUMABLE_CATALOG[id];
    }

    const match = typeof id === 'string'
        ? /^(basic|mid)_health_potion_z([1-9]\d*)$/.exec(id)
        : null;

    if (!match) return null;

    const zone = Number(match[2]);

    if (!Number.isSafeInteger(zone) || !ZONES[zone]) {
        return null;
    }

    const basic = match[1] === 'basic';

    return {
        name:
            `${basic ? 'Basic' : 'Mid-Tier'} Health Potion ` +
            `(${basic ? 50 * zone : 120 * zone} HP)`,
        type: 'potion',
        heal: (basic ? 50 : 120) * zone,
        buyPrice: (basic ? 10 : 20) * zone,
        sellPrice: (basic ? 2 : 5) * zone,
        purchaseZone: zone
    };
}

function herbalistStock(zone) {
    int(zone, 'herbalist zone', 1);

    const ids = [
        `basic_health_potion_z${zone}`,
        `mid_health_potion_z${zone}`,
        'cleansing_tonic'
    ];

    return ids.map(id => ({
        id,
        ...consumableDefinition(id)
    }));
}

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
            consumableDefinition(entry.id),
            'Consumable inventory entry has an unknown item ID'
        );

        int(
            entry.quantity,
            `${entry.id}.quantity`,
            1
        );
    }
}

/*
 * The herbalist has its own staged basket. Selection is not payment.
 * Prices, ownership, and funds are recalculated at agreement time.
 * A message-derived receipt prevents a duplicate assistant notification
 * from applying the exchange twice. No potion is equipped or used here.
 */
function resolveHerbalistAction(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Herbalist interaction requires saved state'
    );

    const state = clone(test.state);
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'Herbalist trade requires presence at a free settlement'
    );

    state.herbalistMenu ||= null;
    state.herbalistReceipts ||= {};

    if (test.action === 'open') {
        assert(
            typeof test.socialId === 'string' &&
            /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
            'Herbalist opening requires an engine-issued message reference'
        );

        if (state.herbalistMenu?.settlementId === settlement.id) {
            return {
                ok: true, created: false, action: 'open', state
            };
        }

        state.herbalistMenu = {
            settlementId: settlement.id,
            inquiryId: test.socialId,
            pendingBasket: null
        };

        return { ok: true, created: true, action: 'open', state };
    }

    if (test.action === 'commit') {
        assert(
            typeof test.socialId === 'string' &&
            /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
            'Herbalist agreement requires an engine-issued message reference'
        );

        const previous = state.herbalistReceipts[test.socialId];

        if (previous) {
            return {
                ok: true,
                created: false,
                action: 'commit',
                receipt: clone(previous),
                state
            };
        }
    }

    assert(
        state.herbalistMenu?.settlementId === settlement.id,
        'No herbalist window is open at this settlement'
    );

    if (test.action === 'discard') {
        state.herbalistMenu.pendingBasket = null;
        return { ok: true, action: 'discard', state };
    }

    const pending = state.herbalistMenu.pendingBasket;
    const selection = test.action === 'commit'
        ? pending?.choices
        : test.basket?.choices;

    assert(
        ['stage', 'commit'].includes(test.action) &&
        Array.isArray(selection),
        'Herbalist trade requires a selection'
    );

    normalizeConsumableInventory(state.inventory);

    const seen = new Set();
    const choices = selection.map(choice => {
        assert(
            choice && ['buy', 'sell'].includes(choice.side) &&
            typeof choice.id === 'string',
            'Invalid herbalist choice'
        );

        const quantity = int(
            choice.quantity,
            'Herbalist quantity',
            1
        );

        const key = `${choice.side}:${choice.id}`;
        assert(!seen.has(key), `Duplicate herbalist choice: ${key}`);
        seen.add(key);

        const definition = consumableDefinition(choice.id);
        assert(definition, `Unknown consumable: ${choice.id}`);

        if (choice.side === 'buy') {
            assert(
                herbalistStock(state.zone).some(item =>
                    item.id === choice.id
                ),
                `The herbalist does not sell ${choice.id} here`
            );
        } else {
            const owned = state.inventory.consumables.find(item =>
                item.id === choice.id
            );

            assert(
                owned && owned.quantity >= quantity,
                `Not enough ${choice.id} to sell`
            );
        }

        const displayName = cosmeticStockName(
            state,
            potionCosmeticStockKey(choice.id),
            definition.name
        );

        return {
            side: choice.side,
            id: choice.id,
            quantity,
            name: displayName,
            unitPrice: choice.side === 'buy'
                ? definition.buyPrice
                : definition.sellPrice
        };
    });

    assert(choices.length > 0, 'Select at least one potion');

    const cost = choices
        .filter(choice => choice.side === 'buy')
        .reduce((total, choice) =>
            total + choice.unitPrice * choice.quantity, 0
        );

    const proceeds = choices
        .filter(choice => choice.side === 'sell')
        .reduce((total, choice) =>
            total + choice.unitPrice * choice.quantity, 0
        );

    const purseBefore = int(state.crew.purse, 'crew purse');
    const purseAfter = purseBefore + proceeds - cost;

    assert(
        purseAfter >= 0,
        `Herbalist trade would leave the crew ${-purseAfter}s short`
    );

    const quote = {
        settlementId: settlement.id,
        zone: state.zone,
        choices,
        cost,
        proceeds,
        purseBefore,
        purseAfter
    };

    if (test.action === 'stage') {
        state.herbalistMenu.pendingBasket = quote;
        return {
            ok: true,
            action: 'stage',
            basket: clone(quote),
            state
        };
    }

    assert(
        JSON.stringify(pending) === JSON.stringify(quote),
        'Herbalist selection changed; reopen and stage it again'
    );

    /*
     * This is one cloned state. If any check fails, runStoredMechanic()
     * saves none of the sales, purchases, or silver changes.
     */
    for (const choice of choices.filter(item =>
        item.side === 'sell'
    )) {
        const entry = state.inventory.consumables.find(item =>
            item.id === choice.id
        );

        entry.quantity -= choice.quantity;

        if (entry.quantity === 0) {
            state.inventory.consumables =
                state.inventory.consumables.filter(item =>
                    item.id !== choice.id
                );
        }
    }

    for (const choice of choices.filter(item =>
        item.side === 'buy'
    )) {
        let entry = state.inventory.consumables.find(item =>
            item.id === choice.id
        );

        if (!entry) {
            const definition = consumableDefinition(choice.id);
            entry = {
                id: choice.id,
                name: choice.name,
                type: definition.type,
                quantity: 0,
                recipient: null
            };
            state.inventory.consumables.push(entry);
        }

        entry.quantity += choice.quantity;
    }

    state.crew.purse = purseAfter;

    const receipt = {
        id: test.socialId,
        ...quote
    };

    state.herbalistMenu.pendingBasket = null;
    state.herbalistReceipts[test.socialId] = clone(receipt);

    return {
        ok: true,
        created: true,
        action: 'commit',
        receipt,
        state
    };
}

/*
 * Ordinary inn prices establish the civilian economy and do not scale
 * with zone. These are expenses, not food buffs, healing, lodging recovery,
 * or elapsed-time mechanics. The GM dresses the purchased service locally;
 * its saved ID and price remain engine-owned.
 */
const INN_SERVICES = [
    { id: 'standard_meal', label: 'Standard filling fare', price: 1 },
    { id: 'better_meal', label: 'Better meal', price: 3 },
    { id: 'special_meal', label: 'Special meal', price: 5 },
    { id: 'common_room', label: 'Common-room bed', price: 1 },
    { id: 'private_room', label: 'Private room', price: 2 },
    { id: 'luxurious_room', label: 'Luxurious room', price: 5 },
    { id: 'hot_water', label: 'Hot water', price: 2 }
];

function resolveInnAction(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Inn interaction requires saved state'
    );

    const state = clone(test.state);
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement &&
        !state.currentJourney &&
        !['active', 'spotted'].includes(state.encounter?.status),
        'Inn services require presence at a free settlement'
    );

    state.innReceipts ||= {};

    /*
     * Check receipts before inspecting the current menu. Replayed
     * assistant notifications must not charge again, even after the
     * crew leaves the settlement.
     */
    if (test.action === 'commit') {
        assert(
            typeof test.socialId === 'string' &&
            /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
            'Inn agreement requires an engine-issued message reference'
        );

        const previous = state.innReceipts[test.socialId];

        if (previous) {
            return {
                ok: true,
                created: false,
                action: 'commit',
                receipt: clone(previous),
                state
            };
        }
    }

    if (test.action === 'open') {
        assert(
            typeof test.socialId === 'string' &&
            /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
            'Inn opening requires an engine-issued message reference'
        );

        if (state.innMenu?.settlementId === settlement.id) {
            return { ok: true, created: false, action: 'open', state };
        }

        state.innMenu = {
            settlementId: settlement.id,
            inquiryId: test.socialId,
            pendingBasket: null
        };

        return { ok: true, created: true, action: 'open', state };
    }

    assert(
        state.innMenu?.settlementId === settlement.id,
        'No inn menu is open at this settlement'
    );

    if (test.action === 'discard') {
        state.innMenu.pendingBasket = null;
        return { ok: true, action: 'discard', state };
    }

    assert(
        ['stage', 'commit'].includes(test.action),
        `Unsupported inn action: ${test.action}`
    );

    const pending = state.innMenu.pendingBasket;
    const requested = test.action === 'commit'
        ? pending?.choices
        : test.basket?.choices;

    assert(
        Array.isArray(requested) && requested.length > 0,
        'Choose at least one inn service'
    );

    const seen = new Set();
    const choices = requested.map(choice => {
        assert(
            choice && typeof choice.id === 'string',
            'Invalid inn service selection'
        );

        const service = INN_SERVICES.find(
            entry => entry.id === choice.id
        );

        assert(service, `Unknown inn service: ${choice.id}`);
        assert(!seen.has(service.id),
            `Duplicate inn service: ${service.id}`);
        seen.add(service.id);

        const quantity = int(
            choice.quantity,
            `${service.id} quantity`,
            1
        );

        const isRoom = [
            'common_room',
            'private_room',
            'luxurious_room'
        ].includes(service.id);

        assert(
            quantity <= (isRoom || service.id === 'hot_water' ? 1 : 20),
            `${service.label} exceeds its allowed quantity`
        );

        return {
            id: service.id,
            label: cosmeticStockName(
                state,
                `inn:${service.id}`,
                service.label
            ),
            quantity,
            unitPrice: service.price
        };
    });

    assert(
        choices.filter(choice =>
            ['common_room', 'private_room', 'luxurious_room']
                .includes(choice.id)
        ).length <= 1,
        'Choose at most one room type per inn exchange'
    );

    const cost = choices.reduce(

        (sum, choice) =>
            sum + choice.unitPrice * choice.quantity,
        0
    );

    const purseBefore = int(state.crew.purse, 'crew purse');
    const purseAfter = purseBefore - cost;

    assert(
        purseAfter >= 0,
        `Inn services would leave the crew ${-purseAfter}s short`
    );

    const quote = {
        settlementId: settlement.id,
        choices,
        cost,
        purseBefore,
        purseAfter
    };

    if (test.action === 'stage') {
        state.innMenu.pendingBasket = quote;
        return {
            ok: true,
            action: 'stage',
            basket: clone(quote),
            state
        };
    }

    assert(
        JSON.stringify(pending) === JSON.stringify(quote),
        'Inn quote changed; reopen and stage it again'
    );

    state.crew.purse = purseAfter;
    state.innMenu.pendingBasket = null;

    const receipt = {
        id: test.socialId,
        ...quote
    };

    state.innReceipts[test.socialId] = clone(receipt);

    return {
        ok: true,
        created: true,
        action: 'commit',
        receipt,
        state
    };
}

/*
 * One cosmetic naming batch per zone, shared by its settlements.
 * Keys come from engine stock, never from the narrator. Names cannot
 * change item identity, stats, healing, price, rarity, or ownership.
 * This is also offered to an existing chat at its current settlement.
 */
function stockNamingEntries(state) {
    const gear = resolveVendorAction({
        action: 'stock',
        zone: state.zone,
        state
    }).catalog.flatMap(entry =>
        entry.variants.map(option => ({
            key:
                `gear:${entry.owner}:${entry.slot}:` +
                `${option.variant || 'standard'}`,
            description:
                `${entry.owner === 'qtik' ? "Q'tik" : 'Tansy'} ` +
                `${entry.slotName}, ${option.label || 'standard'}`
        }))
    );

    const potions = herbalistStock(state.zone)
        .filter(item => item.type === 'potion')
        .map(item => ({
            key: `potion:${item.id}`,
            description:
                `${item.id.startsWith('basic_')
                    ? 'basic'
                    : 'mid-tier'} healing potion`
        }));

    const innServices = INN_SERVICES.map(service => ({
        key: `inn:${service.id}`,
        description: service.label
    }));

    return [...gear, ...potions, ...innServices];
}

function resolveStockNames(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Stock naming requires saved state'
    );

    const state = clone(test.state);

    assert(
        test.zone === state.zone,
        'Stock names belong to the current zone'
    );

    const atSettlement = Object.values(
        state.world?.settlements || {}
    ).some(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        atSettlement && !state.currentJourney,
        'Stock naming requires arrival at a settlement'
    );

    state.cosmeticStockNames ||= {};

    const entries = stockNamingEntries(state);
    const saved =
        state.cosmeticStockNames[state.zone] || {};
    const missingEntries = entries.filter(
        entry => typeof saved[entry.key] !== 'string'
    );
    const expected = new Set(
        missingEntries.map(entry => entry.key)
    );
    const names = test.names;

    if (missingEntries.length === 0) {
        return {
            ok: true,
            created: false,
            action: 'apply',
            zone: state.zone,
            state
        };
    }

    assert(
        names && typeof names === 'object' &&
        !Array.isArray(names) &&
        Object.keys(names).length === expected.size &&
        Object.keys(names).every(key => expected.has(key)),
        'Naming reply must contain exactly the missing stock keys'
    );

    for (const [key, value] of Object.entries(names)) {
        assert(
            typeof value === 'string' &&
            value.trim().length >= 3 &&
            value.trim().length <= 60 &&
            !/[<>&\r\n]/.test(value) &&
            !/\b(?:hp|stat|silver|gold|tier)\b/i.test(value) &&
            !/\d/.test(value),
            `Invalid cosmetic stock name for ${key}`
        );
    }

    state.cosmeticStockNames[state.zone] = {
        ...saved,
        ...Object.fromEntries(
            Object.entries(names).map(([key, value]) => [
                key,
                value.trim()
            ])
        )
    };

    return {
        ok: true,
        created: true,
        action: 'apply',
        zone: state.zone,
        state
    };
}

function cosmeticStockName(state, key, fallback) {
    const name =
        state.cosmeticStockNames?.[state.zone]?.[key];

    return typeof name === 'string' && name.trim().length > 0
        ? name
        : fallback;
}

function gearCosmeticStockKey(owner, slot, variant) {
    return (
        `gear:${owner}:${slot}:` +
        `${variant || 'standard'}`
    );
}

function potionCosmeticStockKey(id) {
    return `potion:${id}`;
}

function resolveConsumableAction(test) {
    const allowedActions = [
        'stock',
        'buy',
        'sell',
        'use',
        'grant',
        'remove'
    ];

    assert(
        allowedActions.includes(test.action),
        `Unsupported consumable action: ${test.action}`
    );

    if (test.action === 'stock') {

        const zone = test.zone ?? test.state?.zone;

        assert(
            Number.isSafeInteger(zone) && ZONES[zone],
            'Herbalist stock requires a valid zone'
        );

        return {
            ok: true,
            action: 'stock',
            zone,
            catalog: herbalistStock(zone)
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

    const definition = consumableDefinition(test.item);

    assert(
        definition,
        `Unknown consumable item: ${test.item}`
    );

    if (test.action === 'buy') {
        assert(
            herbalistStock(state.zone).some(
                entry => entry.id === test.item
            ),
            'This potion grade is not sold in the current zone'
        );
    }

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
                name: cosmeticStockName(
                    state,
                    potionCosmeticStockKey(test.item),
                    definition.name
                ),
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
        result.itemName =
            state.inventory.consumables.find(
                entry => entry.id === test.item
            )?.name || definition.name;

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
        result.itemName =
            state.inventory.consumables.find(
                entry => entry.id === test.item
            )?.name || definition.name;

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

        const itemName = entry.name || definition.name;
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
        result.itemName = itemName;
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

/*
 * Variable fictional expenses use a quote-and-agreement handshake.

 * The narrator may propose a diegetic amount, but quote creation never
 * changes silver. Commit reads only the saved quote and applies it once.
 */
function resolveExpenseAction(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Expense action requires saved state'
    );

    const state = clone(test.state);
    state.expenseReceipts ||= {};

    if (test.action === 'quote') {
        assert(
            typeof test.socialId === 'string' &&
            /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
            'Expense quote requires an engine-issued message reference'
        );

        int(test.amount, 'expense quote amount', 1);
        assert(
            test.amount <= 1000000,
            'Expense quote exceeds the supported limit'
        );
        assert(
            typeof test.reason === 'string' &&
            test.reason.trim().length > 0 &&
            test.reason.trim().length <= 160,
            'Expense quote requires a brief reason'
        );

        const existing = state.pendingExpense;

        if (existing?.id === test.socialId) {
            return {
                ok: true,
                created: false,
                action: 'quote',
                quote: clone(existing),
                state
            };
        }

        assert(
            !existing,
            'Another expense quote is awaiting the players’ decision'
        );

        state.pendingExpense = {
            id: test.socialId,
            amount: test.amount,
            reason: test.reason.trim(),
            locationId: state.currentLocationId || null,
            zone: state.zone
        };

        return {
            ok: true,
            created: true,
            action: 'quote',
            quote: clone(state.pendingExpense),
            state
        };
    }

    assert(
        test.action === 'commit',
        `Unsupported expense action: ${test.action}`
    );

    assert(
        typeof test.socialId === 'string' &&
        /^work-[0-9]+-[a-z0-9]+$/.test(test.socialId),
        'Expense agreement requires an engine-issued message reference'
    );

    const previous = state.expenseReceipts[test.socialId];

    if (previous) {
        return {
            ok: true,
            created: false,
            action: 'commit',
            receipt: clone(previous),
            state
        };
    }

    const quote = state.pendingExpense;

    assert(
        quote &&
        quote.id === test.quoteId,
        'No matching expense quote awaits agreement'
    );

    assert(
        quote.locationId === (state.currentLocationId || null) &&
        quote.zone === state.zone,
        'The crew has moved since this expense was quoted'
    );

    assert(
        Number.isInteger(state.crew.purse) &&
        state.crew.purse >= quote.amount,
        `Insufficient silver: need ${quote.amount}s, ` +
            `have ${state.crew.purse}s`
    );

    const purseBefore = state.crew.purse;
    state.crew.purse -= quote.amount;

    const receipt = {
        id: test.socialId,
        quoteId: quote.id,
        amount: quote.amount,
        reason: quote.reason,
        locationId: quote.locationId,
        purseBefore,
        purseAfter: state.crew.purse
    };

    delete state.pendingExpense;
    state.expenseReceipts[test.socialId] = clone(receipt);

    return {
        ok: true,
        created: true,
        action: 'commit',
        receipt,
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
        state.crew?.qtik?.hp === 0 &&
        state.crew?.tansy?.hp === 0,
        'Direct death resolution requires both protagonists down; ' +
            'a survivor must attempt Flee through combat'
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

/*
 * The narrator reports disclosure only after describing the request to
 * the players. This publishes the already-locked quest; it does not roll
 * another opportunity or accept the offer.
 */
function resolveSocialWorkReveal(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Social work reveal requires saved state'
    );

    const state = clone(test.state);
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement,
        'Work disclosure requires presence at a settlement'
    );

    const contact = state.socialOpportunities?.contacts?.[
        `${settlement.id}:${test.socialId}`
    ];

    assert(
        contact?.result === 'offer' && contact.questId,
        'This contact has no locked work offer to reveal here'
    );

    if (!contact.pendingQuest) {
        const existing = findQuestById(state, contact.questId);

        assert(
            existing,
            'Revealed social offer is missing from the journal'
        );

        return {
            ok: true,
            created: false,
            action: 'reveal_work',
            socialId: contact.id,
            questId: contact.questId,
            state
        };
    }

    const quest = contact.pendingQuest;

    assert(
        quest.id === contact.questId &&
        quest.status === 'offered' &&
        !findQuestById(state, quest.id),
        'Pending social offer does not match its contact'
    );

    saveQuestToJournal(state, quest);
    delete contact.pendingQuest;

    return {
        ok: true,
        created: true,
        action: 'reveal_work',
        socialId: contact.id,
        questId: quest.id,
        state
    };
}

/*
 * A contact is established by the conversation, not generated as an NPC
 * roster on settlement arrival. The assistant reports an inquiry after
 * narrating the first conversational beat. Its stable socialId must be
 * reused for that same contact; repeats never roll again.
 *
 * This operation only works at a saved settlement. The two-offer limit
 * applies to this social channel, not to rumors or combat breadcrumbs.
 */
function resolveSocialWorkOpportunity(test) {
    assert(
        test.state && typeof test.state === 'object',
        'Social opportunity requires saved state'
    );

    const state = clone(test.state);

    assert(
        typeof test.socialId === 'string' &&
        /^[A-Za-z0-9._:-]{1,80}$/.test(test.socialId),
        'Social opportunity needs a stable contact ID'
    );

    assert(
        !['active', 'spotted'].includes(state.encounter?.status) &&
        !state.currentJourney,
        'Finish travel or resolve the encounter before asking locally'
    );

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry => entry.locationId === state.currentLocationId);

    assert(
        settlement && settlement.zone === state.zone,
        'Social work inquiry requires presence at its settlement'
    );

    state.socialOpportunities ||= {
        contacts: {},
        settlements: {}
    };
    const contacts = state.socialOpportunities.contacts;
    const counters = state.socialOpportunities.settlements;

    // A name such as "innkeeper" may recur in another settlement.
    // Scope its saved identity without changing the GM's local ID.
    const contactKey = `${settlement.id}:${test.socialId}`;
    const existingContact = contacts[contactKey];

    if (existingContact) {
        return {
            ok: true,
            created: false,
            action: 'check_work',
            socialId: test.socialId,
            outcome: existingContact.result,
            questId: existingContact.questId || null,
            state
        };
    }

    const counter = counters[settlement.id] ||= {
        checks: 0,
        offers: 0
    };

    const firstContact = counter.checks === 0;
    const eligible = counter.offers < 2;
    const chance = firstContact ? 2 : 10;
    const value = eligible ? roll(state, chance) : null;
    const hasWork = eligible && value === 1;

    const contact = {
        id: test.socialId,
        settlementId: settlement.id,
        locationId: settlement.locationId,
        zone: state.zone,
        roll: value,
        sides: eligible ? chance : null,
        result: hasWork ? 'offer' : 'no_work',
        questSeed: hasWork
            ? {
                source: 'social',
                roll: value,
                result: 'genuine_unclaimed_quest_or_dungeon_hook'
            }
            : null,
        questSeedConsumed: false,
        questId: null
    };

    contacts[contactKey] = contact;
    counter.checks++;

    if (!hasWork) {
        return {
            ok: true,
            created: true,
            action: 'check_work',
            socialId: contact.id,
            outcome: contact.result,
            questId: null,
            state
        };
    }

    const offered = resolveQuestSeed({
        state,
        socialId: contact.id,
        zone: contact.zone,
        settlementId: settlement.id
    });

    assert(
        offered.created && offered.quest,
        'Social trigger did not produce its locked offer'
    );
    const savedContact =
        offered.state.socialOpportunities.contacts[contactKey];

    assert(
        savedContact,
        'Generated social offer lost its settlement-scoped contact'
    );

    /*
     * The quest is locked, but the contact has not disclosed it yet.
     * Do not expose it in the journal before the next conversational
     * beat. Preserve the previous selected quest, if any.
     */
    if (offered.state.activeQuest?.id === offered.quest.id) {
        offered.state.activeQuest = null;
    }

    removeQuestFromJournal(offered.state, offered.quest.id);
    savedContact.questId = offered.quest.id;
    savedContact.pendingQuest = offered.quest;

    offered.state.socialOpportunities
        .settlements[settlement.id].offers++;

    return {

        ok: true,
        created: true,
        action: 'check_work',
        socialId: contact.id,
        outcome: 'offer',
        questId: offered.quest.id,
        quest: offered.quest,
        state: offered.state
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
                    result = ['quote', 'commit'].includes(test.action)
                        ? resolveExpenseAction(test)
                        : resolveCurrencyAction(test);
                    break;
                case 'consumable':
                    result = resolveConsumableAction(test);
                    break;
                case 'herbalist':
                    result = resolveHerbalistAction(test);
                    break;
                case 'inn':
                    result = resolveInnAction(test);
                    break;
                case 'stock_names':
                    result = resolveStockNames(test);
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
                    result = test.action === 'open'
                        ? resolveVendorMenuOpen(test)
                        : test.action === 'commit'
                            ? resolveVendorTradeCommit(test)
                            : ['stage', 'discard'].includes(test.action)
                                ? resolveVendorSelection(test)
                                : resolveVendorAction(test);
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

                case 'instance':
                    result = test.action === 'theme'
                        ? resolveInstanceTheme(test)
                        : resolveInstanceAction(test);
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
                    ensureQuestJournal(state);

                    const quest = test.questId !== undefined
                        ? findQuestById(state, test.questId)
                        : state.activeQuest;

                    assert(
                        quest,
                        test.questId !== undefined
                            ? `Unknown quest ID: ${test.questId}`
                            : 'No selected quest'
                    );

                    const discovery =
                        prepareRecoverCargoDiscovery(quest) ||
                        prepareHerbForagingDiscovery(quest) ||
                        prepareV2QuestDiscoveries(quest);

                    assert(
                        discovery,
                        'This quest has no supported discovery preparation'
                    );

                    result = {
                        ok: true,
                        action: 'quest_discovery_prepare',
                        questId: quest.id,
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

                    assert(
                        typeof test.questId === 'string' &&
                        test.questId.length > 0,
                        'Quest threat reveal requires a questId'
                    );

                    const quest = findQuestById(state, test.questId);

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
                        questId: quest.id,
                        encounterType: 'quest_terminal',
                        encounterId: `quest-terminal-${quest.id}`
                    });

                    result.state.encounter.status = 'spotted';
                    result.state.encounter.questTerminal.targetId =
                        quest.targetId;

                    result.action = 'quest_reveal_terminal';
                    result.questId = quest.id;
                    break;
                }

                case 'quest_site_inspect': {
                    const state = clone(test.state);

                    assert(
                        typeof test.questId === 'string' &&
                        test.questId.length > 0,
                        'Quest site inspection requires a questId'
                    );

                    const quest = findQuestById(
                        state,
                        test.questId
                    );

                    assert(
                        quest?.status === 'in_progress',
                        `Quest ${test.questId} is not in progress`
                    );

                    assert(
                        quest.destinationId &&
                        state.currentLocationId === quest.destinationId,
                        'Travel to the quest destination first'
                    );

                    assert(
                        quest.currentGate?.step === 1 &&
                        quest.currentGate.step < quest.gates,
                        'The first gate is not available for inspection'
                    );

                    assert(
                        !['active', 'spotted'].includes(
                            state.encounter?.status
                        ),
                        'Resolve or avoid the nearby encounter first'
                    );

                    const place = state.places[quest.destinationId];

                    assert(
                        place,
                        'Quest inspection destination is missing'
                    );

                    const evidence = quest.facts?.evidence
                        ? `Inspected ${quest.facts.evidence} at ${place.label}.`
                        : `Reached ${place.label} and inspected the signs relevant to the first gate.`;

                    result = resolveQuestAction({
                        state,
                        questId: quest.id,
                        action: 'clear_gate',
                        objectiveCompleted: true,
                        completionEvidence: evidence
                    });

                    result.action = 'quest_site_inspect';
                    result.questId = quest.id;
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

                    /*
                     * Debug rumor sites are test fixtures, not a growing
                     * campaign road network. Anchor them to the zone's
                     * primary settlement so repeated fixtures cannot form
                     * an increasingly long chain between old test sites.
                     *
                     * Backfill existing test places too. Their old neighbor
                     * links remain intact, but shortestRoute can now use the
                     * settlement shortcut. These test-only edges do not
                     * alter ordinary world routes.
                     */
                    state.routeEdges ||= [];

                    const anchorSettlement =
                        savedPrimarySettlement(state, state.zone);

                    const anchorId =
                        anchorSettlement.locationId;

                    const testPlaces = Object.values(state.places)
                        .filter(place =>
                            place?.testOnly === true &&
                            Number(place.zone) === state.zone &&
                            place.id !== anchorId
                        );

                    for (const testPlace of testPlaces) {
                        const alreadyAnchored = state.routeEdges.some(edge =>
                            (
                                edge.fromId === anchorId &&
                                edge.toId === testPlace.id
                            ) ||
                            (
                                edge.fromId === testPlace.id &&
                                edge.toId === anchorId
                            )
                        );

                        if (alreadyAnchored) continue;

                        state.routeEdges.push({
                            fromId: anchorId,
                            toId: testPlace.id,
                            length: 1,
                            kind: 'debug_rumor_anchor_access',
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
                    result = test.action === 'check_work'
                        ? resolveSocialWorkOpportunity(test)
                        : test.action === 'reveal_work'
                            ? resolveSocialWorkReveal(test)
                            : resolveSocialSeed(test);
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
                    const breadcrumb = state?.breadcrumbs?.[
                        test.breadcrumbId
                    ];

                    assert(
                        breadcrumb?.questSeed?.source === 'pack_drop' &&
                        breadcrumb.questSeed.result ===
                            'diegetic_quest_breadcrumb',
                        'Unknown saved pack breadcrumb'
                    );

                    if (breadcrumb.questSeedConsumed) {
                        const existing = findQuestById(
                            state,
                            breadcrumb.questId
                        );

                        assert(
                            existing,
                            'Consumed breadcrumb lost its quest offer'
                        );

                        result = {
                            ok: true,
                            created: false,
                            action: 'follow_breadcrumb',
                            breadcrumbId: breadcrumb.id,
                            questId: existing.id,
                            state
                        };
                        break;
                    }

                    assert(
                        !['active', 'spotted'].includes(
                            state.encounter?.status
                        ),
                        'Resolve or avoid the encounter before following the clue'
                    );

                    assert(
                        breadcrumb.locationId ===
                            state.currentLocationId &&
                        JSON.stringify(breadcrumb.position) ===
                            JSON.stringify(
                                state.currentPosition ||
                                { nodeId: state.currentLocationId }
                            ),
                        'Return to where this breadcrumb was found'
                    );

                    const issuer = state.world?.settlements?.[
                        breadcrumb.settlementId
                    ];

                    assert(
                        issuer?.zone === breadcrumb.zone,
                        'Breadcrumb has no saved local issuer'
                    );

                    result = resolveQuestSeed({
                        state,
                        breadcrumbId: breadcrumb.id,
                        zone: breadcrumb.zone,
                        settlementId: issuer.id
                    });

                    result.action = 'follow_breadcrumb';
                    result.breadcrumbId = breadcrumb.id;
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
                    const state = clone(test.state);
                    const questId = test.questId;

                    assert(
                        typeof questId === 'string' &&
                        questId.length > 0,
                        'Quest delivery requires an explicit questId'
                    );

                    ensureQuestJournal(state);

                    const quest = findQuestById(state, questId);

                    assert(
                        quest?.status === 'in_progress',
                        `Quest ${questId} is not in progress`
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

                              /*
                     * Delivery is bound to quest.id. Preparation and
                     * completion must not change the UI compatibility
                     * selection or make another accepted quest active.
                     */
                    if (quest.archetype?.id === 'recover_cargo') {
                        prepareRecoverCargoDiscovery(quest);
                    }

                    result = resolveQuestAction({
                        state,
                        questId: quest.id,
                        action: 'complete',
                        objectiveCompleted: true,
                        completionEvidence:
                            quest.turnIn.discoveryId
                                ? `Delivered ${
                                    quest.discoveries?.find(
                                        item =>
                                            item.id ===
                                            quest.turnIn.discoveryId
                                    )?.name ||
                                    quest.facts?.cargo ||
                                    'the quest cargo'
                                } to ${quest.turnIn.recipient}.`
                                : quest.structureV2?.family ===
                                    'rescue_person'
                                    ? `Returned ${
                                        quest.facts.person
                                    } safely to ${
                                        quest.turnIn.recipient
                                    }.`
                                    : `Reported the completed objective to ${
                                        quest.turnIn.recipient
                                    }.`
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
 * Between-fight recovery happens on the saved transition out of an active
 * encounter, not on travel steps or elapsed time. A newly spotted encounter
 * takes precedence, so a chained fight cannot grant recovery between threats.
 *
 * Tansy deliberately receives no out-of-combat healing yet. Revisit that
 * only after the level-20 Mender and its authored quest are both established;
 * then decide whether the Mender supports the same full-recovery rule.
 */
function applyOutOfCombatRecovery(previousState, nextState) {
    const previousStatus =
        previousState?.encounter?.status;

    const nextEncounterStatus =
        nextState?.encounter?.status;

    const encounterEnded =
        ['active', 'spotted'].includes(previousStatus) &&
        ['cleared', 'fled'].includes(nextEncounterStatus);

    if (
        !encounterEnded ||
        nextState.crew?.qtik?.hp <= 0 ||
        nextState.crew?.tansy?.hp <= 0
    ) {
        return null;
    }

    const maxHp = derived(nextState.crew).qtikMaxHp;
    const beforeHp = nextState.crew.qtik.hp;

    nextState.crew.qtik.hp = maxHp;

    return {
        character: 'qtik',
        beforeHp,
        afterHp: maxHp,
        recovered: maxHp - beforeHp,
        reason: 'combat_ended_without_another_encounter'
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

/*
 * A fresh chat must be playable without a manually supplied state export.
 * Start with no encounter or opportunities: the crew discovers those
 * through play. Initialization consumes no campaign RNG rolls.
 */
function createInitialCampaignState() {
    const state = {
        zone: 1,
        rngState: createWorldSeed(),
        crew: {
            level: 1,
            xp: 0,
            purse: 0,
            qtik: {
                hp: 150,
                maxHp: 150,
                def: 1,
                regen: 2
            },
            tansy: {
                hp: 50,
                maxHp: 50
            },
            weasels: {
                active: 3,
                max: 3
            },
            shadows: {
                deck: [],
                active: []
            },
            gear: {
                tansy: {},
                qtik: {}
            }
        },
        inventory: {
            consumables: [],
            bagReserves: [],
            activeTradeListings: []
        },
        encounter: null,
        activeQuest: null,
        quests: {
            offered: [],
            accepted: [],
            completed: [],
            declined: [],
            abandoned: [],
            cancelled: []
        },
        inquiries: {},
        socialSeeds: {},
        reputation: {},
        gearGrantIds: {},
        discoveries: {},
        travelSteps: {},
        places: {},
        leads: {},
        routeEdges: [],
        currentLocationId: 'outpost-z1',
        currentPosition: { nodeId: 'outpost-z1' },
        currentJourney: null
    };

    ensureWorldRecords(state);
    ensureWorldLocation(state);

    const stats = derived(state.crew);

    state.crew.qtik.hp = stats.qtikMaxHp;
    state.crew.qtik.maxHp = stats.qtikMaxHp;
    state.crew.qtik.def = stats.def;
    state.crew.qtik.regen = stats.regen;
    state.crew.tansy.hp = stats.tansyMaxHp;
    state.crew.tansy.maxHp = stats.tansyMaxHp;

    checkImportedState(state);
    return state;
}

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

    const currentSettlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.locationId === state.currentLocationId
    );

    state.places[state.currentLocationId] ||= {
        id: state.currentLocationId,
        label: currentSettlement?.label || state.currentLocationId,
        zone: currentSettlement?.zone || state.zone,
        ...(currentSettlement
            ? { settlementId: currentSettlement.id }
            : {}),
        kind: currentSettlement ? 'settlement' : 'place'
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

function instanceNarrationPacket(result) {
    if (result.action === 'exit') {
        return [
            'The crew left the instance through its entrance.',
            'They are at the saved overland entrance; no travel segment ' +
                'or random encounter was rolled.',
            'Previously visited rooms and room threats remain saved.'
        ].join('\n');
    }

    const lines = [
        `The crew ${result.action === 'enter'
            ? 'entered'
            : 'moved within'} the instance.`,
        `Current room: ${result.roomLabel}.`,
        result.firstVisit
            ? 'This is the first visit to this room.'
            : 'This room was already visited. Do not treat this revisit ' +
                'as a new discovery or reward roll.'
    ];

    if (result.encounter) {
        lines.push(
            `The room contains its saved ${result.encounter.type} threat.`,
            `Encounter ${result.encounter.id} is spotted, not engaged.`,
            'Describe signs of the threat and leave engagement, avoidance, ' +
                'or retreat to the protagonists.',
            'Do not create another encounter if the protagonists return ' +
                'to this room.'
        );
    } else if (result.roomThreatStatus === 'cleared') {
        lines.push(
            'This room’s saved threat has already been cleared.',
            'Do not create another encounter or reward here.'
        );
    } else {
        lines.push(
            'This room has no combat threat in the current instance plan.'
        );
    }

    lines.push(
        `Visible exits: ${
            result.knownExits.map(exit =>
                exit.blocked
                    ? `${exit.label} (blocked until this room is cleared)`
                    : exit.label
            ).join(', ') || 'none'
        }.`,
        result.status === 'exhausted'
            ? 'All required instance threats have been cleared. The ' +
                'instance is exhausted.'
            : 'Other instance content may remain unresolved.',
        'Describe only architecture, atmosphere, and the engine-established ' +
            'threat. Do not add loot, puzzles, quests, bosses, or rewards.'
    );

    return lines.join('\n');
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
            `The crew noticed a point of interest: ${site.label} ` +
                `(reference: ${site.id}).`,
            'It is a known, reachable scenic place; the crew has not ' +
                'necessarily arrived there.',
            'Give it modest, setting-appropriate visible features. ' +
                'This travel result establishes no hidden content, ' +
                'encounter, quest, or reward.'
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

    }
    if (result.movement?.arrivalOnly) {
        lines.push(
            result.movement.journeySegmentConsumed
                ? `The crew completed the final route segment and ` +
                  `arrived at ${result.destinationLabel}.`
                : `Arrival at ${result.destinationLabel} was finalized ` +
                  'without consuming another route segment.',
            'No random travel event was rolled for this arrival.',
            'Any destination opportunity or threat must come from the ' +
                'established quest, rumor, or site mechanics.'
        );
       } else if (result.journey) {
        const journey = result.journey;

        if (journey.status === 'paused') {
            lines.push(
                `The journey toward ${journey.destinationLabel} is paused ` +
                'by a spotted encounter. The crew has not reached the destination.',
                'Do not narrate arrival. The crew must resolve or avoid the encounter before travel continues.'
            );

            if (result.movement?.arrivalDeferred) {
                lines.push(
                    'The crew has covered the route to the destination, but arrival ' +
                    'is deferred until the encounter is resolved. No travel event ' +
                    'will be rolled when that arrival is finalized.'
                );
            }
        } else if (result.arrived) {
            lines.push(
                `The crew arrived at ${journey.destinationLabel}.`
            );
        } else {
            lines.push(
                `The crew is still traveling toward ${journey.destinationLabel}.`,
                'Describe the journey naturally. Do not mention numeric segment counters.'
            );
        }
    }

    if (result.arrived || result.event === 'journey_arrival') {
        lines.push(
            'Arrival does not establish whether any rumor about this place is true.'
        );
    }

    if (result.poiArrival) {
        lines.push(
            `Confirmed arrival at ${result.poiArrival.label}.`,
            'Describe the visible site in a way that fits the saved ' +
                'geography. This ordinary point of interest is scenic.',
            'Arrival does not grant loot, reveal a hidden result, start ' +
                'an encounter, or create a quest. Do not imply that ' +
                'searching it will unlock an unestablished reward.'
        );
    }

    for (const questGate of result.questGates || []) {
        const questLabel = questGate.questId
            ? ` for quest ${questGate.questId}`
            : '';

        lines.push(
            `Evidence found at the destination${questLabel}: ` +
                `${questGate.evidence || 'established arrival evidence'}.`,
            `Quest gate ${questGate.completed.step} completed: ` +
                `${questGate.completed.objective}`,
            questGate.next
                ? `Next gate ${questGate.next.step}: ` +
                    `${questGate.next.objective}`
                : 'The field objective is now secured; delivery remains separate.',
            'No quest reward has been granted by this arrival.'
        );
    }

    for (const delivery of result.deliveryReadyList || []) {
        lines.push(
            delivery.deliveryType === 'cargo'
                ? `The crew returned to the turn-in location with ` +
                    `${delivery.deliveryName} for ${delivery.title}.`
                : `The crew returned to ${delivery.recipient} to report ` +
                    `the completed objective for ${delivery.title}.`,
            `That quest is eligible for delivery to ${delivery.recipient}.`,
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
    recover_cargo: ['sponsor', 'cargo', 'place', 'stakes'],
    ruin_clearance: ['sponsor', 'site', 'stakes'],
    herb_foraging: ['sponsor', 'herb', 'place', 'need', 'stakes'],
    missing_person: ['sponsor', 'person', 'place', 'stakes'],
    territorial_beast: ['sponsor', 'beast', 'place', 'stakes']
};

function publicQuestFactLines(quest) {
    const keys = PUBLIC_QUEST_FACT_KEYS[quest.archetype?.id] || [];
    return keys
        .filter(key => typeof quest.facts?.[key] === 'string')
        .map(key => `${key}: ${quest.facts[key]}`);
}

function questOfferNarrationPacket(quest) {
    const sourceText = {
        rumor: 'The crew followed a rumor lead.',
        pack_drop:
            'The crew followed a quest breadcrumb found on a cleared pack.',
        social:
            'A local contact knows of this request. They may introduce ' +
            'or refer the crew to its saved sponsor; the contact need not ' +
            'personally be the sponsor.',
        debug_test: 'A test trigger created this quest offer.'
    }[quest.seed?.source] ||
        'The crew discovered an engine-established quest offer.';

    const variantLabels = {
        abandoned_transport: 'Abandoned Transport',
        diverted_shipment: 'Diverted Shipment',
        stolen_shipment: 'Stolen Shipment',
        lost: 'Lost Person',
        abducted: 'Abducted Person'
    };

    const variantLabel =
        variantLabels[quest.variant?.id] || null;

    const variantText = variantLabel
        ? quest.archetype?.id === 'recover_cargo'
            ? `Recover Cargo variant: ${variantLabel}.`
            : quest.archetype?.id === 'missing_person'
                ? `Missing Person variant: ${variantLabel}.`
                : `Quest variant: ${variantLabel}.`
        : null;

    const factLines = publicQuestFactLines(quest);
    return [
        sourceText,
        ...(variantText ? [variantText] : []),

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

function inventoryActionNarrationPacket(result, action) {
    if (action === 'equip') {
        return [
            'PRIVATE EQUIPMENT RESULT — do not recite this heading.',
            `${result.equipped.owner === 'qtik' ? "Q'tik" : 'Tansy'} ` +
                `equipped ${result.equipped.name}.`,
            ...(result.replaced?.name
                ? [`Replaced ${result.replaced.name}; it is now in Bag Reserves.`]
                : []),
            'The engine has already applied the equipment and stat changes. ' +
                'Describe the change naturally; do not apply it again.'
        ].join('\n');
    }

    return [
        'PRIVATE CONSUMABLE RESULT — do not recite this heading.',
        `${result.itemName} was used on ` +
            `${result.recipient === 'qtik' ? "Q'tik" : 'Tansy'}.`,
        `Actual HP restored: ${result.healing}.`,
        `Bottles remaining: ${result.stockAfter}.`,
        'The bottle and healing have already been applied. ' +
            'Describe the use naturally; do not consume or heal again.'
    ].join('\n');
}

function expenseQuoteNarrationPacket(quote) {
    return [
        'PRIVATE EXPENSE QUOTE — do not recite this heading.',
        `Engine-issued quote ID: ${quote.id}.`,
        `Proposed expense: ${quote.amount}s for ${quote.reason}.`,
        `Current purse: ${quote.purseBefore ?? 'check current state'}s.`,
        'This is a proposal only; no silver has been deducted.',
        'If the players explicitly agree to THIS amount and reason, ' +
            'place this exact tag inside the disposable <plan> block:',
        `<AETHERMOOR:EXPENSE_AGREED quote_id=${quote.id}>`,
        'Do not emit the tag if they refuse, negotiate, change the service, ' +
            'or have not clearly agreed. A changed amount requires a new quote.',
        'Do not mention tags, the extension, or internal accounting.'
    ].join('\n');
}

function expenseReceiptNarrationPacket(receipt) {
    return [
        'PRIVATE EXPENSE RECEIPT — do not recite this heading.',
        `Paid ${receipt.amount}s for ${receipt.reason}.`,
        `Purse: ${receipt.purseBefore}s → ${receipt.purseAfter}s.`,
        'The charge was applied once. Narrate the agreed payment naturally; ' +
            'do not deduct silver again.',
        'The receipt does not establish any service effect beyond the agreed expense.'
    ].join('\n');
}

function innServiceNarrationPacket(receipt) {
    return [
        'PRIVATE INN SERVICE RECEIPT — do not recite this heading.',
        `Paid ${receipt.cost}s at ${receipt.settlementId}.`,
        `Purse: ${receipt.purseBefore}s → ${receipt.purseAfter}s.`,
        ...receipt.choices.map(choice =>
            `${choice.label} ×${choice.quantity}.`
        ),
        'Payment was applied once. Continue naturally from the ' +
            'agreement; do not charge again.',
        'No healing, buffs, inventory items, or time passage were applied.'
    ].join('\n');
}

function herbalistTradeNarrationPacket(receipt) {
    return [
        'PRIVATE HERBALIST TRADE RESULT — do not recite this heading.',
        `Silver spent: ${receipt.cost}s; received: ` +
            `${receipt.proceeds}s.`,
        `Purse: ${receipt.purseBefore}s → ${receipt.purseAfter}s.`,
        ...receipt.choices.map(choice =>
            `${choice.side === 'buy' ? 'Bought' : 'Sold'}: ` +
                `${choice.name} ×${choice.quantity} ` +
                `(${choice.unitPrice}s each).`
        ),
        'The exchange has already been saved. Narrate the handover ' +
            'naturally; do not charge or transfer these potions again.',
        'No potion was used or equipped by this trade.'
    ].join('\n');
}

function vendorTradeNarrationPacket(receipt) {
    return [
        'PRIVATE COMPLETED TRADE RESULT — do not recite this heading.',
        `Settlement: ${receipt.settlementId}.`,
        `Silver received for sales: ${receipt.proceeds}s.`,
        `Silver paid for purchases: ${receipt.cost}s.`,
        `Purse: ${receipt.purseBefore}s → ${receipt.purseAfter}s.`,
        ...receipt.sold.map(item =>
            `Sold: ${item.name} for ${item.proceeds}s` +
                (item.location === 'worn' ? ' (removed from worn gear).' : '.')
        ),
        ...receipt.bought.map(item =>
            `Purchased: ${item.name} (${item.rarity}, Stat ` +
                `${item.rawStat}) — placed in Bag Reserves, NOT equipped.`
        ),
        'The agreed exchange has already been applied once. Continue ' +
            'naturally from the handover; do not charge, grant, or sell ' +
            'these items again.',
        'Do not mention the tag, extension, or state management.'
    ].join('\n');
}

function socialWorkNarrationPacket(result) {
    if (result.outcome === 'offer') {
        return [
            'PRIVATE SOCIAL OPPORTUNITY RESULT — do not recite this heading.',
            `Engine-issued contact reference: ${result.socialId}.`,
            questOfferNarrationPacket(result.quest),
            'This request is locked but not yet published in the quest ' +
                'journal or accepted by the crew.',
            'Reveal it only if the player continues this conversation ' +
                'or asks for the answer.',
            'After actually describing the request, place the ' +
                'REVEAL_WORK tag supplied in settlement conversation ' +
                'context inside the disposable <plan> block. That ' +
                'publishes this same locked offer; it does not reroll it.',
            'If the crew leaves, do not call them back or announce the ' +
                'request elsewhere. The pending request remains saved ' +
                'under this contact.',
            'Do not mention the check, roll, tag, or extension.'
        ].join('\n');
    }

    return [
        'PRIVATE SOCIAL OPPORTUNITY RESULT — do not recite this heading.',
        `Engine-issued contact reference: ${result.socialId}.`,
        'This contact has no work request to share. Conversation may ' +
            'continue normally.',
        'Do not reroll this inquiry or imply that continued conversation ' +
            'will produce a hidden job.',
        'Do not mention the check, roll, tag, or extension.'
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
    const foes = encounter.foes || [];
    const roster = foes.map((foe, index) =>
        `${foe.role} ${index + 1} (level ${foe.level})`
    );

    return [
        `The quest threat for ${quest.title} has been spotted.`,
        `Engine-established encounter: ${roster.join('; ')}.`,
        'The encounter is spotted but not engaged. Combat has not begun.',
        'Narrate this threat in relation to the established quest objective. Do not add foes or abilities. Leave the decision to engage, avoid, or try another approach to the protagonists.'
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
            quest.structureV2?.family === 'rescue_person'
                ? `Return to ${quest.turnIn?.recipient || quest.facts.sponsor} with the rescued person. The handover is report-only; no person is quest cargo.`
                : `Return the recovered cargo to ${quest.turnIn?.recipient || quest.facts.sponsor}.`,
            'The quest payout has not been granted.'
        );

    } else if (result.questGate?.next) {
        lines.push(
            `Gate ${result.questGate.completed.step} completed.`,
            `Next objective: ${result.questGate.next.objective}`
        );

        if (result.questGate.linkedEncounter) {
            lines.push(
                'That next objective has revealed its linked threat. ' +
                'The encounter is spotted, not engaged; the crew must choose how to respond.'
            );
        }
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
        if (questAction === 'cancel') {
        return [
            `The crew cancelled the active quest: ${quest.title}.`,
            'No quest rewards or reputation were granted.',
            'The quest was not completed and remains recorded in the quest history.'
        ].join('\n');
    }

    if (questAction === 'complete') {
        const rewards = result.rewards;
        const recipient =
            quest.turnIn?.recipient ||
            quest.facts?.sponsor ||
            quest.town;
        const cargoDelivery =
            Boolean(quest.turnIn?.discoveryId);

        return [
            cargoDelivery
                ? `The crew delivered the quest cargo to ${recipient}.`
                : quest.structureV2?.family === 'rescue_person'
                    ? `The crew returned ${quest.facts.person} to ${recipient}.`
                    : `The crew reported the completed objective to ${recipient}.`,
            `Quest completed: ${quest.title}.`,
            `Rewards paid: ${rewards.xp} XP, ${rewards.silver} silver, ` +
                `${rewards.repSteps} reputation steps.`,
            ...rewards.loot.map(item =>
                `Salvage received: ${item.name} (${item.rarity}).`
            ),
            ...(cargoDelivery
                ? ['Quest cargo contents were not added to the crew purse.']
                : []),
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

function combatNarrationPacket(result, actions) {
    if (actions?.flee === true) {
        return [
            'COMBAT ESCAPE RESULT — narrate naturally.',
            result.flee?.success
                ? 'The surviving crew member escaped.'
                : 'Escape failed; one enemy response was resolved.',
            ...(result.death
                ? [
                    `Death XP penalty for this encounter: ` +
                        `${result.death.xpLost}.`,
                    result.death.totalDefeat
                        ? 'Both protagonists fell and respawned at the ' +
                            'zone’s primary settlement.'
                        : result.death.respawned
                            ? 'The fallen protagonist respawned at the ' +
                                'stone when the survivor escaped. The ' +
                                'survivor did not respawn.'
                            : 'One protagonist remains at 0 HP; the ' +
                                'survivor may try to flee again.'
                ]
                : []),
            'No combat rewards were granted for fleeing.'
        ].join('\n');
    }

    const qtikActions = {
        fire_melee: 'Fire Melee',
        ice_melee: 'Ice Melee',
        stun: 'Stun',
        ice_patch: 'Ice Patch',
        frost_stomp: 'Frost Stomp',
        drink: 'Drink'
    };

    const tansyActions = {
        visor: 'Visor',
        vitals: 'Vitals',
        hamstring: 'Hamstring',
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
    const slainIds = new Set(
        (result.kills || []).map(kill => kill.id)
    );

    const lines = [
        'COMBAT SCENE RESULT.',
        `Q'tik used ${qtikActions[actions?.qtik] || actions?.qtik || 'an action'}.`,
        `Tansy used ${tansyActions[actions?.tansy] || actions?.tansy || 'a command'}.`,
        'Dramatize these established events as a coherent scene. ' +
            'Add atmosphere, pacing, dialogue, and physical description, ' +
            'but do not add attacks, injuries, decisions, enemy behavior, ' +
            'or outcomes absent from this result.'
    ];

    if (actions?.target) {
        lines.push(`The selected target was ${foeName(actions.target)}.`);
    }

    if (result.death) {
        lines.push(
            `${result.death.fallen.map(owner =>
                owner === 'qtik' ? "Q'tik" : 'Tansy'
            ).join(' and ')} fell.`,
            `Shared XP death penalty: ${result.death.xpLost}.`,
            result.death.respawned
                ? result.death.totalDefeat
                    ? 'Both respawned at the zone’s primary settlement. ' +
                        'The encounter ended without victory rewards.'
                    : 'The fallen protagonist respawned at the stone ' +
                        'when combat ended. The survivor did not respawn.'
                : 'The fallen protagonist remains at 0 HP. Combat is ' +
                    'still active; the survivor can attempt to flee.'
        );
    }

    const notableBeats = [];

    for (const exchange of result.exchanges || []) {
        for (const hit of exchange.hits || []) {
            if (hit.hp === 0 && slainIds.has(hit.id)) {
                notableBeats.push(`${foeName(hit.id)} was slain`);
            }
        }

        if (exchange.enemyMiss === true) {
            notableBeats.push('an enemy attack missed');
        }

        for (const effect of exchange.effects || []) {
            if (
                effect.includes('destroyed') ||
                effect.includes('intercepted') ||
                effect.includes('sacrificed') ||
                effect.includes('reflected') ||
                effect.includes('interrupted') ||
                effect.includes('disrupted') ||
                effect.includes('reinforcements') ||
                effect.includes('telegraph')
            ) {
                notableBeats.push(effect);
            }
        }
    }

    if (notableBeats.length > 0) {
        lines.push(
            'Notable battle beats: ' +
            notableBeats.join('; ') +
            '.'
        );
    }

    const living = (result.summary?.encounter?.foes || [])
        .filter(foe => foe.hp > 0)
        .map(foe => foeName(foe.id));

    if (result.rewards?.applied) {
        lines.push(
            `The encounter was cleared. Rewards applied: ` +
            `${result.rewards.xp} XP and ${result.rewards.silver} silver.`
        );

        for (const item of result.rewards.loot || []) {
            lines.push(
                `Loot received: ${item.name} (${item.rarity}).`
            );
        }

        if (
            result.rewards.packDrop?.result ===
            'diegetic_quest_breadcrumb'
        ) {
            lines.push(
                'The cleared pack left a visible quest breadcrumb.',
                `Breadcrumb reference: ${
                    result.rewards.packDrop.breadcrumbId
                }.`,
                'Give it a modest, setting-fitting physical form. ' +
                    'Do not invent its eventual quest, sponsor, objective, ' +
                    'destination, or reward.',
                'Finding it is not the decision to pursue it. Leave ' +
                    'that choice to the protagonists.'
            );
        }
    } else if (result.packCleared) {
        lines.push(
            'The encounter was cleared; no rewards were applied.'
        );
    } else if (!result.death) {
        lines.push(
            living.length
                ? `Enemies still standing: ${living.join(', ')}.`
                : 'No enemies remain standing.'
        );
    }

    if (result.summary) {
        lines.push(
            `After the fight: Q'tik ` +
                `${result.summary.qtikHp}/${result.summary.qtikMaxHp} HP; ` +
                `Tansy ${result.summary.tansyHp}/` +
                `${result.summary.tansyMaxHp} HP.`
        );
    }

    for (const questGate of result.questGates ||
        (result.questGate ? [result.questGate] : [])) {
        lines.push(
            `Quest gate ${questGate.completed.step} completed` +
                (
                    questGate.questId
                        ? ` for quest ${questGate.questId}`
                        : ''
                ) +
                '.',
            questGate.next
                ? `Next objective: ${questGate.next.objective}`
                : 'The field objective is secured; delivery remains separate.'
        );
    }

    lines.push(
        'Use natural story language. Do not mention extension internals, ' +
        'numeric travel counters, per-exchange HP bookkeeping, or this result packet.'
    );

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

            assert(
                oneCase.action === 'import' ||
                oneCase.action === 'initialize',
                'State action must be initialize, import, status, or export'
            );
            assert(
                !stored,
                'This chat already has saved state; initialization will not overwrite it'
            );

            const imported = oneCase.action === 'initialize'
                ? createInitialCampaignState()
                : clone(oneCase.state);

            if (oneCase.action === 'import') {
                ensureWorldRecords(imported);
                checkImportedState(imported);
            }

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
                initialized: oneCase.action === 'initialize',
                imported: oneCase.action === 'import',
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
        if (
            batch &&
            caseResult.created === false &&
            (
                oneCase.kind === 'travel' ||
                oneCase.kind === 'instance' ||
                oneCase.kind === 'stock_names' ||
                oneCase.kind === 'follow_breadcrumb' ||
                (
                    oneCase.kind === 'social' &&

                    ['check_work', 'reveal_work'].includes(
                        oneCase.action
                    )
                ) ||
                (
                    ['vendor', 'herbalist', 'inn'].includes(oneCase.kind) &&
                    ['open', 'commit'].includes(oneCase.action)
                ) ||
                (
                    oneCase.kind === 'currency' &&
                    ['quote', 'commit'].includes(oneCase.action)
                )
            )
        ) {

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

        const recovery = applyOutOfCombatRecovery(
            savedState,
            nextState
        );

        if (recovery) {
            caseResult.outOfCombatRecovery = recovery;
        }

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
            ['accept', 'decline', 'abandon', 'cancel', 'complete']
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
                    findQuestById(
                        nextState,
                        nextState.encounter.questTerminal.questId
                    )
                )

            : batch &&
              oneCase?.kind === 'instance' &&
              caseResult.created
                ? [
                    instanceNarrationPacket(caseResult),
                    ...(caseResult.encounter
                        ? [
                            discoveryNarrationPacket(
                                nextState.encounter
                            )
                        ]
                        : [])
                ].join('\n\n')

            : beganNewEncounter
                ? [
                    discoveryNarrationPacket(nextEncounter),
                    ...(nextEncounter.questTerminal
                        ? [
                            questTerminalNarrationPacket(
                                nextEncounter,
                                findQuestById(
                                    nextState,
                                    nextEncounter.questTerminal.questId
                                )
                            )
                        ]
                        : []),
                    ...(batch &&
                        oneCase?.kind === 'quest_event' &&
                        caseResult.created &&
                        caseResult.questGate
                        ? [
                            questDiscoveryNarrationPacket(
                                caseResult,
                                findQuestById(
                                    nextState,
                                    caseResult.questId
                                )
                            )
                        ]
                        : []),
                    ...(caseResult.journey
                        ? [travelNarrationPacket(caseResult)]
                        : [])
                ].join('\n\n')

            : batch &&
              oneCase?.kind === 'gear' &&
              oneCase.action === 'equip'
                ? inventoryActionNarrationPacket(caseResult, 'equip')

            : batch &&
              oneCase?.kind === 'consumable' &&
              oneCase.action === 'use' &&
              caseResult.recipient
                ? inventoryActionNarrationPacket(caseResult, 'use')

            : batch &&
              oneCase?.kind === 'currency' &&
              oneCase.action === 'quote' &&
              caseResult.created
                ? expenseQuoteNarrationPacket({
                    ...caseResult.quote,
                    purseBefore: savedState.crew.purse
                })

            : batch &&
              oneCase?.kind === 'currency' &&
              oneCase.action === 'commit' &&
              caseResult.created
                ? expenseReceiptNarrationPacket(caseResult.receipt)

            : batch &&
              oneCase?.kind === 'vendor' &&
              oneCase.action === 'commit' &&
              caseResult.created
                ? vendorTradeNarrationPacket(caseResult.receipt)

            : batch &&
              oneCase?.kind === 'herbalist' &&

              oneCase.action === 'commit' &&
              caseResult.created
                ? herbalistTradeNarrationPacket(caseResult.receipt)

            : batch &&
              oneCase?.kind === 'inn' &&
              oneCase.action === 'commit' &&
              caseResult.created
                ? innServiceNarrationPacket(caseResult.receipt)

            : batch &&
              oneCase?.kind === 'social' &&
              oneCase.action === 'check_work' &&
              caseResult.created
                ? socialWorkNarrationPacket(caseResult)

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
                    findQuestById(nextState, caseResult.questId)
                )

            : batch &&
              oneCase?.kind === 'quest_event' &&
              caseResult.created
                ? questDiscoveryNarrationPacket(
                    caseResult,
                    caseResult.quest ||
                        findQuestByDiscoveryId(
                            nextState,
                            caseResult.questItemId
                        )
                )

            : batch &&
              oneCase?.kind === 'quest_site_inspect'
                ? questSiteInspectionPacket(
                    caseResult,
                    findQuestById(nextState, caseResult.questId)
                )

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
                                    'instance',
                                    'journey',
                                    'quest_discovery_prepare',
                                    'quest_delivery',
                                    'quest_discovery_reconcile',
                                    'quest_event',
                                    'quest_site_inspect',
                                    'quest_reveal_terminal',
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
                                    'herbalist',
                                    'inn',
                                    'stock_names',
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
                            breadcrumbId: {
                                type: 'string',
                                description:
                                    'Engine-issued ID of a saved pack breadcrumb'
                            },
                            destinationId: {
                                type: 'string',
                                description:
                                    'Stable known destination ID for explicit movement'
                            },
                            instanceId: {
                                type: 'string'
                            },
                            roomId: {
                                type: 'string'
                            },
                            stepId: {
                                type: 'string'
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
                                    'Stable ID of the quest owning the event'
                            },

                            action: {
                                type: 'string',
                                enum: [
                                    'initialize',
                                    'import',
                                    'check_work',
                                    'reveal_work',
                                    'status',
                                    'export',
                                    'accept',
                                    'decline',
                                    'abandon',
                                    'cancel',
                                    'clear_gate',
                                    'resolve_objective',
                                    'complete',
                                    'equip',
                                    'grant',
                                    'pawn',
                                    'list',
                                    'settle',
                                    'stock',
                                    'open',
                                    'enter',
                                    'move',
                                    'exit',
                                    'theme',
                                    'stage',
                                    'discard',
                                    'commit',
                                    'buy',
                                    'spend',
                                    'earn',
                                    'quote',
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
                                description:
                                    'Saved consumable ID; healing grades include their purchase zone'
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

                            basket: {
                                type: 'object',
                                description:
                                    'Engine-validated pending vendor selection; not a purchase'
                            },

                            names: {
                                type: 'object',
                                description:
                                    'Cosmetic labels keyed by engine-issued stock identities'
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
                                    'Engine-issued assistant-message reference'
                            },

                            quoteId: {
                                type: 'string',
                                description:
                                    'Engine-issued ID of the saved expense quote'
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

/*
 * Tool exposure is a device-local developer preference, not campaign
 * state. Ordinary UI, movement, and assistant-tag handling call the
 * mechanics directly and remain available when tools are hidden.
 * Registration happens at startup; changing this setting needs a reload.
 */
const AETHERMOOR_DEVELOPER_TOOLS_KEY =
    'aethermoorDeveloperToolsEnabled';

function aethermoorDeveloperToolsEnabled() {
    try {
        return localStorage.getItem(
            AETHERMOOR_DEVELOPER_TOOLS_KEY
        ) === 'true';
    } catch (error) {
        console.warn(
            '[Aethermoor] Could not read developer tool setting',
            error
        );
        return false;
    }
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

function formatQuestStatus(quest) {
    if (!quest) {
        return 'No active quest offer.';
    }

       const variantLabels = {
        abandoned_transport: 'Abandoned Transport',
        diverted_shipment: 'Diverted Shipment',
        stolen_shipment: 'Stolen Shipment',
        lost: 'Lost Person',
        abducted: 'Abducted Person'
    };

    const lines = [
        `Quest: ${quest.title}`,
        `Status: ${quest.status}`,
        `Rank: ${quest.rank}`,
        ...(variantLabels[quest.variant?.id]
            ? [`Variant: ${variantLabels[quest.variant.id]}`]
            : []),
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
            
            } else if (quest.status === 'cancelled') {
        lines.push(
            `Cancelled at gate ${quest.cancelledAtGate || 'unknown'}.`,
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
        const handoverInstruction =
            quest.turnIn.discoveryId
                ? 'When the protagonists actually hand over the cargo in the fiction, place this exact tag inside the disposable <plan> block:'
                : quest.structureV2?.family === 'rescue_person'
                    ? 'When the protagonists actually return the rescued person and meet the sponsor, place this exact tag inside the disposable <plan> block:'
                    : 'When the protagonists actually meet the sponsor and report the completed objective, place this exact tag inside the disposable <plan> block:';

        lines.push(
            `Turn-in is eligible with ${quest.turnIn.recipient}.`,
            handoverInstruction,
            `<AETHERMOOR:DELIVERED quest_id=${quest.id}>`,
            'Do not emit the delivery tag before the fictional handoff.'
        );
    }

    return lines.join('\n');
}

function openAethermoorTab(tab) {
    aethermoorActiveTab = tab;

    if (aethermoorPanelOpen && aethermoorPanelElement?.hidden === false) {
        renderAethermoorTab(tab);
    } else {
        openAethermoorPanel();
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
    button.title = 'View the Aethermoor quest journal';
    button.addEventListener('click', () => {
        openAethermoorTab('quests');
    });

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
    button.title = 'View the Aethermoor World tab';
    button.addEventListener('click', () => {
        openAethermoorTab('world');
    });

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

        .aethermoor-tab[data-tab="instances"].active {
            color: #ffffff;
            border-top: 2px solid #c084fc;
        }

        .aethermoor-tab[data-tab="inventory"].active {
            color: #ffffff;
            border-top: 2px solid #4ade80;
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

        .aethermoor-shop {
            position: fixed;
            z-index: 10002;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(620px, calc(100vw - 24px));
            height: min(75vh, 720px);
            min-width: min(320px, calc(100vw - 24px));
            min-height: min(260px, calc(100vh - 24px));
            max-width: calc(100vw - 24px);
            max-height: calc(100vh - 24px);
            resize: both;
            overflow: auto;
            box-sizing: border-box;
            padding: 12px;
            color: #d0d7de;
            background: #12161c;
            border: 1px solid #2b3542;
            border-left: 3px solid #4da6ff;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65);
            font: 12px/1.5 Consolas, monospace;
        }

        .aethermoor-shop-header {
            display: flex;
            justify-content: space-between;
            align-items: start;
            gap: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #1f2730;
            cursor: move;
            user-select: none;
            touch-action: none;
        }

        .aethermoor-shop-title {
            color: #ffffff;
            font-weight: 700;
        }

        .aethermoor-shop-summary {
            margin: 8px 0;
            color: #9caab8;
            white-space: pre-wrap;
        }

        .aethermoor-vendor-row {
            padding: 9px 0;
            border-top: 1px solid #1f2730;
        }

        .aethermoor-vendor-name {
            color: #ffffff;
            font-weight: 700;
        }

        .aethermoor-vendor-price {
            float: right;
            color: #ffd166;
            font-weight: 700;
        }

        .aethermoor-vendor-detail {
            color: #9caab8;
        }

        .aethermoor-inventory-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 0;
            border-top: 1px solid #1f2730;
        }

        .aethermoor-inventory-item:first-child {
            border-top: 0;
        }

        .aethermoor-inventory-item-main {
            min-width: 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .aethermoor-inventory-item-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 5px;
        }

        .aethermoor-inventory-item-actions button {
            padding: 4px 7px;
            color: #d0d7de;
            background: #181d23;
            border: 1px solid #2b3542;
            cursor: pointer;
            font: inherit;
            white-space: nowrap;
        }

        .aethermoor-inventory-item-actions button:hover,
        .aethermoor-inventory-item-actions button:focus-visible {
            border-color: #4da6ff;
            color: #ffffff;
        }

        .aethermoor-rarity-common {
            color: #ffffff;
        }

        .aethermoor-rarity-uncommon,
        .aethermoor-inventory-gain {
            color: #4ade80;
        }

        .aethermoor-rarity-rare {
            color: #38bdf8;
        }

        .aethermoor-rarity-epic {
            color: #c084fc;
        }

        .aethermoor-rarity-legendary {
            color: #fbbf24;
        }

        .aethermoor-inventory-loss {
            color: #f87171;
        }

        .aethermoor-inventory-neutral {
            color: #9caab8;
        }

        .aethermoor-herbalist-window .aethermoor-vendor-name {
            color: #4ade80;
        }

        .aethermoor-inn-window .aethermoor-vendor-name,
        .aethermoor-inn-window .aethermoor-inn-price {
            color: #ffffff;
        }

        .aethermoor-inn-price {
            font-weight: 700;
        }

        .aethermoor-herbalist-window .aethermoor-vendor-row button,
        .aethermoor-inn-window .aethermoor-vendor-row button {

            min-width: 28px;
            margin: 7px 6px 0 0;
            padding: 3px 7px;
            color: #d0d7de;
            background: #181d23;
            border: 1px solid #2b3542;
            cursor: pointer;
        }

        .aethermoor-herbalist-window .aethermoor-vendor-row button:hover,
        .aethermoor-inn-window .aethermoor-vendor-row button:hover {
            border-color: #4da6ff;
        }

        .aethermoor-herbalist-window .aethermoor-vendor-row button:disabled,
        .aethermoor-inn-window .aethermoor-vendor-row button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        .aethermoor-herbalist-window .aethermoor-vendor-row span,
        .aethermoor-inn-window .aethermoor-vendor-row span {
            display: inline-block;
            min-width: 30px;
            text-align: center;
            color: #ffd166;
        }

        .aethermoor-inn-window .aethermoor-vendor-row
        span.aethermoor-inn-price {
            min-width: 0;
            text-align: left;
            color: #ffffff;
        }

        .aethermoor-vendor-bonus {

            color: #9caab8;
        }

        .aethermoor-trade-gain {
            color: #4ade80;
        }

        .aethermoor-trade-loss,
        .aethermoor-vendor-skip {
            color: #f87171;
        }

        .aethermoor-trade-even {
            color: #9caab8;
        }

        .aethermoor-trade-columns {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
        }

        .aethermoor-trade-column {
            min-width: 0;
            padding: 10px;
            background: #181d23;
            border: 1px solid #2b3542;
            box-shadow: inset 0 1px 8px rgba(0, 0, 0, 0.25);
        }

        .aethermoor-trade-column > h3 {
            margin: 0 0 8px;
            color: #ffffff;
            font-size: 12px;
        }

        .aethermoor-trade-option {
            display: block;
            width: 100%;
            margin-top: 6px;
            padding: 8px;
            color: #d0d7de;
            background: #12161c;
            border: 1px solid #2b3542;
            text-align: left;
            white-space: pre-wrap;
            cursor: pointer;
            font: inherit;
        }

        .aethermoor-trade-option:hover,
        .aethermoor-trade-option:focus-visible {
            border-color: #4da6ff;
        }

        .aethermoor-trade-option[aria-pressed="true"] {
            border-color: #4ade80;
            box-shadow: 0 0 0 1px #4ade80,
                0 0 12px rgba(74, 222, 128, 0.16);
        }

        .aethermoor-trade-option:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .aethermoor-trade-ledger {
            position: sticky;
            bottom: -12px;
            margin: 12px -12px -12px;
            padding: 12px;
            color: #ffd166;
            background: #101419;
            border-top: 1px solid #2b3542;
            box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.45);
        }

        @media (max-width: 600px) {
            .aethermoor-trade-columns {
                grid-template-columns: 1fr;
            }
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

        .aethermoor-ui-action:hover:not(:disabled),
        .aethermoor-ui-action:focus-visible:not(:disabled) {
            color: #ffffff;
            border-color: #4da6ff;
        }

        .aethermoor-ui-action:disabled {
            opacity: 0.45;
            cursor: not-allowed;
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
        .aethermoor-debug-records {
            display: grid;
            gap: 8px;
        }

        .aethermoor-debug-record {
            display: grid;
            gap: 6px;
            padding: 8px;
            background: #181d23;
            border: 1px solid #2b3542;
            border-left: 3px solid #c084fc;
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

    for (const tab of [
        'combat', 'quests', 'world', 'instances', 'inventory'
    ]) {
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
        } else if (tab === 'inventory') {
            await renderInventoryTab(host);
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
        host.replaceChildren();
        host.appendChild(
            makeAethermoorSection(
                'QUEST JOURNAL',
                !getContext().chatMetadata?.[AETHERMOOR_METADATA_KEY]
                    ? 'No campaign yet. Open World to start one.'
                    : error instanceof Error
                        ? error.message
                        : String(error),
                'quest'
            )
        );
        return;
    }

    const state = snapshot.state;
    const movementBlocked =
        Boolean(state.activeInstanceId) ||
        ['active', 'spotted'].includes(state.encounter?.status);

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
            'Accepted quests remain in the journal alongside new offers.',
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
                                : 'Quest cancelled. No rewards were granted.'
                    );
                } finally {
                    button.disabled = false;
                }
            }
        );

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
                            kind: 'quest_reveal_terminal',
                            questId: quest.id
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

        const destinationId =
            quest.objectiveResolution && quest.turnIn
                ? quest.turnIn.locationId
                : quest.destinationId;

        if (
            destinationId &&
            destinationId !== state.currentLocationId
        ) {
            const journey =
                state.currentJourney?.destinationId === destinationId
                    ? state.currentJourney
                    : null;

            if (journey) {
                const progress = document.createElement('div');
                progress.className = 'aethermoor-ui-text';
                progress.textContent =
                    `Journey: ${journey.completedSegments}/` +
                    `${journey.totalSegments} segments` +
                    (journey.status === 'paused'
                        ? ' · interrupted'
                        : '');
                section.appendChild(progress);
            }

            const move = makeAethermoorAction(
                journey?.completedSegments === journey?.totalSegments
                    ? 'Finish journey to quest destination'
                    : journey
                        ? 'Continue to quest destination'
                        : quest.objectiveResolution
                            ? 'Travel to issuer'
                            : 'Travel to quest objective',
                'quest',
                () => copyAethermoorCommand(
                    destinationCommand(destinationId)
                )
            );

            move.disabled = movementBlocked;
            section.appendChild(move);
        }

        addQuestAction(section, quest, 'Cancel Quest', 'cancel');
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
        ['Abandoned', journal.abandoned.length],
        ['Cancelled', journal.cancelled.length]
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
        const sourceQuest =
            entry.source?.type === 'quest'
                ? Object.values(state.quests || {})
                    .flatMap(bucket =>
                        Array.isArray(bucket) ? bucket : []
                    )
                    .find(quest => quest?.id === sourceId)
                : null;

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
                    : sourceQuest?.title ||
                      sourceLead?.label ||
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

/*
 * A shop visit presents both sides of a possible exchange. Clicks are
 * local UI selection only. Close stages a quote; Discard cancels it.
 * Neither action commits a trade. The player must agree in the fiction
 * before a later engine operation may exchange money or gear.
 */
async function openAethermoorShopWindow() {
    addAethermoorPanelStyles();

    const metadata = getContext().chatMetadata;
    const snapshot = await readStoredCombatState();

    assert(
        getContext().chatMetadata === metadata,
        'Chat changed before the shop could open'
    );

    const state = snapshot.state;
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.id === state.vendorMenu?.settlementId &&
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(
        settlement,
        'There is no open shop at the crew’s current settlement'
    );

    const stock = resolveVendorAction({
        action: 'stock',
        zone: state.zone,
        state
    });

    const selectedBuys = new Map();
    const selectedSales = new Map();
    const saved = state.vendorMenu.pendingBasket;

    if (saved?.settlementId === settlement.id) {
        for (const item of saved.buy || []) {
            selectedBuys.set(
                `${item.owner}:${item.slot}`,
                {
                    number: item.number,
                    variant: item.variant
                }
            );
        }

        for (const item of saved.sell || []) {
            selectedSales.set(
                item.location === 'worn'
                    ? `worn:${item.owner}:${item.slot}`
                    : `bag:${item.index}`,
                item
            );
        }
    }

    document.getElementById('aethermoor_shop_window')?.remove();

    const windowElement = document.createElement('section');
    windowElement.id = 'aethermoor_shop_window';
    windowElement.className = 'aethermoor-shop';
    windowElement.setAttribute('role', 'dialog');
    windowElement.setAttribute(
        'aria-label',
        `Trade at ${settlement.label}`
    );

    const header = document.createElement('div');
    header.className = 'aethermoor-shop-header';

    const title = document.createElement('div');
    title.className = 'aethermoor-shop-title';
    title.textContent = `System Log // Trade · ${settlement.label}`;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aethermoor-panel-close';
    close.textContent = 'Close & stage selection';
    header.append(title, close);
    windowElement.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'aethermoor-shop-summary';
    summary.textContent =
        `Zone ${state.zone} · Purse: ${state.crew.purse}s\n` +
        'Select either side of the trade. Close stages a quote; it ' +
        'does not buy, sell, or equip. Agree with the merchant in ' +
        'the story to complete the exchange.';
    windowElement.appendChild(summary);

    const columns = document.createElement('div');
    columns.className = 'aethermoor-trade-columns';

    const merchant = document.createElement('section');
    merchant.className = 'aethermoor-trade-column';
    const merchantTitle = document.createElement('h3');
    merchantTitle.textContent = 'MERCHANT OFFERS';
    merchant.appendChild(merchantTitle);

    const crew = document.createElement('section');
    crew.className = 'aethermoor-trade-column';
    const crewTitle = document.createElement('h3');
    crewTitle.textContent = 'CREW OFFERS';
    crew.appendChild(crewTitle);

    columns.append(merchant, crew);
    windowElement.appendChild(columns);

    const ledger = document.createElement('div');
    ledger.className = 'aethermoor-trade-ledger';
    windowElement.appendChild(ledger);

    const buyButtons = [];
    const saleButtons = [];

    function totals() {
        const cost = [...selectedBuys.values()].reduce(
            (total, choice) => total +
                stock.catalog.find(
                    entry => entry.number === choice.number
                ).price,
            0
        );

        const proceeds = [...selectedSales.values()].reduce(
            (total, choice) => total + choice.proceeds,
            0
        );

        return {
            cost,
            proceeds,
            remaining: state.crew.purse + proceeds - cost
        };
    }

    function refresh() {
        const { cost, proceeds, remaining } = totals();

        ledger.textContent =
            `Crew offers +${proceeds}s · Merchant offers −${cost}s\n` +
            `Projected purse: ${remaining}s · ` +
            'No transaction has occurred.';

        ledger.style.color =
            remaining < 0 ? '#f87171' : '#ffd166';

        for (const { button, key, price, number, variant } of buyButtons) {
            const selected = selectedBuys.get(key);
            const isSelected =
                selected?.number === number &&
                selected?.variant === variant;

            button.setAttribute('aria-pressed', String(isSelected));
            button.disabled =
                !selected &&
                remaining < price;
        }

        for (const { button, key } of saleButtons) {
            button.setAttribute(
                'aria-pressed',
                String(selectedSales.has(key))
            );
        }
    }

    const bonusNames = {
        crewAtk: 'Crew ATK',
        tansyMaxHp: 'Tansy MaxHP',
        qtikMaxHp: 'Q’tik MaxHP',
        frontlineDef: 'Frontline DEF',
        crewLuk: 'Crew LUK'
    };

    for (const entry of stock.catalog) {
        const key = `${entry.owner}:${entry.slot}`;
        const owner = entry.owner === 'qtik' ? "Q'tik" : 'Tansy';

        for (const option of entry.variants) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'aethermoor-trade-option';

            const effects = Object.entries(option.bonus)
                .filter(([, amount]) => amount > 0)
                .map(([name, amount]) =>
                    `+${amount} ${bonusNames[name] || name}`
                );

            const worn =
                state.crew.gear?.[entry.owner]?.[entry.slot];

            const wornBonus = gearBonus(
                entry.owner,
                entry.slot,
                worn
            );

            const comparisonKeys = {
                crewAtk: ['atk', 'Crew ATK'],
                tansyMaxHp: ['hp', 'Tansy MaxHP'],
                qtikMaxHp: ['hp', 'Q’tik MaxHP'],
                frontlineDef: ['def', 'Frontline DEF'],
                crewLuk: ['luk', 'Crew LUK']
            };

            const heading = document.createElement('div');
            heading.className = 'aethermoor-vendor-name';
            heading.textContent =
                `${option.displayName || entry.slotName} · ` +
                `${entry.price}s`;

            const detail = document.createElement('div');
            detail.className = 'aethermoor-vendor-detail';
            detail.textContent =
                `Common · Stat ${entry.stat} · ` +
                `Equipped Stat ${entry.equippedStat}`;

            button.append(heading, detail);

            for (const [key, [wornKey, label]] of Object.entries(
                comparisonKeys
            )) {
                const proposed = Number(option.bonus[key] || 0);
                const current = Number(wornBonus[wornKey] || 0);

                if (proposed === 0 && current === 0) continue;

                const difference = proposed - current;
                const line = document.createElement('div');

                line.className = difference > 0
                    ? 'aethermoor-trade-gain'
                    : difference < 0
                        ? 'aethermoor-trade-loss'
                        : 'aethermoor-trade-even';

                line.textContent =
                    `${label}: ${difference > 0 ? '+' : ''}` +
                    `${difference} vs worn`;

                button.appendChild(line);
            }

            button.addEventListener('click', () => {
                const selected = selectedBuys.get(key);

                if (
                    selected?.number === entry.number &&
                    selected?.variant === option.variant
                ) {
                    selectedBuys.delete(key);
                } else {
                    selectedBuys.set(key, {
                        number: entry.number,
                        variant: option.variant
                    });
                }

                refresh();
            });

            merchant.appendChild(button);
            buyButtons.push({
                button,
                key,
                price: entry.price,
                number: entry.number,
                variant: option.variant
            });
        }
    }

    function addSale(item, choice, label) {
        const rawStat = item.rawStat ?? item.stat;
        if (!Number.isInteger(rawStat) || rawStat <= 0) return;

        const key = choice.location === 'worn'
            ? `worn:${choice.owner}:${choice.slot}`
            : `bag:${choice.index}`;

        const proceeds = rawStat * 2;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'aethermoor-trade-option';
        button.textContent =
            `${item.name || label} · +${proceeds}s\n` +
            `${label} · ${item.rarity || 'Common'} · Stat ${rawStat}`;

        button.addEventListener('click', () => {
            if (selectedSales.has(key)) {
                selectedSales.delete(key);
            } else {
                selectedSales.set(key, {
                    ...choice,
                    proceeds
                });
            }

            refresh();
        });

        crew.appendChild(button);
        saleButtons.push({ button, key });
    }

    (state.inventory.bagReserves || []).forEach(
        (item, index) => addSale(
            item,
            { location: 'bag', index },
            'Bag Reserves'
        )
    );

    for (const owner of ['tansy', 'qtik']) {
        for (const [slot, item] of Object.entries(
            state.crew.gear?.[owner] || {}
        )) {
            if (item && (item.stat ?? item.rawStat) > 0) {
                addSale(
                    item,
                    { location: 'worn', owner, slot },
                    `${owner === 'qtik' ? "Q'tik" : 'Tansy'} · worn ${slot}`
                );
            }
        }
    }

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'aethermoor-trade-option';
    discard.textContent = 'Discard selection';
    discard.addEventListener('click', async () => {
        discard.disabled = true;

        try {
            await runStoredMechanic({
                cases: [{
                    name: 'discard_vendor_selection',
                    kind: 'vendor',
                    action: 'discard'
                }]
            });

            windowElement.remove();
        } catch (error) {
            discard.disabled = false;
            toastr.error(String(error), 'Aethermoor');
        }
    });

    windowElement.appendChild(discard);

    close.addEventListener('click', async () => {
        close.disabled = true;

        try {
            if (selectedBuys.size || selectedSales.size) {
                await runStoredMechanic({
                    cases: [{
                        name: 'stage_vendor_selection',
                        kind: 'vendor',
                        action: 'stage',
                        basket: {
                            buy: [...selectedBuys.values()].map(
                                ({ number, variant }) => ({
                                    number,
                                    variant
                                })
                            ),
                            sell: [...selectedSales.values()].map(
                                ({ location, owner, slot, index }) => ({
                                    location,
                                    ...(location === 'worn'
                                        ? { owner, slot }
                                        : { index })
                                })
                            )
                        }
                    }]
                });

                toastr.info(
                    'Selection staged; no items or silver exchanged.',
                    'Aethermoor'
                );
            }

            windowElement.remove();
        } catch (error) {
            close.disabled = false;
            toastr.error(
                error instanceof Error ? error.message : String(error),
                'Aethermoor'
            );
        }
    });

    refresh();
    document.body.appendChild(windowElement);

    restoreAethermoorPanelGeometry(
        windowElement,
        AETHERMOOR_SHOP_GEOMETRY_KEY
    );

    enableAethermoorPanelDragging(
        header,
        windowElement,
        AETHERMOOR_SHOP_GEOMETRY_KEY
    );

    // Resizing ends with a pointer release; dragging saves through its
    // own handler. Neither operation stages or commits the trade.
    windowElement.addEventListener('pointerup', () => {
        setTimeout(() => {
            if (windowElement.isConnected) {
                saveAethermoorPanelGeometry(
                    windowElement,
                    AETHERMOOR_SHOP_GEOMETRY_KEY
                );
            }
        }, 0);
    });

    close.focus();
}

/*
 * Potion quantities and prices come from consumableDefinition().
 * Button clicks alter only the projected basket. Close stages it;
 * the fictional agreement tag is required for the actual exchange.
 */
async function openAethermoorHerbalistWindow() {
    addAethermoorPanelStyles();

    const metadata = getContext().chatMetadata;
    const snapshot = await readStoredCombatState();

    assert(
        getContext().chatMetadata === metadata,
        'Chat changed before the herbalist could open'
    );

    const state = snapshot.state;
    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.id === state.herbalistMenu?.settlementId &&
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(settlement, 'No herbalist is open at this settlement');

    const stock = herbalistStock(state.zone).map(item => ({
        ...item,
        name: cosmeticStockName(
            state,
            potionCosmeticStockKey(item.id),
            item.name
        )
    }));
    const quantities = new Map();

    for (const choice of
        state.herbalistMenu.pendingBasket?.choices || []) {
        quantities.set(
            `${choice.side}:${choice.id}`,
            choice.quantity
        );
    }

    document.getElementById('aethermoor_herbalist_window')?.remove();

    const panel = document.createElement('section');
    panel.id = 'aethermoor_herbalist_window';
    panel.className = 'aethermoor-shop aethermoor-herbalist-window';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Herbalist trade');

    const header = document.createElement('div');
    header.className = 'aethermoor-shop-header';

    const title = document.createElement('b');
    title.className = 'aethermoor-shop-title';
    title.textContent =
        `System Log // Herbalist · ${settlement.label}`;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aethermoor-panel-close';
    close.textContent = 'Close & stage selection';
    header.append(title, close);
    panel.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'aethermoor-shop-summary';
    summary.textContent =
        `Purse: ${state.crew.purse}s\n` +
        'Choose quantities. Closing stages only; agree in the story ' +
        'to buy or sell. Potions retain their original healing grade.';
    panel.appendChild(summary);

    const columns = document.createElement('div');
    columns.className = 'aethermoor-trade-columns';

    const merchant = document.createElement('section');
    merchant.className = 'aethermoor-trade-column';
    merchant.innerHTML = '<h3>HERBALIST OFFERS</h3>';

    const crew = document.createElement('section');
    crew.className = 'aethermoor-trade-column';
    crew.innerHTML = '<h3>CREW OFFERS</h3>';

    columns.append(merchant, crew);
    panel.appendChild(columns);

    const ledger = document.createElement('div');
    ledger.className = 'aethermoor-trade-ledger';
    panel.appendChild(ledger);

    const controls = [];

    function totals() {
        let cost = 0;
        let proceeds = 0;

        for (const [key, quantity] of quantities) {
            const [side, id] = key.split(':');
            const item = consumableDefinition(id);

            if (side === 'buy') {
                cost += item.buyPrice * quantity;
            } else {
                proceeds += item.sellPrice * quantity;
            }
        }

        return {
            cost,
            proceeds,
            remaining: state.crew.purse + proceeds - cost
        };
    }

    function refresh() {
        const { cost, proceeds, remaining } = totals();

        ledger.textContent =
            `Sales +${proceeds}s · Purchases −${cost}s\n` +
            `Projected purse: ${remaining}s · Nothing exchanged yet.`;
        ledger.style.color =
            remaining < 0 ? '#f87171' : '#ffd166';

        for (const control of controls) {
            const count = quantities.get(control.key) || 0;
            control.count.textContent = ` ×${count}`;
            control.minus.disabled = count === 0;
            control.plus.disabled =
                control.max !== null
                    ? count >= control.max
                    : control.price > remaining;
        }
    }

    function addRow(container, side, item, maximum = null) {
        const key = `${side}:${item.id}`;
        const row = document.createElement('div');
        row.className = 'aethermoor-vendor-row';

        const name = document.createElement('div');
        name.className = 'aethermoor-vendor-name';
        name.textContent = item.name;

        const detail = document.createElement('div');
        detail.className = 'aethermoor-vendor-detail';
        detail.textContent =
            `${item.type === 'potion'
                ? `Restores ${item.heal} HP`
                : 'Clears eligible debuff stacks'} · ` +
            `${side === 'buy' ? item.buyPrice : item.sellPrice}s each` +
            (maximum === null ? '' : ` · Owned: ${maximum}`);

        const minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−';

        const count = document.createElement('span');

        const plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+';

        minus.addEventListener('click', () => {
            const next = (quantities.get(key) || 0) - 1;
            if (next) quantities.set(key, next);
            else quantities.delete(key);
            refresh();
        });

        plus.addEventListener('click', () => {
            quantities.set(key, (quantities.get(key) || 0) + 1);
            refresh();
        });

        row.append(name, detail, minus, count, plus);
        container.appendChild(row);

        controls.push({
            key,
            minus,
            plus,
            count,
            max: maximum,
            price: item.buyPrice
        });
    }

    for (const item of stock) {
        addRow(merchant, 'buy', item);
    }

    for (const owned of state.inventory.consumables || []) {
        if (owned.quantity > 0) {
            addRow(
                crew,
                'sell',
                {
                    id: owned.id,
                    ...consumableDefinition(owned.id)
                },
                owned.quantity
            );
        }
    }

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'aethermoor-trade-option';
    discard.textContent = 'Discard selection';
    discard.addEventListener('click', async () => {
        discard.disabled = true;

        try {
            const output = await runStoredMechanic({
                cases: [{
                    name: 'discard_herbalist_basket',
                    kind: 'herbalist',
                    action: 'discard'
                }]
            });

            assert(output?.ok === true, 'Could not discard selection');
            panel.remove();
        } catch (error) {
            discard.disabled = false;
            toastr.error(String(error), 'Aethermoor');
        }
    });

    panel.appendChild(discard);

    close.addEventListener('click', async () => {
        close.disabled = true;

        try {
            const choices = [...quantities].map(([key, quantity]) => {
                const [side, id] = key.split(':');
                return { side, id, quantity };
            });

            const output = await runStoredMechanic({
                cases: [{
                    name: choices.length
                        ? 'stage_herbalist_basket'
                        : 'discard_herbalist_basket',
                    kind: 'herbalist',
                    action: choices.length ? 'stage' : 'discard',
                    ...(choices.length
                        ? { basket: { choices } }
                        : {})
                }]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not stage herbalist selection'
            );

            panel.remove();
        } catch (error) {
            close.disabled = false;
            toastr.error(
                error instanceof Error ? error.message : String(error),
                'Aethermoor'
            );
        }
    });

    refresh();
    document.body.appendChild(panel);

    restoreAethermoorPanelGeometry(
        panel,
        AETHERMOOR_HERBALIST_GEOMETRY_KEY
    );
    enableAethermoorPanelDragging(
        header,
        panel,
        AETHERMOOR_HERBALIST_GEOMETRY_KEY
    );

    panel.addEventListener('pointerup', () => {
        setTimeout(() => {
            if (panel.isConnected) {
                saveAethermoorPanelGeometry(
                    panel,
                    AETHERMOOR_HERBALIST_GEOMETRY_KEY
                );
            }
        }, 0);
    });

    close.focus();
}

/*
 * Inn selections are UI-local until Close stages a quote. Closing does
 * not deduct silver. The narrator's later agreement report commits it.
 */
async function openAethermoorInnWindow() {
    addAethermoorPanelStyles();

    const metadata = getContext().chatMetadata;
    const snapshot = await readStoredCombatState();

    assert(
        getContext().chatMetadata === metadata,
        'Chat changed before the inn menu could open'
    );

    const state = snapshot.state;

    const displayServices = INN_SERVICES.map(service => ({
        ...service,
        displayName: cosmeticStockName(
            state,
            `inn:${service.id}`,
            service.label
        )
    }));

    const settlement = Object.values(
        state.world?.settlements || {}
    ).find(entry =>
        entry.id === state.innMenu?.settlementId &&
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    assert(settlement, 'No inn menu is open here');

    const quantities = new Map(
        (state.innMenu.pendingBasket?.choices || [])
            .map(choice => [choice.id, choice.quantity])
    );

    const serviceById = id =>
        displayServices.find(service => service.id === id);

    document.getElementById('aethermoor_inn_window')?.remove();

    const panel = document.createElement('section');
    panel.id = 'aethermoor_inn_window';
    panel.className = 'aethermoor-shop aethermoor-inn-window';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Inn services');

    const header = document.createElement('div');
    header.className = 'aethermoor-shop-header';

    const title = document.createElement('b');
    title.className = 'aethermoor-shop-title';
    title.textContent =
        `System Log // Inn Services · ${settlement.label}`;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aethermoor-panel-close';
    close.textContent = 'Close & stage selection';

    header.append(title, close);
    panel.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'aethermoor-shop-summary';
    summary.textContent =
        `Purse: ${state.crew.purse}s\n` +
        'Meals and lodging are expenses only. Close stages a quote; ' +
        'agree in the story to pay. No healing or buffs are included.';
    panel.appendChild(summary);

    const columns = document.createElement('div');
    columns.className = 'aethermoor-trade-columns';
    panel.appendChild(columns);

    const ledger = document.createElement('div');
    ledger.className = 'aethermoor-trade-ledger';
    panel.appendChild(ledger);

    const controls = [];

    function refresh() {
        const cost = INN_SERVICES.reduce(
            (sum, service) =>
                sum + service.price *
                    (quantities.get(service.id) || 0),
            0
        );

        const remaining = state.crew.purse - cost;

        ledger.textContent =
            `Services −${cost}s · Projected purse: ${remaining}s\n` +
            'No payment has occurred.';
        ledger.style.color =
            remaining < 0 ? '#f87171' : '#ffd166';

        const roomIds = [
            'common_room',
            'private_room',
            'luxurious_room'
        ];
        const selectedRoom = roomIds.find(id =>
            (quantities.get(id) || 0) > 0
        );

        for (const control of controls) {
            const { service } = control;
            const count = quantities.get(service.id) || 0;
            const isRoom = roomIds.includes(service.id);
            const maximum =
                isRoom || service.id === 'hot_water' ? 1 : 20;

            control.count.textContent = ` ×${count} `;
            control.minus.disabled = count === 0;
            control.plus.disabled =
                count >= maximum ||
                (isRoom &&
                    selectedRoom !== undefined &&
                    selectedRoom !== service.id) ||
                remaining < service.price;
        }
    }

    for (const [heading, ids] of [
        ['MEALS', [
            'standard_meal',
            'better_meal',
            'special_meal'
        ]],
        ['ROOMS & COMFORTS', [
            'common_room',
            'private_room',
            'luxurious_room',
            'hot_water'
        ]]
    ]) {
        const column = document.createElement('section');
        column.className = 'aethermoor-trade-column';

        const label = document.createElement('h3');
        label.textContent = heading;
        column.appendChild(label);

        for (const id of ids) {
            const service = serviceById(id);
            const row = document.createElement('div');
            row.className = 'aethermoor-vendor-row';

            const name = document.createElement('div');
            name.className = 'aethermoor-vendor-name';
            name.append(document.createTextNode(
                `${service.displayName} · `
            ));

            const price = document.createElement('span');
            price.className = 'aethermoor-inn-price';
            price.textContent = `${service.price}s`;
            name.appendChild(price);

            const minus = document.createElement('button');

            minus.type = 'button';
            minus.textContent = '−';

            const count = document.createElement('span');

            const plus = document.createElement('button');
            plus.type = 'button';
            plus.textContent = '+';

            minus.addEventListener('click', () => {
                const next = (quantities.get(id) || 0) - 1;
                if (next > 0) quantities.set(id, next);
                else quantities.delete(id);
                refresh();
            });

            plus.addEventListener('click', () => {
                quantities.set(id, (quantities.get(id) || 0) + 1);
                refresh();
            });

            row.append(name, minus, count, plus);
            column.appendChild(row);

            controls.push({ service, minus, count, plus });
        }

        columns.appendChild(column);
    }

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'aethermoor-trade-option';
    discard.textContent = 'Discard selection';

    discard.addEventListener('click', async () => {
        discard.disabled = true;

        try {
            const output = await runStoredMechanic({
                cases: [{
                    name: 'discard_inn_selection',
                    kind: 'inn',
                    action: 'discard'
                }]
            });

            assert(output?.ok === true, 'Could not discard inn selection');
            panel.remove();
        } catch (error) {
            discard.disabled = false;
            toastr.error(
                error instanceof Error ? error.message : String(error),
                'Aethermoor'
            );
        }
    });

    panel.appendChild(discard);

    close.addEventListener('click', async () => {
        close.disabled = true;

        try {
            const choices = [...quantities].map(
                ([id, quantity]) => ({ id, quantity })
            );

            const output = await runStoredMechanic({
                cases: [{
                    name: choices.length
                        ? 'stage_inn_selection'
                        : 'discard_inn_selection',
                    kind: 'inn',
                    action: choices.length ? 'stage' : 'discard',
                    ...(choices.length
                        ? { basket: { choices } }
                        : {})
                }]
            });

            assert(
                output?.ok === true,
                output?.results?.[0]?.error ||
                    'Could not stage inn selection'
            );

            panel.remove();
        } catch (error) {
            close.disabled = false;
            toastr.error(
                error instanceof Error ? error.message : String(error),
                'Aethermoor'
            );
        }
    });

    refresh();
    document.body.appendChild(panel);

    restoreAethermoorPanelGeometry(
        panel,
        AETHERMOOR_INN_GEOMETRY_KEY
    );
    enableAethermoorPanelDragging(
        header,
        panel,
        AETHERMOOR_INN_GEOMETRY_KEY
    );

    panel.addEventListener('pointerup', () => {
        setTimeout(() => {
            if (panel.isConnected) {
                saveAethermoorPanelGeometry(
                    panel,
                    AETHERMOOR_INN_GEOMETRY_KEY
                );
            }
        }, 0);
    });

    close.focus();
}

/*
 * Inventory is a read-only view of this chat's saved mechanics state.
 * Rendering cannot consume potions, equip gear, change silver, or reopen
 * a shop automatically. Shop reopen controls require the crew to remain
 * at the settlement where the corresponding window was opened.
 */
async function renderInventoryTab(host) {
    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        host.replaceChildren();
        host.appendChild(
            makeAethermoorSection(
                'INVENTORY',
                !getContext().chatMetadata?.[AETHERMOOR_METADATA_KEY]
                    ? 'No campaign yet. Open World to start one.'
                    : error instanceof Error
                        ? error.message
                        : String(error),
                'world'
            )
        );
        return;
    }

    const state = snapshot.state;
    const inventory = state.inventory || {};
    const gear = state.crew?.gear || {};
    const settlements = Object.values(
        state.world?.settlements || {}
    );

    host.replaceChildren();
    markCampaignViewRendered(snapshot);

    host.appendChild(
        makeAethermoorSection(
            'CREW INVENTORY',
            `Purse: ${state.crew.purse}s\n` +
                'Items below are from saved state, not narrated estimates.',
            'world'
        )
    );

    const potionSection = makeAethermoorSection(
        'POTIONS & TONICS',
        'Saved consumables available outside combat.',
        'world'
    );

    const consumableEntries = (inventory.consumables || [])
        .filter(item => item?.quantity > 0);

    if (consumableEntries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'aethermoor-ui-text';
        empty.textContent = 'None in shared stock.';
        potionSection.appendChild(empty);
    }

    for (const item of consumableEntries) {
        const definition = consumableDefinition(item.id);

        const row = document.createElement('div');
        row.className = 'aethermoor-inventory-item';

        const main = document.createElement('div');
        main.className = 'aethermoor-inventory-item-main';

        const name = document.createElement('div');
        name.className =
            `aethermoor-vendor-name ${rarityClass(item)}`;
        name.textContent =
            `${item.name || definition?.name || item.id} ×${item.quantity}`;

        main.appendChild(name);

        if (definition?.type === 'tonic') {
            const detail = document.createElement('div');
            detail.className = 'aethermoor-vendor-detail';
            detail.textContent = 'Cleansing tonic · combat use';
            main.appendChild(detail);
        }

        const actions = document.createElement('div');
        actions.className = 'aethermoor-inventory-item-actions';

        if (definition?.type === 'potion') {
            for (const [recipient, label] of [
                ['qtik', "Use on Q'tik"],
                ['tansy', 'Use on Tansy']
            ]) {
                const use = document.createElement('button');
                use.type = 'button';
                use.textContent = label;

                use.addEventListener('click', async () => {
                    use.disabled = true;

                    await runAethermoorPanelCase(
                        host,
                        'inventory',
                        {
                            name:
                                `use_${item.id}_${recipient}`,
                            kind: 'consumable',
                            action: 'use',
                            item: item.id,
                            quantity: 1,
                            recipient
                        },
                        `${definition.name} used on ${
                            recipient === 'qtik'
                                ? "Q'tik"
                                : 'Tansy'
                        }.`
                    );
                });

                actions.appendChild(use);
            }
        } else {
            const note = document.createElement('div');
            note.className = 'aethermoor-inventory-neutral';
            note.textContent = 'No outside-combat use yet.';
            actions.appendChild(note);
        }

        row.append(main, actions);
        potionSection.appendChild(row);
    }

    host.appendChild(potionSection);

    const bag = inventory.bagReserves || [];

    const bagSection = makeAethermoorSection(
        `BAG RESERVES · ${bag.length}`,
        bag.length
            ? 'Unbound gear available to equip or trade.'
            : 'No gear in Bag Reserves.',
        'world'
    );

    const currentGear = gear;

    function rarityClass(item) {
        return `aethermoor-rarity-${
            String(item.rarity || 'common').toLowerCase()
        }`;
    }

    function itemComparison(item) {
        if (
            !item.owner ||
            !item.slot ||
            !['tansy', 'qtik'].includes(item.owner)
        ) {
            return null;
        }

        const worn =
            currentGear[item.owner]?.[item.slot] || null;

        const candidateBonus = gearBonus(
            item.owner,
            item.slot,
            {
                stat: item.rawStat,
                variant: item.variant
            }
        );

        const wornBonus = gearBonus(
            item.owner,
            item.slot,
            worn
        );

        const differences = [];

        for (const [key, label] of [
            ['atk', 'ATK'],
            ['def', 'DEF'],
            ['hp', 'HP'],
            ['luk', 'LUK']
        ]) {
            const difference =
                Number(candidateBonus[key] || 0) -
                Number(wornBonus[key] || 0);

            if (difference !== 0) {
                differences.push({
                    difference,
                    label
                });
            }
        }

        if (differences.length === 0) {
            return {
                text: 'Equal to worn gear',
                className: 'aethermoor-inventory-neutral'
            };
        }

        return {
            text: differences.map(entry =>
                `${entry.difference > 0 ? '+' : ''}` +
                    `${entry.difference} ${entry.label}`
            ).join(' · '),
            className: differences.every(
                entry => entry.difference >= 0
            )
                ? 'aethermoor-inventory-gain'
                : differences.every(
                    entry => entry.difference <= 0
                )
                    ? 'aethermoor-inventory-loss'
                    : 'aethermoor-inventory-neutral'
        };
    }

    for (const [index, item] of bag.entries()) {
        const row = document.createElement('div');
        row.className = 'aethermoor-inventory-item';

        const main = document.createElement('div');
        main.className = 'aethermoor-inventory-item-main';

        const name = document.createElement('div');
        name.className =
            `aethermoor-vendor-name ${rarityClass(item)}`;
        name.textContent =
            item.name || 'Unnamed gear';

        const detail = document.createElement('div');
        detail.className = 'aethermoor-vendor-detail';
        detail.textContent =
            `Tier ${item.rawStat ?? item.stat ?? 'unknown'} · ` +
            `${item.bound ? 'Bound' : 'Unbound'}`;

        main.append(name, detail);

        const comparison = itemComparison(item);

        if (comparison) {
            const comparisonLine = document.createElement('div');
            comparisonLine.className = comparison.className;
            comparisonLine.textContent = comparison.text;
            main.appendChild(comparisonLine);
        }

        const actions = document.createElement('div');
        actions.className = 'aethermoor-inventory-item-actions';

        if (
            item.owner &&
            item.slot &&
            item.classRestricted !== true
        ) {
            const equip = document.createElement('button');
            equip.type = 'button';
            equip.textContent = 'Equip';

            equip.addEventListener('click', async () => {
                equip.disabled = true;

                await runAethermoorPanelCase(
                    host,
                    'inventory',
                    {
                        name: `equip_inventory_item_${index}`,
                        kind: 'gear',
                        action: 'equip',
                        itemIndex: index
                    },
                    'Gear equipped.'
                );
            });

            actions.appendChild(equip);
        }

        row.append(main, actions);
        bagSection.appendChild(row);
    }

    host.appendChild(bagSection);

    for (const [owner, label] of [
        ['tansy', 'TANSY'],
        ['qtik', "Q'TIK"]
    ]) {
        const wornSection = makeAethermoorSection(
            `${label} · WORN GEAR`,
            'Currently equipped items.',
            'world'
        );

        const equipped = Object.entries(gear[owner] || {})
            .filter(([, item]) =>
                item && Number(item.stat ?? item.rawStat) > 0
            );

        if (equipped.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'aethermoor-ui-text';
            empty.textContent = 'No gear equipped.';
            wornSection.appendChild(empty);
        }

        for (const [slot, item] of equipped) {
            const row = document.createElement('div');
            row.className = 'aethermoor-inventory-item';

            const main = document.createElement('div');
            main.className = 'aethermoor-inventory-item-main';

            const name = document.createElement('div');
            name.className =
                `aethermoor-vendor-name ${rarityClass(item)}`;
            name.textContent = item.name || 'Unnamed gear';

            const detail = document.createElement('div');
            detail.className = 'aethermoor-vendor-detail';
            detail.textContent =
                `${slot} · Tier ${item.stat ?? item.rawStat}`;

            main.append(name, detail);
            row.appendChild(main);
            wornSection.appendChild(row);
        }

        host.appendChild(wornSection);
    }

    const listings = inventory.activeTradeListings || [];

    if (listings.length) {
        host.appendChild(
            makeAethermoorSection(
                `TRADE-STREAM LISTINGS · ${listings.length}`,
                listings.map(item =>
                    item.name || item.listingId || 'Unnamed listing'
                ).join('\n'),
                'world'
            )
        );
    }

    if (
        state.currentJourney ||
        ['active', 'spotted'].includes(state.encounter?.status)
    ) {
        return;
    }

    const currentSettlement = settlements.find(entry =>
        entry.locationId === state.currentLocationId &&
        entry.zone === state.zone
    );

    if (!currentSettlement) return;

    const shopSection = makeAethermoorSection(
        'OPENED SHOPS',
        'Reopen a shop already shown at this settlement. ' +
            'Reopening does not stage or complete a trade.',
        'world'
    );

    let hasShop = false;

    if (state.vendorMenu?.settlementId === currentSettlement.id) {
        hasShop = true;
        shopSection.appendChild(
            makeAethermoorAction(
                'Reopen Trade Window',
                'world',
                () => {
                    void openAethermoorShopWindow().catch(error =>
                        toastr.error(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            'Aethermoor'
                        )
                    );
                }
            )
        );
    }

    if (state.herbalistMenu?.settlementId === currentSettlement.id) {
        hasShop = true;
        shopSection.appendChild(
            makeAethermoorAction(
                'Reopen Herbalist Window',
                'world',
                () => {
                    void openAethermoorHerbalistWindow().catch(error =>
                        toastr.error(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            'Aethermoor'
                        )
                    );
                }
            )
        );
    }

    if (state.innMenu?.settlementId === currentSettlement.id) {
        hasShop = true;
        shopSection.appendChild(
            makeAethermoorAction(
                'Reopen Inn Services',
                'world',
                () => {
                    void openAethermoorInnWindow().catch(error =>
                        toastr.error(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            'Aethermoor'
                        )
                    );
                }
            )
        );
    }

    if (hasShop) host.appendChild(shopSection);
}

function combatRecapPrompt(receipt) {
    const lines = [
        'Please narrate the completed fight as a concise, cinematic scene.',
        'Use only the actions and events listed below. Do not add attacks, injuries, enemy behavior, decisions, or outcomes.',
        'Combat rewards have already been applied. Present them as the aftermath; do not invent a search or claim that rewards still need to be collected.',
        ''
    ];

    for (const turn of receipt.narrativeTurns || []) {
        lines.push(
            `Turn ${turn.turn}: Q'tik chose ${turn.actions.qtik}; ` +
                `Tansy chose ${turn.actions.tansy}.` +
                (turn.actions.target
                    ? ` Their selected target was ${turn.actions.target}.`
                    : '')
        );

        for (const exchange of turn.exchanges || []) {
            for (const event of exchange.events || []) {
                lines.push(`- ${event}`);
            }
        }
    }

    lines.push(
        '',
        `Result: victory. ${receipt.xp} XP and ${receipt.silver} silver were received.`
    );

    for (const item of receipt.loot || []) {
        lines.push(`Loot received: ${item.name || 'Unnamed item'}.`);
    }

    if (
        receipt.packDrop?.result ===
        'diegetic_quest_breadcrumb'
    ) {
        lines.push('A quest breadcrumb was found.');
    }

    for (const levelUp of receipt.levelUps || []) {
        lines.push(`The crew reached level ${levelUp.level}.`);
    }

    return lines.join('\n');
}

async function copyCombatRecapPrompt(receipt) {
    const text = combatRecapPrompt(receipt);

    try {
        await navigator.clipboard.writeText(text);
    } catch (_error) {
        const input = document.createElement('textarea');
        input.value = text;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand('copy');
        input.remove();
    }

    toastr.info(
        'Combat recap copied. Paste and send it to invite the GM to narrate the fight.',
        'Aethermoor'
    );
}

function appendVictoryReceipt(host, receipt) {
    const lines = [
        `+${receipt.xp} XP · +${receipt.silver}s`,
        ...(receipt.loot || []).map(item =>
            `Loot: ${item.name || 'Unnamed item'}`
        ),
        ...(receipt.packDrop?.result ===
            'diegetic_quest_breadcrumb'
            ? ['A quest breadcrumb was found.']
            : []),
        ...(receipt.levelUps || []).map(change =>
            `Reached level ${change.level}.`
        ),
        ...(receipt.death
            ? [
                `${receipt.death.fallen.join(' and ')} fell; ` +
                    `${receipt.death.xpLost} XP death penalty applied. ` +
                    'The fallen protagonist respawned after victory.'
            ]
            : [])
    ];

    if (
        !receipt.loot?.length &&
        receipt.packDrop?.result !==
            'diegetic_quest_breadcrumb'
    ) {
        lines.push('No additional item dropped.');
    }

    const section = makeAethermoorSection(
        'VICTORY · REWARDS RECEIVED',
        lines.join('\n'),
        'combat'
    );

    section.appendChild(
        makeAethermoorAction(
            'Copy fight recap prompt',
            'combat',
            () => {
                void copyCombatRecapPrompt(receipt).catch(error =>
                    toastr.error(
                        error instanceof Error
                            ? error.message
                            : String(error),
                        'Aethermoor'
                    )
                );
            }
        )
    );

    host.appendChild(section);
}

/*
 * Present one saved encounter in the tab where it arose. Decisions call
 * the existing engage/avoid operations; combat turns still use the single
 * Combat UI. Victory displays the already-applied receipt, never claims
 * rewards a second time.
 */
function appendEncounterCard(host, state, originTab) {
    const encounter = state.encounter;

    if (encounter?.status === 'spotted') {
        const section = makeAethermoorSection(
            'ENCOUNTER SPOTTED',
            encounter.foes
                .filter(foe => foe.hp > 0)
                .map((foe, index) =>
                    `${combatFoeLabel(foe, index)} · ` +
                    `${foe.hp}/${foe.maxHp} HP`
                )
                .join('\n') +
                '\nCombat has not begun.',
            'combat'
        );

        for (const [label, kind] of [
            ['Engage', 'engage'],
            ['Avoid', 'avoid']
        ]) {
            const button = makeAethermoorAction(
                label,
                'combat',
                async () => {
                    button.disabled = true;

                    try {
                        const output = await runStoredMechanic({
                            cases: [{
                                name: `${kind}_spotted_encounter`,
                                kind
                            }]
                        });

                        assert(
                            output?.ok === true &&
                            output.results?.[0]?.ok !== false,
                            output?.results?.[0]?.error ||
                                `Could not ${kind} encounter`
                        );

                        if (kind === 'engage') {
                            openAethermoorTab('combat');
                        } else {
                            renderAethermoorTab(originTab);
                        }
                    } catch (error) {
                        button.disabled = false;
                        toastr.error(
                            error instanceof Error
                                ? error.message
                                : String(error),
                            'Aethermoor'
                        );
                    }
                }
            );

            section.appendChild(button);
        }

        host.appendChild(section);
        return;
    }

    const receipt = encounter?.status === 'cleared'
        ? encounter.victoryReceipt
        : null;

    if (receipt?.encounterId !== encounter.id) return;

    appendVictoryReceipt(host, receipt);
}

/*
 * Instance navigation is a view over saved room state. Its buttons copy
 * commands; they never enter a room or resolve its contents on click.
 * Overland travel to the entrance uses the ordinary route resolver.
 */
async function renderInstanceTab(host) {

    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        host.replaceChildren();
        host.appendChild(
            makeAethermoorSection(
                'INSTANCE',
                !getContext().chatMetadata?.[AETHERMOOR_METADATA_KEY]
                    ? 'No campaign yet. Open World to start one.'
                    : error instanceof Error
                        ? error.message
                        : String(error),
                'world'
            )
        );
        return;
    }

    const state = snapshot.state;
    host.replaceChildren();
    markCampaignViewRendered(snapshot);

    const instance = state.activeInstanceId
        ? state.instances?.[state.activeInstanceId]
        : state.instances?.[`instance-z${state.zone}-known`];

    if (!instance) {
        host.appendChild(
            makeAethermoorSection(
                'INSTANCE',
                'No known instance in the current zone.',
                'world'
            )
        );
        return;
    }

    const blocked = ['active', 'spotted']
        .includes(state.encounter?.status);

    if (state.activeInstanceId) {
        if (state.encounter?.instanceId === instance.id) {
            appendEncounterCard(host, state, 'instances');
        }

        const room = instance.rooms?.[instance.currentRoomId];

        if (!room) {
            host.appendChild(
                makeAethermoorSection(
                    'INSTANCE',
                    'Saved instance room is unavailable.',
                    'world'
                )
            );
            return;
        }

        const known = new Set();

        for (const visited of Object.values(instance.rooms)) {
            if (!visited.visited) continue;
            known.add(visited.id);
            for (const exitId of visited.exits) known.add(exitId);
        }

        const map = Object.values(instance.rooms)
            .filter(entry => known.has(entry.id))
            .map(entry =>
                `${entry.id === room.id ? '● ' : '○ '}` +
                `${entry.label} · ` +
                `${entry.visited ? 'Visited' : 'Known exit'}`
            ).join('\n');

        const section = makeAethermoorSection(
            `INSTANCE · ${instance.label}`,
            `Current room: ${room.label}\n` +
                `Status: ${instance.status}\n\n${map}` +
                (blocked
                    ? '\n\nResolve or avoid the encounter before moving.'
                    : ''),
            'world'
        );

        for (const exitId of room.exits) {
            const destination = instance.rooms[exitId];
            if (!destination) continue;

            const unmet = (destination.requiresCleared || [])
                .filter(requiredId =>
                    instance.rooms[requiredId]?.threatStatus !== 'cleared'
                );

            const button = makeAethermoorAction(
                unmet.length
                    ? `${destination.label} · blocked`
                    : `Move to ${destination.label}`,
                'world',
                () => copyAethermoorCommand(
                    instanceCommand(instance.id, 'move', exitId)
                )
            );

            button.disabled = blocked || unmet.length > 0;
            if (unmet.length) {
                button.title = `Clear ${
                    unmet.map(id => instance.rooms[id]?.label || id)
                        .join(', ')
                } first.`;
            }
            section.appendChild(button);
        }

        if (room.id === 'entrance') {
            const leave = makeAethermoorAction(
                'Leave instance',
                'world',
                () => copyAethermoorCommand(
                    instanceCommand(instance.id, 'exit')
                )
            );
            leave.disabled = blocked;
            section.appendChild(leave);
        }

        host.appendChild(section);
        return;
    }

    const atEntrance =
        state.currentLocationId === instance.entranceId &&
        !state.currentJourney;

    const journey =
        state.currentJourney?.destinationId === instance.entranceId
            ? state.currentJourney
            : null;

    const section = makeAethermoorSection(
        'KNOWN INSTANCE',
        `${instance.label}\nStatus: ${instance.status}\n` +
            (atEntrance
                ? 'The crew is at its entrance.'
                : journey
                    ? `Journey: ${journey.completedSegments}/` +
                        `${journey.totalSegments} segments` +
                        (journey.status === 'paused'
                            ? ' · interrupted'
                            : '')
                    : 'The entrance is a known destination.'),
        'world'
    );

    const command = atEntrance
        ? instanceCommand(instance.id, 'enter')
        : destinationCommand(instance.entranceId);

    const button = makeAethermoorAction(
        atEntrance
            ? 'Enter instance'
            : journey?.completedSegments === journey?.totalSegments
                ? 'Finish journey to instance entrance'
                : journey
                    ? 'Continue to instance entrance'
                    : 'Travel to instance entrance',
        'world',
        () => copyAethermoorCommand(command)
    );

    button.disabled = blocked;
    section.appendChild(button);
    host.appendChild(section);
}

async function renderWorldTab(host) {

    let snapshot;

    try {
        snapshot = await readStoredCombatState();
    } catch (error) {
        host.replaceChildren();

        if (!getContext().chatMetadata?.[AETHERMOOR_METADATA_KEY]) {
            const start = makeAethermoorSection(
                'START CAMPAIGN',
                'Create the level-1 crew in Thornhaven. This does not ' +
                    'generate a quest, encounter, or opening scene.',
                'world'
            );

            const button = makeAethermoorAction(
                'Start Campaign',
                'world',
                async () => {
                    button.disabled = true;

                    try {
                        const result = await runStoredMechanic({
                            cases: [{
                                name: 'initialize_campaign',
                                kind: 'state',
                                action: 'initialize'
                            }]
                        });

                        assert(
                            result?.ok === true &&
                            result.initialized === true,
                            result?.error ||
                                'Could not initialize campaign'
                        );

                        await renderWorldTab(host);
                    } catch (startError) {
                        button.disabled = false;
                        toastr.error(
                            startError instanceof Error
                                ? startError.message
                                : String(startError),
                            'Aethermoor'
                        );
                    }
                }
            );

            start.appendChild(button);
            host.appendChild(start);
            return;
        }

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

    // Shop reopening belongs to Inventory; World lists travel choices.
    const movementBlocked =
        Boolean(state.activeInstanceId) ||
        ['active', 'spotted'].includes(state.encounter?.status);

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
        if (destinationId === currentLocationId) return;

        const distance = distanceLabel(destinationId);

        if (!distance) return;

        const button = makeAethermoorAction(
            `${label} · ${distance}`,
            'world',
            () => copyAethermoorCommand(
                destinationCommand(destinationId)
            )
        );

        button.disabled = movementBlocked;
        if (state.activeInstanceId) {
            button.title = 'Leave the instance before overland travel.';
        }

        container.appendChild(button);
    }

    if (state.activeInstanceId) {
        host.appendChild(
            makeAethermoorSection(
                'INSIDE AN INSTANCE',
                'Open the Instance tab for the room map and exits. ' +
                    'World destinations remain visible, but overland ' +
                    'travel is unavailable until you leave.',
                'world'
            )
        );
    } else if (movementBlocked) {
        host.appendChild(
            makeAethermoorSection(
                'TRAVEL PAUSED',
                'Resolve or avoid the encounter before starting or ' +
                    'changing a journey.',
                'world'
            )
        );
    }

    if (!state.encounter?.instanceId) {
        appendEncounterCard(host, state, 'world');
    }

    const knownInstance =
        state.instances?.[`instance-z${state.zone}-known`];

    if (knownInstance) {
        host.appendChild(
            makeAethermoorSection(
                'KNOWN INSTANCE',
                `${knownInstance.label} · ${knownInstance.status}\n` +
                    'Its entrance and room controls are in the Instance tab.',
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

    const journal = ensureQuestJournal(state);
    const acceptedCount = journal.accepted.filter(
        quest => quest?.status === 'in_progress'
    ).length;

    if (acceptedCount > 0) {
        host.appendChild(
            makeAethermoorSection(
                'QUEST DESTINATIONS',
                `${acceptedCount} quest(s) in progress. ` +
                    'Open Quests for their objectives and travel commands.',
                'quest'
            )
        );
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

      /*
     * Foreground only current-zone rumors. Earlier-zone rumors remain
     * saved, but are history rather than prompts to backtrack through
     * obsolete encounters. Accepted quests remain visible above,
     * regardless of zone; this display does not cancel anything.
     */
    const rumors = leads.filter(lead =>
        lead.kind === 'rumor' &&
        lead.testOnly !== true &&
        Number(state.places[lead.targetId]?.zone) === state.zone
    );

    const rumorSection = makeAethermoorSection(
        'RUMORS · CURRENT ZONE',
        rumors.length
            ? 'Known rumors and their destinations in this zone.'
            : 'No open rumors in this zone.',
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
            status.textContent =
                'The crew is here. A confirmed arrival resolves this rumor; ' +
                'check its saved result or any resulting quest offer.';
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

    const olderRumors = Object.values(state.leads || {})
        .filter(lead => {
            const place = state.places?.[lead?.targetId];
            return lead?.kind === 'rumor' &&
                lead.testOnly !== true &&
                place &&
                Number.isInteger(Number(place.zone)) &&
                Number(place.zone) < state.zone;
        });

    if (olderRumors.length > 0) {
        const history = document.createElement('details');
        history.className = 'aethermoor-knowledge';

        const heading = document.createElement('summary');
        heading.className = 'aethermoor-ui-heading';
        heading.textContent =
            `EARLIER-ZONE RUMORS · ${olderRumors.length}`;
        history.appendChild(heading);

        for (const lead of olderRumors) {
            const place = state.places[lead.targetId];
            const entry = document.createElement('div');
            entry.className = 'aethermoor-ui-text';
            entry.style.marginTop = '8px';
            entry.textContent =
                `Zone ${place.zone} · ${place.label} · ` +
                `${lead.status === 'known' ? 'Unresolved' : 'Investigated'}\n` +
                `${lead.claim || lead.label || lead.id}`;
            history.appendChild(entry);
        }

        host.appendChild(history);
    }

    const pointsOfInterest = Object.values(state.places || {})
        .filter(place =>
            place?.kind === 'point_of_interest' &&
            Number(place.zone) === state.zone &&
            place.testOnly !== true
        );

    const poiSection = makeAethermoorSection(
        'POINTS OF INTEREST · CURRENT ZONE',
        pointsOfInterest.length
            ? 'Places noticed during travel. Visiting is not searching.'
            : 'No points of interest noticed in this zone.',
        'world'
    );

    for (const place of pointsOfInterest) {
        if (place.id === currentLocationId) {
            const atSite = document.createElement('div');
            atSite.className = 'aethermoor-ui-text';
            atSite.textContent =
                `${place.label}\nThe crew is here. ` +
                'What they do next is up to the player.';
            poiSection.appendChild(atSite);
        } else {
            addTravelAction(
                poiSection,
                `Travel to ${place.label}`,
                place.id
            );
        }
    }
    host.appendChild(poiSection);

    /*
     * The saved world connects neighboring primary settlements, but the
     * next settlement need not already be a character-known place or lead.
     * Expose its route so the forward-moving campaign cannot stall.
     * This establishes a travel choice, not knowledge of local NPCs,
     * quests, rumors, or what awaits on arrival.
     */
    const nextZone = world.zones?.[state.zone + 1];
    const nextSettlement = nextZone
        ? world.settlements?.[nextZone.primarySettlementId]
        : null;

    if (nextSettlement?.locationId) {
        const onward = makeAethermoorSection(
            'ONWARD',
            `Route toward Zone ${nextZone.number}: ${nextZone.name}\n` +
                `Terrain ahead: ${nextZone.geography?.description || 'unknown'}.`,
            'world'
        );

        addTravelAction(
            onward,
            `Travel onward to Zone ${nextZone.number}`,
            nextSettlement.locationId
        );

        host.appendChild(onward);
    }

    // Test fixtures are created from Narration Debug, not ordinary World.
    const settlements = Object.values(world.settlements || {})

        .filter(settlement => {
            if (!settlement?.locationId) return false;
            if (settlement.locationId === currentLocationId) return false;

            /*
             * The next primary settlement already has its own ONWARD entry.
             * Do not render the same saved destination again under Known
             * Settlements. One location ID must produce one ordinary travel
             * command in World.
             */
            if (
                settlement.locationId ===
                nextSettlement?.locationId
            ) {
                return false;
            }

            /*
             * Ordinary World travel moves forward. Accepted quests have
             * their own destination/return entries above, so an earlier
             * settlement can still be reached when that quest warrants it.
             */
            if (Number(settlement.zone) < state.zone) return false;

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
    host.appendChild(
        makeAethermoorAction(
            'Debug: Narration Recorder',
            'world',
            openNarrationDebug
        )
    );

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
    } else if (tab === 'instances') {
        renderInstanceTab(views.instances);
    } else if (tab === 'inventory') {
        renderInventoryTab(views.inventory);
    }
}

const AETHERMOOR_PANEL_GEOMETRY_KEY =
    'aethermoorMainPanelGeometry';
const AETHERMOOR_SHOP_GEOMETRY_KEY =
    'aethermoorShopWindowGeometry';
const AETHERMOOR_HERBALIST_GEOMETRY_KEY =
    'aethermoorHerbalistWindowGeometry';
const AETHERMOOR_INN_GEOMETRY_KEY =
    'aethermoorInnWindowGeometry';

function restoreAethermoorPanelGeometry(
    panel,
    storageKey = AETHERMOOR_PANEL_GEOMETRY_KEY
) {
    try {
        const saved = JSON.parse(
            localStorage.getItem(storageKey) || 'null'
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
        panel.style.transform = 'none';
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
    } catch (error) {
        console.warn(
            'Aethermoor: Could not restore main panel geometry',
            error
        );
    }
}

function saveAethermoorPanelGeometry(
    panel,
    storageKey = AETHERMOOR_PANEL_GEOMETRY_KEY
) {
    const rect = panel.getBoundingClientRect();

    try {
        localStorage.setItem(
            storageKey,
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

function enableAethermoorPanelDragging(
    header,
    panel,
    storageKey = AETHERMOOR_PANEL_GEOMETRY_KEY
) {
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
        panel.style.transform = 'none';
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

            saveAethermoorPanelGeometry(panel, storageKey);
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
            ['world', 'World'],
            ['instances', 'Instance'],
            ['inventory', 'Inventory']
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
            consumableDefinition(entry.id)
        )
        .map(entry => ({
            value: entry.id,
            label:
                entry.name ||
                consumableDefinition(entry.id).name,
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
                reportAethermoorError(error, 'Combat tab refresh failed');
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
            !['quests', 'world', 'instances', 'inventory']
                .includes(aethermoorActiveTab) ||
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
                : aethermoorActiveTab === 'instances'
                    ? renderInstanceTab(host)
                    : aethermoorActiveTab === 'inventory'
                        ? renderInventoryTab(host)
                        : renderWorldTab(host);

        Promise.resolve(refresh)
            .catch(error => {
                reportAethermoorError(error, 'Campaign tab refresh failed');
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
        const item = consumableDefinition(button.dataset.value);
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
        encounter?.status === 'active' &&
        (
            state.crew.qtik.hp === 0 ||
            state.crew.tansy.hp === 0
        )
    ) {
        const survivor = state.crew.qtik.hp > 0
            ? "Q'tik"
            : 'Tansy';

        const section = makeAethermoorSection(
            'COMPANION DOWN',
            `${state.crew.qtik.hp === 0 ? "Q'tik" : 'Tansy'} ` +
                'is at 0 HP. Their commands are unavailable.\n' +
                `${survivor} can attempt to flee. A failed escape ` +
                'allows one enemy response. The death XP penalty ' +
                'has already been applied once.',
            'combat'
        );

        const flee = makeAethermoorAction(
            `${survivor}: Attempt Flee`,
            'combat',
            async () => {
                if (aethermoorCombatBusy) return;
                aethermoorCombatBusy = true;
                flee.disabled = true;

                try {
                    const result = await runStoredMechanic({
                        actions: { flee: true }
                    });

                    assert(result?.ok === true,
                        result?.error || 'Flee failed to resolve');

                    if (
                        result.flee?.success ||
                        result.death?.totalDefeat
                    ) {
                        openAethermoorTab(
                            state.activeInstanceId &&
                            !result.death?.totalDefeat
                                ? 'instances'
                                : 'world'
                        );
                    } else {
                        await openCombatPanel(inlineHost);
                    }
                } catch (error) {
                    flee.disabled = false;
                    toastr.error(
                        error instanceof Error
                            ? error.message
                            : String(error),
                        'Aethermoor'
                    );
                } finally {
                    aethermoorCombatBusy = false;
                }
            }
        );

        section.appendChild(flee);
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

        const receipt = encounter?.status === 'cleared'
            ? encounter.victoryReceipt
            : null;

        if (receipt?.encounterId === encounter.id) {
            appendVictoryReceipt(inlineHost, receipt);
        }

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

            const finished =
                ['cleared', 'fled', 'dead'].includes(
                    result.summary?.encounter?.status
                );
            if (finished) {
                const destination =
                    state.activeInstanceId ? 'instances' : 'world';

                aethermoorActiveTab = destination;
                renderAethermoorTab(destination);
            } else {
                renderAethermoorTab('combat');
            }
        } catch (error) {
            resultBox.hidden = false;
            resultBox.textContent =
                `Turn was not resolved: ${
                    error instanceof Error ? error.message : String(error)
                }`;
            reportAethermoorError(error, 'Combat turn failed');
        } finally {
            aethermoorCombatBusy = false;
            resolveButton.disabled = false;
            resolveButton.textContent = 'Resolve Turn';
        }
    });

    actions.appendChild(resolveButton);

    const fleeButton = makeAethermoorAction(
        'Attempt Flee',
        'combat',
        async () => {
            if (aethermoorCombatBusy) return;
            aethermoorCombatBusy = true;
            fleeButton.disabled = true;

            try {
                const result = await runStoredMechanic({
                    actions: { flee: true }
                });

                assert(
                    result?.ok === true,
                    result?.error || 'Flee failed to resolve'
                );

                if (
                    result.flee?.success ||
                    result.death?.totalDefeat
                ) {
                    openAethermoorTab(
                        state.activeInstanceId &&
                        !result.death?.totalDefeat
                            ? 'instances'
                            : 'world'
                    );
                } else {
                    await openCombatPanel(inlineHost);
                }
            } catch (error) {
                fleeButton.disabled = false;
                toastr.error(
                    error instanceof Error
                        ? error.message
                        : String(error),
                    'Aethermoor'
                );
            } finally {
                aethermoorCombatBusy = false;
            }
        }
    );

    actions.appendChild(fleeButton);
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

/*
 * Diagnostics live outside the machine state and gameplay revision.
 * Use the same queue as mechanics so diagnostic saves cannot race a
 * mechanics save. Records are bounded and never interpreted as events.
 * Disabling recording preserves existing evidence; Clear removes it.
 */
const AETHERMOOR_DEBUG_KEY = 'aethermoorNarrationDebug';
const AETHERMOOR_DEBUG_LIMIT = 30;

function saveNarrationDebugChange(metadata, change) {
    return queueAethermoor(async () => {
        const context = getContext();
        if (context.chatMetadata !== metadata) return;

        const previous = metadata[AETHERMOOR_DEBUG_KEY];
        const next = previous
            ? clone(previous)
            : { enabled: false, entries: [] };

        change(next);
        next.entries = next.entries.slice(-AETHERMOOR_DEBUG_LIMIT);
        metadata[AETHERMOOR_DEBUG_KEY] = next;

        try {
            await context.saveMetadata();
        } catch (error) {
            if (previous === undefined) {
                delete metadata[AETHERMOOR_DEBUG_KEY];
            } else {
                metadata[AETHERMOOR_DEBUG_KEY] = previous;
            }
            throw error;
        }
    });
}

function recordNarrationDebug(type, details) {
    const metadata = getContext().chatMetadata;
    if (metadata?.[AETHERMOOR_DEBUG_KEY]?.enabled !== true) return;

    // Capture values now, before queued work or message rendering changes them.
    const entry = {
        time: new Date().toISOString(),
        type,
        revision: metadata[AETHERMOOR_METADATA_KEY]?.revision ?? null,
        details: clone(details)
    };

    void saveNarrationDebugChange(metadata, debug => {
        debug.entries.push(entry);
    }).catch(error => {
        console.warn('[Aethermoor] Diagnostic save failed', error);
    });
}

function openNarrationDebug() {
    const context = getContext();
    const metadata = context.chatMetadata;
    assert(metadata, 'Open a chat before viewing narration diagnostics');

    document.getElementById('aethermoor_narration_debug')?.remove();

    const panel = document.createElement('section');
    panel.id = 'aethermoor_narration_debug';
    panel.className = 'aethermoor-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Narration Debug');

    const header = document.createElement('header');
    header.className = 'aethermoor-panel-header';
    const title = document.createElement('b');
    title.textContent = 'NARRATION DEBUG';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => panel.remove());
    header.append(title, close);

    const body = document.createElement('main');
    body.className = 'aethermoor-panel-content';
    const status = document.createElement('div');
    status.className = 'aethermoor-ui-text';
    const controls = document.createElement('div');
    controls.className = 'aethermoor-ui-actions';

    const developerToolsLabel = document.createElement('label');
    developerToolsLabel.className = 'aethermoor-ui-text';
    const developerTools = document.createElement('input');
    developerTools.type = 'checkbox';
    developerTools.checked = aethermoorDeveloperToolsEnabled();
    developerToolsLabel.append(
        developerTools,
        document.createTextNode(' Expose developer function tools')
    );

    const developerToolsStatus = document.createElement('div');
    developerToolsStatus.className = 'aethermoor-ui-text';
    developerToolsStatus.textContent =
        'Tool exposure changes after reloading SillyTavern.';

    developerTools.addEventListener('change', () => {
        try {
            localStorage.setItem(
                AETHERMOOR_DEVELOPER_TOOLS_KEY,
                String(developerTools.checked)
            );
            developerToolsStatus.textContent =
                'Setting saved. Reload SillyTavern to change which ' +
                'tools the model can see.';
        } catch (error) {
            developerTools.checked =
                aethermoorDeveloperToolsEnabled();
            toastr.error(
                'Could not save developer tool setting.',
                'Aethermoor Debug'
            );
        }
    });

    const output = document.createElement('div');
    output.className = 'aethermoor-debug-records';

        async function copyDebugText(text, label) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_error) {
            const input = document.createElement('textarea');
            input.value = text;
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.focus();
            input.select();
            document.execCommand('copy');
            input.remove();
        }

        toastr.info(`${label} copied to clipboard.`, 'Narration Debug');
    }

    function recordCopyText(entry) {
        const details = entry.details || {};

        if (typeof details.text === 'string') {
            return details.text;
        }

        return JSON.stringify(details, null, 2);
    }

    function refresh() {
        const debug = metadata[AETHERMOOR_DEBUG_KEY];
        const entries = debug?.entries || [];

        status.textContent =
            `Recording: ${debug?.enabled ? 'ON' : 'OFF'} · ` +
            `${entries.length}/${AETHERMOOR_DEBUG_LIMIT} events\n` +
            'Private engine context may contain hidden quest information.\n' +
            'Each event has its own clipboard action.';
        toggle.textContent = debug?.enabled
            ? 'Disable recording'
            : 'Enable recording';

        output.replaceChildren();

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'aethermoor-ui-text';
            empty.textContent = 'No diagnostic records.';
            output.appendChild(empty);
            return;
        }

        entries.forEach((entry, index) => {
            const details = entry.details || {};
            const record = document.createElement('section');
            record.className = 'aethermoor-debug-record';

            const heading = document.createElement('div');
            heading.className = 'aethermoor-ui-heading';
            heading.textContent =
                `${index + 1}. ${entry.type} · ` +
                `${entry.time}`;

            const metadataLine = document.createElement('div');
            metadataLine.className = 'aethermoor-ui-text';
            metadataLine.textContent =
                `Revision: ${entry.revision ?? 'none'}` +
                (
                    details.eventType
                        ? ` · Event: ${details.eventType}`
                        : ''
                ) +
                (
                    details.messageId !== undefined &&
                    details.messageId !== null
                        ? ` · Message: ${details.messageId}`
                        : ''
                );

            const copyButton = makeAethermoorAction(
                entry.type === 'assistant_notification'
                    ? 'Copy observed message'
                    : entry.type === 'handoff_injected'
                        ? 'Copy injected handoff'
                        : 'Copy record',
                'world',
                () => {
                    void copyDebugText(
                        recordCopyText(entry),
                        'Diagnostic text'
                    );
                }
            );

            record.append(
                heading,
                metadataLine,
                copyButton
            );

            output.appendChild(record);
        });
    }

    async function changeDebug(change) {
        try {
            assert(
                getContext().chatMetadata === metadata,
                'Chat changed; reopen Narration Debug in the current chat'
            );
            await saveNarrationDebugChange(metadata, change);
            refresh();
        } catch (error) {
            toastr.error(error.message || String(error), 'Narration Debug');
        }
    }

    const toggle = makeAethermoorAction('Enable recording', 'world', () => {
        void changeDebug(debug => {
            debug.enabled = !debug.enabled;
        });
    });
    const refreshButton = makeAethermoorAction('Refresh records', 'world', refresh);
    const clear = makeAethermoorAction('Clear records', 'world', () => {
        void changeDebug(debug => {
            debug.entries = [];
        });
    });

    const createTestRumor = makeAethermoorAction(
        'Create test rumor',
        'world',
        async () => {
            try {
                const result = await runStoredMechanic({
                    cases: [{
                        name: 'debug_create_rumor',
                        kind: 'debug_create_rumor',
                        inquiryId: `watchtower-test-${Date.now()}`,
                        reason: 'Test Rumor Site',
                        completionEvidence:
                            'A debug rumor points to a test destination.'
                    }]
                });

                assert(
                    result?.ok === true &&
                    result.results?.[0]?.ok !== false,
                    result?.results?.[0]?.error ||
                        'Could not create test rumor'
                );

                toastr.info('Test rumor created.', 'Aethermoor Debug');
            } catch (error) {
                toastr.error(
                    error instanceof Error
                        ? error.message
                        : String(error),
                    'Aethermoor Debug'
                );
            }
        }
    );

    controls.append(toggle, refreshButton, clear, createTestRumor);
    body.append(
        status,
        developerToolsLabel,
        developerToolsStatus,
        controls,
        output
    );
    panel.append(header, body);
    document.body.appendChild(panel);
    refresh();
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
            '- Report only useful player-facing results, such as final HP, ' +
            'rewards, quest changes, and whether the crew arrived. Do not ' +
            'narrate internal counters such as travel segments or repeat ' +
            'per-exchange HP bookkeeping.\n' +
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

/*
 * Identify the actual saved assistant reply, not an NPC name supplied by
 * the narrator. Both received and rendered notifications for that reply
 * derive the same ID. If the reply is not in chat yet, wait for a later
 * notification rather than roll under an unstable event identity.
 *
 * This identifies an inquiry event, not a fictional person. Persistent NPC
 * recognition needs a separate, explicitly linked continuity record.
 */
function socialWorkIdForAssistantMessage(message) {
    const chat = getContext().chat;

    if (!Array.isArray(chat)) return null;

    for (let index = chat.length - 1; index >= 0; index--) {
        const entry = chat[index];

        if (
            entry?.is_user !== true &&
            entry?.is_system !== true &&
            entry?.mes === message.text
        ) {
            /*
             * The private handoff is temporarily inserted into chat and
             * removed after generation. Exclude system messages from the
             * position used for identity so both notifications for this
             * reply derive the same inquiry ID.
             */
            const savedPosition = chat
                .slice(0, index)
                .filter(item => item?.is_system !== true)
                .length;

            return (
                `work-${savedPosition}-` +
                worldHash(entry.mes).toString(36)
            );
        }
    }

    return null;
}

/*
 * Technical explanations and beta reports may quote packet headings or
 * protocol examples as code. Those examples are neither narration leaks
 * nor gameplay events. Detection and event extraction must inspect the
 * same text so ignoring an example cannot accidentally authorize its tags.
 *
 * Real protocol tags inside <plan> remain eligible: <plan> is not a
 * Markdown code fence. This helper changes no saved mechanics or RNG.
 */
function aethermoorNonCodeText(text) {
    if (typeof text !== 'string') return '';

    const lines = text.split(/\r?\n/);
    const output = [];
    let fenceCharacter = null;
    let fenceLength = 0;

    for (const line of lines) {
        const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);

        if (fenceCharacter) {
            if (
                fence &&
                fence[1][0] === fenceCharacter &&
                fence[1].length >= fenceLength &&
                fence[2].trim() === ''
            ) {
                fenceCharacter = null;
                fenceLength = 0;
            }

            output.push('');
            continue;
        }

        if (fence) {
            fenceCharacter = fence[1][0];
            fenceLength = fence[1].length;
            output.push('');
            continue;
        }

        output.push(line);
    }

    // Inline code examples are also explanatory text, not event reports.
    return output.join('\n').replace(/(`+)[^`\n]*?\1/g, '');
}

function extractAethermoorQuestEvents(text) {
    if (typeof text !== 'string') return [];
    text = aethermoorNonCodeText(text);
    const events = [];

    /*
     * A work check is a report of an already narrated interaction.
     * Require it inside the disposable plan block, not in story prose.
     */
    for (const plan of text.matchAll(/<plan\b[^>]*>([\s\S]*?)<\/plan>/gi)) {
        const themePattern =
            /<AETHERMOOR:INSTANCE_THEME\s+instance=([A-Za-z0-9._:-]+)\s*>([\s\S]*?)<\/AETHERMOOR:INSTANCE_THEME>/g;

        for (const match of plan[1].matchAll(themePattern)) {
            try {
                events.push({
                    event: 'instance_theme',
                    instanceId: match[1],
                    names: JSON.parse(match[2].trim())
                });
            } catch (error) {
                reportAethermoorError(
                    error,
                    'Instance theme JSON rejected',
                    `theme-json:${worldHash(text)}:${match.index}`
                );
            }
        }

        const namingPattern =
            /<AETHERMOOR:STOCK_NAMES\s+zone=([1-9]\d*)\s*>([\s\S]*?)<\/AETHERMOOR:STOCK_NAMES>/g;

        for (const match of plan[1].matchAll(namingPattern)) {
            try {
                events.push({
                    event: 'stock_names',
                    zone: Number(match[1]),
                    names: JSON.parse(match[2].trim())
                });
            } catch (error) {
                reportAethermoorError(
                    error,
                    'Stock names JSON rejected',
                    `stock-json:${worldHash(text)}:${match.index}`
                );
            }
        }

        /*
         * ASK_WORK reports the interaction only. The GM does not assign
         * contact identity. REVEAL_WORK below uses an ID previously
         * issued by the engine.
         */
        const pattern = /<AETHERMOOR:ASK_WORK\s*>/g;

        for (const _match of plan[1].matchAll(pattern)) {
            events.push({
                event: 'ask_work'
            });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:ASK_WARES\s*>/g
        )) {
            events.push({ event: 'ask_wares' });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:ASK_HERBALIST\s*>/g
        )) {
            events.push({ event: 'ask_herbalist' });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:ASK_INN\s*>/g
        )) {
            events.push({ event: 'ask_inn' });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:INN_AGREED\s*>/g
        )) {
            events.push({ event: 'inn_agreed' });
        }

        const expenseQuotePattern =
            /<AETHERMOOR:EXPENSE_QUOTE\s+amount=([1-9]\d*)\s+reason="([^"]{1,160})"\s*>/g;

        for (const match of plan[1].matchAll(expenseQuotePattern)) {
            events.push({
                event: 'expense_quote',
                amount: Number(match[1]),
                reason: match[2]
            });
        }

        const expenseAgreementPattern =
            /<AETHERMOOR:EXPENSE_AGREED\s+quote_id=(work-[0-9]+-[a-z0-9]+)\s*>/g;

        for (const match of plan[1].matchAll(expenseAgreementPattern)) {
            events.push({
                event: 'expense_agreed',
                quoteId: match[1]
            });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:HERBALIST_AGREED\s*>/g
        )) {

            events.push({ event: 'herbalist_agreed' });
        }

        for (const _match of plan[1].matchAll(
            /<AETHERMOOR:TRADE_AGREED\s*>/g
        )) {
            events.push({
                event: 'trade_agreed'
            });
        }

        const breadcrumbPattern =
            /<AETHERMOOR:FOLLOW_BREADCRUMB\s+id=([A-Za-z0-9._:-]+)\s*>/g;

        for (const match of plan[1].matchAll(breadcrumbPattern)) {
            events.push({
                event: 'follow_breadcrumb',
                breadcrumbId: match[1]
            });
        }

        const revealPattern =
            /<AETHERMOOR:REVEAL_WORK\s+social_id=([A-Za-z0-9._:-]{1,80})\s*>/g;

        for (const match of plan[1].matchAll(revealPattern)) {
            events.push({
                event: 'reveal_work',
                socialId: match[1]
            });
        }
    }

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
    text = aethermoorNonCodeText(text);
    const leaks = [];

    /*
     * A marker mention is not sufficient evidence of a leaked handoff.
     * Require the opening marker, the private-context heading, and the
     * closing marker in their actual packet positions. Fenced and inline
     * code examples have already been excluded from this inspection.
     */
    const handoffPattern =
        /^\s*<aethermoor-mechanics-handoff>\s*\r?\n\s*PRIVATE ENGINE CONTEXT\b[\s\S]*?^\s*<aethermoor-mechanics-handoff>\s*$/im;

    if (handoffPattern.test(text)) {
        leaks.push('complete engine handoff');
    }

    const signatures = [
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

    for (const signature of signatures) {
        if (signature.pattern.test(text)) {
            leaks.push(signature.label);
        }
    }

    return leaks;
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
        'Recognizable engine-instruction text appeared outside a code example. ' +
        'This may be technical discussion or copied narration context; ' +
        'inspect the reply before diagnosing a problem. ' +
        'Discovery and delivery tags from this reply were ignored. ' +
        'Saved mechanics were not undone or rerolled.',
        'Aethermoor: Instruction-text match'
    );
}

async function processAethermoorAssistantEvents(data) {
    const message = getAssistantMessageText(data);
    if (!message) return;

    /*
     * Leak detection is intentionally disabled. The handoff contains
     * authorized scene facts and instructions; matching its wording is
     * not evidence that secret information was exposed. Keep the detector
     * helpers below for possible future use. The Narration Recorder is the
     * diagnostic source when an actual exposure is suspected.
     */
    
    const events = extractAethermoorQuestEvents(message.text);
    if (events.length === 0) return;

        for (const event of events) {
        try {
            let result;
            if (event.event === 'instance_theme') {
                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_instance_theme',
                        kind: 'instance',
                        action: 'theme',
                        instanceId: event.instanceId,
                        names: event.names
                    }]
                });
            } else if (event.event === 'stock_names') {
                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_cosmetic_stock_names',
                        kind: 'stock_names',
                        action: 'apply',
                        zone: event.zone,
                        names: event.names
                    }]
                });
            } else if (event.event === 'follow_breadcrumb') {
                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_follow_breadcrumb',
                        kind: 'follow_breadcrumb',
                        breadcrumbId: event.breadcrumbId
                    }]
                });
            } else if (event.event === 'expense_quote') {
                const socialId =
                    socialWorkIdForAssistantMessage(message);

                assert(
                    socialId,
                    'Expense quote awaits a saved assistant message'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_expense_quote',
                        kind: 'currency',
                        action: 'quote',
                        socialId,
                        amount: event.amount,
                        reason: event.reason
                    }]
                });
            } else if (event.event === 'expense_agreed') {
                const socialId =
                    socialWorkIdForAssistantMessage(message);

                assert(
                    socialId,
                    'Expense agreement awaits a saved assistant message'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_expense_commit',
                        kind: 'currency',
                        action: 'commit',
                        socialId,
                        quoteId: event.quoteId
                    }]
                });
            } else if (event.event === 'ask_work') {
                const socialId =
                    socialWorkIdForAssistantMessage(message);

                assert(
                    socialId,
                    'Work inquiry awaits a saved assistant message'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_social_work_inquiry',
                        kind: 'social',
                        action: 'check_work',
                        socialId
                    }]
                });
            } else if (event.event === 'reveal_work') {
                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_social_work_reveal',
                        kind: 'social',
                        action: 'reveal_work',
                        socialId: event.socialId
                    }]
                });
            } else if (event.event === 'ask_wares') {
                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(
                    messageId,
                    'Wares inquiry awaits a saved assistant message'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_vendor_menu_open',
                        kind: 'vendor',
                        action: 'open',
                        socialId: messageId
                    }]
                });

                assert(
                    result?.ok === true &&
                    result.results?.[0]?.result?.action === 'open',
                    'Vendor menu did not open'
                );

                await openAethermoorShopWindow();
            } else if (event.event === 'ask_herbalist') {
                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(messageId, 'Herbalist inquiry awaits a saved reply');

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_herbalist_open',
                        kind: 'herbalist',
                        action: 'open',
                        socialId: messageId
                    }]
                });

                assert(
                    result?.ok === true &&
                    result.results?.[0]?.result?.action === 'open',
                    'Herbalist menu did not open'
                );

                await openAethermoorHerbalistWindow();
            } else if (event.event === 'ask_inn') {
                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(messageId, 'Inn inquiry awaits a saved reply');

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_inn_open',
                        kind: 'inn',
                        action: 'open',
                        socialId: messageId
                    }]
                });

                assert(
                    result?.ok === true &&
                    result.results?.[0]?.result?.action === 'open',
                    'Inn menu did not open'
                );

                await openAethermoorInnWindow();
            } else if (event.event === 'inn_agreed') {
                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(messageId, 'Inn agreement awaits a saved reply');

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_inn_commit',
                        kind: 'inn',
                        action: 'commit',
                        socialId: messageId
                    }]
                });
            } else if (event.event === 'herbalist_agreed') {

                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(messageId, 'Herbalist agreement awaits a saved reply');

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_herbalist_commit',
                        kind: 'herbalist',
                        action: 'commit',
                        socialId: messageId
                    }]
                });
            } else if (event.event === 'trade_agreed') {

                const messageId =
                    socialWorkIdForAssistantMessage(message);

                assert(
                    messageId,
                    'Trade agreement awaits a saved assistant message'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_vendor_trade_agreement',
                        kind: 'vendor',
                        action: 'commit',
                        socialId: messageId
                    }]
                });
            } else if (event.event === 'delivered') {
                const stateResult = await readStoredCombatState();
                const quest = findQuestById(
                    stateResult.state,
                    event.questId
                );

                assert(
                    quest?.status === 'in_progress',
                    'Delivery tag does not match an in-progress quest'
                );

                result = await runStoredMechanic({
                    cases: [{
                        name: 'assistant_quest_delivery',
                        kind: 'quest_delivery',
                        questId: event.questId
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
            reportAethermoorError(
                error,
                `Assistant event rejected (${event.event})`,
                `assistant:${worldHash(message.text)}:` +
                    `${event.event}:${JSON.stringify(event)}:` +
                    `${error instanceof Error ? error.message : String(error)}`
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

const AETHERMOOR_INSTANCE_COMMAND =
    /\[\s*AETHERMOOR:INSTANCE\s+instance="([A-Za-z0-9._:-]+)"\s+action="(enter|move|exit)"(?:\s+room="([A-Za-z0-9._:-]+)")?\s*\]/i;

function instanceCommand(instanceId, action, roomId = null) {
    return `[AETHERMOOR:INSTANCE instance="${instanceId}" ` +
        `action="${action}"` +
        (roomId ? ` room="${roomId}"` : '') +
        ']';
}

function findLatestUserInstanceMovement(chat) {
    const index = findLastUserMessage(chat);
    const text = chat[index]?.mes;

    if (typeof text !== 'string') return null;

    const prose = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '');

    const match = prose.match(AETHERMOOR_INSTANCE_COMMAND);

    return match
        ? {
            index,
            text: prose,
            instanceId: match[1],
            action: match[2].toLowerCase(),
            roomId: match[3] || null
        }
        : null;
}

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

/*
 * The GM cannot receive a newly resolved interaction midway through its
 * reply. Give it the reporting rule before settlement conversation, then
 * supply saved results on later replies. This is read-only prompt context:
 * the assistant's tag requests a check; only the saved mechanic decides
 * whether a job exists. Apply the same delayed-handshake principle to
 * future vendor and site interactions.
 */
function settlementWorkContextPacket(state, settlement) {
    const contacts = Object.values(
        state.socialOpportunities?.contacts || {}
    ).filter(contact =>
        contact.settlementId === settlement.id
    );

    const lines = [
        'PRIVATE SETTLEMENT CONVERSATION CONTEXT — do not recite.',
        `Current settlement: ${settlement.label}.`,
        'Ordinary conversation needs no mechanics tag.',
        'If the players ask a local merchant to show their wares, ' +
            'respond naturally without inventing stock, stats, or prices. ' +
            'Place <AETHERMOOR:ASK_WARES> inside the disposable <plan> block.',
        'The extension opens its exact stock in a separate shop window ' +
            'after that reply. On a later relevant reply, invite the ' +
            'players to consult that window. You may describe region-appropriate ' +
            'cosmetic appearances; do not change item identities, ' +
            'bonuses, variants, prices, or ownership.',
        'Seeing wares does not purchase or equip an item.',
        'If the players ask an innkeeper about meals, rooms, or hot ' +
            'water, have the innkeeper offer a bill of fare or ordering ' +
            'slate and put <AETHERMOOR:ASK_INN> inside <plan>. The ' +
            'extension opens its exact service menu after this reply. ' +
            'The player’s selections represent what they indicate on ' +
            'that slate; no payment occurs yet. Dress meals and rooms ' +
            'for the locale, but do not invent prices, healing, or buffs.',
        'If the players ask a herbalist to trade potions, respond ' +
            'naturally without inventing prices, healing, or stock. ' +
            'Place <AETHERMOOR:ASK_HERBALIST> inside <plan>. The ' +
            'extension opens its separate potion window after this reply.',
        'If the players meaningfully ask a local person about work, ' +
            'respond naturally without promising a specific unestablished job.',
        'For the first meaningful work inquiry with a local person, ' +
            'put this tag in the disposable <plan> block:',
        '<AETHERMOOR:ASK_WORK>',
        'Do not supply a social_id or invent a contact ID. Report at most ' +
            'one new work inquiry per reply.',
        'The extension assigns an ID to the saved reply, checks once, ' +
            'and supplies its result on a later reply. A check does not ' +
            'accept a quest or make every NPC a quest giver.',
        'For a person already listed below, reuse their engine-issued ' +
            'contact ID; do not report them as a new inquiry. The engine ' +
            'cannot independently identify a returning NPC from prose.',
        'Do not mention the tag, roll, or extension in story prose.'
    ];

    const stagedTrade = state.vendorMenu?.pendingBasket;

    if (
        stagedTrade?.settlementId === settlement.id &&
        stagedTrade.zone === state.zone
    ) {
        lines.push(
            'A trade selection is staged, but NOTHING has been sold, ' +
                'bought, paid, or equipped yet.',
            `Merchant asks ${stagedTrade.cost}s; crew offers items ` +
                `valued at ${stagedTrade.proceeds}s. ` +
                `Projected purse after exchange: ${stagedTrade.purseAfter}s.`,
            'Only if the players agree to this staged exchange AND the ' +
                'merchant agrees in the fiction, place this exact tag ' +
                'inside the disposable <plan> block:',
            '<AETHERMOOR:TRADE_AGREED>',
            'The tag supplies no prices or item identities. The engine ' +
                'rechecks the saved basket and commits it atomically ' +
                'after this reply. Do not claim an item is equipped.'
        );
    }

    const stagedHerbs = state.herbalistMenu?.pendingBasket;

    if (
        stagedHerbs?.settlementId === settlement.id &&
        stagedHerbs.zone === state.zone
    ) {
        lines.push(
            'A herbalist exchange is staged but has NOT happened.',
            `Potion purchases: ${stagedHerbs.cost}s; ` +
                `potion sales: ${stagedHerbs.proceeds}s; ` +
                `projected purse: ${stagedHerbs.purseAfter}s.`,
            'Only after the players and herbalist agree to that ' +
                'exchange in the fiction, put ' +
                '<AETHERMOOR:HERBALIST_AGREED> inside <plan>. ' +
                'The engine will validate and apply the saved basket.'
        );
    }

    const stagedInn = state.innMenu?.pendingBasket;

    if (stagedInn?.settlementId === settlement.id) {
        lines.push(
            'Inn services are selected but NOT paid for yet.',
            ...stagedInn.choices.map(choice =>
                `${choice.label} ×${choice.quantity}: ` +
                    `${choice.unitPrice * choice.quantity}s.`
            ),
            `Total ${stagedInn.cost}s; projected purse ` +
                `${stagedInn.purseAfter}s.`,
            'The staged services are what the crew indicated on the ' +
                'innkeeper’s bill of fare, not a payment already made. ' +
                'If their spoken order differs, have the innkeeper point ' +
                'to the specific mismatch and ask which they want. ' +
            'The player can reopen Inn Services and correct the ' +
                'selection. Do not invent a prior order, treat the ' +
                'difference as money paid or owed, silently substitute ' +
                'services, charge a difference, or emit INN_AGREED.',
            'Only after the players and innkeeper agree to the SAME ' +
                'staged services in the fiction, put ' +
                '<AETHERMOOR:INN_AGREED> inside <plan>. ' +
                'The engine will deduct the saved expense after this reply.'
        );
    }

    for (const contact of contacts) {
         if (contact.result === 'offer') {
            const quest = contact.pendingQuest ||
                Object.values(state.quests || {})
                    .flatMap(bucket =>
                        Array.isArray(bucket) ? bucket : []
                    )
                    .find(entry => entry?.id === contact.questId);

            if (quest) {
                lines.push(
                    `Previously checked contact ${contact.id}: ` +
                        `quest ${quest.id} (${quest.status}).`,
                    questOfferNarrationPacket(quest),
                    'Use this information only if conversation with THAT ' +
                        'contact resumes. Do not announce their job while ' +
                        'speaking to someone else or after the crew leaves.',
                    ...(contact.pendingQuest
                        ? [
                            'After actually revealing this request to the ' +
                                'players, place this exact tag inside <plan>:',
                            `<AETHERMOOR:REVEAL_WORK social_id=${contact.id}>`,
                            'This publishes the locked offer; it does not ' +
                                'accept the quest or grant rewards.'
                        ]
                        : [])
                );
            }

        } else {
            lines.push(
                `Previously checked contact ${contact.id}: no job. ` +
                    'Conversation may continue; do not reroll this contact.'
            );
        }
    }

    return lines.join('\n');
}

globalThis.aethermoorMechanicsInterceptor =
    async function (chat) {
        if (!Array.isArray(chat)) return;

        const localMovement =
            findLatestUserInstanceMovement(chat);

        if (localMovement) {
            try {
                await runStoredMechanic({
                    cases: [{
                        name: 'resolve_instance_command',
                        kind: 'instance',
                        stepId: travelStepId(localMovement),
                        instanceId: localMovement.instanceId,
                        action: localMovement.action,
                        ...(localMovement.roomId
                            ? { roomId: localMovement.roomId }
                            : {})
                    }]
                });
            } catch (error) {
                reportAethermoorError(
                    error,
                    'Instance movement failed',
                    `instance-move:${travelStepId(localMovement)}:` +
                        `${error instanceof Error ? error.message : String(error)}`
                );
            }
        } else {
            const movement = findLatestUserMovement(chat);

            if (movement) {
                try {
                    await runStoredMechanic({
                        cases: [{
                            name: 'resolve_movement_command',
                            kind: 'travel',
                            stepId: travelStepId(movement),
                            destinationId:
                                movement.destinationId || undefined
                        }]
                    });
                } catch (error) {
                    reportAethermoorError(
                        error,
                        'Travel failed',
                        `travel:${travelStepId(movement)}:` +
                            `${error instanceof Error ? error.message : String(error)}`
                    );
                }
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
        const contextState = state ? clone(state) : null;

        const questJournal = contextState
            ? ensureQuestJournal(contextState)
            : null;

              /*
         * The journal, not activeQuest selection, determines which accepted
         * quests concern this location. Context is detached and read-only:
         * it never prepares or saves discoveries during prompt construction.
         */
        const relevantQuests = (questJournal?.accepted || [])
            .filter(quest =>
                quest?.status === 'in_progress' &&
                (
                    quest.destinationId === contextState.currentLocationId ||
                    quest.turnIn?.locationId === contextState.currentLocationId
                )
            );

        if (
            contextState &&
            !['active', 'spotted'].includes(
                contextState.encounter?.status
            )
        ) {
            for (const quest of relevantQuests) {
                if (
                    quest.deliveryReady === true &&
                    contextState.currentLocationId ===
                        quest.turnIn?.locationId
                ) {
                    const packet = questDeliveryContextPacket(quest);

                    if (packet) {
                        entries.push({
                            id: `delivery-context-${quest.id}`,
                            type: 'quest_delivery_context',
                            packet
                        });
                    }
                }

                if (
                    contextState.currentLocationId === quest.destinationId
                ) {
                    const packet = questDiscoveryContextPacket(quest);

                    if (packet) {
                        entries.push({
                            id:
                                `scene-context-${quest.id}-` +
                                `${quest.currentGate?.step || 1}`,
                            type: 'quest_context',
                            packet
                        });
                    }
                }
            }
        }

        /*
         * Ask for a site's cosmetic identity only when the crew reaches
         * its entrance or is exploring it. Resend an established identity
         * during exploration so the GM need not remember a consumed
         * handoff or infer the theme from generic room labels.
         */
        if (contextState && !contextState.currentJourney) {
            const instance = contextState.activeInstanceId
                ? contextState.instances?.[
                    contextState.activeInstanceId
                  ]
                : Object.values(
                    contextState.instances || {}
                  ).find(site =>
                    site.entranceId ===
                        contextState.currentLocationId
                  );

            if (
                instance &&
                contextState.zone === instance.zone &&
                contextState.currentLocationId === instance.entranceId
            ) {
                if (instance.presentation?.established === true) {
                    entries.push({
                        id: `instance-identity-${instance.id}`,
                        type: 'instance_identity',
                        packet: [
                            'PRIVATE SAVED INSTANCE IDENTITY — do not recite.',
                            `Instance: ${instance.presentation.name}.`,
                            `Kind: ${instance.presentation.kind}.`,
                            `Atmosphere: ${
                                instance.presentation.atmosphere
                            }.`,
                            'Keep later room descriptions consistent with ' +
                                'this identity and the saved geography.',
                            'Room count, exits, threats, rewards, and ' +
                                'clearance still come only from the engine.'
                        ].join('\n')
                    });
                } else {
                    const geography =
                        contextState.world?.zones?.[
                            instance.zone
                        ]?.geography?.description ||
                        'the local region';

                    entries.push({
                        id: `instance-theme-request-${instance.id}`,
                        type: 'instance_theme_request',
                        packet: [
                            'PRIVATE INSTANCE IDENTITY REQUEST.',
                            `Engine-issued instance ID: ${instance.id}.`,
                            `Saved geography: ${geography}.`,
                            'This is a finite fixed site. Choose a short ' +
                                'locally fitting name, a kind of place, ' +
                                'and one sentence of atmosphere.',
                            'The kind may be a ruin, camp, catacomb, ' +
                                'worksite, cave complex, or another form ' +
                                'that makes sense here. Do not assume ' +
                                'one particular culture or biome.',
                            'In this reply, place exactly this form ' +
                                'inside <plan>, replacing the JSON values:',
                            `<AETHERMOOR:INSTANCE_THEME instance=${
                                instance.id
                            }>{"name":"Local site name","kind":"kind of place","atmosphere":"Short atmospheric description"}</AETHERMOOR:INSTANCE_THEME>`,
                            'You are naming presentation only. Do not ' +
                                'add rooms, exits, enemies, puzzles, ' +
                                'loot, bosses, or rewards.',
                            'Describe the arrival or current room ' +
                                'naturally; do not discuss this request.'
                        ].join('\n')
                    });
                }
            }
        }

        /*
         * Breadcrumbs survive replacement of the encounter. Supply
         * only unresolved clues at the crew's actual saved position.
         * The GM reports the player's pursuit; it does not choose or
         * generate the resulting quest.
         */
        if (
            contextState &&
            !['active', 'spotted'].includes(
                contextState.encounter?.status
            )
        ) {
            const position = contextState.currentPosition ||
                { nodeId: contextState.currentLocationId };

            for (const breadcrumb of Object.values(
                contextState.breadcrumbs || {}
            )) {
                if (
                    breadcrumb.questSeedConsumed ||
                    breadcrumb.locationId !==
                        contextState.currentLocationId ||
                    JSON.stringify(breadcrumb.position) !==
                        JSON.stringify(position)
                ) {
                    continue;
                }

                entries.push({
                    id: `breadcrumb-context-${breadcrumb.id}`,
                    type: 'breadcrumb_context',
                    packet: [
                        'PRIVATE BREADCRUMB CONTEXT — do not recite.',
                        `A cleared pack left clue ${breadcrumb.id} here.`,
                        'Its specific quest has NOT been established.',
                        'If the player actually chooses to examine or ' +
                            'pursue this clue, narrate that first beat ' +
                            'without promising a particular job. Put ' +
                            'this exact tag inside <plan>:',
                        `<AETHERMOOR:FOLLOW_BREADCRUMB id=${
                            breadcrumb.id
                        }>`,
                        'The engine will lock an offer after this reply. ' +
                            'Do not accept the offer for the crew.'
                    ].join('\n')
                });
            }
        }

        /*
         * Supply the interaction rule on ordinary settlement replies,
         * not only after a quest result has already been queued. Include
         * saved contact results so a resumed conversation does not depend
         * on a consumed one-use handoff or long-term LLM memory.
         */
        if (contextState) {
            const settlement = Object.values(
                contextState.world?.settlements || {}
            ).find(entry =>
                entry.locationId === contextState.currentLocationId
            );

            if (settlement) {
                entries.push({
                    id: `settlement-work-context-${settlement.id}`,
                    type: 'social_context',
                    packet: settlementWorkContextPacket(
                        contextState,
                        settlement
                    )
                });

                const namingEntries =
                    stockNamingEntries(contextState);

                const savedNames =
                    contextState.cosmeticStockNames?.[
                        contextState.zone
                    ] || {};

                const missingNamingEntries =
                    namingEntries.filter(entry =>
                        typeof savedNames[entry.key] !== 'string'
                    );

                if (
                    !contextState.currentJourney &&
                    missingNamingEntries.length > 0
                ) {

                    entries.push({
                        id: `stock-naming-zone-${contextState.zone}`,
                        type: 'cosmetic_naming',
                        packet: [
                            'PRIVATE COSMETIC STOCK NAMING REQUEST.',
                            `Zone ${contextState.zone}: ` +
                                `${contextState.world.zones[
                                    contextState.zone
                                ].name}.`,
                            `Geography: ${
                                contextState.world.zones[
                                    contextState.zone
                                ].geography.description
                            }.`,
                            'In this reply, return one JSON object containing ' +
                                'exactly these keys and fictional item names:',
                            ...missingNamingEntries.map(entry =>
                                `- ${entry.key}: ${entry.description}`
                            ),
                            'Put it inside this exact form in <plan>:',
                            `<AETHERMOOR:STOCK_NAMES zone=${
                                contextState.zone
                            }>{"key":"cosmetic name"}</AETHERMOOR:STOCK_NAMES>`,
                            'Replace the example JSON with ALL requested ' +
                                'keys. Use the keys exactly. Names are ' +
                                'cosmetic only: no numbers, HP, prices, ' +
                                'tiers, stats, or mechanical claims.',
                            'Do not recite this request or delay the ' +
                                'ordinary scene to discuss naming.'
                        ].join('\n')
                    });
                }
            }
        }
        if (contextState?.pendingExpense) {
            const quote = contextState.pendingExpense;

            entries.push({
                id: `expense-quote-context-${quote.id}`,
                type: 'expense_quote_context',
                packet: [
                    'PRIVATE PENDING EXPENSE QUOTE — do not recite.',
                    `Quote ID: ${quote.id}.`,
                    `Purpose: ${quote.reason}.`,
                    `Amount: ${quote.amount}s.`,
                    'No silver has been deducted.',
                    'The player must explicitly agree to this exact amount ' +
                        'and purpose before payment.',
                    'If they agree in this reply, place this exact tag inside <plan>:',
                    `<AETHERMOOR:EXPENSE_AGREED quote_id=${quote.id}>`,
                    'If they decline or negotiate, do not emit the tag. ' +
                        'A changed price requires a new quote.',
                    'Do not mention the tag, extension, or internal accounting.'
                ].join('\n')
            });
        }

        if (!metadata || entries.length === 0) {
            console.log('[Aethermoor] No handoff queued');
            return;
        }

        // The handoff is inserted for generation. Retain its exact object
        // and metadata reference so cleanup cannot affect another chat.
        const message = makeAethermoorHandoffMessage(entries);

        recordNarrationDebug('handoff_injected', {
            handoffIds: entries.map(entry => entry.id),
            text: message.mes
        });

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

        recordNarrationDebug('handoff_consumed', {
            handoffIds: injected.ids
        });

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
            const observed = getAssistantMessageText(data);

            recordNarrationDebug('assistant_notification', {
                eventType,
                messageId: observed?.messageId ?? null,
                text: observed?.text ?? null,
                textOrigin:
                    typeof data === 'string' ||
                    typeof data?.mes === 'string' ||
                    typeof data?.message === 'string' ||
                    typeof data?.message?.mes === 'string'
                        ? 'event_payload'
                        : 'chat_lookup',
                handoffIds: aethermoorInjectedHandoff?.ids || []
            });

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

        recordNarrationDebug('generation_ended', {
            handoffIds: injected?.ids || [],
            replyReceived: Boolean(injected?.replyReceived),
            temporaryHandoffPresent: Boolean(
                injected?.chat?.includes(injected.message)
            )
        });

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
    if (aethermoorDeveloperToolsEnabled()) {
        try {
            registerAethermoorTools();
        } catch (error) {
            console.error(
                'Aethermoor: Function-tool registration failed',
                error
            );
        }
    } else {
        console.log(
            '[Aethermoor] Developer function tools disabled'
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

