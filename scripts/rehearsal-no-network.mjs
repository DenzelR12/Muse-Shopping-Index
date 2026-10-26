// Loaded in every Node test worker. Production transports use fetch; test doubles
// explicitly inject their own mocked transport. Never fall through to live APIs.
globalThis.fetch=async()=>{throw Error('external_network_disabled_in_rehearsal');};
