# Vesper Cortex VHF SignalK Plugin

[<img src="https://img.shields.io/npm/v/signalk-cortex-plugin">](https://www.npmjs.com/package/signalk-cortex-plugin)

Connects to [Vesper Cortex Hub](http://www.vespermarine.com) via a local Ethernet network and makes the
following static & dynamic vessel information available in SignalK:

- Name, MMSI, Call Sign, Type, Dimensions
- Position
- Heading
- Barometer
- Anchor position & radius

Does not make external information available which Cortex received via NMEA, the idea is that you probably
get this into SignalK via another mechanism.

Use together with [signalk-anchoralarm-headless-plugin](https://github.com/jonaswitt/signalk-anchoralarm-headless-plugin) for an
effective anchor alarm when the boat's NMEA network is powered down.
