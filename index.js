const { CortexWebsocket } = require("yacht-data-streams/build/src/cortex-ws");

module.exports = (app) => {
    let unsubscribes = [];

    let websocket;

    const plugin = {
        id: "signalk-cortex-plugin",
        name: "Cortex (Vesper) VHF",
        start: (settings, restartPlugin) => {
            websocket = new CortexWebsocket(settings.cortex_host, [
                ...(settings.send_vessel_information || settings.send_anchor_radius ? ["VesselControl"] : []),
                ...(settings.send_vessel_position || settings.send_anchor_radius ? ["VesselPositionUnderway"] : []),
                ...(settings.send_heading ? ["InternalHeading"] : []),
                ...(settings.send_anchor_radius ? ["Heading"] : []),
                ...(settings.send_pressure ? ["BarometricPressure"] : []),
                ...(settings.send_anchor || settings.send_anchor_radius ? ["AnchorWatchControl"] : []),
                ...(settings.send_anchor_alarm ? ["AnchorWatch"] : []),
            ]);

            let lastPosition = null;
            let lastAnchorPosition = null;
            let lastAnchorSet = null;
            let lastLength = null;
            let lastAntennaToStern = null;
            let lastHeading = null;

            const makeCalcValues = () => {
                // app.debug(`Calculating derived values with ${JSON.stringify({ position: lastPosition, anchorPosition: lastAnchorPosition, length: lastLength, antennaToStern: lastAntennaToStern, heading: lastHeading })}`);
                const values = [];

                if (settings.send_anchor_radius) {
                    if (lastPosition != null && lastLength != null && lastAntennaToStern != null && lastHeading != null && lastAnchorPosition != null) {
                        const bowPosition = getLocationFromBearing(
                            lastPosition,
                            lastLength - lastAntennaToStern,
                            lastHeading
                        );
                        values.push({
                            path: 'navigation.anchor.currentRadius',
                            value: getDistance(bowPosition, lastAnchorPosition),
                        });
                        values.push({
                            path: 'navigation.anchor.bearingTrue',
                            value: degToRad(bearing(bowPosition, lastAnchorPosition)),
                        });
                    } else if (lastAnchorSet === false) {
                        values.push({
                            path: 'navigation.anchor.currentRadius',
                            value: null,
                        });
                        values.push({
                            path: 'navigation.anchor.bearingTrue',
                            value: null,
                        });
                    } else {
                        app.debug(`Not enough data to calculate anchor radius/bearing: ${JSON.stringify({ position: lastPosition, anchorPosition: lastAnchorPosition, length: lastLength, antennaToStern: lastAntennaToStern, heading: lastHeading })}`);
                    }
                }

                return values;
            }
            const sendCalcValuesIfNeeded = () => {
                const calcValues = makeCalcValues();
                if (calcValues.length > 0) {
                    app.handleMessage(plugin.id, {
                        updates: [{
                            values: calcValues,
                        }]
                    });
                }
            }

            websocket.on("message", (msgType, payload) => {
                switch (msgType) {
                    case 'VesselControl':
                        const values = []

                        if (payload.name) {
                            values.push({
                                path: 'name',
                                value: payload.name,
                            });
                        }

                        if (payload.mmsi) {
                            values.push({
                                path: 'mmsi',
                                value: payload.mmsi.toString(),
                            });
                        }

                        if (payload.callSign) {
                            values.push({
                                path: 'communication',
                                value: { callsignVhf: payload.callSign },
                            });
                        }

                        if (payload.type) {
                            values.push({
                                path: 'design.aisShipType',
                                value: { id: payload.type },
                            });
                        }

                        if (payload.dimensions.length != null) {
                            lastLength = payload.dimensions.length;
                            values.push({
                                path: 'design.length',
                                value: { overall: payload.dimensions.length },
                            });
                        }

                        if (payload.dimensions.beam != null) {
                            values.push({
                                path: 'design.beam',
                                value: payload.dimensions.beam,
                            });
                        }

                        if (payload.dimensions.length != null && payload.dimensions.antennaToStern != null) {
                            lastAntennaToStern = payload.dimensions.antennaToStern;
                            values.push({
                                path: 'sensors.gps.fromBow',
                                value: payload.dimensions.length - payload.dimensions.antennaToStern,
                            });
                        }

                        if (settings.send_vessel_information) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values,
                                }]
                            });
                        }
                        break;

                    case 'VesselPositionUnderway':
                        if (!(payload.a != null && !Number.isNaN(payload.a) && payload.o != null && !Number.isNaN(payload.o))) {
                            return
                        }
                        lastPosition = {
                            latitude: payload.a / 10_000_000,
                            longitude: payload.o / 10_000_000,
                        };
                        if (settings.send_vessel_position) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values: [{
                                        path: 'navigation.position',
                                        value: lastPosition,
                                    }]
                                }]
                            });
                        }
                        sendCalcValuesIfNeeded();
                        break;

                    case "InternalHeading":
                        if (!(payload.heading != null && !Number.isNaN(payload.heading))) { return }
                        app.handleMessage(plugin.id, {
                            updates: [{
                                values: [{
                                    path: "navigation.headingTrue",
                                    value: payload.heading != null ? payload.heading / 180 * Math.PI : null,
                                }]
                            }]
                        });
                        break;

                    case 'Heading':
                        if (payload.true != null && !Number.isNaN(payload.true)) {
                            lastHeading = payload.true;
                        }
                        break;

                    case "BarometricPressure":
                        if (
                            !(payload.internalPressure != null &&
                                !Number.isNaN(payload.internalPressure))
                        ) {
                            return
                        }
                        app.handleMessage(plugin.id, {
                            updates: [{
                                values: [{
                                    path: "environment.inside.pressure",
                                    value: payload.internalPressure,
                                }]
                            }]
                        });
                        break;

                    case 'AnchorWatchControl':
                        lastAnchorSet = payload.setAnchor;
                        lastAnchorPosition = payload.setAnchor && payload.anchorPosition?.a != null && !Number.isNaN(payload.anchorPosition.a) && payload.anchorPosition?.o != null && !Number.isNaN(payload.anchorPosition.o) ? {
                            latitude: payload.anchorPosition.a / 10_000_000,
                            longitude: payload.anchorPosition.o / 10_000_000,
                        } : null;
                        if (settings.send_anchor) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values: [{
                                        path: 'navigation.anchor.position',
                                        value: lastAnchorPosition,
                                    }, {
                                        path: 'navigation.anchor.maxRadius',
                                        value: payload.setAnchor ? payload.alarmRadius : null,
                                    }]
                                }]
                            });
                        }
                        sendCalcValuesIfNeeded();
                        break;

                    case 'AnchorWatch':
                        app.handleMessage(plugin.id, {
                            updates: [{
                                values: [{
                                    path: "notifications.navigation.anchor",
                                    value: payload.outOfBounds ? {
                                        state: "alarm",
                                        method: ["sound"],
                                        message: "Anchor out of bounds",
                                    } : {
                                        state: "normal",
                                        message: "Anchor within bounds",
                                    },
                                }]
                            }]
                        });
                        break;
                }
            });
        },
        stop: () => {
            unsubscribes.forEach(f => f());
            unsubscribes = [];

            websocket?.close();
            websocket = undefined;
        },
        schema: () => ({
            properties: {
                cortex_host: {
                    type: 'string',
                    title: 'Vesper Cortex Hub IP',
                },
                send_vessel_information: {
                    type: 'boolean',
                    title: 'Send Vessel Information (Name, MMSI, Call Sign, Type, Dimensions)',
                    default: true
                },
                send_vessel_position: {
                    type: 'boolean',
                    title: 'Send Vessel Position',
                    default: true
                },
                send_heading: {
                    type: 'boolean',
                    title: 'Send Vessel Heading (Cortex Internal)',
                    default: true
                },
                send_pressure: {
                    type: 'boolean',
                    title: 'Send Barometric Pressure',
                    default: true
                },
                send_anchor: {
                    type: 'boolean',
                    title: 'Send Anchor Position & Max. Radius',
                    default: true
                },
                send_anchor_radius: {
                    type: 'boolean',
                    title: 'Send Anchor Range & Bearing',
                    default: true
                },
                send_anchor_alarm: {
                    type: 'boolean',
                    title: 'Send Anchor Alarm',
                    default: true
                },
            },
        }),
    };

    return plugin;
};


const EARTH_RADIUS = 6371000; // Radius of the earth in m
const EARTH_CIRCUMFERENCE = EARTH_RADIUS * 2 * Math.PI;

/**
 * Returns the distance between two positions
 *
 * @param lat1 - The latitude of the first position in degrees
 * @param lon1 - The longitude of the first position in degrees
 * @param lat2 - The latitude of the second position in degrees
 * @param lon2 - The longitude of the second position in degrees
 *
 * @return number - The distance in meters
 */
function getDistance(
    { latitude: lat1, longitude: lon1 },
    { latitude: lat2, longitude: lon2 },
) {
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(degToRad(lat1)) *
        Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = EARTH_RADIUS * c; // Distance in m
    return d;
}

/**
 * Calculate the bearing between two positions as a value from 0-360
 *
 * @param lat1 - The latitude of the first position in degrees
 * @param lon1 - The longitude of the first position in degrees
 * @param lat2 - The latitude of the second position in degrees
 * @param lon2 - The longitude of the second position in degrees
 *
 * @return number - The bearing in degrees (between 0 and 360)
 */
function bearing(
    { latitude: lat1, longitude: lon1 },
    { latitude: lat2, longitude: lon2 },
) {
    const lat1Rad = degToRad(lat1);
    const lon1Rad = degToRad(lon1);
    const lat2Rad = degToRad(lat2);
    const lon2Rad = degToRad(lon2);

    const dLon = lon2Rad - lon1Rad;
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const brng = radToDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}

/**
 * convert from degrees into radians
 *
 * @param deg - The degrees to be converted into radians
 * @return radians
 */
function degToRad(deg) {
    return (deg * Math.PI) / 180;
}

/**
 * convert from radians into degrees
 *
 * @param rad - The radians to be converted into degrees
 * @return degrees
 */
function radToDeg(rad) {
    return (rad * 180) / Math.PI;
}

/**
 * Returns the new location calculated from current location, bearing(deg) and distance(meters)
 */
function getLocationFromBearing(startLocation, distance, bearingInDeg) {
    // Convert bearing to radian
    const brng = degToRad(bearingInDeg);
    // Current coords to radians
    let lat = degToRad(startLocation.latitude);
    let lon = degToRad(startLocation.longitude);

    // Do the math
    lat = Math.asin(
        Math.sin(lat) * Math.cos(distance / EARTH_RADIUS) +
        Math.cos(lat) * Math.sin(distance / EARTH_RADIUS) * Math.cos(brng)
    );
    lon += Math.atan2(
        Math.sin(brng) * Math.sin(distance / EARTH_RADIUS) * Math.cos(lat),
        Math.cos(distance / EARTH_RADIUS) - Math.sin(lat) * Math.sin(lat)
    );

    // Coords back to degrees and return
    return {
        latitude: radToDeg(lat),
        longitude: radToDeg(lon),
    }
}

