const { CortexWebsocket } = require("yacht-data-streams/build/src/cortex-ws");

module.exports = (app) => {
    let unsubscribes = [];

    let websocket;

    const plugin = {
        id: "signalk-cortex-plugin",
        name: "Cortex (Vesper) VHF",
        start: (settings, restartPlugin) => {
            websocket = new CortexWebsocket(settings.cortex_host, [
                ...(settings.send_vessel_information ? ["VesselControl"] : []),
                ...(settings.send_vessel_position ? ["VesselPositionUnderway"] : []),
                ...(settings.send_heading ? ["InternalHeading"] : []),
                ...(settings.send_pressure ? ["BarometricPressure"] : []),
                ...(settings.send_anchor ? ["AnchorWatchControl"] : []),
            ]);

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
                            values.push({
                                path: 'sensors.gps.fromBow',
                                value: payload.dimensions.length - payload.dimensions.antennaToStern,
                            });
                        }

                        app.handleMessage(plugin.id, {
                            updates: [{
                                values,
                            }]
                        });
                        break;

                    case 'VesselPositionUnderway':
                        if (payload.a != null && payload.o != null) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values: [{
                                        path: 'navigation.position',
                                        value: payload.a != null && payload.o != null ? {
                                            "latitude": payload.a / 10_000_000,
                                            "longitude": payload.o / 10_000_000,
                                        } : null,
                                    }]
                                }]
                            });
                        }
                        break;

                    case "InternalHeading":
                        if (payload.heading != null && !Number.isNaN(payload.heading)) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values: [{
                                        path: "navigation.headingTrue",
                                        value: payload.heading != null ? payload.heading / 180 * Math.PI : null,
                                    }]
                                }]
                            });
                        }
                        break;

                    case "BarometricPressure":
                        if (
                            payload.internalPressure != null &&
                            !Number.isNaN(payload.internalPressure)
                        ) {
                            app.handleMessage(plugin.id, {
                                updates: [{
                                    values: [{
                                        path: "environment.inside.pressure",
                                        value: payload.internalPressure,
                                    }]
                                }]
                            });
                        }
                        break;

                    case 'AnchorWatchControl':
                        app.handleMessage(plugin.id, {
                            updates: [{
                                values: [{
                                    path: 'navigation.anchor.position',
                                    value: payload.anchorPosition?.a != null && payload.anchorPosition?.o != null ? {
                                        "latitude": (payload.anchorPosition.a / 10_000_000).toString(),
                                        "longitude": (payload.anchorPosition.o / 10_000_000).toString(),
                                    } : null,
                                }]
                            }, {
                                values: [{
                                    path: 'navigation.anchor.maxRadius',
                                    value: payload.setAnchor ? payload.alarmRadius : null,
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
            },
        }),
    };

    return plugin;
};

